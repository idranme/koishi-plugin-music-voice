import { Context, Schema, Quester, h, isNullable } from 'koishi'
import Puppeteer from 'koishi-plugin-puppeteer'
import { } from 'koishi-plugin-ffmpeg'
import { } from 'koishi-plugin-silk'

export const name = 'music-downloadvoice-api'
export const inject = {
    required: ['http', 'puppeteer']
}

export const usage = `
<a target="_blank" href="https://github.com/idanran/koishi-plugin-music-downloadvoice-api?tab=readme-ov-file#%E4%BD%BF%E7%94%A8%E8%AF%A5%E6%8F%92%E4%BB%B6%E6%90%9C%E7%B4%A2%E5%B9%B6%E8%8E%B7%E5%8F%96%E6%AD%8C%E6%9B%B2">食用方法点此获取</a>
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
        waitTimeout: Schema.natural().role('ms').min(1000).step(1000).description('等待用户选择歌曲序号的最长时间').default(45000)
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
    pay?: string
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
    cover?: string
    songurl: string
    src?: string
    id?: number
}

interface SearchXZGResponse {
    code: number
    msg: string
    data: SongData[] | SongData
}

interface SearchXZGParams {
    name?: string
    n?: number
    songid?: number
    pagesize?: number
    max?: number
}

interface SearchQQResponse {
    code: number
    ts: number
    start_ts: number
    traceid: string
    request: {
        code: number
        data: {
            body: {
                item_song: {
                    album: {
                        name: string
                    }
                    id: number
                    mid: string
                    name: string
                    singer: {
                        name: string
                    }[]
                    title: string
                }[]
            },
            code: number
            feedbackURL: string
            meta: unknown
            ver: number
        }
    }
}

type Platform = 'QQ Music' | 'NetEase Music'

async function searchXZG(http: Quester, platform: Platform, params: SearchXZGParams) {
    let apiBase = 'https://api.xingzhige.com/API/QQmusicVIP/'
    if (platform === 'NetEase Music') apiBase = 'https://api.xingzhige.com/API/NetEase_CloudMusic_new/'
    return await http.get<SearchXZGResponse>(apiBase, { params })
}

async function searchQQ(http: Quester, query: string) {
    return await http.post<SearchQQResponse>('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        comm: {
            ct: 11,
            cv: '1929'
        },
        request: {
            module: 'music.search.SearchCgiService',
            method: 'DoSearchForQQMusicLite',
            param: {
                search_id: '83397431192690042',
                remoteplace: 'search.android.keyboard',
                query,
                search_type: 0,
                num_per_page: 10,
                page_num: 1,
                highlight: 1,
                nqc_flag: 0,
                page_id: 1,
                grp: 1
            }
        }
    })
}

function formatSongList(data: SongData[], platform: Platform, startIndex: number) {
    const formatted = data.map((song, index) => `${index + startIndex + 1}. ${song.songname} -- ${song.name}`).join('<br />')
    return `<b>${platform}</b>:<br />${formatted}`
}

async function generateSongListImage(pptr: Puppeteer, listText: string, cfg: Config) {
    const textBrightness = cfg.darkMode ? 255 : 0
    const backgroundBrightness = cfg.darkMode ? 0 : 255
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
              background: rgb(${backgroundBrightness},${backgroundBrightness},${backgroundBrightness});
              color: rgb(${textBrightness},${textBrightness},${textBrightness});
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

            let qq: SearchXZGResponse, netease: SearchXZGResponse
            try {
                let res = await searchQQ(ctx.http, keyword)
                if (typeof res === 'string') res = JSON.parse(res)
                const item = res.request?.data?.body?.item_song
                qq = {
                    code: res.code,
                    msg: '',
                    data: Array.isArray(item) ? item.map(v => {
                        return {
                            songname: v.title.replaceAll('<em>', '').replaceAll('</em>', ''),
                            album: v.album.name,
                            songid: v.id,
                            songurl: `https://y.qq.com/n/ryqq/songDetail/${v.mid}`,
                            name: v.singer.map(v => v.name).join('/')
                        }
                    }) : []
                }
            } catch (e) {
                logger.warn('获取QQ音乐数据时发生错误', e)
            }
            try {
                netease = await searchXZG(ctx.http, 'NetEase Music', { name: keyword })
            } catch (e) {
                logger.warn('获取网易云音乐数据时发生错误', e)
            }

            const qqData = qq?.data as SongData[]
            const neteaseData = netease?.data as SongData[]
            if (!qqData?.length && !neteaseData?.length) return '无法获取歌曲列表，请稍后再试。'

            const qqListText = qqData?.length ? formatSongList(qqData, 'QQ Music', 0) : '<b>QQ Music</b>: 无法获取歌曲列表'
            const neteaseListText = neteaseData?.length ? formatSongList(neteaseData, 'NetEase Music', qqData?.length ?? 0) : '<b>NetEase Music</b>: 无法获取歌曲列表'

            const listText = `${qqListText}<br /><br />${neteaseListText}`
            const exitCommands = cfg.exitCommand.split(/[,，]/).map(cmd => cmd.trim())
            const exitCommandTip = cfg.menuExitCommandTip ? `退出选择请发[${exitCommands}]中的任意内容<br /><br />` : ''

            let quoteId = session.messageId

            if (cfg.imageMode) {
                const imageBuffer = await generateSongListImage(ctx.puppeteer, listText, cfg)
                const payload = [
                    h.quote(quoteId),
                    h.image(imageBuffer, 'image/png'),
                    h.text(`${exitCommandTip.replaceAll('<br />', '\n')}请在 `),
                    h('i18n:time', { value: cfg.waitTimeout }),
                    h.text('内，\n'),
                    h.text('输入歌曲对应的序号')
                ]
                const msg = await session.send(payload)
                quoteId = msg.at(-1)
            } else {
                const msg = await session.send(`${h.quote(quoteId)}${listText}<br /><br />${exitCommandTip}请在 <i18n:time value="${cfg.waitTimeout}"/>内，<br />输入歌曲对应的序号`)
                quoteId = msg.at(-1)
            }

            const input = await session.prompt((session) => {
                quoteId = session.messageId
                return h.select(session.elements, 'text').toString()
            }, { timeout: cfg.waitTimeout })

            if (isNullable(input)) return `${quoteId ? h.quote(quoteId) : ''}输入超时，已取消点歌。`
            if (exitCommands.includes(input)) {
                return `${h.quote(quoteId)}已退出歌曲选择。`
            }

            const serialNumber = +input
            if (Number.isNaN(serialNumber) || serialNumber < 1 || serialNumber > (qqData?.length ?? 0) + (neteaseData?.length ?? 0)) {
                return `${h.quote(quoteId)}序号输入错误，已退出歌曲选择。`
            }

            const songData: SongData[] = []
            if (qqData?.length) {
                songData.push(...qqData)
            }
            if (neteaseData?.length) {
                songData.push(...neteaseData)
            }

            let platform: Platform, songid: number
            const selected = songData[serialNumber - 1]
            if (selected.songurl.includes('163.com/')) {
                platform = 'NetEase Music'
                songid = selected.id
            }
            if (selected.songurl.includes('qq.com/')) {
                platform = 'QQ Music'
                songid = selected.songid
            }
            if (!platform) return `${h.quote(quoteId)}获取歌曲失败。`

            const [tipMessageId] = await session.send(h.quote(quoteId) + cfg.generationTip)

            const song = await searchXZG(ctx.http, platform, { songid })
            if (song.code === 0) {
                const data = song.data as SongData
                try {
                    await session.send(h.audio(data.src))
                } catch (err) {
                    if (cfg.recall) session.bot.deleteMessage(session.channelId, tipMessageId)
                    throw err
                }
                if (cfg.recall) session.bot.deleteMessage(session.channelId, tipMessageId)
            } else {
                if (cfg.recall) session.bot.deleteMessage(session.channelId, tipMessageId)
                let msg = song.msg || ''
                if (msg) {
                    const strAry = msg.split('')
                    if ([',', '.', '，', '。'].includes(strAry.at(-1))) {
                        strAry.pop()
                    }
                    strAry.push('，')
                    msg = strAry.join('')
                }
                return `${h.quote(quoteId)}${msg}获取歌曲失败。`
            }
        })
}