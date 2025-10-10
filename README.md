# koishi-plugin-music-voice

[![npm](https://img.shields.io/npm/v/koishi-plugin-music-voice?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-music-voice)

🎵 **语音点歌** - 搜索网易云音乐的歌曲，交互后发送语音消息，🤩付费的歌曲也可以欸？！

## 特点

- **搜索歌曲**：🤩 支持网易云音乐的歌曲搜索。
- **友好交互**：📱 简单易用的指令，快速获取你喜欢的音乐。

## 安装

在 Koishi 插件市场搜索并安装 `music-voice`

## 使用该插件搜索并获取歌曲

**用户**：

```code
music <歌曲名称>
```

**机器人**：

```code
【歌曲列表】
请在■■秒内，输入歌曲对应的序号
```

**用户**：

```code
（选择的歌曲序号）
```

**机器人**：

```code
生成语音中…
```

```code
【一条时间较长的语音消息】
```

## API说明

本插件使用基于 Meting 构建的 Meting-API 来获取音乐直链。

如果需要更换API，可以直接在浏览器搜索 "Meting-API"，

找到你可用的服务 将自定义API地址填入配置项即可。

相关地址：
- https://github.com/metowolf/Meting
- https://github.com/injahow/meting-api
- https://api.injahow.cn/meting/

## 注意事项

- 本插件依赖外部 API 获取歌曲信息，请保持网络畅通
- 使用 `adapter-qq` 发送语音，需要安装并启用 `ffmpeg` 和 `silk` 服务
