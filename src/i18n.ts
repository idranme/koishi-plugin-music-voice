import type { Context } from 'koishi'

import type { RuntimeConfig } from './types'

export function registerI18n(ctx: Context, config: RuntimeConfig) {
  const prefix = ctx.root.config.prefix?.[0] ?? ''

  ctx.i18n.define('zh-CN', {
    commands: {
      [config.commandName]: {
        description: '搜索歌曲并播放网易云音乐',
        messages: {
          nokeyword: `请输入歌曲相关信息。\n示例：${prefix}${config.commandName} 蔚蓝档案`,
          songlisterror: '无法获取歌曲列表，请稍后再试。',
          invalidKeyword: '无法获取歌曲列表，请尝试更换关键词。',
          exitCommandTip: '退出选择请发送 [{0}] 中的任意内容<br/><br/>',
          imageGenerationFailed: '生成图片歌单失败，请检查 puppeteer 服务是否正常。',
          imageListPrompt: '{0}请在 {1} 秒内，\n输入歌曲对应的序号。',
          textListPrompt: '{0}<br/><br/>{1}请在 {2} 秒内，<br/>输入歌曲对应的序号。',
          promptTimeout: '输入超时，已取消点歌。',
          exitPrompt: '已退出歌曲选择。',
          invalidNumber: '序号输入错误，已退出歌曲选择。',
          durationExceeded: '歌曲持续时间超出限制。',
          getSongFailed: '获取歌曲失败，请稍后再试。',
          noMoreSongs: '没有更多歌曲了。',
          alreadyOnFirstPage: '已经是第一页了。',
          rateLimitExceeded: '操作过于频繁，请在 {0} 秒后再试。',
        },
      },
    },
  })
}
