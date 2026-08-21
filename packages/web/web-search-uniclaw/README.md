# @deepseek-ai/dsh-web-search-uniclaw

English | [中文](README.zh.md)

A Yuanjing/Bocha-backed `WebSearchProvider` for the harness [web capability](../web/README.md). The UniClaw desktop composition selects this provider for the standard model-facing `web_search` tool. It resolves the `UNICLAW_APP_TOKEN` written by UniClaw login for every request, so login, logout, and token rotation take effect without restarting the application.

## Config

| Key | Default | Meaning |
|---|---|---|
| `endpoint` | Yuanjing Bocha endpoint | HTTPS search endpoint. |
| `apiKeyEnv` | `UNICLAW_APP_TOKEN` | Credential reference resolved for each request. |
| `timeoutMs` | `30000` | Provider request timeout in milliseconds. |
| `defaultCount` | `10` | Result count when the caller omits `maxResults`; range 1–50. |
| `freshness` | `noLimit` | `noLimit`, `oneDay`, `oneWeek`, `oneMonth`, `oneYear`, one date, or a date range. |
| `summary` | `true` | Ask the provider for page summaries. |

The provider sends bearer credentials only to the configured endpoint and rejects redirects. Missing credentials fail with `WEB_PROVIDER_CREDENTIAL_MISSING`; network, HTTP, provider-code, and JSON failures use `WEB_PROVIDER_ERROR`; cancellation and timeout use `WEB_ABORTED`.

## Model Experience

Indirectly, through [`dsh-tool-web`](../tool-web/README.md), which adds the provider's URLs, titles, summaries or snippets, and publication or crawl dates to model context only when the model invokes `web_search`.

#### KV Cache effect

No direct invalidation. The existing `web_search` schema is unchanged.

## Known Limitations and Deferred Work

- The provider exposes one deployment-wide freshness value; the shared `WebSearchRequest` does not carry a per-call freshness field.
- The endpoint can return an empty source list for a valid response without `data.webPages.value`.
