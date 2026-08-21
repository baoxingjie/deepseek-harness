# Agent Note: UniClaw search through the shared web capability

Status: implemented

English | [中文](2026-08-21-uniclaw-search-provider.zh.md)

## Problem

The UniClaw desktop application authenticates users and stores its application token, but its model-facing web search still uses the base profile's DeepSeek provider. A standalone scratch tool would duplicate the stable `web_search` schema, bypass provider selection and shared result bounds, and require a second credential source outside UniClaw login.

## Decision

`@deepseek-ai/dsh-web-search-uniclaw` implements `WebSearchProvider` over Yuanjing's Bocha-compatible endpoint. The desktop overlay mounts the provider and selects its `uniclaw` id in `ctx.web`; the existing `dsh-tool-web` consumer remains the only model-facing search tool.

The provider resolves `UNICLAW_APP_TOKEN` from `ctx.credentials` for each operation. UniClaw login and token refresh therefore feed search through the same stored credential as models and keyed MCP servers, while logout makes the next search fail without retaining a cached secret. Credential-bearing requests reject redirects before contacting their targets.

The adapter maps provider pages into `WebSearchSource`, prefers generated summary text over snippets, and retains publication or crawl dates. The shared web runtime still enforces the model-requested result limit.

## Verification

A real Loader composition mounts the credential provider, web runtime, and UniClaw search provider from `cordis.yml`, then observes a normalized search result and the outbound authorization, redirect, request-count, freshness, and summary fields. Focused tests also cover response normalization, missing credentials, provider error codes, and invalid JSON. The desktop runtime deployment includes the provider through its production dependency graph.

## Alternatives considered

**Mount the scratch plugin by absolute path.** Rejected because its configuration contains a macOS-only path, it is outside the packaged runtime, and it registers a second model-facing tool instead of implementing the repository's web capability roles.

**Add the search implementation to `uniclaw-shell`.** Rejected because `uniclaw-shell` owns authentication and UniClaw configuration routes, while provider selection, search normalization, cancellation, and model-facing presentation already have owners in the web capability packages.

**Keep DeepSeek search selected in the UniClaw desktop composition.** Rejected because it requires a separate DeepSeek credential and does not provide the search service included with the authenticated UniClaw deployment.

## Consequences

The desktop plugin list contains a separately diagnosable `web-search-uniclaw` entry, and `web_search` uses the token established by UniClaw login. Search is unavailable before login or after logout. The provider adds no fetch capability and exposes freshness as deployment configuration because the shared request type has no per-call freshness field.
