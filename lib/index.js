"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const koishi_1 = require("koishi");
const fetch = require('node-fetch');
const axios = require('axios').default;
const https = require('https');
const fs = require('fs');
const path = require('path'); 
const { h } = require('koishi');
const logger = new koishi_1.Logger('Music-downloadvoice-api');
exports.inject = { optional: ["puppeteer", "ffmpeg", "silk"] };
const { Schema } = require('koishi'); 



exports.usage = `
<p>确保<a href="https://ffmpeg.org/download.html">ffmpeg</a>的环境已经正确安装了哦~  已在red平台测试可以发送语音，其他不知道呢~ </p>
<p>【音频文件中转路径】留空或者填入任意文件夹路径即可，只借用一会会存储，</p>
<p>填入例如“<code> D:/114514/1919810/nodejs/koishi </code> ”</p>

<p>生成语音的速度取决于网速和CPU性能哦~</p>
`;


exports.Config = koishi_1.Schema.intersect([
  koishi_1.Schema.object({
  downloadPath: koishi_1.Schema.string()
    .description('音频文件中转路径,可留空。留空默认使用[ C:/Music-downloadvoice-api ]'),
  
  loadmessage: koishi_1.Schema.string()
    .default('生成语音中...')
    .description('生成语音中返回的文字提示内容'),
  waitTimeout: koishi_1.Schema.natural()
    .role('ms')
    .description('允许用户返回选择序号的等待时间。')
    .default(45000), // 等待的时长
    }).description('基础设置'),



  koishi_1.Schema.object({
  retryLimit: koishi_1.Schema.number().default(3).description('允许用户返回的序号的容错次数'),
  exitCommand: koishi_1.Schema.string()
    .default('0，不听了')
    .description('序号容错时的退出指令。多个指令间请用逗号分隔开'),
  MenuExitCommandTip: koishi_1.Schema.boolean().default(false).description('歌单内容的后面，加上退出指令的文字提示'),
  retryExitCommandTip: koishi_1.Schema.boolean().default(true).description('交互序号错误时，加上退出指令的文字提示'),

  recall: koishi_1.Schema.boolean().default(true).description('一段时间后会撤回“生成语音中”'),
  recall_time: koishi_1.Schema.number().default(20000).description('“生成语音中”消息撤回的时间'),
  


  }).description('进阶设置'),

  koishi_1.Schema.object({
  imageMode: koishi_1.Schema.boolean()
    .default(true)
    .description('开启后返回图片歌单，关闭后返回文本歌单'),
  textbrightness: koishi_1.Schema.natural()
    .description('字体亮度。黑白调节。阈值为0到255。黑:0，白:255')
    .default(0), // 默认纯黑
  backgroundbrightness: koishi_1.Schema.natural()
    .description('背景亮度。黑白调节。阈值为0到255。黑:0，白:255')
    .default(255), // 默认纯白
  nightModeEnabled: koishi_1.Schema.boolean()
    .default(false)
    .description('自动开启夜间模式'),
  nightModeStart: koishi_1.Schema.string()
    .default('22:00')
    .description('夜间模式开始时间（HH:mm格式）注：设置两个时间点，间隔较长的一段为白天'),
  nightModeEnd: koishi_1.Schema.string()
    .default('06:00')
    .description('夜间模式结束时间（HH:mm格式）'),
  nightModeTextBrightness: koishi_1.Schema.natural()
    .description('夜间模式字体亮度。黑白调节。阈值为0到255。黑:0，白:255')
    .default(255), // 默认纯白
  nightModeBackgroundBrightness: koishi_1.Schema.natural()
    .description('夜间模式背景亮度。黑白调节。阈值为0到255。黑:0，白:255')
    .default(0), // 默认纯黑

  }).description('图片歌单设置'),
]);


// 0.2.0新增的  
//创建一个https.Agent实例，配置为忽略SSL证书错误
const httpsAgent = new https.Agent({
  rejectUnauthorized: false // 关键选项，使其不拒绝未经授权的证书。
});

// 0.2.5 重写fetchSongData，防止其中某个API坏掉。
async function fetchSongData(apiBase, keyword, n) {
  const defaultErrorResponse = {
    "code": 0,
    "msg": "暂无",
    "data": [{
      "songname": "暂无",
      "subtitle": "暂无",
      "name": "暂无",
      "album": "暂无",
      "pay": "暂无",
      "song_type": "暂无",
      "type": "暂无",
      "songid": "暂无",
      "mid": "暂无",
      "time": "暂无",
      "bpm": "暂无",
      "quality": "暂无",
      "interval": "暂无",
      "size": "暂无",
      "kbps": "暂无",
      "cover": "暂无",
      "songurl": "暂无",
      "src": "暂无"
    }]
  };

  const params = n ? `?name=${encodeURIComponent(keyword)}&n=${n}` : `?name=${encodeURIComponent(keyword)}`;
  try {
    const response = await fetch(`${apiBase}${params}`, { agent: httpsAgent }); // 使用定义的agent
    if (!response.ok) throw new Error(`Failed to fetch song data from ${apiBase}`);
    return await response.json();
  } catch (e) {
    logger.error(e.message);
    return defaultErrorResponse; // 当出现错误或无法访问API时，返回预定义的错误响应
  }
}

async function fetchQQSongData(keyword, n) {
  const apiBase = 'https://api.xingzhige.com/API/QQmusicVIP/';
  return fetchSongData(apiBase, keyword, n);
}

async function fetchNetEaseSongData(keyword, n) {
  const apiBase = 'https://api.xingzhige.com/API/NetEase_CloudMusic_new/';
  return fetchSongData(apiBase, keyword, n);
}

function formatSongList(songList, platform, startIndex) {
  const formattedList = songList.map((song, index) => `${index + startIndex}. ${song.songname} -- ${song.name}`).join('\n');
  return `${platform}：\n${formattedList}`;
}

// 0.0.1，基于原插件新增的下载歌曲的函数
// 使用axios下载歌曲
async function downloadSong(url, songName, downloadPath) {
  
  // 检查目录是否存在，不存在则创建
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true });
  }
  
  try {
    const response = await axios({
      method: 'get',
      url: url,
      responseType: 'stream'
    });
    
    const safeSongName = songName.replace(/[/\\?%*:|"<>]/g, '-');
    const filePath = path.join(downloadPath, `${safeSongName}.mp3`);
    
    // 保存文件
    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filePath));
      writer.on('error', reject);
    });

  } catch (error) {
    throw new Error(`Failed to download song: ${error.message}`);
  }
}



// 0.0.4，新增的生成图片歌单的函数
async function generateSongListImage(ctx, qqSongList, netEaseSongList, config) {
  // 判断当前是否为夜间模式
  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes(); // 将当前时间转换为分钟
  const nightModeStartTime = parseInt(config.nightModeStart.split(':')[0]) * 60 + parseInt(config.nightModeStart.split(':')[1]);
  const nightModeEndTime = parseInt(config.nightModeEnd.split(':')[0]) * 60 + parseInt(config.nightModeEnd.split(':')[1]);

  let isNightMode = false;
  if (nightModeEndTime > nightModeStartTime) {
    // 夜间模式时间段不跨越午夜
    isNightMode = config.nightModeEnabled && (currentTime >= nightModeStartTime && currentTime <= nightModeEndTime);
  } else {
    // 夜间模式时间段跨越午夜
    isNightMode = config.nightModeEnabled && (currentTime >= nightModeStartTime || currentTime <= nightModeEndTime);
  }

  // 根据是否为夜间模式，来设置字体和背景的亮度
  const textBrightness = isNightMode ? config.nightModeTextBrightness : config.textbrightness;
  const backgroundBrightness = isNightMode ? config.nightModeBackgroundBrightness : config.backgroundbrightness;
  
  const page = await ctx.puppeteer.browser.newPage();
  
  // 使用配置中的亮度值
  const textColor = `rgb(${textBrightness},${textBrightness},${textBrightness})`;
  const backgroundColor = `rgb(${backgroundBrightness},${backgroundBrightness},${backgroundBrightness})`;


  

  // 设置页面内容，尤其需要平台标识和分隔符，以后考虑换背景，支持API什么的
  const htmlContent = `
    <html>
      <head>
        <style>
          body {
            margin: 0;
            font-family: Arial, sans-serif;
            font-size: 16px;
            background: ${backgroundColor}; /* 使用配置项调整的背景颜色 */
            color: ${textColor}; /* 使用配置项调整的文本颜色 */
            width: fit-content; /* 调整宽度以适应内容 */
          }
          #song-list {
            padding: 20px;
            display: inline-block; /* 使div适应内容宽度 */
            max-width: 100%; /* 防止内容溢出 */
          }
          .platform-title {
            font-weight: bold;
            margin-top: 20px;
          }
          .separator {
            margin: 10px 0;
            text-align: left; /* 调整分隔符对齐方式 */
          }
          .song-item {
            white-space: nowrap; /* 防止歌曲名称换行 */
          }
        </style>
      </head>
      <body>
        <div id="song-list">
          <div class="platform-title">QQ音乐：</div>
          ${qqSongList.map((song, index) => `<div class="song-item">${index + 1}. ${song.songname} -- ${song.name}</div>`).join('')}
          <div class="separator">============================</div>
          <div class="platform-title">网易云平台：</div>
          ${netEaseSongList.map((song, index) => `<div class="song-item">${index + qqSongList.length + 1}. ${song.songname} -- ${song.name}</div>`).join('')}
        </div>
      </body>
    </html>
  `;
  await page.setContent(htmlContent);

  // 计算最长的歌曲信息长度
  const maxWidth = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.song-item'));
    return Math.max(...items.map(item => item.offsetWidth));
  });

  // 设置视口大小为最长歌曲信息长度加上padding
  await page.setViewport({
    width: maxWidth + 40, // 这里假设左右padding总和为40px
    height: 2000, // 设置一个较大的高度以适应所有内容
    deviceScaleFactor: 1,
  });

  // 对内容进行截图，截取所需部分
  const clipRect = await page.evaluate(() => {
    const songList = document.getElementById('song-list');
    const rect = songList.getBoundingClientRect();
    return { x: rect.left, y: rect.top, width: rect.width, height: rect.height };
  });

  const screenshot = await page.screenshot({
    clip: clipRect,
    encoding: 'binary'
  });
  
  await page.close();
  return screenshot;
}

// 撤回用的
function sleep(time) {
  return new Promise(resolve => setTimeout(resolve, time));
}


function apply(ctx, config) {
  // 监听发送事件以获取 messageId
  let messageId;
  ctx.on('send', (session) => {
    messageId = session.messageId;
  });


  //0.1.8 新增重试模式。开启后，在API返回错误时会重新尝试，重试三次后仍然失败则停止并返回错误。
  async function fetchWithRetry(fetchFunction, keyword, retries = 3) {
    let attempt = 0;
    while (attempt < retries) {
      try {
        const response = await fetchFunction(keyword);
        if (response !== null && response.code === 0) return response;
        throw new Error('API返回错误');
      } catch (error) {
        logger.error(error.message);
        if (attempt === retries - 1) {
          logger.error('重试次数用尽，获取数据失败');
          break; // 退出循环，返回错误
        }
      }
      attempt++;
    }
    return null; // 在所有重试尝试失败后返回null
  }

  ctx.command('md-file <keyword:text>', '搜索并下载歌曲')
    .action(async ({ session }, keyword) => {
    if (!keyword) return '请输入歌曲相关信息。';
    let selectedSong  = null;
    //0.2.7
    //let qqSongData = null;
    //let netEaseSongData = null;
    let qqSongData = {
      "code": 0,
      "msg": "暂无",
      "data": [{
          "songname": "暂无",
          "subtitle": "暂无",
          "name": "暂无",
          "album": "暂无",
          "pay": "暂无",
          "song_type": "暂无",
          "type": "暂无",
          "songid": "暂无",
          "mid": "暂无",
          "time": "暂无",
          "bpm": "暂无",
          "quality": "暂无",
          "interval": "暂无",
          "size": "暂无",
          "kbps": "暂无",
          "cover": "暂无",
          "songurl": "暂无",
          "src": "暂无"
      }]
  };
  let netEaseSongData = {
      "code": 0,
      "msg": "暂无",
      "data": [{
          "songname": "暂无",
          "subtitle": "暂无",
          "name": "暂无",
          "album": "暂无",
          "pay": "暂无",
          "song_type": "暂无",
          "type": "暂无",
          "songid": "暂无",
          "mid": "暂无",
          "time": "暂无",
          "bpm": "暂无",
          "quality": "暂无",
          "interval": "暂无",
          "size": "暂无",
          "kbps": "暂无",
          "cover": "暂无",
          "songurl": "暂无",
          "src": "暂无"
      }]
  };
    
   
    //0.2.5移除根据repostmode决定是否应用重试机制

   // 单独处理 QQ 音乐 API 请求
   try {
    const response = await fetchQQSongData(keyword);
    if (response === null || response.code !== 0) {
        logger.error('QQ音乐API返回错误。');
    } else {
        qqSongData = response;
    }
} catch (e) {
    logger.error('请求QQ音乐API时发生错误。', e);
}

// 单独处理网易云音乐 API 请求
try {
    const response = await fetchNetEaseSongData(keyword);
    if (response === null || response.code !== 0) {
        logger.error('网易云音乐API返回错误。');
    } else {
        netEaseSongData = response;
    }
} catch (e) {
    logger.error('请求网易云音乐API时发生错误。', e);
}
    
  // 构造QQ音乐和网易云音乐的歌单字符串，包括平台标识和分隔符
const qqSongListText = qqSongData && qqSongData.data.length > 0 
? formatSongList(qqSongData.data, 'QQ音乐', 1) 
: 'QQ音乐：无法获取歌曲列表';
const netEaseSongListText = netEaseSongData && netEaseSongData.data.length > 0 
? formatSongList(netEaseSongData.data, '网易云平台', qqSongData ? qqSongData.data.length + 1 : 1) 
: '网易云平台：无法获取歌曲列表';

// 合并QQ音乐和网易云音乐的歌单，添加平台标识和分隔符
const songListText = `${qqSongListText}\n=======================\n${netEaseSongListText}`;

  // 构造歌曲列表字符串
  const songList = [
    ...(qqSongData ? qqSongData.data : []),
    ...(netEaseSongData ? netEaseSongData.data : [])
  ];



  const exitCommands = config.exitCommand.split(/[,，]/).map(cmd => cmd.trim())
  const waitTimeInSeconds = config.waitTimeout / 1000;
  //带有平台标识和分隔符的图片歌单
  let songListSent = false; // 标记是否成功发送了歌单
  if (config.imageMode) {
    try {
      const imageBuffer = await generateSongListImage(ctx, qqSongData.data, netEaseSongData.data, config);
      let exitCommandTip = config.MenuExitCommandTip ? `退出选择请发[${exitCommands}]中的任意指令\n\n` : "";
      await session.send(h.image('data:image/png;base64,' + imageBuffer.toString('base64')) + `${exitCommandTip}请在${waitTimeInSeconds}秒内，\n输入歌曲对应的序号：`);
      songListSent = true;
    } catch (e) {
      logger.error('生成图片歌单失败', e);
      await session.send('生成图片歌单失败，请稍后再试。');
    }
  } else {
    // 发送文本歌单
    if (qqSongData && qqSongData.data && qqSongData.data.length > 0 || netEaseSongData && netEaseSongData.data && netEaseSongData.data.length > 0) {
      let exitCommandTip = config.MenuExitCommandTip ? `退出选择请发[${exitCommands}]中的任意指令\n\n` : "";
      await session.send(songListText + `\n\n${exitCommandTip}请在${waitTimeInSeconds}秒内输入歌曲对应的序号：`);
      songListSent = true;
    } else {
      await session.send('无法获取歌曲列表，请稍后再试。');
    }
  }

// 接收序号选择并且判断的内容
  // 接收用户输入序号的逻辑，包括容错重试

  if (songListSent) {
    let retryCount = config.retryLimit;
    let input = '';
    let timedOut = false; // 添加一个标记来检查是否超时
    // 设置超时逻辑
    const timeoutPromise = new Promise(resolve => setTimeout(() => resolve('timeout'), config.waitTimeout));
    do {
      input = await Promise.race([
        session.prompt(`请输入歌曲序号（剩余次数${retryCount}）：`),
        timeoutPromise
      ]);
      
      if (input === 'timeout') {
        timedOut = true;
        break; // 跳出循环
      }
      
      if (exitCommands.includes(input)) {
        return '已退出歌曲选择。';
      }
      
      if (!input || Number.isNaN(+input) || +input < 1 || +input > (qqSongData ? qqSongData.data.length : 0) + (netEaseSongData ? netEaseSongData.data.length : 0)) {
        retryCount--;
        let exitCommandTip = config.retryExitCommandTip ? `\n\n退出选择请发[${exitCommands}]中的任意指令` : "";
        if (retryCount > 0) {
        await session.send(`请输入歌单内正确的序号（剩余次数${retryCount}）。${exitCommandTip}`);
        } else {
        return '已达到最大重试次数，操作已取消。';
        }
      } else {
        break; // 正确输入，跳出循环
      }
      } while (retryCount > 0);
      
      // 检查是否因超时而结束
      if (timedOut) {
      await session.send('操作超时，已取消点歌。');
      return; // 结束函数执行
      }
  

  const index = parseInt(input, 10); // 将用户输入转换为整数

  // 检查序号是否在可用的歌曲列表范围内
  if (qqSongData && index <= qqSongData.data.length) {
  // 获取QQ音乐歌曲详细信息
  selectedSong = await fetchQQSongData(keyword, index);
  } else if (netEaseSongData && index > qqSongData.data.length) {
  // 获取网易云音乐歌曲详细信息
  const netEaseIndex = index - qqSongData.data.length - 1;
  selectedSong = await fetchNetEaseSongData(keyword, netEaseIndex + 1);
  } else {
  return '请输入正确的序号。';
  }
  
  
  if (!selectedSong || selectedSong.code !== 0 || !selectedSong.data.src) {
    return '获取选定歌曲失败，请输入正确的序号。';
}

// 发送 "生成语音中..." 消息，并立即获取 messageId
const ingMessageResponse = await session.send(config.loadmessage || '生成语音中...');
// 取数组的第一个元素作为 messageId
const ingMessageId = ingMessageResponse[0]; 

// 下载地址路径
const downloadPath = config.downloadPath || 'C:/Music-downloadvoice-api';

try {
  const filePath = await downloadSong(selectedSong.data.src, selectedSong.data.songname, downloadPath);
  const fileUrl = path.resolve(filePath);

  const deleteMessage = async function() {
    // 撤回消息动作
    await sleep(config.recall_time);
    if (config.recall && ingMessageId) {
        try {
            await session.bot.deleteMessage(session.guildId, ingMessageId);
        } catch (error) {
            logger.warn('Failed to recall message:', error);
        }
    } 
  }

  const sendMessage = async function() {
    // 发送音频动作
    if (session.platform === 'qq') {
        if (!ctx.silk)
            throw new Error("silk 服务未加载");
        if (!ctx.ffmpeg)
            throw new Error("ffmpeg 服务未加载");

        const buf = fs.readFileSync(filePath);
        const data = await ctx.ffmpeg.builder().input(buf).outputOption("-ar", '24000', '-ac', '1', '-f', 's16le').run('buffer');
        const res = await ctx.silk.encode(data, 24000);
        await session.send(koishi_1.h.audio(Buffer.from(res.data), "audio/amr"));

    } else {
        await session.send(h.audio(`file:///${fileUrl.replace(/\\/g, '/')}`));
    }

    // 删除文件
    try {
      fs.unlinkSync(filePath);
    } catch (error) {
      logger.error(`删除文件时出现错误: ${error.message}`);
    }
    logger.success(`成功发送点歌语音，并删除文件: ${filePath}`);
  }

  // 执行并发操作
  await Promise.all([deleteMessage(), sendMessage()]);

} catch (error) {
  logger.error(`处理过程中出现错误: ${error.message}`);
}
//if (songListSent) {
}//}，用于防止继续进行生成歌单失败后的逻辑

});
};

exports.apply = apply;