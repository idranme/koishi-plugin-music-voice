import type { Context } from 'koishi'

import type { PluginLogger, RuntimeConfig } from './types'

export function createPluginLogger(ctx: Context, config: RuntimeConfig): PluginLogger {
  const logger = ctx.logger('music-voice')

  return {
    debug: (...args) => {
      if (config.loggerinfo) {
        Reflect.apply(logger.info, logger, args)
      }
    },
    warn: (message, error) => {
      if (error === undefined) {
        logger.warn(message)
        return
      }
      logger.warn(message, error)
    },
    error: (message, error) => {
      if (error === undefined) {
        logger.error(message)
        return
      }
      logger.error(message, error)
    },
  }
}
