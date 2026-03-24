import { Context } from 'koishi'
import {} from 'koishi-plugin-puppeteer'

import { registerMusicVoiceCommand } from './command'
import { Config } from './config'
import { registerI18n } from './i18n'
import { createPluginLogger } from './logger'
import { createMessageBehavior } from './message-behavior'
import type { RuntimeConfig } from './types'
import { usage } from './usage'

export const name = 'music-voice'

export const inject = {
  required: ['logger', 'http', 'i18n'],
  optional: ['puppeteer'],
}

export { Config, usage }

export function apply(ctx: Context, config: RuntimeConfig) {
  const logger = createPluginLogger(ctx, config)
  const messageBehavior = createMessageBehavior(config)

  registerI18n(ctx, config)
  registerMusicVoiceCommand(ctx, config, {
    logger,
    messageBehavior,
  })
}
