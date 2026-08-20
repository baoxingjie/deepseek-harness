# uniclaw-shell

DeepSeek Harness 的 UniClaw（元景网关）集成：短信验证码登录 + 套餐/模型目录自动配置 + 技能（推荐/技能市场/已安装）+ MCP 服务器（内置/自定义）。不改 harness 核心代码，通过 cordis.yml patch 覆盖层挂载。

拆成两个包，因为仓库要求每个包只用一个编译面：

| 包 | 编译面 | 职责 |
|---|---|---|
| `packages/uniclaw/uniclaw-shell` | host | 网关代理路由、模型目录物化、技能安装管线、MCP 挂载管理 |
| `packages/uniclaw/ui-uniclaw` | client | 「技能」「MCP」两个设置页，注册进工作台自带的设置弹窗 |

## 环境要求

- Node.js `^22.19.0 || >=24`
- pnpm 11（用 corepack 即可，见下）
- 能访问 `maas.ai-yuanjing.com` 的网络
- 一个开通了 UniClaw 套餐的手机号

## 本地启动

```sh
# 1. 克隆（注意 -b 指定分支）
git clone -b uniclaw-shell git@github.com:baoxingjie/deepseek-harness.git
cd deepseek-harness

# 2. 启用 pnpm（二选一）
corepack enable          # 推荐；nvm 用户无需 sudo
# npm i -g pnpm@11.7.0   # 或者全局安装

# 3. 安装依赖并构建（首次约 2-5 分钟）
pnpm install
pnpm run build

# 5. 把两个包装进 web profile（out-of-tree 插件按 harness 的设计装在 profile 目录）
cd ~/.dsh/profiles/web
pnpm add "link:$OLDPWD/packages/uniclaw/uniclaw-shell" "link:$OLDPWD/packages/uniclaw/ui-uniclaw"
cd -

# 6. 启动
pnpm dsh web --patch ./packages/uniclaw/uniclaw-shell/cordis.yml
```

启动日志出现 `[uniclaw-shell] loaded` 和 `dsh web: http://127.0.0.1:3082` 即成功。

## 登录与使用

1. 打开 **http://127.0.0.1:3082/uniclaw** → 手机号 + 图形验证码 + 短信验证码登录
2. 登录成功后插件自动完成：
   - 元景 sk 密钥存入 `~/.dsh/.credentials.yaml`（配置文件里只有凭据引用，不落明文）
   - my-plan 模型目录物化进 `~/.dsh/settings.yaml` 的 `llm-pi-ai` 分节（live 生效，无需重启）
3. 回到 **http://127.0.0.1:3082/** 工作台：
   - 首次使用需 **选择工作区**（添加任意项目目录），否则输入框不可用
   - 模型选择器里选 UniClaw 元景下的模型（DeepSeek V4 Flash / GLM 5.2 / Qwen3 等），直接对话

## 技能（Skills）

工作台 → 左下角**设置** → **技能**（与 UniClaw app「扩展 → 技能」同源的三个页签）：

- **推荐**：UniClaw 推荐技能目录（元景网关 `/uniclaw/recommended-skills`），点 `+` 一键安装。安装时校验包大小与 sha256
- **技能市场**：万悟技能广场（`/wanwu/api/skills/*` 代理），支持分类筛选，点 `+` 安装
- **已安装**：启用/停用开关、查看 SKILL.md、卸载；也可 **上传技能**（.zip / .skill，包内根目录须有带 `name`/`description` frontmatter 的 SKILL.md）
- **内置技能**：UniClaw app 打包内置的 14 个 public skills（canvas-design / dws / pptx-plus-linux / uniai-docx 等）随插件分发在 `uniclaw-shell/skills/`，由插件注册的 `uniclaw-bundled` SkillProvider 以 bundled rank（600）进入目录 —— 项目/用户同名技能会覆盖内置。内置技能可停用（落盘 `~/.dsh/uniclaw-builtin-disabled.json`，provider invalidate 即时生效）但不可卸载

安装即生效，无需重启：技能落盘到 `~/.dsh/skills/<name>/`，这正是 harness 自带 `dsh-skill-filesystem` provider 监听的 user-dsh 根（rank 400，chokidar live watch）。技能随后自动进入对话的 `<available_skills>` 目录（`dsh-tool-skill` 注入），模型在对话里用 `skill` 工具即可加载运行。停用 = 移动到 `~/.dsh/skills-inactive/`（脱离扫描根），启用 = 移回。

注意：harness 只接受 kebab-case 技能名（`^[a-z0-9]+(-[a-z0-9]+)*$`）。安装管线会自动把不合规的 frontmatter `name` 规范化重写（中文名取拉丁片段或回退到包名/哈希），原始名字保留在安装元数据 `~/.dsh/uniclaw-skills-meta.json` 的 `displayName` 里供页面展示。

## MCP 服务器

工作台 → **设置** → **MCP**，对应 UniClaw app 设置里的 MCP 面板：

- **内置**（随插件分发，与 UniClaw app 打包 config.json 的 `is_builtin` 三项同源）：
  - `UniAI-Toolkit` — 元景 UniAI 工具集，HTTP。URL 里 `key=` 为空占位，登录后由插件填入当前 app token（等同 UniClaw 后端 `inject_yuanjing_key()`）；套餐 key 轮换时 my-plan 刷新会带新 key 重新挂载。默认开
  - `arXiv-mcp` — arXiv 论文检索，HTTP，无需 key。默认开
  - `playwright` — 浏览器自动化，stdio（`npx @playwright/mcp@latest --isolated`）。UniClaw 用自管浏览器运行时兜底，harness 没有，首次运行要现下载，因此**默认关**，需要时自行打开
- **自定义**：点「+ 添加 MCP 服务器」，HTTP 填地址 + 请求头，Stdio 填命令 + 参数 + 环境变量，可编辑/删除。名称即模型侧工具命名空间，须匹配 `^[A-Za-z0-9_-]{1,32}$` 且不与已有服务器重名（409）
- 内置项可停用不可删除；开关与自定义条目落盘 `~/.dsh/uniclaw-mcp.json`（`overrides` 存内置开关，`custom` 存自定义条目）

改动即时生效，无需重启：每个启用的服务器挂载一份 harness 自带的 `@deepseek-ai/dsh-mcp-client` 插件实例，其工具以 `mcp__<服务器名>__<工具名>` 注册进 `ctx.tools`，对话里模型直接可调；重连/重新同步由该桥接插件自己负责。挂载管理器按配置签名对账，只重挂被改动的那一个，删除的自动卸载。

## 常见问题

| 现象 | 处理 |
|---|---|
| `pnpm: command not found`（构建或 git push 时） | 上面第 2 步没做全局启用；`corepack enable` 后重开终端 |
| 模型请求 404 | 确认拉到的是最新分支——旧版本误用 OpenAI 协议，现已按 provider 映射（yuanjing → `anthropic-messages`） |
| 模型请求 401 / `MISSING_CREDENTIAL` | 重新到 `/uniclaw` 登录一次；套餐 key 轮换后每次 my-plan 刷新会自动同步 |
| 端口被占 | 改 `uniclaw-shell/cordis.yml` 里 `webserver` 的 `port`（默认 3082） |
| 登录成功但提示"账号暂无可用密钥" | 该手机号没有生效的 UniClaw 套餐（无 app_token 下发），先在 UniClaw 端开通 |
| 设置里看不到「技能」「MCP」两页 | `ui-uniclaw` 没装进 profile 或没构建；`cd ~/.dsh/profiles/web && pnpm add link:<repo>/packages/uniclaw/ui-uniclaw`，再 `pnpm --filter @deepseek-ai/dsh-client-ui-uniclaw run bundle` |
| MCP 显示"待登录" | `UniAI-Toolkit` 的 URL 需要 app token，先到 `/uniclaw` 登录；登录后自动挂载 |
| MCP 开着但"未挂载" | 看启动日志的 `MCP mount failed`：HTTP 多为地址/请求头不对或网络不通，stdio 多为本机没有该命令 |

## 实现说明（给开发者）

- 插件入口：[src/index.ts](src/index.ts)，Host 半侧 only（一期）。零运行时 import（`import type` only），因为它以绝对路径挂载、不在任何 node_modules 解析域内
- 注册的路由：`/api/uniclaw/login/{captcha,sendCode,smsLogin}`、`/api/uniclaw/my-plan`、`/api/uniclaw/status`（均为元景网关代理）、`/uniclaw`（一期登录页）
- 技能模块：[src/skills.ts](src/skills.ts)（API + 安装管线 + 内置 zip 解包）。前缀路由 `/api/uniclaw/skills`：`GET installed | market/{categories,list,detail} | recommended/{categories,list} | content?name=`，`POST market/install | recommended/install | upload?filename= | toggle | delete`。语义对齐 UniClaw 后端 `routes/skills.py`（安装幂等按市场 id、409 结构化 `skill_conflict`、推荐包 path/size/sha256 校验）
- 客户端半侧：[../ui-uniclaw/src/client/](../ui-uniclaw/src/client/)。`ctx.slots.inject('settings.section', …)` 各注册一页，模板是 `packages/client/ui-settings-models`。两页各持一个 `createSnapshotStore` 控制器，首次打开时加载；目录接口是网关裸透传，行形状在 [api.ts](../ui-uniclaw/src/client/api.ts) 归一化。客户端 bundle 的发现要求包声明 `dsh.client` 并导出 `./client`，改完要重新 `pnpm --filter @deepseek-ai/dsh-client-ui-uniclaw run bundle`
- 技能包解包为内置最小 zip 读取器（node:zlib inflateRaw，central directory 遍历，拒绝 `..`/绝对路径/zip64），因为绝对路径挂载的插件无法引入 unzip 依赖
- 内置技能 provider：[src/skills-bundled.ts](src/skills-bundled.ts)（`ctx.skills.registerProvider`，样板是 `dsh-skill-badge`），frontmatter 工具共享在 [src/skill-md.ts](src/skill-md.ts)。技能源拷自 UniClaw `backend/skills/public`（已剔除 `__pycache__`/`.pyc`），更新方式为重拷 + 重启
- MCP 模块：[src/mcp-builtin.ts](src/mcp-builtin.ts)。内置定义对齐 UniClaw 打包 config.json 的 `is_builtin` 条目；路由 `/api/uniclaw/mcp`：`GET /`、`POST toggle|save|delete`。`requestMcpSync(ctx, appToken)` 串行对账（登录、my-plan 刷新、开关、增删改都走它），mcp-client 以相对源码路径 import（插件按绝对路径挂载，不在任何 node_modules 解析域内，bare specifier 解析不到；桥接插件自身的依赖从它的包目录正常解析）
- 协议映射与 UniClaw 后端 `agent_manager._make_chat_model` 保持一致：`provider=yuanjing|anthropic` → `anthropic-messages`（SDK 拼 `/v1/messages`），其余 → `openai-completions`（拼 `/chat/completions`）
- my-plan 语义与 UniClaw 相同：有效 payload 全量覆盖模型目录，无效 payload 保留本地 last-known-good；顶层 `apiKey` 每次刷新回写凭据（兑换 `updateKey` 轮换场景）
- 调试：`UNICLAW_SHELL_DEBUG=1` 启动会多注册 `POST /api/uniclaw/debug/materialize`，可手喂 my-plan payload 测物化，勿在正式环境开
- 环境变量：`UNICLAW_AUTH_BASE` / `UNICLAW_GATEWAY_BASE` / `UNICLAW_APPLICATION`（企业部署换网关用）；技能模块另有 `UNICLAW_SKILL_MARKET_BASE_URL` / `UNICLAW_RECOMMENDED_SKILLS_BASE_URL`（与 UniClaw app 同名开关）

下一步：登录改成 `settings.onboarding` 页（未登录时挡在工作台前），套餐/用量单开一页；再在外面套 Electron 壳（主进程 spawn `dsh web` + 窗口加载本地地址）。
