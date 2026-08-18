# uniclaw-shell

DeepSeek Harness 的 UniClaw（元景网关）集成插件：短信验证码登录 + 套餐/模型目录自动配置。纯插件实现，不改 harness 核心代码，通过 cordis.yml patch 覆盖层挂载。

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

# 4. 把 patch 里的插件路径改成你自己的绝对路径（harness loader 要求绝对路径）
#    macOS:
sed -i '' "s#/Users/bxj/maas/deepseek/deepseek-harness#$(pwd)#" uniclaw-shell/cordis.yml
#    Linux 去掉 '' 即: sed -i "s#...#$(pwd)#" uniclaw-shell/cordis.yml

# 5. 启动
pnpm dsh web --patch ./uniclaw-shell/cordis.yml
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

## 常见问题

| 现象 | 处理 |
|---|---|
| `pnpm: command not found`（构建或 git push 时） | 上面第 2 步没做全局启用；`corepack enable` 后重开终端 |
| 模型请求 404 | 确认拉到的是最新分支——旧版本误用 OpenAI 协议，现已按 provider 映射（yuanjing → `anthropic-messages`） |
| 模型请求 401 / `MISSING_CREDENTIAL` | 重新到 `/uniclaw` 登录一次；套餐 key 轮换后每次 my-plan 刷新会自动同步 |
| 端口被占 | 改 `uniclaw-shell/cordis.yml` 里 `webserver` 的 `port`（默认 3082） |
| 登录成功但提示"账号暂无可用密钥" | 该手机号没有生效的 UniClaw 套餐（无 app_token 下发），先在 UniClaw 端开通 |

## 实现说明（给开发者）

- 插件入口：[src/index.ts](src/index.ts)，Host 半侧 only（一期）。零运行时 import（`import type` only），因为它以绝对路径挂载、不在任何 node_modules 解析域内
- 注册的路由：`/api/uniclaw/login/{captcha,sendCode,smsLogin}`、`/api/uniclaw/my-plan`、`/api/uniclaw/status`（均为元景网关代理）、`/uniclaw`（一期登录页）
- 协议映射与 UniClaw 后端 `agent_manager._make_chat_model` 保持一致：`provider=yuanjing|anthropic` → `anthropic-messages`（SDK 拼 `/v1/messages`），其余 → `openai-completions`（拼 `/chat/completions`）
- my-plan 语义与 UniClaw 相同：有效 payload 全量覆盖模型目录，无效 payload 保留本地 last-known-good；顶层 `apiKey` 每次刷新回写凭据（兑换 `updateKey` 轮换场景）
- 调试：`UNICLAW_SHELL_DEBUG=1` 启动会多注册 `POST /api/uniclaw/debug/materialize`，可手喂 my-plan payload 测物化，勿在正式环境开
- 环境变量：`UNICLAW_AUTH_BASE` / `UNICLAW_GATEWAY_BASE` / `UNICLAW_APPLICATION`（企业部署换网关用）

二期计划：客户端半侧插件（登录卡片进设置页、套餐/用量展示），打包成正式 npm 包消掉绝对路径限制。
