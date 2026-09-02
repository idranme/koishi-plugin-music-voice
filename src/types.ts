export type RecallTarget = 'generationTip' | 'songList'

export type SilentMessage =
  | 'promptTimeout'
  | 'exitPrompt'
  | 'invalidNumber'
  | 'durationExceeded'
  | 'getSongFailed'

export type RateLimitScope = 'user' | 'channel' | 'platform'

export type RequestMode = 'apis' | 'custom'

export type SearchRequestMode = 'parallel' | 'direct' | 'proxy'

export type SendType = 'text' | 'audio' | 'audiobuffer' | 'video' | 'file'

export type ListMode = 'text' | 'image'

export interface MusicVoiceConfig {
  commandName: string
  commandAlias: string
  generationTip: string
  recallTargets?: RecallTarget[]
  silentMessages?: SilentMessage[]
  waitForTimeout: number
  listMode: ListMode
  preferQQMarkdown?: boolean
  textChannel?: string
  backgroundChannel?: string
  searchListCount: number
  nextPageCommand: string
  prevPageCommand: string
  exitCommandList: string[]
  menuExitCommandTip: boolean
  maxSongDuration: number
  enableRateLimit: boolean
  rateLimitScope?: RateLimitScope
  rateLimitInterval?: number
  type: RequestMode
  text?: string
  allowTrialOnly: boolean
  searchRequestMode: SearchRequestMode
  srcToWhat: SendType
  loggerinfo: boolean
}

export type RuntimeConfig = MusicVoiceConfig

export interface SongData {
  id: number
  name: string
  artists: string
  albumName: string
  duration: number
  lrc?: string
}

export interface NetEaseSearchResponse {
  result?: {
    songs?: NetEaseSongItem[]
  }
}

export interface NetEaseSongItem {
  id: number
  name: string
  artists: Array<{ name: string }>
  album: { name: string }
  duration: number
}

export interface NetEasePodcastResponse {
  program?: {
    mainSong?: { id?: number; duration?: number }
    duration?: number
  }
}

export interface PluginLogger {
  debug: (...args: unknown[]) => void
  warn: (message: string, error?: unknown) => void
  error: (message: string, error?: unknown) => void
}
