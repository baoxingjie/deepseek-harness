# Agent Note: 通过共享 web 能力提供 UniClaw 搜索

Status: implemented

[English](2026-08-21-uniclaw-search-provider.md) | 中文

## 问题

UniClaw 桌面应用会认证用户并存储应用 token，但其面向模型的 web 搜索仍使用基础 profile 的 DeepSeek provider。独立的临时工具会重复稳定的 `web_search` schema，绕过 provider 选择和共享结果限制，而且需要在 UniClaw 登录之外提供第二套凭据来源。

## 决策

`@deepseek-ai/dsh-web-search-uniclaw` 基于元景的 Bocha 兼容 endpoint 实现 `WebSearchProvider`。桌面覆盖层挂载该 provider，并在 `ctx.web` 中选择其 `uniclaw` id；现有 `dsh-tool-web` consumer 仍是唯一面向模型的搜索工具。

Provider 每次操作都从 `ctx.credentials` 解析 `UNICLAW_APP_TOKEN`。因此，UniClaw 登录和 token 刷新通过模型及需要密钥的 MCP server 所使用的同一份存储凭据为搜索提供认证，而退出登录会使下一次搜索失败，不会保留缓存 secret。携带凭据的请求会在联系重定向目标之前拒绝重定向。

Adapter 将 provider 页面映射为 `WebSearchSource`，优先使用生成的摘要而不是片段，并保留发布日期或抓取日期。共享 web runtime 仍负责执行模型请求的结果数量限制。

## 验证

真实 Loader 组合通过 `cordis.yml` 挂载凭据 provider、web runtime 和 UniClaw 搜索 provider，然后观察标准化搜索结果以及出站认证、重定向、请求数量、freshness 和 summary 字段。聚焦测试还覆盖响应标准化、缺少凭据、provider 错误码和无效 JSON。桌面 runtime 部署通过生产依赖图包含该 provider。

## 考虑过的替代方案

**通过绝对路径挂载临时插件。** 未采用，因为其配置包含仅适用于 macOS 的路径，不在打包 runtime 内，而且它会注册第二个面向模型的工具，而不是实现仓库的 web 能力角色。

**把搜索实现加入 `uniclaw-shell`。** 未采用，因为 `uniclaw-shell` 负责认证和 UniClaw 配置路由，而 provider 选择、搜索标准化、取消和面向模型的呈现已经由 web 能力包负责。

**在 UniClaw 桌面组合中继续选择 DeepSeek 搜索。** 未采用，因为它需要单独的 DeepSeek 凭据，也没有提供经过认证的 UniClaw 部署所包含的搜索服务。

## 后果

桌面插件列表包含可独立诊断的 `web-search-uniclaw` 条目，`web_search` 使用 UniClaw 登录建立的 token。搜索在登录前或退出后不可用。Provider 不增加 fetch 能力，而且共享请求类型没有逐次调用的 freshness 字段，因此 freshness 作为部署配置公开。
