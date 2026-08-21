# @deepseek-ai/dsh-web-search-uniclaw

[English](README.md) | 中文

这是 Harness [web 能力](../web/README.md)的元景／Bocha `WebSearchProvider`。UniClaw 桌面组合为面向模型的标准 `web_search` 工具选择此 provider。每次请求都会解析 UniClaw 登录写入的 `UNICLAW_APP_TOKEN`，因此登录、退出和 token 轮换无需重启应用即可生效。

## 配置

| 键 | 默认值 | 含义 |
|---|---|---|
| `endpoint` | 元景 Bocha endpoint | HTTPS 搜索 endpoint。 |
| `apiKeyEnv` | `UNICLAW_APP_TOKEN` | 每次请求解析的凭据引用。 |
| `timeoutMs` | `30000` | Provider 请求超时毫秒数。 |
| `defaultCount` | `10` | 调用方省略 `maxResults` 时的结果数，范围为 1–50。 |
| `freshness` | `noLimit` | `noLimit`、`oneDay`、`oneWeek`、`oneMonth`、`oneYear`、单个日期或日期范围。 |
| `summary` | `true` | 请求 provider 生成页面摘要。 |

Provider 只向配置的 endpoint 发送 bearer 凭据，并拒绝重定向。缺少凭据时返回 `WEB_PROVIDER_CREDENTIAL_MISSING`；网络、HTTP、provider 错误码和 JSON 错误使用 `WEB_PROVIDER_ERROR`；取消和超时使用 `WEB_ABORTED`。

## 模型体验

通过 [`dsh-tool-web`](../tool-web/README.md) 间接生效；只有模型调用 `web_search` 时，后者才会把此提供方返回的 URL、标题、摘要或片段，以及发布日期或抓取日期加入模型上下文。

#### KV Cache 影响

不会直接失效。现有 `web_search` schema 保持不变。

## 已知限制和延期工作

- Provider 只公开一个部署级 freshness 值；共享的 `WebSearchRequest` 不携带逐次调用的 freshness 字段。
- 有效响应不含 `data.webPages.value` 时，provider 可以返回空 source 列表。
