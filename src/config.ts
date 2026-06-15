import { Schema } from 'koishi'

export const PRESET_METING_APIS = [
  'https://api.injahow.cn/meting/',
  'https://api.qijieya.cn/meting/',
  'https://api.moeyao.cn/meting/',
  'https://meting.jinghuashang.cn/',
  'https://meting.qjqq.cn/',
  'https://api.crowya.com/meting/',
  'https://meting-api.mlj-dragon.cn/meting/',
  'https://api.amarea.cn/meting/',
]

export const Config = Schema.intersect([
  Schema.object({
    commandName: Schema.string().description('使用的指令名称').default('music'),
    generationTip: Schema.string().description('生成语音时返回的文字提示内容').default('生成语音中...'),
    recallTargets: Schema.array(Schema.union([
      Schema.const('generationTip').description('生成提示语（生成语音中...）'),
      Schema.const('songList').description('歌单消息'),
    ]))
      .role('checkbox')
      .default(['generationTip', 'songList'])
      .description('勾选后会在流程结束时撤回对应消息'),
    silentMessages: Schema.array(Schema.union([
      Schema.const('promptTimeout').description('超时提示（输入超时，已取消点歌）'),
      Schema.const('exitPrompt').description('退出提示（已退出歌曲选择）'),
      Schema.const('invalidNumber').description('序号错误提示（输入序号错误，已退出歌曲选择）'),
      Schema.const('durationExceeded').description('时长超限提示（歌曲时长超出限制）'),
      Schema.const('getSongFailed').description('获取失败提示（获取歌曲失败，请稍后再试）'),
    ]))
      .role('checkbox')
      .default([])
      .description('勾选后不会发送对应提示消息'),
    waitForTimeout: Schema.natural().min(1).step(1).description('等待用户选择歌曲序号的最长时间（秒）').default(45),
  }).description('基础设置'),

  Schema.object({
    listMode: Schema.union([
      Schema.const('text').description('纯文本歌单'),
      Schema.const('image').description('图片歌单（需要 puppeteer 服务）'),
    ]).role('radio').description('歌单发送模式').default('text'),
    preferQQMarkdown: Schema.boolean()
      .description('是否在 qq平台 尝试使用原生 Markdown 发送歌单')
      .default(false),
  }).description('歌单设置'),
  Schema.union([
    Schema.object({
      listMode: Schema.const('image').required(),
      textChannel: Schema.string().description('图片歌单的文字颜色').role('color').default('rgba(255, 255, 255, 1)'),
      backgroundChannel: Schema.string().description('图片歌单的背景颜色').role('color').default('rgba(0, 0, 0, 1)'),
    }),
    Schema.object({}),
  ]),

  Schema.object({
    searchListCount: Schema.natural().description('搜索结果列表数量').default(20),
    nextPageCommand: Schema.string().description('翻页指令：下一页').default('下一页'),
    prevPageCommand: Schema.string().description('翻页指令：上一页').default('上一页'),
    exitCommandList: Schema.array(Schema.string()).role('table').description('退出选择指令，每行一个').default(['0', '不听了']),
    menuExitCommandTip: Schema.boolean().description('是否在歌单后面补充退出提示').default(false),
    maxSongDuration: Schema.natural().min(1).step(1).description('歌曲最大时长（分钟）').default(30),
  }).description('进阶设置'),

  Schema.object({
    enableRateLimit: Schema.boolean().description('是否启用频率限制').default(false),
  }).description('频率限制'),
  Schema.union([
    Schema.object({
      enableRateLimit: Schema.const(true).required(),
      rateLimitScope: Schema.union([
        Schema.const('user').description('按单个用户限制'),
        Schema.const('channel').description('按单个频道限制'),
        Schema.const('platform').description('按单个平台限制'),
      ]).description('频率限制范围').default('user'),
      rateLimitInterval: Schema.natural().min(1).step(1).description('频率限制间隔（秒）').default(60),
    }),
    Schema.object({
      enableRateLimit: Schema.const(false),
    }),
  ]),

  Schema.object({
    type: Schema.union([
      Schema.const('apis').description('预设 API'),
      Schema.const('custom').description('自定义 API'),
    ]).description('获取音乐直链的后端').default('apis'),
    searchRequestMode: Schema.union([
      Schema.const('parallel').description('并行请求'),
      Schema.const('direct').description('直连'),
      Schema.const('proxy').description('代理'),
    ]).role('radio').description('网易云搜索请求模式').default('parallel'),
  }).description('请求设置'),
  Schema.union([
    Schema.object({
      type: Schema.const('apis'),
    }),
    Schema.object({
      type: Schema.const('custom').required(),
      text: Schema.string()
        .default('https://api.injahow.cn/meting/')
        .description('自定义后端 API 地址')
        .role('link'),
    }),
  ]),

  Schema.object({
    srcToWhat: Schema.union([
      Schema.const('text').description('文本 h.text'),
      Schema.const('audio').description('语音 h.audio'),
      Schema.const('audiobuffer').description('语音（buffer）h.audio'),
      Schema.const('video').description('视频 h.video'),
      Schema.const('file').description('文件 h.file'),
    ]).role('radio').default('audio').description('歌曲信息返回格式'),
  }).description('调试设置'),

  Schema.object({
    loggerinfo: Schema.boolean().default(false).description('调试日志模式'),
  }).description('开发者选项'),
])
