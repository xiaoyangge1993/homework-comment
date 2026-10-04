# 跟读课文预批改

老师布置英语跟读课文，学生在手机浏览器里逐句听标准音、录音提交。腾讯云智聆按句打分。老师只听有漏读、错读或节奏偏离的作业，其余一键通过并发送中文点评。点评可以再合成语音。

第一期是 Web。学生端微信小程序是第二期，这个仓库里还没有 `miniprogram/`。现在不用申请小程序，也不用添加「智聆语音评测」插件。

## 老师需要开通的接口

1. [智聆口语评测（新版）](https://console.cloud.tencent.com/soenew)。评测用英文句子模式，引擎 `16k_en`。
2. [语音合成](https://console.cloud.tencent.com/tts)。点评用中文女声，语速偏慢。
3. [API 密钥](https://console.cloud.tencent.com/cam/capi)。`SecretId`、`SecretKey` 两个产品共用。`AppId` 在同一页的账号信息里，只给智聆用。

没有这两项密钥也能布置作业、录音和回放。页面会写「评测未配置」或「语音合成未配置」，不会出现假分数。

## 环境

- Node.js 20 或更新版本
- ffmpeg，用来把录音和视频抽成 16 kHz 单声道 wav，再交给智聆。没有 ffmpeg 时，纯音频里已经是 wav 的仍可评测；视频提交会被拒绝，并提示安装 ffmpeg。已经保存的视频仍可播放。macOS 13 及更新版本可以用 `brew install ffmpeg`。macOS 12 没有现成的 Homebrew 安装包，可以把可执行文件放到 `bin/ffmpeg`，或在 `.env.local` 里设置 `FFMPEG_PATH`。服务也会查找 `/opt/homebrew/bin` 和 `/usr/local/bin`。

## 配置

```bash
cp .env.example .env.local
```

`.env.local` 不要提交进仓库。

| 字段 | 作用 |
| --- | --- |
| `TEACHER_PASSWORD` | 老师登录密码。第一次启动时写入数据库。之后改这个值不会改掉已经写入的密码；要重设，先停掉服务，删除 `data/app.db`，再启动。 |
| `SESSION_SECRET` | 给老师和学生的登录票据签名。用一长串随机字符。 |
| `TENCENT_SECRET_ID` | 腾讯云 SecretId。智聆和语音合成都用它。 |
| `TENCENT_SECRET_KEY` | 腾讯云 SecretKey。 |
| `TENCENT_SOE_APPID` | 智聆 WebSocket 路径里的 AppId。三个腾讯云评测字段缺一个，评测就不可用。 |
| `TENCENT_TTS_VOICE_TYPE` | 可选。默认 `101001`（智瑜，中文女声）。账号没开精品音色时可以改成 `1001`。 |

语音合成是否可用，只看 `TENCENT_SECRET_ID` 和 `TENCENT_SECRET_KEY`。语速固定为约 0.8 倍。

密钥填好之后如果页面仍评不了：

- 智聆返回「请求未授权」或「签名错误」。签名错误说明 SecretKey 和 AppId 不配对。请求未授权说明签名已经通过，但这把密钥是子账号，主账号要在 [访问管理](https://console.cloud.tencent.com/cam) 里给它授予「智聆口语评测（新版）」权限。控制台开通服务不会自动授权子账号。
- 语音合成返回「语音合成资源包已用完」。需要在 [语音合成资源包](https://console.cloud.tencent.com/tts) 购买资源包，或开通后付费。文字点评仍会保存。

## 启动

```bash
npm install
npm run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。老师从「老师进入」登录，学生从「学生进入」填写班级码和姓名。

生产运行：

```bash
npm run build
npm start
```

`npm start` 会读取服务器上的 `.env.local`。部署到 Vercel 时这个文件不在仓库里，也不会上传。请在 Vercel 项目的 Settings → Environment Variables 中设置 `TEACHER_PASSWORD` 和 `SESSION_SECRET`（评测和语音合成还需要腾讯云那几项），环境勾选 Production，然后重新部署。只改本地 `.env.local` 不会让线上登录成功。Vercel 的函数目录是只读的，数据库和录音会写到该实例的 `/tmp`，实例回收后这些数据不会保留。

音频在 `data/audio/`，原视频在 `data/video/`，数据库在 `data/app.db`。数据库只存相对路径。这些目录不要提交。

布置视频接受 mp4、webm、mov，最长 5 分钟，最大 200MB。学生每一句的视频同样是这三种格式，最长 60 秒，最大 80MB。学生也可以只录音。服务端只抽出音轨做评测，不分析画面和口型。布置视频抽出的音轨只作整篇参照，不参与逐句打分。没有逐句标准音时，看板写「只有整段视频参照」。

## 验收课文

`The pandas are black and white. They are cute. They like bamboo.`

1. 老师新建作业，确认拆成 3 句，上传或录制整段布置视频，然后发布。逐句标准音可以缺。一句都没有时，看板上会写「只有整段视频参照」。
2. 学生用班级码进入作业链接，先看布置视频，再逐句提交视频或录音。一句视频最长 60 秒、80MB。系统先抽出音轨，再评测。
3. 配了智聆密钥时，每句保存真实评测结果，漏读下划线，错读标红，多读单独列出。
4. 没配密钥时，录音仍在，页面没有数字分数，可以点「重新评测」。
5. 看板里，准确度低于 80、完整度低于 90、有漏读或错读、或节奏不是「接近」的作业排在前面，标成建议亲听。其余已交齐且没有这些问题的，可以一键通过。
6. 通过后学生能看到最终文字。配了语音合成时能播放语音。
7. 打回第 2 句后，学生只能重录第 2 句，另外两句的结果还在。

同名学生不会自动并到旧记录上。页面会先问是不是本人。

## 检查

```bash
npm test
npm run build
```
