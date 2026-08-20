import { promises as fs } from "node:fs";
import { pathToFileURL } from "node:url";

import { Context, h, isNullable, type Session } from "koishi";

import type { MessageBehavior } from "./message-behavior";
import {
  downloadSongFile,
  fetchSongBuffer,
  resolvePodcastSource,
  resolveSongSource,
  searchNetEase,
} from "./network";
import {
  buildQQMarkdownSongList,
  sendQQMarkdownSongList,
  supportsQQMarkdown,
} from "./qq-markdown";
import { formatSongList, generateSongListImage } from "./render";
import type {
  PluginLogger,
  RateLimitScope,
  RuntimeConfig,
  SilentMessage,
  SongData,
} from "./types";

interface CommandDependencies {
  logger: PluginLogger;
  messageBehavior: MessageBehavior;
}

function quote(messageId?: string | null) {
  return messageId ? h.quote(messageId) : "";
}

function getLastMessageId(messageIds: string[]) {
  return messageIds.at(-1) ?? null;
}

function getRateLimitKey(scope: RateLimitScope | undefined, session: Session) {
  switch (scope) {
    case "channel":
      return `${session.platform}:${session.channelId}`;
    case "platform":
      return session.platform;
    case "user":
    default:
      return `${session.platform}:${session.userId}`;
  }
}

async function deleteMessageSafely(
  session: Session,
  messageId: string | null,
  logger: PluginLogger
) {
  if (!messageId) {
    return;
  }

  try {
    await session.bot.deleteMessage(session.channelId, messageId);
  } catch (error) {
    logger.debug("撤回消息失败", messageId, error);
  }
}

async function sendNotice(
  session: Session,
  originalMessageId: string | null,
  key: SilentMessage,
  messageBehavior: MessageBehavior
) {
  if (messageBehavior.shouldSilence(key)) {
    return;
  }

  await session.send(`${quote(originalMessageId)}${session.text(`.${key}`)}`);
}

async function sendSongList(
  ctx: Context,
  session: Session,
  config: RuntimeConfig,
  keyword: string,
  currentPage: number,
  songs: SongData[],
  startIndex: number,
  quoteId: string | null,
  logger: PluginLogger
) {
  if (config.preferQQMarkdown && supportsQQMarkdown(session)) {
    try {
      const markdown = buildQQMarkdownSongList(
        songs,
        keyword,
        currentPage,
        startIndex,
        config
      );
      const messageId = await sendQQMarkdownSongList(session, markdown, logger);
      return { failed: false, messageId, isMarkdown: true };
    } catch (error) {
      logger.warn(
        `QQ 原生 Markdown 歌单发送失败，已回退为${
          config.listMode === "image" ? "图片" : "文本"
        }歌单。`,
        error
      );
    }
  }

  if (config.listMode === "image") {
    const listText = formatSongList(songs, "NetEase Music", startIndex, true);
    const exitCommandTip = config.menuExitCommandTip
      ? session.text(".exitCommandTip", [config.exitCommandList.join(", ")])
      : "";
    const imageBuffer = await generateSongListImage(
      ctx,
      listText,
      config,
      logger
    );

    if (!imageBuffer) {
      return {
        failed: true,
        messageId: null as string | null,
        isMarkdown: false,
      };
    }

    const promptMessage = session.text(".imageListPrompt", [
      exitCommandTip.replaceAll("<br/>", "\n"),
      config.waitForTimeout,
    ]);
    const messageIds = await session.send([
      quote(quoteId),
      h.image(imageBuffer, "image/png"),
      h.text(promptMessage),
    ]);

    return {
      failed: false,
      messageId: getLastMessageId(messageIds),
      isMarkdown: false,
    };
  }

  const listText = formatSongList(songs, "NetEase Music", startIndex, false);
  const exitCommandTip = config.menuExitCommandTip
    ? session.text(".exitCommandTip", [config.exitCommandList.join(", ")])
    : "";
  const promptMessage = session
    .text(".textListPrompt", [listText, exitCommandTip, config.waitForTimeout])
    .replaceAll("<br/>", "\n");
  const messageIds = await session.send(`${quote(quoteId)}${promptMessage}`);

  return {
    failed: false,
    messageId: getLastMessageId(messageIds),
    isMarkdown: false,
  };
}

async function sendSongByMode(
  ctx: Context,
  session: Session,
  src: string,
  config: RuntimeConfig
) {
  switch (config.srcToWhat) {
    case "text":
      await session.send(h.text(src));
      return;
    case "audio":
      await session.send(h.audio(src));
      return;
    case "audiobuffer": {
      const srcBuffer = await fetchSongBuffer(ctx, src);
      await session.send(h.audio(srcBuffer, "audio/mpeg"));
      return;
    }
    case "video":
      await session.send(h.video(src));
      return;
    case "file": {
      const tempFilePath = await downloadSongFile(ctx, src);

      try {
        await session.send(h.file(pathToFileURL(tempFilePath).href));
      } finally {
        await fs.unlink(tempFilePath).catch(() => {});
      }
      return;
    }
  }
}

export function registerMusicVoiceCommand(
  ctx: Context,
  config: RuntimeConfig,
  deps: CommandDependencies
) {
  const rateLimitMap = new Map<string, number>();

  ctx
    .command(`${config.commandName || "music"} <keyword:text>`)
    .option("number", "-n <number:number> 歌曲序号")
    .option("page", "-p <page:number> 页码")
    .option("encodedKeyword", "-k <keyword:string> 编码关键词")
    .action(async ({ session, options }, keyword) => {
      if (typeof options.encodedKeyword === "string") {
        keyword = Buffer.from(options.encodedKeyword, "base64url").toString(
          "utf8"
        );
      }

      if (!keyword) {
        return session.text(".nokeyword");
      }

      if (config.enableRateLimit) {
        const now = Date.now();
        const rateLimitKey = getRateLimitKey(config.rateLimitScope, session);
        const lastUseTime = rateLimitMap.get(rateLimitKey);
        const rateLimitInterval = config.rateLimitInterval ?? 60;

        if (lastUseTime) {
          const remainingTime = rateLimitInterval - (now - lastUseTime) / 1000;

          if (remainingTime > 0) {
            return session.text(".rateLimitExceeded", [
              Math.ceil(remainingTime).toString(),
            ]);
          }
        }

        rateLimitMap.set(rateLimitKey, now);
      }

      deps.logger.debug("收到点歌请求", session.stripped.content);

      const originalMessageId = session.messageId ?? null;
      let quoteId = session.messageId ?? null;
      let songListMessageId: string | null = null;
      let selected: SongData | undefined;
      let podcastSource: string | null = null;

      const cleanupSongList = async () => {
        if (deps.messageBehavior.shouldRecall("songList")) {
          await deleteMessageSafely(session, songListMessageId, deps.logger);
          songListMessageId = null;
        }
      };

      const podcastMatch = keyword.match(
        /^https?:\/\/(?:music\.)?163\.com\/dj\?[^\s]*\bid=\d+/i
      );
      if (podcastMatch) {
        try {
          const podcast = await resolvePodcastSource(
            ctx,
            config,
            podcastMatch[0],
            deps.logger
          );
          podcastSource = podcast.source;
          selected = {
            id: podcast.songId,
            name: "网易云播客",
            artists: "",
            albumName: "",
            duration: podcast.duration,
          };
        } catch (error) {
          deps.logger.warn("解析网易云播客失败", error);
          return session.text(".getSongFailed");
        }
      }

      let neteaseData: SongData[] = [];
      const requestedPage =
        Number.isInteger(options.page) && options.page > 0
          ? options.page - 1
          : 0;

      if (options.number !== undefined && !podcastSource) {
        const serialNumber = options.number;

        if (!Number.isInteger(serialNumber) || serialNumber < 1) {
          if (deps.messageBehavior.shouldSilence("invalidNumber")) {
            return;
          }

          return `${quote(quoteId)}${session.text(".invalidNumber")}`;
        }

        const pageSize = config.searchListCount;
        const pageIndex = Math.floor((serialNumber - 1) / pageSize);
        const pageOffset = pageIndex * pageSize;

        try {
          neteaseData = await searchNetEase(
            ctx,
            config,
            keyword,
            pageSize,
            pageOffset,
            deps.logger
          );
        } catch (error) {
          deps.logger.warn("获取网易云歌曲列表失败", error);
          return session.text(".songlisterror");
        }

        if (!neteaseData.length) {
          return session.text(".invalidKeyword");
        }

        const pageStart = pageOffset + 1;
        const pageEnd = pageOffset + neteaseData.length;

        if (serialNumber < pageStart || serialNumber > pageEnd) {
          if (deps.messageBehavior.shouldSilence("invalidNumber")) {
            return;
          }

          return `${quote(quoteId)}${session.text(".invalidNumber")}`;
        }

        selected = neteaseData[serialNumber - pageStart];
      } else if (!podcastSource) {
        let currentPage = requestedPage;
        const pageSize = config.searchListCount;

        while (true) {
          try {
            neteaseData = await searchNetEase(
              ctx,
              config,
              keyword,
              pageSize,
              currentPage * pageSize,
              deps.logger
            );
          } catch (error) {
            deps.logger.warn("获取网易云歌曲列表失败", error);
            return session.text(".songlisterror");
          }

          if (!neteaseData.length) {
            if (currentPage === 0) {
              return session.text(".invalidKeyword");
            }

            await session.send(
              `${quote(quoteId)}${session.text(".noMoreSongs")}`
            );
            currentPage--;
            continue;
          }

          await cleanupSongList();

          const listStartIndex = currentPage * pageSize;
          const songListResult = await sendSongList(
            ctx,
            session,
            config,
            keyword,
            currentPage,
            neteaseData,
            listStartIndex,
            quoteId,
            deps.logger
          );

          if (songListResult.failed) {
            return session.text(".imageGenerationFailed");
          }

          songListMessageId = songListResult.messageId;
          quoteId = songListMessageId ?? quoteId;

          // Markdown 菜单通过按钮参数继续交互，不进入 prompt。
          if (songListResult.isMarkdown) {
            return;
          }

          const input = await session.prompt(
            (promptSession) => {
              quoteId = promptSession.messageId ?? quoteId;
              return h.select(promptSession.elements, "text").join("");
            },
            { timeout: config.waitForTimeout * 1000 }
          );

          if (isNullable(input)) {
            await cleanupSongList();
            await sendNotice(
              session,
              originalMessageId,
              "promptTimeout",
              deps.messageBehavior
            );
            return;
          }

          const trimmedInput = input.trim();

          if (config.exitCommandList.includes(trimmedInput)) {
            await cleanupSongList();
            await sendNotice(
              session,
              originalMessageId,
              "exitPrompt",
              deps.messageBehavior
            );
            return;
          }

          if (trimmedInput === config.nextPageCommand.trim()) {
            currentPage++;
            continue;
          }

          if (trimmedInput === config.prevPageCommand.trim()) {
            if (currentPage > 0) {
              currentPage--;
              continue;
            }

            await session.send(
              `${quote(quoteId)}${session.text(".alreadyOnFirstPage")}`
            );
            continue;
          }

          const serialNumber = Number(trimmedInput);
          const selectStartIndex = currentPage * pageSize + 1;
          const selectEndIndex = currentPage * pageSize + neteaseData.length;

          if (
            !Number.isInteger(serialNumber) ||
            serialNumber < selectStartIndex ||
            serialNumber > selectEndIndex
          ) {
            await cleanupSongList();
            await sendNotice(
              session,
              originalMessageId,
              "invalidNumber",
              deps.messageBehavior
            );
            return;
          }

          selected = neteaseData[serialNumber - selectStartIndex];
          break;
        }
      }

      if (!selected) {
        return;
      }

      if (selected.duration > config.maxSongDuration * 60 * 1000) {
        await cleanupSongList();
        await sendNotice(
          session,
          originalMessageId,
          "durationExceeded",
          deps.messageBehavior
        );
        return;
      }

      let tipMessageId: string | null = null;

      if (config.generationTip.trim()) {
        const tipMessageIds = await session.send(
          `${quote(quoteId)}${h.text(config.generationTip)}`
        );
        tipMessageId = getLastMessageId(tipMessageIds);
      }

      const cleanupFinishedMessages = async () => {
        if (deps.messageBehavior.shouldRecall("generationTip")) {
          await deleteMessageSafely(session, tipMessageId, deps.logger);
        }

        await cleanupSongList();
      };

      try {
        const src =
          podcastSource ??
          (await resolveSongSource(ctx, config, selected.id, deps.logger));

        deps.logger.debug("选中歌曲", selected);
        deps.logger.debug("歌曲直链", src);
        deps.logger.debug("发送类型", config.srcToWhat);

        await sendSongByMode(ctx, session, src, config);
        await cleanupFinishedMessages();
      } catch (error) {
        await cleanupFinishedMessages();
        deps.logger.error("获取歌曲详情或发送语音失败", error);
        await sendNotice(
          session,
          originalMessageId,
          "getSongFailed",
          deps.messageBehavior
        );
      }
    });
}
