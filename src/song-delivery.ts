import { promises as fs } from 'node:fs'
import { pathToFileURL } from 'node:url'

import { h, type Context, type Session } from 'koishi'

import { downloadSongFile, fetchSongBuffer } from './network'
import type { RuntimeConfig } from './types'

interface SongDeliveryOptions {
  forceFile: boolean
}

async function sendSongFile(ctx: Context, session: Session, src: string) {
  const tempFilePath = await downloadSongFile(ctx, src)

  try {
    await session.send(h.file(pathToFileURL(tempFilePath).href))
  } finally {
    // 文件发送完成后及时清理临时文件。
    await fs.unlink(tempFilePath).catch(() => {})
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
    await sendSongFile(ctx, session, src)
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
      await sendSongFile(ctx, session, src)
  }
}
