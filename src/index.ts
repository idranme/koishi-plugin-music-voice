import { Context, Schema, h, isNullable, Time } from 'koishi'
import type { } from 'koishi-plugin-puppeteer'

export const name = 'music-voice'
export const inject = {
  required: ['http'],
  optional: ['puppeteer']
}

export const usage = `
<a target="_blank" href="https://github.com/idranme/koishi-plugin-music-voice?tab=readme-ov-file#%E4%BD%BF%E7%94%A8%E8%AF%A5%E6%8F%92%E4%BB%B6%E6%90%9C%E7%B4%A2%E5%B9%B6%E8%8E%B7%E5%8F%96%E6%AD%8C%E6%9B%B2">➤ 食用方法点此获取</a>

---

本插件旨在 安装即可语音点歌。

因各种不可抗力因素，目前使用 [龙珠API-网易云音乐](https://www.hhlqilongzhu.cn/) 作为后端服务。

更多功能与后端选择，欢迎使用 [➣ music-link](/market?keyword=music-link)
`;

export interface Config {
  generationTip: string
  waitTimeout: number
  exitCommand: string
  menuExitCommandTip: boolean
  recall: boolean
  imageMode: boolean
  darkMode: boolean;
  searchListCount: number;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    generationTip: Schema.string().description('生成语音时返回的文字提示内容').default('生成语音中…'),
    waitTimeout: Schema.natural().role('ms').min(Time.second).step(Time.second).description('等待用户选择歌曲序号的最长时间')
      .default(45 * Time.second)
  }).description('基础设置'),
  Schema.object({
    imageMode: Schema.boolean().description('开启后返回图片歌单，关闭后返回文本歌单').required(),
    darkMode: Schema.boolean().description('是否开启图片歌单暗黑模式').default(true)
  }).description('歌单设置'),
  Schema.object({
    exitCommand: Schema.string().description('退出选择指令，多个指令间请用逗号分隔开').default('0, 不听了'),
    menuExitCommandTip: Schema.boolean().description('是否在歌单内容的后面，加上退出选择指令的文字提示').default(false),
    recall: Schema.boolean().description('是否在发送语音后撤回 generationTip').default(true),
    searchListCount: Schema.natural().description('搜索歌曲列表的数量').default(20),
  }).description('进阶设置')
])

interface SongData {
  song_name: string;
  song_singer: string;
  quality: string;
  cover: string;
  link: string;
  music_url: string;
  lyric?: string;
  platform: 'NetEase Music';
  index: number;
}

function formatSongList(data: SongData[], startIndex: number) {
  const netEaseMusicList = data.filter(song => song.platform === 'NetEase Music');

  let formatted = '';

  if (netEaseMusicList.length > 0) {
    const netEaseFormatted = netEaseMusicList.map((song) => {
      return `${song.index}. ${song.song_name} -- ${song.song_singer}`;
    }).join('<br/>');
    formatted += `<b>NetEase Music</b>:<br/>${netEaseFormatted}`;
  }

  return formatted;
}


export function apply(ctx: Context, cfg: Config) {
  const logger = ctx.logger('music-voice')
  ctx.command('music <keyword:text>', '搜索歌曲并播放')
    .alias('mdff', '点歌')
    .action(async ({ session }, keyword) => {
      if (!keyword) return '请输入歌曲相关信息。'

      let songData: SongData[] = [];
      try {
        songData = await searchMusic(keyword, cfg.searchListCount)
      } catch (err) {
        logger.warn('获取歌曲数据时发生错误', err.message)
        return '无法获取歌曲列表，请稍后再试。'
      }


      if (!songData.length) return '无法获取歌曲列表，请尝试更换关键词。'


      const listText = formatSongList(songData, 0)
      const exitCommands = cfg.exitCommand.split(/[,，]/).map(cmd => cmd.trim())
      const exitCommandTip = cfg.menuExitCommandTip ? `退出选择请发[${exitCommands}]中的任意内容<br/><br/>` : ''

      let quoteId = session.messageId

      if (cfg.imageMode) {
        const imageBuffer = await generateSongListImage(listText, cfg)
        if (!imageBuffer) { // 检查 imageBuffer 是否为 null
          return '生成图片歌单失败，请检查 puppeteer 服务是否正常。';
        }
        const payload = [
          h.quote(quoteId),
          h.image(imageBuffer, 'image/png'),
          h.text(`${exitCommandTip.replaceAll('<br/>', '\n')}请在 `),
          h('i18n:time', { value: cfg.waitTimeout }),
          h.text('内，\n'),
          h.text('输入歌曲对应的序号')
        ]
        const msg = await session.send(payload)
        quoteId = msg.at(-1)
      } else {
        const payload = `${h.quote(quoteId)}${listText}<br/><br/>${exitCommandTip}请在 <i18n:time value="${cfg.waitTimeout}"/>内，<br/>输入歌曲对应的序号`
        const msg = await session.send(payload)
        quoteId = msg.at(-1)
      }

      const input = await session.prompt((session) => {
        quoteId = session.messageId
        return h.select(session.elements, 'text').join('')
      }, { timeout: cfg.waitTimeout })

      if (isNullable(input)) return `${quoteId ? h.quote(quoteId) : ''}输入超时，已取消点歌。`
      if (exitCommands.includes(input)) {
        return `${h.quote(quoteId)}已退出歌曲选择。`
      }

      const serialNumber = +input
      if (!Number.isInteger(serialNumber) || serialNumber < 1 || serialNumber > songData.length) {
        return `${h.quote(quoteId)}序号输入错误，已退出歌曲选择。`
      }


      const selected = songData[serialNumber - 1]


      const [tipMessageId] = await session.send(h.quote(quoteId) + `` + h.text(cfg.generationTip))

      try {
        let music_url = selected.music_url;
        // 再次请求API获取歌曲真实URL - 网易云音乐平台
        if (selected.platform === 'NetEase Music') {
          const wyDetailsUrl = `https://www.hhlqilongzhu.cn/api/dg_wyymusic.php?gm=${encodeURIComponent(keyword)}&type=json&num=${cfg.searchListCount}&n=${selected.index}`; // 序号直接使用 index
          const wyDetailResponse = await ctx.http.get(wyDetailsUrl);
          if (wyDetailResponse && wyDetailResponse.music_url) {
            music_url = wyDetailResponse.music_url;
          } else {
            logger.warn('获取网易云音乐失败', wyDetailResponse);
            return;
          }
        }
        await session.send(h.audio(music_url))
        if (cfg.recall) session.bot.deleteMessage(session.channelId, tipMessageId)
      } catch (err) {
        if (cfg.recall) session.bot.deleteMessage(session.channelId, tipMessageId)
        logger.error('获取歌曲详情或发送语音失败', err);
        return `${h.quote(quoteId)}获取歌曲失败，请稍后再试。`
      }
    })

  async function searchMusic(keyword: string, limit: number): Promise<SongData[]> {
    let wySongs: SongData[] = [];

    try {
      const wyUrl = `https://www.hhlqilongzhu.cn/api/dg_wyymusic.php?gm=${encodeURIComponent(keyword)}&type=json&num=${limit}`;
      const wyData = await ctx.http.get(wyUrl);

      if (wyData && wyData.code === 200 && wyData.data) {
        wySongs = (wyData.data as any[]).map((item, index) => ({
          song_name: item.title || '未知歌名',
          song_singer: item.singer || '未知歌手',
          quality: item.id,
          cover: item.cover,
          link: item.link,
          music_url: item.music_url,
          lyric: item.lrc,
          platform: 'NetEase Music',
          index: index + 1,
        })) as SongData[];
      } else {
        logger.warn('搜索网易云音乐失败', wyData);
      }
    } catch (error) {
      logger.error('搜索网易云音乐失败', error);
    }

    let currentIndex = 1;
    wySongs.forEach(song => {
      song.index = currentIndex++;
    });

    return [...wySongs];
  }

  async function generateSongListImage(listText: string, cfg: Config) {
    if (!ctx.puppeteer) {
      logger.warn('puppeteer 服务未启用，无法生成图片歌单。');
      return null;
    }
    const textChannel = cfg.darkMode ? 255 : 0
    const backgroundChannel = cfg.darkMode ? 0 : 255
    const content = `
        <!DOCTYPE html>
        <html lang="zh">
          <head>
            <title>music</title>
            <meta charset="UTF-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <style>
              body {
                margin: 0;
                font-family: "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei", SimSun, sans-serif;
                font-size: 16px;
                background: rgb(${backgroundChannel} ${backgroundChannel} ${backgroundChannel});
                color: rgb(${textChannel} ${textChannel} ${textChannel});
                min-height: 100vh;
              }
              #song-list {
                padding: 20px;
                display: inline-block; /* 使div适应内容宽度 */
                max-width: 100%; /* 防止内容溢出 */
                white-space: nowrap; /* 防止歌曲名称换行 */
                transform: scale(0.9);
              }
              s {
                text-decoration-thickness: 1.5px;
              }
            </style>
          </head>
          <body>
            <div id="song-list">${listText}</div>
          </body>
        </html>
      `
    const page = await ctx.puppeteer.page()
    await page.setContent(content)
    const list = await page.$('#song-list')
    if (!list) return null; // 避免 list 为 null 导致报错
    const screenshot = await list.screenshot({})
    page.close()
    return screenshot
  }
}