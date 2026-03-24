import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import type { Context } from 'koishi'

import type { PluginLogger, RuntimeConfig, SongData } from './types'

const templateCandidates = [
  path.resolve(__dirname, '../data/song-list.html'),
]

const songListTemplate = loadSongListTemplate()

function loadSongListTemplate() {
  for (const candidate of templateCandidates) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8')
    }
  }

  throw new Error('找不到歌单图片模板文件。')
}

function escapeHtml(content: string) {
  return content
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export function formatSongList(data: SongData[], platform: string, startIndex: number, imageMode: boolean) {
  const prefix = imageMode ? `<b>${escapeHtml(platform)}</b>:<br/>` : `${platform}:\n`
  const separator = imageMode ? '<br/>' : '\n'
  const formatted = data.map((song, index) => {
    const line = `${index + startIndex + 1}. ${song.name} -- ${song.artists} -- ${song.albumName}`
    return imageMode ? escapeHtml(line) : line
  }).join(separator)

  return `${prefix}${formatted}`
}

export async function generateSongListImage(
  ctx: Context,
  listText: string,
  config: RuntimeConfig,
  logger: PluginLogger,
) {
  if (!ctx.puppeteer) {
    logger.warn('puppeteer 服务未启用，无法生成图片歌单。')
    return null
  }

  const runtimeStyle = [
    '<style id="music-voice-runtime-style">',
    ':root {',
    `  --music-voice-background: ${config.backgroundChannel ?? 'rgba(0, 0, 0, 1)'};`,
    `  --music-voice-text: ${config.textChannel ?? 'rgba(255, 255, 255, 1)'};`,
    '}',
    '</style>',
  ].join('\n')

  const content = songListTemplate
    .replace('<!-- MUSIC_VOICE_RUNTIME_STYLE -->', runtimeStyle)
    .replace('<!-- MUSIC_VOICE_CONTENT -->', listText)

  const page = await ctx.puppeteer.page()

  try {
    await page.setContent(content)
    const list = await page.$('#song-list')

    if (!list) {
      return null
    }

    return await list.screenshot({})
  } finally {
    await page.close()
  }
}
