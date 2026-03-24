import type { RecallTarget, RuntimeConfig, SilentMessage } from './types'

export interface MessageBehavior {
  shouldRecall: (target: RecallTarget) => boolean
  shouldSilence: (target: SilentMessage) => boolean
}

const DEFAULT_RECALL_TARGETS: RecallTarget[] = ['generationTip', 'songList']

export function createMessageBehavior(config: RuntimeConfig): MessageBehavior {
  const recallTargets = new Set<RecallTarget>(
    config.recallTargets ?? DEFAULT_RECALL_TARGETS,
  )
  const silentMessages = new Set<SilentMessage>(
    config.silentMessages ?? [],
  )

  return {
    shouldRecall: (target) => recallTargets.has(target),
    shouldSilence: (target) => silentMessages.has(target),
  }
}
