import type { Session } from 'koishi'

import type { PluginLogger, RuntimeConfig, SongData } from './types'

interface QQMessageApi {
  sendMessage(channelId: string, content: unknown): Promise<unknown>
  sendPrivateMessage(userId: string, content: unknown): Promise<unknown>
}

interface QQGuildMessageApi {
  sendMessage(channelId: string, content: unknown): Promise<unknown>
}

interface RawMarkdownMessage {
  msg_type: 2
  markdown: {
    content: string
  }
  msg_id?: string
  event_id?: string
}

declare module 'koishi' {
  interface Session {
    qq?: QQMessageApi
    qqguild?: QQGuildMessageApi
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getNestedValue(source: unknown, paths: string[]): unknown {
  let current: unknown = source

  for (const key of paths) {
    if (!isRecord(current) || !(key in current)) {
      return undefined
    }

    current = current[key]
  }

  return current
}

function escapeMarkdownCell(content: string) {
  return content
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replaceAll('|', '\\|')
}

function buildInlineCommand(command: string, enter: boolean) {
  return `mqqapi://aio/inlinecmd?command=${encodeURIComponent(command)}&enter=${enter ? 'true' : 'false'}&reply=false`
}

function getInteractionId(session: Session) {
  const interactionId = getNestedValue(session.event, ['_data', 'id'])
  return typeof interactionId === 'string' ? interactionId : undefined
}

function buildRawMarkdownMessage(session: Session, markdown: string): RawMarkdownMessage {
  return {
    msg_type: 2,
    msg_id: session.messageId ?? undefined,
    event_id: getInteractionId(session),
    markdown: {
      content: markdown,
    },
  }
}

function extractMessageId(result: unknown): string | null {
  if (typeof result === 'string') {
    return result
  }

  if (Array.isArray(result)) {
    const messageId = result.at(-1)
    return typeof messageId === 'string' ? messageId : null
  }

  if (!isRecord(result)) {
    return null
  }

  if (typeof result.id === 'string') {
    return result.id
  }

  if (typeof result.message_id === 'string') {
    return result.message_id
  }

  const data = result.data
  if (!isRecord(data)) {
    return null
  }

  if (typeof data.id === 'string') {
    return data.id
  }

  if (typeof data.message_id === 'string') {
    return data.message_id
  }

  return null
}

export function supportsQQMarkdown(session: Session) {
  return session.platform === 'qq' || session.platform === 'qqguild'
}

export function buildQQMarkdownSongList(
  songs: SongData[],
  startIndex: number,
  config: RuntimeConfig,
) {
  const cancelCommand = config.exitCommandList[0] ?? '0'
  const prevPageLink = buildInlineCommand(config.prevPageCommand, true)
  const nextPageLink = buildInlineCommand(config.nextPageCommand, true)
  const cancelLink = buildInlineCommand(cancelCommand, true)
  const retryLink = buildInlineCommand(`${config.commandName} `, false)
  const rows = songs.map((song, index) => {
    const serialNumber = startIndex + index + 1
    const playLink = buildInlineCommand(String(serialNumber), true)

    return `|[播放](${playLink})|${escapeMarkdownCell(song.name)}|${escapeMarkdownCell(song.artists)}|`
  })

  const lines = [
    '# 歌单',
    '',
    '|点歌|歌曲名称|歌手|',
    '|---|---|---|',
    ...rows,
    '',
    `请在 ${config.waitForTimeout} 秒内选择歌曲。`,
  ]

  if (config.menuExitCommandTip) {
    lines.push(`退出：发送 \`${config.exitCommandList.join(' / ')}\`。`)
  }

  lines.push('')
  lines.push(`|[上一页](${prevPageLink})|[下一页](${nextPageLink})|`)
  lines.push('|---|---|')
  lines.push(`|[取消点歌](${cancelLink})|[再次点歌](${retryLink})|`)

  return lines.join('\n')
}

export async function sendQQMarkdownSongList(
  session: Session,
  markdown: string,
  logger: PluginLogger,
) {
  const message = buildRawMarkdownMessage(session, markdown)
  const guildId = session.event.guild?.id
  const userId = session.event.user?.id

  if (guildId) {
    if (session.qq) {
      const result = await session.qq.sendMessage(session.channelId, message)
      return extractMessageId(result)
    }

    if (session.qqguild) {
      const result = await session.qqguild.sendMessage(session.channelId, message)
      return extractMessageId(result)
    }
  }

  if (userId && session.qq) {
    const result = await session.qq.sendPrivateMessage(userId, message)
    return extractMessageId(result)
  }

  logger.warn('当前会话没有可用的 QQ 原生 Markdown 发送目标。')
  return null
}
