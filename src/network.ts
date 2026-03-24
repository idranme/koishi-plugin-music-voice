import { promises as fs } from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import type { Context } from 'koishi'

import { PRESET_METING_APIS } from './config'
import type { NetEaseSearchResponse, PluginLogger, RuntimeConfig, SongData } from './types'

const SEARCH_TIMEOUT_MS = 5000
const SOURCE_TIMEOUT_MS = 5000
const DOWNLOAD_TIMEOUT_MS = 15000
const PROXY_URL = 'https://web-proxy.apifox.cn/api/v1/request'
const REQUEST_TIMEOUT_REASON = 'music-voice-request-timeout'

interface RequestCandidate {
  label: string
  run: (signal: AbortSignal) => Promise<string>
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function getHostLabel(targetUrl: string) {
  try {
    return new URL(targetUrl).host
  } catch {
    return targetUrl
  }
}

function createTimeout(ctx: Context, controller: AbortController, timeoutMs: number) {
  return ctx.setTimeout(() => controller.abort(REQUEST_TIMEOUT_REASON), timeoutMs)
}

async function requestText(targetUrl: string, signal: AbortSignal) {
  const response = await fetch(targetUrl, {
    method: 'GET',
    signal,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return await response.text()
}

async function requestTextByProxy(targetUrl: string, signal: AbortSignal, timeoutMs: number) {
  const response = await fetch(PROXY_URL, {
    method: 'POST',
    signal,
    headers: {
      'api-u': targetUrl,
      'api-o0': `method=GET, timings=true, timeout=${timeoutMs}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  return await response.text()
}

function buildCandidates(targetUrls: string[], useProxy: boolean, timeoutMs: number): RequestCandidate[] {
  return targetUrls.flatMap((targetUrl) => {
    const label = getHostLabel(targetUrl)
    const candidates: RequestCandidate[] = [{
      label: `${label} 直连`,
      run: (signal) => requestText(targetUrl, signal),
    }]

    if (useProxy) {
      candidates.push({
        label: `${label} 代理`,
        run: (signal) => requestTextByProxy(targetUrl, signal, timeoutMs),
      })
    }

    return candidates
  })
}

function buildSmartCandidates(targetUrls: string[], timeoutMs: number) {
  return buildCandidates(targetUrls, true, timeoutMs)
}

function isMediaContentType(contentType: string | null) {
  if (!contentType) {
    return false
  }

  const normalized = contentType.toLowerCase()
  return normalized.startsWith('audio/')
    || normalized.startsWith('video/')
    || normalized.includes('application/octet-stream')
}

async function requestSource(targetUrl: string, signal: AbortSignal) {
  const response = await fetch(targetUrl, {
    method: 'GET',
    signal,
  })

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  if (isMediaContentType(response.headers.get('content-type'))) {
    await response.body?.cancel()
    return response.url || targetUrl
  }

  return await response.text()
}

function buildDirectCandidates(targetUrls: string[]): RequestCandidate[] {
  return targetUrls.map((targetUrl) => ({
    label: `${getHostLabel(targetUrl)} 直连`,
    run: (signal) => requestSource(targetUrl, signal),
  }))
}

async function raceRequests<T>(
  ctx: Context,
  candidates: RequestCandidate[],
  timeoutMs: number,
  parser: (content: string) => T | null,
  description: string,
  logger: PluginLogger,
) {
  if (!candidates.length) {
    throw new Error(`${description} 没有可用请求。`)
  }

  const controllers = candidates.map(() => new AbortController())
  const tasks = candidates.map(async (candidate, index) => {
    const controller = controllers[index]
    const disposeTimeout = createTimeout(ctx, controller, timeoutMs)

    try {
      logger.debug(`${description} 开始请求`, candidate.label)
      const raw = await candidate.run(controller.signal)
      const parsed = parser(raw)

      if (parsed === null) {
        throw new Error('返回结果不可用')
      }

      logger.debug(`${description} 命中`, candidate.label)
      return parsed
    } catch (error) {
      if (controller.signal.aborted && controller.signal.reason === REQUEST_TIMEOUT_REASON) {
        throw new Error(`${candidate.label} 请求超时`)
      }

      if (controller.signal.aborted) {
        throw new Error(`${candidate.label} 已取消`)
      }

      throw new Error(`${candidate.label} 请求失败：${getErrorMessage(error)}`)
    } finally {
      disposeTimeout()
    }
  })

  try {
    return await Promise.any(tasks)
  } catch (error) {
    logger.error(`${description} 全部失败`, error)
    throw error
  } finally {
    for (const controller of controllers) {
      controller.abort()
    }
  }
}

function parseSearchResponse(content: string) {
  try {
    const parsed = JSON.parse(content) as NetEaseSearchResponse

    if (!parsed || typeof parsed !== 'object') {
      return null
    }

    return parsed
  } catch {
    return null
  }
}

function tryParseUrl(content: string) {
  const trimmed = content.trim()

  if (!trimmed) {
    return null
  }

  try {
    const parsed = new URL(trimmed)

    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return trimmed
    }
  } catch {
    // 忽略，继续尝试解析 JSON。
  }

  try {
    const parsed = JSON.parse(trimmed) as { url?: unknown }

    if (typeof parsed.url !== 'string') {
      return null
    }

    const normalized = parsed.url.trim()
    const url = new URL(normalized)

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return normalized
    }
  } catch {
    return null
  }

  return null
}

function resolveExtension(contentType: string | null) {
  if (!contentType) {
    return '.mp3'
  }

  if (contentType.includes('audio/mpeg')) return '.mp3'
  if (contentType.includes('audio/mp4')) return '.m4a'
  if (contentType.includes('audio/wav')) return '.wav'
  if (contentType.includes('audio/flac')) return '.flac'

  return '.mp3'
}

async function fetchArrayBuffer(ctx: Context, targetUrl: string, timeoutMs: number) {
  const controller = new AbortController()
  const disposeTimeout = createTimeout(ctx, controller, timeoutMs)

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }

    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type'),
    }
  } finally {
    disposeTimeout()
    controller.abort()
  }
}

export async function searchNetEase(
  ctx: Context,
  config: RuntimeConfig,
  keyword: string,
  limit: number,
  offset: number,
  logger: PluginLogger,
) {
  const searchApiUrl = `http://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&total=true&limit=${limit}`
  const response = await raceRequests(
    ctx,
    buildSmartCandidates([searchApiUrl], SEARCH_TIMEOUT_MS),
    SEARCH_TIMEOUT_MS,
    parseSearchResponse,
    '网易云搜索',
    logger,
  )

  const songs = response.result?.songs ?? []

  return songs.map<SongData>((song) => ({
    id: song.id,
    name: song.name,
    artists: song.artists.map((artist) => artist.name).join('/'),
    albumName: song.album.name,
    duration: song.duration,
  }))
}

export async function resolveSongSource(
  ctx: Context,
  config: RuntimeConfig,
  songId: number,
  logger: PluginLogger,
) {
  const targetUrls = config.type === 'apis'
    ? PRESET_METING_APIS.map((api) => `${api}?type=url&id=${songId}`)
    : [`${config.text}?type=url&id=${songId}`]

  return await raceRequests(
    ctx,
    buildDirectCandidates(targetUrls),
    SOURCE_TIMEOUT_MS,
    tryParseUrl,
    '歌曲直链获取',
    logger,
  )
}

export async function fetchSongBuffer(ctx: Context, targetUrl: string) {
  const result = await fetchArrayBuffer(ctx, targetUrl, DOWNLOAD_TIMEOUT_MS)
  return result.buffer
}

export async function downloadSongFile(ctx: Context, targetUrl: string) {
  const result = await fetchArrayBuffer(ctx, targetUrl, DOWNLOAD_TIMEOUT_MS)
  const filename = `${crypto.randomBytes(8).toString('hex')}${resolveExtension(result.contentType)}`
  const filePath = path.join(os.tmpdir(), filename)

  await fs.writeFile(filePath, result.buffer)
  return filePath
}
