import { promises as fs } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { h, type Context, type Session } from 'koishi'

import { downloadSongFile, fetchSongBuffer } from './network'
import type { RuntimeConfig } from './types'

interface SongDeliveryOptions {
  forceFile: boolean
  /** 以文件形式发送时用于展示的文件名（不含扩展名）。 */
  fileName?: string
}

// 清理文件名中不安全的字符，避免歌名里的路径符号等导致上传失败。
function sanitizeFileName(name: string) {
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

  return [...cleaned].slice(0, 80).join('')
}

async function sendSongFile(ctx: Context, session: Session, src: string, fileName?: string) {
  const { filePath, extension } = await downloadSongFile(ctx, src)

  try {
    // 后缀名由 MIME 推断；name 与 title 同时携带，兼容不同 QQ 适配器。
    const baseName = fileName ? sanitizeFileName(fileName) : ''
    const title = `${baseName || 'music'}${extension}`
    await session.send(h.file(pathToFileURL(filePath).href, { name: title, title }))
  } finally {
    // 文件发送完成后及时清理临时文件。
    await fs.unlink(filePath).catch(() => {})
  }
}

export async function sendSong(
  ctx: Context,
  session: Session,
  src: string,
  config: RuntimeConfig,
  options: SongDeliveryOptions,
) {
  if (options.forceFile) {
    await sendSongFile(ctx, session, src, options.fileName)
    return
  }

  switch (config.srcToWhat) {
    case 'text':
      await session.send(h.text(src))
      return
    case 'audio':
      // Koishi 使用 audio 元素发送语音消息。
      await session.send(h.audio(src))
      return
    case 'audiobuffer': {
      const srcBuffer = await fetchSongBuffer(ctx, src)
      await session.send(h.audio(srcBuffer, 'audio/mpeg'))
      return
    }
    case 'video':
      await session.send(h.video(src))
      return
    case 'file':
      await sendSongFile(ctx, session, src, options.fileName)
  }
}
