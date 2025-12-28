import { Context, Schema, h, isNullable } from 'koishi'
import { } from 'koishi-plugin-puppeteer'

import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import url from 'node:url';

export const name = 'music-voice'
export const inject = {
  required: ["logger", "http", "i18n"],
  optional: ['puppeteer']
}

export const usage = `

---

<a target="_blank" href="https://github.com/idranme/koishi-plugin-music-voice">➤ 食用方法点此获取</a>

本插件旨在提供开箱即用的语音点歌功能。

因各种不可抗力因素，目前仅支持使用网易云音乐。

---

## 开启插件前，请确保以下服务已经启用！

### 所需服务：

- [puppeteer服务](/market?keyword=puppeteer) （可选安装）

此外可能还需要这些服务才能发送语音：


- [ffmpeg服务](/market?keyword=ffmpeg)  （可选安装）（此服务可能额外依赖[downloads服务](/market?keyword=downloads)）

- [silk服务](/market?keyword=silk)  （可选安装）


---
`

export const Config = Schema.intersect([
  Schema.object({
    commandName: Schema.string().description('使用的指令名称').default('music'),
    commandAlias: Schema.string().description('使用的指令别名').default('mdff'),
    generationTip: Schema.string().description('生成语音时返回的文字提示内容').default('生成语音中…'),
    recallMessages: Schema.array(Schema.union([
      Schema.const('generationTip').description('生成提示语（生成语音中…）'),
      Schema.const('songList').description('歌单消息'),
      Schema.const('promptTimeout').description('超时提示（输入超时，已取消点歌）'),
      Schema.const('exitPrompt').description('退出提示（已退出歌曲选择）'),
      Schema.const('invalidNumber').description('序号错误提示（序号输入错误，已退出歌曲选择）'),
      Schema.const('durationExceeded').description('时长超限提示（歌曲持续时间超出限制）'),
      Schema.const('getSongFailed').description('获取失败提示（获取歌曲失败，请稍后再试）'),
    ]))
      .role('checkbox')
      .default(['generationTip', 'songList'])
      .description('勾选后将 撤回/不发送 对应的提示消息（勾选=撤回/不发送，不勾选=不撤回/发送）'),
    waitForTimeout: Schema.natural().min(1).step(1).description('等待用户选择歌曲序号的最长时间 （秒）').default(45),
  }).description('基础设置'),

  Schema.object({
    imageMode: Schema.boolean().description('开启后 返回图片歌单（需要puppeteer服务）<br>关闭后 返回文本歌单').default(false),
  }).description('歌单设置'),
  Schema.union([
    Schema.object({
      imageMode: Schema.const(true).required(),
      textChannel: Schema.string().description('图片歌单的文字颜色').role('color').default("rgba(255, 255, 255, 1)"),
      backgroundChannel: Schema.string().description('图片歌单的背景颜色').role('color').default("rgba(0, 0, 0, 1)"), // "rgba(42, 45, 62, 1)"
    }),
    Schema.object({}),
  ]),

  Schema.object({
    searchListCount: Schema.natural().description('搜索的歌曲列表的数量').default(20),
    nextPageCommand: Schema.string().description('翻页指令-下一页').default('下一页'),
    prevPageCommand: Schema.string().description('翻页指令-上一页').default('上一页'),
    exitCommandList: Schema.array(String).role('table').description('退出选择指令。<br>一行一个指令（此指令 在歌单内容中默认没有使用提示）').default(["0", "不听了"]),
    menuExitCommandTip: Schema.boolean().description('是否在歌单内容的后面，加上`退出选择指令`的文字提示').default(false),
    maxSongDuration: Schema.natural().min(1).step(1).description('歌曲最长持续时间（分钟）<br>超过此时长的音频 不会被发送').default(30),
  }).description('进阶设置'),

  Schema.object({
    enableRateLimit: Schema.boolean().description('是否启用频率限制').default(false),
  }).description('频率限制'),
  Schema.union([
    Schema.object({
      enableRateLimit: Schema.const(true).required(),
      rateLimitScope: Schema.union([
        Schema.const('user').description('对单个用户限制'),
        Schema.const('channel').description('对单个频道限制'),
        Schema.const('platform').description('对单个平台限制'),
      ]).description('频率限制作用范围').default('user'),
      rateLimitInterval: Schema.natural().min(1).step(1).description('频率限制间隔时间（秒）').default(60),
    }),
    Schema.object({}),
  ]),

  Schema.object({
    type: Schema.union([
      Schema.const('apis').description('预设API'),
      Schema.const('custom').description('自定义API')
    ]).description("获取音乐直链的后端").default("apis"),
  }).description('请求设置'),
  Schema.union([
    Schema.object({
      type: Schema.const('apis'),
      metingAPI: Schema.union([
        Schema.const('https://api.injahow.cn/meting/').description('`api.injahow.cn`'),
        Schema.const('https://api.qijieya.cn/meting/').description('`api.qijieya.cn`'),
        Schema.const('https://api.moeyao.cn/meting/').description('`api.moeyao.cn`'),
        Schema.const('https://meting.jinghuashang.cn/').description('`meting.jinghuashang.cn`'),
        Schema.const('https://meting.qjqq.cn/').description('`meting.qjqq.cn`'),
        Schema.const('https://api.crowya.com/meting/').description('`api.crowya.com`'),
        Schema.const('https://meting-api.mlj-dragon.cn/meting/').description('`meting-api.mlj-dragon.cn`'),
        Schema.const('https://api.amarea.cn/meting/').description('`api.amarea.cn`'),
      ]).description("后端API地址<br>选择一个可以访问的API").default("https://api.injahow.cn/meting/"),
    }),
    Schema.object({
      type: Schema.const('custom').required(),
      text: Schema.string().default("https://api.injahow.cn/meting/").description("自定义后端API地址<br>填入一个可以访问的API地址").role('link'),
    }),
  ]),

  Schema.object({
    useProxy: Schema.boolean().description('是否使用 `Apifox Web Proxy` 代理请求（适用于海外用户）').default(false),
    srcToWhat: Schema.union([
      Schema.const('text').description('文本 h.text'),
      Schema.const('audio').description('语音 h.audio'),
      Schema.const('audiobuffer').description('语音（buffer） h.audio'),
      Schema.const('video').description('视频 h.video'),
      Schema.const('file').description('文件 h.file'),
    ]).role('radio').default("audio").description('歌曲信息的的返回格式'),
  }).description('调试设置'),

  Schema.object({
    loggerinfo: Schema.boolean().default(false).description("日志调试模式"),
  }).description('开发者选项'),
])

interface SongData {
  id: number;
  name: string;
  artists: string;
  albumName: string;
  duration: number;
  lrc?: string;
}

interface NetEaseSearchResponse {
  result?: {
    songs?: NetEaseSongItem[];
  };
}

interface NetEaseSongItem {
  id: number;
  name: string;
  artists: { name: string }[];
  album: { name: string };
  duration: number;
}

export function apply(ctx: Context, config) {
  ctx.on('ready', async () => {

    const logger = ctx.logger('music-voice')

    // 频率限制记录：存储上次使用时间
    const rateLimitMap = new Map<string, number>();

    ctx.i18n.define("zh-CN", {
      commands: {
        [config.commandName]: {
          description: `搜索歌曲并播放网易云音乐`,
          messages: {
            "nokeyword": `请输入歌曲相关信息。\n➣示例：${ctx.root.config.prefix[0]}${config.commandName} 蔚蓝档案`,
            "songlisterror": "无法获取歌曲列表，请稍后再试。",
            "invalidKeyword": "无法获取歌曲列表，请尝试更换关键词。",
            "exitCommandTip": "退出选择请发 [{0}] 中的任意内容<br/><br/>",
            "imageGenerationFailed": "生成图片歌单失败，请检查 puppeteer 服务是否正常。",
            "imageListPrompt": "{0}请在 {1} 秒内，\n输入歌曲对应的序号",
            "textListPrompt": "{0}<br/><br/>{1}请在 {2} 秒内，<br/>输入歌曲对应的序号",
            "promptTimeout": "输入超时，已取消点歌。",
            "exitPrompt": "已退出歌曲选择。",
            "invalidNumber": "序号输入错误，已退出歌曲选择。",
            "durationExceeded": "歌曲持续时间超出限制。",
            "getSongFailed": "获取歌曲失败，请稍后再试。",
            "noMoreSongs": "没有更多歌曲了。",
            "alreadyOnFirstPage": "已经是第一页了。",
            "rateLimitExceeded": "操作过于频繁，请在 {0} 秒后再试。",
          }
        },
      }
    });

    ctx.command(`${config.commandName || "music"} <keyword:text>`)
      .alias(config.commandAlias || "mdff")
      .option('number', '-n <number:number> 歌曲序号')
      .action(async ({ session, options }, keyword) => {
        if (!keyword) return session.text(".nokeyword")

        // 频率限制检查
        if (config.enableRateLimit) {
          let rateLimitKey: string;
          // 根据配置的作用范围生成不同的key
          switch (config.rateLimitScope) {
            case 'user':
              rateLimitKey = `${session.platform}:${session.userId}`;
              break;
            case 'channel':
              rateLimitKey = `${session.platform}:${session.channelId}`;
              break;
            case 'platform':
              rateLimitKey = session.platform;
              break;
            default:
              rateLimitKey = `${session.platform}:${session.userId}`;
          }

          const now = Date.now();
          const lastUseTime = rateLimitMap.get(rateLimitKey);

          if (lastUseTime) {
            const timePassed = (now - lastUseTime) / 1000; // 转换为秒
            const remainingTime = config.rateLimitInterval - timePassed;

            if (remainingTime > 0) {
              // 还在冷却时间内
              return session.text(".rateLimitExceeded", [Math.ceil(remainingTime).toString()]);
            }
          }

          // 更新最后使用时间
          rateLimitMap.set(rateLimitKey, now);
        }

        logInfo(session.stripped.content)
        let neteaseData: SongData[] = [];
        let selected: SongData;
        const originalMessageId = session.messageId; // 保存原始用户指令消息ID
        let quoteId = session.messageId;
        let songListMessageId: string | null = null; // 用于存储歌单消息ID

        // 优先处理-n选项，不进入分页逻辑
        if (options.number !== undefined) {
          try {
            //-n选项只搜索第一页
            neteaseData = await searchNetEase(keyword, config.searchListCount, 0);
          } catch (err) {
            logger.warn('获取网易云音乐数据时发生错误', err.message);
            return session.text(".songlisterror");
          }

          if (!neteaseData.length) return session.text(".invalidKeyword");

          const serialNumber = options.number;
          if (!Number.isInteger(serialNumber) || serialNumber < 1 || serialNumber > neteaseData.length) {
            return `${h.quote(quoteId)}` + session.text(".invalidNumber");
          }
          selected = neteaseData[serialNumber - 1];
        } else {
          // 进入分页交互逻辑
          let currentPage = 0;
          const pageSize = config.searchListCount;

          while (true) {
            try {
              neteaseData = await searchNetEase(keyword, pageSize, currentPage * pageSize);
            } catch (err) {
              logger.warn('获取网易云音乐数据时发生错误', err.message);
              return session.text(".songlisterror");
            }

            // 处理没有搜索结果的情况
            if (!neteaseData.length) {
              if (currentPage === 0) {
                return session.text(".invalidKeyword");
              } else {
                await session.send(`${h.quote(quoteId)}` + session.text(".noMoreSongs"));
                currentPage--; // 回到上一页
                continue;
              }
            }

            const listStartIndex = currentPage * pageSize;
            const neteaseListText = formatSongList(neteaseData, 'NetEase Music', listStartIndex);
            const listText = `${neteaseListText}`;
            const exitCommands = config.exitCommandList;
            const exitCommandTip = config.menuExitCommandTip ? session.text(".exitCommandTip", [exitCommands.join(', ')]) : '';

            if (config.imageMode) {
              const imageBuffer = await generateSongListImage(listText, config);
              if (!imageBuffer) {
                return session.text(".imageGenerationFailed");
              }
              const promptMessage = session.text(".imageListPrompt", [exitCommandTip.replaceAll('<br/>', '\n'), config.waitForTimeout]);
              // 将图片和提示文字合并为一条消息发送
              const songListMsg = await session.send([
                h.quote(quoteId),
                h.image(imageBuffer, 'image/png'),
                h.text(promptMessage),
              ]);
              songListMessageId = songListMsg[0]; // 保存歌单消息ID
              quoteId = songListMsg[0];
            } else {
              const payload = `${h.quote(quoteId)}` + session.text(".textListPrompt", [listText, exitCommandTip, config.waitForTimeout]);
              const msg = await session.send(h.unescape(payload));
              songListMessageId = msg.at(-1); // 保存歌单消息ID
              quoteId = msg.at(-1);
            }

            // 等待用户输入，每次循环重置超时时间
            const input = await session.prompt((session) => {
              quoteId = session.messageId;
              return h.select(session.elements, 'text').join('');
            }, { timeout: config.waitForTimeout * 1000 });

            if (isNullable(input)) {
              // 超时时撤回歌单消息
              if (config.recallMessages.includes('songList') && songListMessageId) {
                session.bot.deleteMessage(session.channelId, songListMessageId);
              }
              // 如果没有勾选promptTimeout，则发送超时提示
              if (!config.recallMessages.includes('promptTimeout')) {
                await session.send(`${h.quote(originalMessageId)}` + session.text(".promptTimeout"));
              }
              return;
            }

            if (exitCommands.includes(input)) {
              // 取消选择时撤回歌单消息
              if (config.recallMessages.includes('songList') && songListMessageId) {
                session.bot.deleteMessage(session.channelId, songListMessageId);
              }
              // 如果没有勾选exitPrompt，则发送退出提示
              if (!config.recallMessages.includes('exitPrompt')) {
                await session.send(`${h.quote(originalMessageId)}` + session.text(".exitPrompt"));
              }
              return;
            }

            // 处理翻页指令
            if (input.trim() === config.nextPageCommand) {
              currentPage++;
              continue;
            }

            if (input.trim() === config.prevPageCommand) {
              if (currentPage > 0) {
                currentPage--;
                continue;
              } else {
                await session.send(`${h.quote(quoteId)}` + session.text(".alreadyOnFirstPage"));
                continue;
              }
            }

            // 处理选歌序号
            const serialNumber = +input;
            const selectStartIndex = currentPage * pageSize + 1;
            const selectEndIndex = currentPage * pageSize + neteaseData.length;

            if (!Number.isInteger(serialNumber) || serialNumber < selectStartIndex || serialNumber > selectEndIndex) {
              // 序号错误时撤回歌单消息
              if (config.recallMessages.includes('songList') && songListMessageId) {
                session.bot.deleteMessage(session.channelId, songListMessageId);
              }
              // 如果没有勾选invalidNumber，则发送序号错误提示
              if (!config.recallMessages.includes('invalidNumber')) {
                await session.send(`${h.quote(originalMessageId)}` + session.text(".invalidNumber"));
              }
              return;
            }

            selected = neteaseData[serialNumber - selectStartIndex];
            break; // 歌曲选择成功，跳出循环
          }
        }
        const interval = selected.duration / 1000;
        const [tipMessageId] = await session.send(h.quote(quoteId) + `` + h.text(config.generationTip))
        try {
          let src: string = '';
          if (config.type === 'apis') {
            // 使用预设的API
            src = `${config.metingAPI}?type=url&id=${selected.id}`;
          } else if (config.type === 'custom') {
            // 使用自定义API
            src = `${config.text}?type=url&id=${selected.id}`;
          }
          logInfo(selected)
          logInfo(src)
          logInfo(config.srcToWhat)
          if (interval * 1000 > config.maxSongDuration * 1000 * 60) {
            // 歌曲时长超限时撤回提示消息和歌单消息
            if (config.recallMessages.includes('generationTip')) {
              session.bot.deleteMessage(session.channelId, tipMessageId);
            }
            if (config.recallMessages.includes('songList') && songListMessageId) {
              session.bot.deleteMessage(session.channelId, songListMessageId);
            }
            // 如果没有勾选durationExceeded，则发送时长超限提示
            if (!config.recallMessages.includes('durationExceeded')) {
              await session.send(`${h.quote(originalMessageId)}` + session.text(".durationExceeded"));
            }
            return;
          }
          switch (config.srcToWhat) {
            case 'text':
              await session.send(h.text(src));
              break;
            case 'audio':
              await session.send(h.audio(src));
              break;
            case 'audiobuffer': {
              const srcFile = (await ctx.http.file(src)).data;
              const srcBuffer = Buffer.from(srcFile);
              await session.send(h.audio(srcBuffer, 'audio/mpeg'));
              break;
            }
            case 'video': {
              await session.send(h.video(src));
              break;
            }
            case 'file': {
              const tempFilePath = await downloadFile(src);
              const fileUrl = url.pathToFileURL(tempFilePath).href;
              logInfo(fileUrl)
              await session.send(h.file(fileUrl));
              await fs.unlinkSync(tempFilePath);
              break;
            }
            default:
              ctx.logger.error(`Unsupported send type: ${config.srcToWhat}`);
              return
          }

          // 发送语音成功后撤回提示消息和歌单消息
          if (config.recallMessages.includes('generationTip')) {
            session.bot.deleteMessage(session.channelId, tipMessageId);
          }
          if (config.recallMessages.includes('songList') && songListMessageId) {
            session.bot.deleteMessage(session.channelId, songListMessageId);
          }
        } catch (error) {
          // 发送语音失败时撤回提示消息和歌单消息
          if (config.recallMessages.includes('generationTip')) {
            session.bot.deleteMessage(session.channelId, tipMessageId);
          }
          if (config.recallMessages.includes('songList') && songListMessageId) {
            session.bot.deleteMessage(session.channelId, songListMessageId);
          }
          logger.error('获取歌曲详情或发送语音失败', error);
          // 如果没有勾选getSongFailed，则发送获取失败提示
          if (!config.recallMessages.includes('getSongFailed')) {
            await session.send(`${h.quote(originalMessageId)}` + session.text(".getSongFailed"));
          }
          return;
        }
      })

    async function downloadFile(url: string) {
      try {
        const file = await ctx.http.file(url);
        const contentType = file.type || file.mime;
        let ext = '.mp3';
        if (contentType) {
          if (contentType.includes('audio/mpeg')) {
            ext = '.mp3';
          } else if (contentType.includes('audio/mp4')) {
            ext = '.m4a';
          } else if (contentType.includes('audio/wav')) {
            ext = '.wav';
          } else if (contentType.includes('audio/flac')) {
            ext = '.flac';
          }
        }
        let filename = crypto.randomBytes(8).toString('hex') + ext;
        const filePath = path.join(os.tmpdir(), filename);
        const buffer = Buffer.from(file.data);
        await fs.writeFileSync(filePath, buffer);
        return filePath;
      } catch (error) {
        logger.error('文件下载失败:', error);
        return null;
      }
    }

    function logInfo(...args: any[]) {
      if (config.loggerinfo) {
        (logger.info as (...args: any[]) => void)(...args);
      }
    }

    async function requestWithProxy(targetUrl: string): Promise<string> {
      const proxyUrl = 'https://web-proxy.apifox.cn/api/v1/request';

      try {
        const response = await ctx.http.post(proxyUrl, {}, {
          headers: {
            'api-u': targetUrl,
            'api-o0': 'method=GET, timings=true, timeout=3000',
            'Content-Type': 'application/json'
          }
        });

        return response;
      } catch (error) {
        logger.error('代理请求失败', error);
        throw error;
      }
    }

    async function searchNetEase(keyword: string, limit: number = 10, offset: number = 0): Promise<SongData[]> {
      const searchApiUrl = `http://music.163.com/api/search/get/web?csrf_token=hlpretag=&hlposttag=&s=${encodeURIComponent(keyword)}&type=1&offset=${offset}&total=true&limit=${limit}`;

      try {
        let searchApiResponse: string;

        if (config.useProxy) {
          // 使用代理请求
          logInfo('使用代理请求网易云音乐API');
          searchApiResponse = await requestWithProxy(searchApiUrl);
        } else {
          // 直接请求
          logInfo('直接请求网易云音乐API');
          searchApiResponse = await ctx.http.get(searchApiUrl);
        }

        const parsedSearchApiResponse: NetEaseSearchResponse = JSON.parse(searchApiResponse);
        const searchData = parsedSearchApiResponse.result;

        if (!searchData || !searchData.songs || searchData.songs.length === 0) {
          return [];
        }

        const songList: SongData[] = searchData.songs.map((song) => {
          return {
            id: song.id,
            name: song.name,
            artists: song.artists.map(artist => artist.name).join('/'),
            albumName: song.album.name,
            duration: song.duration
          };
        });
        logInfo(songList)
        return songList;
      } catch (error) {
        logger.error('网易云音乐搜索出错', error);
        return [];
      }
    }

    async function generateSongListImage(listText: string, config) {
      if (!ctx.puppeteer) {
        logger.warn('puppeteer 服务未启用，无法生成图片歌单。');
        return null;
      }
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
              font-size: 16px;
              background: ${config.backgroundChannel};
              color: ${config.textChannel};
              min-height: 100vh;
            }
            #song-list {
              padding: 20px;
              display: inline-block; 
              max-width: 100%; 
              white-space: nowrap; 
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

    function formatSongList(data: SongData[], platform: string, startIndex: number) {
      const formatted = data.map((song, index) => {
        let item = `${index + startIndex + 1}. ${song.name} -- ${song.artists} -- ${song.albumName}`
        return item
      }).join('<br/>')
      return `<b>${platform}</b>:<br/>${formatted}`
    }

  })
}
