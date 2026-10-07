import { promises as fs } from 'node:fs'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'

import type { Context } from 'koishi'

import { PRESET_FULL_METING_APIS, PRESET_TRIAL_METING_APIS } from './config'
import type { NetEasePodcastResponse, NetEaseSearchResponse, PluginLogger, RuntimeConfig, SearchRequestMode, SongData } from './types'

const SEARCH_TIMEOUT_MS = 5000
const SOURCE_TIMEOUT_MS = 5000
const DOWNLOAD_TIMEOUT_MS = 15000
const PROXY_URL = 'https://web-proxy.apifox.cn/api/v1/request'
const REQUEST_TIMEOUT_REASON = 'music-voice-request-timeout'

interface RequestCandidate {
  label: string
  run: (signal: AbortSignal) => Promise<string>
}

// 候选请求返回“格式正确但内容为空”（例如空歌曲列表）时标记的错误。
// 空结果不应当作成功，需要继续等待其他候选（如代理）返回。
class EmptyResultError extends Error {
  constructor(description: string) {
    super(`${description} 返回空结果`)
    this.name = 'EmptyResultError'
  }
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

function buildCandidates(targetUrls: string[], mode: SearchRequestMode, timeoutMs: number): RequestCandidate[] {
  return targetUrls.flatMap((targetUrl) => {
    const label = getHostLabel(targetUrl)
    const candidates: RequestCandidate[] = []

    if (mode === 'parallel' || mode === 'direct') {
      candidates.push({
        label: `${label} 直连`,
        run: (signal) => requestText(targetUrl, signal),
      })
    }

    if (mode === 'parallel' || mode === 'proxy') {
      candidates.push({
        label: `${label} 代理`,
        run: (signal) => requestTextByProxy(targetUrl, signal, timeoutMs),
      })
    }

    return candidates
  })
}

function buildSearchCandidates(targetUrls: string[], mode: SearchRequestMode, timeoutMs: number) {
  return buildCandidates(targetUrls, mode, timeoutMs)
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
  /** 判定结果是否为空（空结果按失败处理，会继续等待其他候选）。 */
  isEmpty?: (value: T) => boolean,
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

      // 空结果视为失败，让 Promise.any 继续等待其他候选返回。
      if (isEmpty?.(parsed)) {
        throw new EmptyResultError(candidate.label)
      }

      logger.debug(`${description} 命中`, candidate.label)
      return parsed
    } catch (error) {
      // 空结果需要保留原始错误类型，便于汇总时区分“搜不到”与“请求失败”。
      if (error instanceof EmptyResultError) {
        logger.debug(`${description} 返回空结果`, candidate.label)
        throw error
      }

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
    // 全部候选失败：若每个候选都只是返回空结果，则视为没有搜索到可用内容。
    if (error instanceof AggregateError && error.errors.length > 0
      && error.errors.every((item: unknown) => item instanceof EmptyResultError)) {
      logger.debug(`${description} 全部返回空结果`, error.errors.length)
      throw new EmptyResultError(description)
    }

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
  let response: NetEaseSearchResponse

  try {
    response = await raceRequests(
      ctx,
      buildSearchCandidates([searchApiUrl], config.searchRequestMode, SEARCH_TIMEOUT_MS),
      SEARCH_TIMEOUT_MS,
      parseSearchResponse,
      '网易云搜索',
      logger,
      // 空歌曲列表视为无效结果，交由其他候选（直连/代理）继续尝试。
      (parsed) => !parsed.result?.songs?.length,
    )
  } catch (error) {
    // 所有候选都只返回空列表时，按“未搜索到歌曲”返回空数组，由上层提示更换关键词。
    if (error instanceof EmptyResultError) {
      return []
    }

    throw error
  }

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
  // Meting 需要显式指定网易云源。
  const presetApis = config.allowTrialOnly
    ? PRESET_TRIAL_METING_APIS
    : PRESET_FULL_METING_APIS
  const targetUrls = config.type === 'apis'
    ? presetApis.map((api) => `${api}?server=netease&type=url&id=${songId}`)
    : [`${config.text}?server=netease&type=url&id=${songId}`]

  return await raceRequests(
    ctx,
    buildDirectCandidates(targetUrls),
    SOURCE_TIMEOUT_MS,
    tryParseUrl,
    '歌曲直链获取',
    logger,
  )
}

export async function resolvePodcastSource(
  ctx: Context,
  config: RuntimeConfig,
  podcastUrl: string,
  logger: PluginLogger,
) {
  const url = new URL(podcastUrl)
  const programId = url.searchParams.get('id')

  if (!programId || !/^\d+$/.test(programId)) {
    throw new Error('网易云播客链接缺少有效的节目 ID')
  }

  const controller = new AbortController()
  const disposeTimeout = createTimeout(ctx, controller, SOURCE_TIMEOUT_MS)

  try {
    // 通过节目详情接口拿到对应音频 ID。
    const response = await fetch(
      `https://music.163.com/api/dj/program/detail?id=${programId}`,
      {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Referer: 'https://music.163.com/',
        },
      },
    )

    if (!response.ok) {
      throw new Error(`节目详情 HTTP ${response.status}`)
    }

    const data = await response.json() as NetEasePodcastResponse
    const songId = data.program?.mainSong?.id

    if (!songId) {
      throw new Error('节目详情中没有找到音频 ID')
    }

    logger.debug('网易云播客节目已解析', { programId, songId })

    const source = await resolveSongSource(ctx, config, songId, logger)

    return {
      source,
      duration: data.program?.mainSong?.duration ?? data.program?.duration ?? 0,
      songId,
    }
  } finally {
    disposeTimeout()
    controller.abort()
  }
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
