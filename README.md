# koishi-plugin-music-downloadvoice-api

[![npm](https://img.shields.io/npm/v/koishi-plugin-music-downloadvoice-api?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-music-downloadvoice-api)

🎵 **QQ语音音乐** - 搜索并提供QQ音乐和网易云音乐平台的歌曲,交互选择后发送语音消息,🤩付费的歌曲也可以欸！？

## 特点

- **搜索歌曲**：🤩 支持QQ音乐和网易云音乐平台的歌曲搜索。
- **歌曲详情**：🎧 获取包括音质、大小和听语音链接在内的歌曲详细信息。
- **友好交互**：📱 简单易用的指令,快速获取你喜欢的音乐。

## 安装

在koishi插件市场搜索并安装`music-downloadvoice-api`

## 使用

在你的聊天环境中,你可以使用以下指令 来搜索和听语音音乐,支持QQ和网易云平台

### 使用`music-downloadvoice-api`搜索并听语音歌曲

交互示例：
**用户**：

```code
指令名称   <歌曲名称>
```

**机器人**：

```code
【歌曲列表】
【歌曲列表】
【歌曲列表】
【歌曲列表】
请在■■秒内,输入歌曲对应的序号：
```

**用户**：

```code
[选择的歌曲序号]
```

**机器人**：

```code
生成语音ing....
```

```code
【一条较长的语音消息】
```

## 配置歌曲文件夹

在控制台支持用户使用配置项自定义一个音乐下载的路径,

由于语音在发送完成后可以自动删除,所以无需担心存储占用问题~

所以其实选什么歌曲文件夹也没关系的啦~ *-*

- 删除成功和失败,都在日志输出提示标识。

## 注意事项

- 1.需要使用API调用歌曲信息,请保持网络畅通
- 2.语音功能需要ffmpeg的转码支持
- 3.依赖koishi-plugin-silk插件

### 更新日志

- **0.2.8**   修复配置项[waitTimeout]失效的问题。
- **0.2.7**   不再[let qqSongData  = null]与[let netEaseSongData  = null]。而改为默认的【暂无】，以防止API返回错误造成的报错。
- **0.2.6**   1.增加配置项[MenuExitCommandTip,retryExitCommandTip]，以提示用户使用退出指令。
- **0.2.5**   1.重写fetchSongData，防止其中某个API坏掉。 2.取消重试模式（0.2.6补上的readme）
- **0.2.4**   1. 新增配置项[retryLimit]与[exitCommand]，增加用户返回的序号的容错。自定义序号容错时的退出指令。 2.修复之前[歌单发不出来，但是接下来还进行选择序号交互]的逻辑漏洞。
- **0.2.3**   修正nightModeEnabled配置项的注释。
- **0.2.2**   1.整理配置项，新增分组[图片歌单设置]。2.新增配置项[textbrightness,backgroundbrightness,nightModeEnabled,nightModeStart,nightModeEnd,nightModeTextBrightness,nightModeBackgroundBrightness]  3.允许用户自定义设置歌单的字体、背景亮度。  4.新增夜间模式选项。  5.允许用户自定义设置夜间模式的歌单的字体、背景亮度。
- **0.2.1**  我擦,0.2.0修坏了。重写下载函数,使用axios下载歌曲,修复[Music-downloadvoice-api 处理过程中出现错误: Protocol "http:" not supported. Expected "https:"]
- **0.2.0**  新增一个https.Agent实例,配置为忽略SSL证书错误。
- **0.1.9**  补全规范配置项的【koishi_1.Schema】少了【koishi_1.】
- **0.1.8**  新增重试模式。开启后,在API返回错误时会重新尝试,重试三次后仍然失败则停止并返回错误。
- **0.1.7**  在不开启【recall】时,取消“生成语音中”的日志输出。
- **0.1.6**  修改为【exports.inject = { optional: ["puppeteer", "ffmpeg", "silk"] };】以移除日志的警告报错
- **0.1.5**  即使配置项【loadmessage】为空,也可以处理,返回“生成语音中...”的默认文字内容。
- **0.1.4**  1. 修复【撤回延迟越长,发语音所需时间越长】的bug,改为了并发操作,CPU性能越强发的越快。  2.增加配置项【loadmessage】,允许自定义“生成语音中...”的文字内容。
- **0.1.3**  adapter-qq的官方机器人也可以发语音了（忘了写了0.1.4补上的
- **0.1.2**  修复0.1.0撤回【生成语音ing】失败的情况
- **0.1.1**  修复0.1.0撤回【生成语音ing】失败的情况
- **0.1.0**  1.支持QQ官方机器人发送语音。 2.延迟waitTimeout至45秒。 3.加入依赖插件【ffmpeg】。
- **0.0.9**  1.与music-downloadlink-api对齐,图片歌单采用图文一起发送而不分开发。 2.增加配置项【waitTimeout】允许用户自定义等待的序号输入时长。 3.延长了【recall_time】配置项的默认时长至20秒。
- **0.0.8**  依赖koishi-plugin-silk: 0.1.0
- **0.0.7**  增加配置项,支持选项撤回“生成语音ing.....”的消息。
- **0.0.6**  修改配置项内容,确保能够开箱即用。
- **0.0.5**  完善代码部分的小错误,忘记声明pptr服务了,现在没有warn了。Akisa大人说得对,小小学很佩服。
- **0.0.4**  完善交互提示,增加图片歌单和歌单形式的开关。
- **0.0.3**  完善交互提示,修正ffmpeg的单词拼写错误。
- **0.0.2**  完善依赖,silk加入插件所需依赖。
- **0.0.1**  music-downloadvoice-api功能基本实现,通过API点歌并且返回语音消息。
