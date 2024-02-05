import { Context, Schema, Quester, h } from 'koishi'
import Puppeteer from 'koishi-plugin-puppeteer'
import { } from 'koishi-plugin-ffmpeg'
import { } from 'koishi-plugin-silk'

export const name = 'music-downloadvoice-api'
export const inject = {
    required: ['http', 'puppeteer'],
    optional: ['ffmpeg', 'silk']
}

export const usage = `
[食用方法点此获取](https://www.npmjs.com/package/koishi-plugin-music-downloadvoice-api)

生成语音的速度取决于网速和设备性能哦~
`

export interface Config {
    generationTip: string
    waitTimeout: number
    exitCommand: string
    menuExitCommandTip: boolean
    recall: boolean
    imageMode: boolean
    darkMode: boolean
}

export const Config: Schema<Config> = Schema.intersect([
    Schema.object({
        generationTip: Schema.string().description('生成语音时返回的文字提示内容').default('生成语音中…'),
        waitTimeout: Schema.natural().role('ms').description('等待用户选择歌曲序号的最长时间').default(45000)
    }).description('基础设置'),
    Schema.object({
        exitCommand: Schema.string().description('退出选择指令，多个指令间请用逗号分隔开').default('0, 不听了'),
        menuExitCommandTip: Schema.boolean().description('是否在歌单内容的后面，加上退出选择指令的文字提示').default(false),
        recall: Schema.boolean().description('是否在发送语音后撤回 generationTip').default(true)
    }).description('进阶设置'),
    Schema.object({
        imageMode: Schema.boolean().description('开启后返回图片歌单，关闭后返回文本歌单').default(true),
        darkMode: Schema.boolean().description('是否开启暗黑模式').default(true)
    }).description('图片歌单设置'),
])

interface SongData {
    songname: string
    subtitle?: string
    name: string
    album: string
    pay: string
    song_type?: string
    type?: number
    songid?: number
    mid?: string
    time?: string
    bpm?: string
    quality?: string
    interval?: string
    size?: string
    kbps?: string
    cover: string
    songurl: string
    src: string
    id?: number
}

interface SearchResponse {
    code: number
    msg: string
    data: SongData[] | SongData
}

interface SearchParams {
    name?: string
    n?: number
    songid?: number
}

type Platform = 'QQ Music' | 'NetEase Music'

async function search(http: Quester, platform: Platform, params: SearchParams) {
    let apiBase = 'https://api.xingzhige.com/API/QQmusicVIP'
    if (platform === 'NetEase Music') apiBase = 'https://api.xingzhige.com/API/NetEase_CloudMusic_new'
    return await http.get<SearchResponse>(apiBase, { params })
}

function formatSongList(data: SongData[], platform: Platform, startIndex: number) {
    const formatted = data.map((song, index) => `${index + startIndex + 1}. ${song.songname} -- ${song.name}`).join('<br />')
    return `<b>${platform}</b>:<br />${formatted}`
}

async function generateSongListImage(pptr: Puppeteer, listText: string, cfg: Config) {
    const textBrightness = cfg.darkMode ? 255 : 0
    const backgroundBrightness = cfg.darkMode ? 0 : 255
    const textColor = `rgb(${textBrightness},${textBrightness},${textBrightness})`
    const backgroundColor = `rgb(${backgroundBrightness},${backgroundBrightness},${backgroundBrightness})`
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="zh">
        <head>
          <title>music</title>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            body {
              margin: 0;
              font-family: PingFang SC, Hiragino Sans GB, Microsoft YaHei, SimSun, sans-serif;
              font-size: 16px;
              background: ${backgroundColor};
              color: ${textColor};
              min-height: 100vh;
            }
            #song-list {
              padding: 20px;
              display: inline-block; /* 使div适应内容宽度 */
              max-width: 100%; /* 防止内容溢出 */
              white-space: nowrap; /* 防止歌曲名称换行 */
              transform: scale(0.75);
            }
          </style>
        </head>
        <body>
          <div id="song-list">${listText}</div>
        </body>
      </html>
    `

    const page = await pptr.browser.newPage()
    await page.setContent(htmlContent)
    const clip = await page.evaluate(() => {
        const songList = document.getElementById('song-list')
        const { left: x, top: y, width, height } = songList.getBoundingClientRect()
        return { x, y, width, height }
    })
    const screenshot = await page.screenshot({ clip })
    page.close()
    return screenshot
}

export function apply(ctx: Context, cfg: Config) {
    const logger = ctx.logger('music-downloadvoice-api')

    ctx.command('music <keyword:text>', '搜索歌曲并生成语音')
        .alias('mdff', '点歌')
        .action(async ({ session }, keyword) => {
            if (!keyword) return '请输入歌曲相关信息。'

            let qq: SearchResponse, netease: SearchResponse
            try {
                qq = await search(ctx.http, 'QQ Music', { name: keyword })
            } catch (e) {
                logger.warn('获取QQ音乐数据时发生错误', e)
            }
            try {
                netease = await search(ctx.http, 'NetEase Music', { name: keyword })
            } catch (e) {
                logger.warn('获取网易云音乐数据时发生错误', e)
            }

            const qqData = qq.data as SongData[]
            const neteaseData = netease.data as SongData[]
            if (!qqData?.length && !neteaseData?.length) return '无法获取歌曲列表，请稍后再试。'

            const qqListText = qqData?.length ? formatSongList(qqData, 'QQ Music', 0) : '<b>QQ Music</b>: 无法获取歌曲列表'
            const neteaseListText = neteaseData?.length ? formatSongList(neteaseData, 'NetEase Music', qqData?.length ?? 0) : '<b>NetEase Music</b>: 无法获取歌曲列表'

            const songListText = `${qqListText}<br /><br />${neteaseListText}`
            const exitCommands = cfg.exitCommand.split(/[,，]/).map(cmd => cmd.trim())
            const waitTimeInSeconds = cfg.waitTimeout / 1000
            const exitCommandTip = cfg.menuExitCommandTip ? `退出选择请发[${exitCommands}]中的任意内容<br /><br />` : ''

            let quoteId = session.messageId

            if (cfg.imageMode) {
                const imageBuffer = await generateSongListImage(ctx.puppeteer, songListText, cfg)
                const payload = [
                    h.quote(quoteId),
                    h.image(imageBuffer, 'image/png'),
                    h.text(`${exitCommandTip}请在${waitTimeInSeconds}秒内，`),
                    h('br'),
                    h.text('输入歌曲对应的序号')
                ]
                const msg = await session.send(payload)
                quoteId = msg.at(-1)
            } else {
                const msg = await session.send(songListText + `<br /><br />${exitCommandTip}请在${waitTimeInSeconds}秒内，<br />输入歌曲对应的序号`)
                quoteId = msg.at(-1)
            }

            const input = await session.prompt((session) => {
                quoteId = session.messageId
                return session.content
            }, { timeout: cfg.waitTimeout })

            if (!input) return `${quoteId ? h.quote(quoteId) : ''}输入超时，已取消点歌。`
            if (exitCommands.includes(input)) {
                return `${h.quote(quoteId)}已退出歌曲选择。`
            }

            const serialNumber = +input
            if (Number.isNaN(serialNumber) || serialNumber < 1 || serialNumber > (qqData?.length ?? 0) + (neteaseData?.length ?? 0)) {
                return `${h.quote(quoteId)}输入的序号错误，已退出歌曲选择。`
            }

            const songData: SongData[] = []
            if (qqData) {
                songData.push(...qqData)
            }
            if (neteaseData) {
                songData.push(...neteaseData)
            }

            let platform: Platform, songid: number
            const selected = songData[serialNumber - 1]
            if (selected.songurl.includes('163.com')) {
                platform = 'NetEase Music'
                songid = selected.id
            }
            if (selected.songurl.includes('qq.com')) {
                platform = 'QQ Music'
                songid = selected.songid
            }
            if (!platform) return `${h.quote(quoteId)}获取歌曲失败。`

            const [tipMessageId] = await session.send(h.quote(quoteId) + cfg.generationTip)

            const song = await search(ctx.http, platform, { songid })
            if (song.code === 0) {
                const data = song.data as SongData
                try {
                    if (session.platform === 'qq') {
                        if (!ctx.silk) throw new Error('silk 服务未加载')
                        if (!ctx.ffmpeg) throw new Error('ffmpeg 服务未加载')
                        const input = await ctx.http.file(data.src)
                        const pcm = await ctx.ffmpeg.builder().input(Buffer.from(input.data)).outputOption('-ar', '24000', '-ac', '1', '-f', 's16le').run('buffer')
                        const silk = await ctx.silk.encode(pcm, 24000)
                        await session.send(h.audio(silk.data, 'audio/amr'))
                    } else {
                        await session.send(h.audio(data.src))
                    }
                } catch (e) {
                    logger.error(e)
                } finally {
                    if (cfg.recall) session.bot.deleteMessage(session.channelId, tipMessageId)
                }
            } else {
                return `${h.quote(quoteId)}获取歌曲失败。`
            }
        })
}