---
name: video-source-search
description: 影视片源搜索、全集提取、播放验证和下载助手（movie/TV source search, full-episode extraction, playback verification, download）。用于电影、电视剧、综艺、动漫、短剧的资源搜索、片源搜索、播放源搜索、免费播放、在线播放、网盘、m3u8、mp4、ts片段、下载、保存、转mp4、投屏、能否播放、验证链接等请求。用户说"搜索电视剧/搜索电影/搜索动漫/搜索综艺/搜索短剧 + 片名"、"搜电视剧/搜电影/查电视剧/查电影 + 片名"，即使没有说"资源/在哪看/下载"，也必须触发本 skill，而不是普通网页信息搜索。用户提到找资源、在哪里看、有没有片源、免费观看、在线播放、下载、第1集、第N集、全集、全39集、m3u8列表、ffmpeg下载时也触发。连续剧默认寻找全集/全季/分集列表，不只返回单集。
---

# 影视片源搜索 VOD

## 🚫 第 0 条铁律：技能目录只读，产物写用户工作目录

本文开头那行 `Base directory for this skill: <路径>` 就是**技能根**，下文写作 `<技能根>`。

- **绝不 `cd` 进技能目录**，调技能脚本一律用绝对路径：`python <技能根>/scripts/xxx.py`。下文命令都这么写，照抄时别省掉 `<技能根>/`。
- **所有产物写用户工作目录**：下载的视频（`--out`）、日志、临时清单，一个都不进技能目录。视频动辄几百 MB，写进技能安装目录会被技能更新连锅端。
- 开工前 `pwd` 确认自己在哪；`--out` 用相对路径 `./片名E01.mp4` 或用户指定的路径。


## Quick Workflow

1. 首次使用先跑环境检查（见 Setup）。
2. 提取干净片名和类型：`tv` / `movie` / `unknown`。
3. `mcp_vods.py search` 搜索；连续剧再用 `detail --episode -1` 取全集。见 [mcp-vods](references/mcp-vods.md)。
4. 连续 empty/timeout 就换兜底搜索，别在 mcp-vods 上反复重试。见 [fallback-search](references/fallback-search.md)。
5. 按 [output-rules](references/output-rules.md) 过滤付费墙、聚合页、非影视站、错误片名。
6. `probe_media.py` 验证时长、清晰度、可播性。见 [media-verify](references/media-verify.md)。
7. 要下载就 `download_media.py start` + 多次 `status`。见 [download-progress](references/download-progress.md)。
8. 输出结果，连续剧优先给全集链表。
9.下载如果一直进度为0证明这个片源下载不了，这个时候你对这个视频任务重新换源再重新下载。

## Setup

脚本是 Python 3（只用标准库），Windows / macOS / Linux 通用。命令统一写 `python`。

```bash
python <技能根>/scripts/preflight.py --json              # 体检：node/npx、uv/uvx、ffmpeg/ffprobe
python <技能根>/scripts/preflight.py --install          # 缺什么装什么
```

ffmpeg/ffprobe 缺失：**只跑 `python <技能根>/scripts/preflight.py --install` 这一条命令**，失败就原样重跑——脚本幂等自愈（断点续传、魔数校验自动丢弃 HTML 错误页、损坏文件自动重装），不需要任何手动准备或清理。平台差异脚本自己处理：Windows 走 OSS exe 直连，Linux（含无 root 的 sandbox）从国内镜像装静态构建到 `~/.local/bin` 全程免 root，macOS 走 brew。

**工具路径不用你操心**：preflight 验真后把 ffmpeg/ffprobe/npx/uvx 的绝对路径写进 `tools.json`，probe/download/搜索脚本共用同一套解析（注册表 → PATH → 各平台已知安装位置），**不依赖 PATH**，所以「preflight 说 ✅、脚本说找不到」这种矛盾不会再出现。真缺了脚本会自己调 preflight --install 装完续跑，你什么都不用做。

以下手搓行为**一律禁止**——实测每一条都翻过车：

- ❌ `where` / `Get-Command` / `shutil.which` 自己找 ffmpeg 路径：agent 子进程 PATH 和用户终端不同，找不到是正常的，**不代表没装**，脚本内部已经查过更多位置。
- ❌ 看到「找不到 ffprobe」就重跑 preflight 或换 winget/PowerShell 重装：脚本已经自动装过一次了，再来一遍只是浪费几分钟。报错文案里写了唯一该跑的命令，照做即可。
- ❌ `sudo` / `apt-get install`：sandbox 无 root，只会卡密码或 Permission denied。
- ❌ 自己 curl GitHub/ghproxy/OSS 拼链接下"静态包"：常拿到 HTML 错误页，执行报 `syntax error near unexpected token`。
- ❌ `pip install ffmpeg-python`：那是 Python 包装库，不是 ffmpeg 本体，装完 `ffmpeg` 命令依然不存在。
- ❌ `rm -rf` 缓存目录再重试：sandbox 的 /tmp 常删不动（Operation not permitted）；脚本重跑本来就不需要清缓存。

（Windows 的 OSS exe 直连地址，仅供核对，preflight 已内置：
https://obs-nmhhht6.cucloud.cn/app-agent-prod/video-search/ffmpeg-9.0-essentials/bin/ffmpeg.exe
https://obs-nmhhht6.cucloud.cn/app-agent-prod/video-search/ffmpeg-9.0-essentials/bin/ffprobe.exe ）


缺工具时故障会伪装成别的问题——uvx 不在 PATH 看着像"片源引擎连接失败"，ffprobe 缺失看着像"这个源不可播"。所以先体检。需要 sudo 的安装命令 preflight 只打印不执行（agent 里会卡在密码提示），转给用户跑。

冷启动要建 mcp-vods 环境（~89 个包，1–5 分钟），**可能超过 Bash 工具默认 120 秒超时**。被打断是正常的，依赖断点续装，加大超时重跑即可——**不要据此判定引擎不可用而转兜底**，这是本 skill 最常见的误判。

## Scripts

优先用脚本，别手写底层命令：命令拼错是历史最高频故障，而且报错会伪装成环境问题。

```bash
# 搜索：默认已按片名相关度排序、省略封面图和简介列（省约 80% 上下文）
python scripts/mcp_vods.py search "{片名}" [--page 1] [--max-rows 30] [--timeout 120]
python scripts/mcp_vods.py search "{片名}" --raw       # 要原始完整输出
python scripts/mcp_vods.py detail --id "{id}" --source "{source}" [--episode -1]
python scripts/mcp_vods.py doctor                      # mcp 链路分层诊断

# 探测：结论可直接写进结果表
python scripts/probe_media.py "{m3u8|mp4}" [--expect movie|tv] [--expect-minutes 120] \
    [--referer "{播放页}"] [--sample] [--json]

# 下载：start 立即返回，之后跨轮次 status 汇报。
# HLS master 清单会在 start 内自动下钻到最高码率分片清单，不用手动传 probe 的 variant_url；
# 已是分片清单或 non-HLS 不受影响；解析失败自动回退原 URL（--no-resolve 可关）。
python scripts/download_media.py start --url "{m3u8}" --out "{文件.mp4}" \
    --duration {秒} [--est-size-mb {probe 给的}] [--referer "{播放页}"]
python scripts/download_media.py status --out "{文件.mp4}"
python scripts/download_media.py stop   --out "{文件.mp4}"
```

`probe_media.py --json` 的 `est_size_mb` 可直接喂给 `download start --est-size-mb`。

## When To Read References

- `mcp-vods.md`：搜索空/超时、取全集、候选排序。
- `fallback-search.md`：mcp-vods 失败后的兜底梯子和对用户话术。
- `media-verify.md`：挖真实媒体 URL、时长门槛。
- `download-progress.md`：进度汇报节奏、分段下载、失败处理。
- `output-rules.md`：过滤、排序、结果表格式。


## Long Download Reminder

当 `download_media.py start` 已成功启动后台下载后，不要在当前agent等待下载完成。
必须立即回复用户：下载已转入后台，并会定期反馈进度。

随后创建一个 UniClaw 定时任务，定时任务必须保存并使用以下prompt：

----我的后台在运行着用户创建的一个影视搜索任务，用户使用了video-search这个skill，用户搜索的片名称是- 片名：{片名}，请每10分钟进行一次以下任务，得到结果提醒我下载进度，- 状态命令：`python scripts/download_media.py status --out "{输出文件绝对路径}" --json`，运行上述 status 命令，
1. 若 `processed_seconds `为“0”，"speed"为""，证明这个片源下载不了，这个时候你需要对这个视频任务重新开始执行 换源  再重新下载。
2. 若 `running=true`，向用户反馈百分比、已处理时长、文件大小、速度、预计剩余时间。
3. 若 `finished=true` 或输出文件已完成，反馈“下载完成”，给出文件路径，然后停止这个定时任务。
4. 若 `running=false` 且 `finished=false`，读取 `{输出文件去扩展名}.meta.json` 和 `{输出文件去扩展名}.log` 判断失败原因，反馈失败信息。
不要重复发送无变化进度；如果百分比变化小于 1%，只说“仍在下载中”。- 预计总时长：`probe_media.py` 或 `download_media.py start --duration` 使用的秒数。- 输出文件绝对路径：`download_media.py start --out` 使用的路径。进度文件位置由输出文件派生：- `{basename}.progress.txt`：ffmpeg 进度  - `{basename}.meta.json`：下载元信息、pid、失败尾日志  - `{basename}.pid.txt`：后台 ffmpeg 进程号  - `{basename}.log`：ffmpeg 错误日志  优先使用 `download_media.py status --json`，不要手动解析 progress 文件；只有 status 失败时才读 sidecar 文件兜底。如果下载任务完成了，请必须将下载好的文件通过present_to_user工具展示给用户，同步把这个定时任务暂停掉！----


## Critical Rules

- 关键词只用干净片名，不加 `全集/电视剧/年份/m3u8`——加了反而匹配不到，修饰词留给网页搜索。
- 不对用户暴露 `mcp-vods`/`uvx`/`连接失败` 等内部术语；需要兜底只说"正在用网络搜索为你查找片源"。
- 连续剧默认找全集。只验证了单集就不能标成"全集可用"。
- 时长是硬门槛不是加分项：预告片和切片是最主要的假阳性来源。
- 正版平台有授权版本时一并给出入口，不挤占免费结果。
- 播放地址必须是 Markdown 可点击链接，不能是纯文本或反引号 URL。
- 不伪造链接：URL 必须来自搜索、页面、接口或探测输出。
- 下载超 30 秒要多次汇报进度。`start` 已 detach，用 `status` 跨轮次查。
- 防盗链源站给 probe/download 传 `--referer`（UA 已默认带）。探测失败先怀疑缺 Referer。



## Self-Test

- `找一下狂飙的资源`：给全集链表，不只第 1 集。
- 搜"狂飙"会混进几十条同名短剧。脚本已按相关度预排序，但仍要用年份（2023）和集数（39）复核，别把 60–100 集的短剧当正剧。
- mcp-vods 两次 empty：走兜底，不直接回"无结果"。
- `我想看流浪地球`：用 `--expect movie --expect-minutes` 排掉时长不对的候选。
- `下载狂飙第1集`：超 30 秒要有多次进度更新。
- 结果表里播放地址是 `[播放链接](https://...)` 形式。
- `推荐几部好看的刑侦剧`：不触发本 skill。
