# Agent Note: Electron desktop installers

Status: implemented

English | [中文](2026-08-19-electron-desktop-installers.zh.md)

## Problem

The browser application requires users to install Node.js, install the CLI, start a Web profile, and manage its terminal process. Windows and macOS users need a desktop installation that owns those steps without creating a second application runtime.

## Decision

`apps/desktop` is the `uniclaw-dsh` Electron shell over the shipped Web profile. Its main process launches the deployed `dsh` CLI through Electron's Node mode, binds the server to `127.0.0.1` on an OS-assigned port, and waits for the existing `dsh web:` readiness line before showing a window. The child command enables Electron's internal ASAR support and loads the resolver hook before passing the CLI entry as the script. The readiness line can precede the listener accepting its first connection, so Electron retries only `ERR_CONNECTION_REFUSED` for a bounded interval before treating navigation as failed. The main module schedules this work after `app.whenReady()` resolves without awaiting readiness during module evaluation, because Electron emits readiness only after main-module evaluation completes. The renderer uses the existing HTTP, SSE, static-file, plugin, and permission paths. Electron Builder, the executable, the application user model ID, window titles, and installer artifacts use the same product name and bundled application icon.

The packaged application carries a runtime created by pnpm production deploy with injected workspace packages and a hoisted dependency tree. Every desktop distribution command builds all repository artifacts before deployment, so injected workspace packages contain their declared `lib/` entries even from a clean checkout. Preparation uses a staging directory outside the workspace, replaces links that escape the deployment with package files, and runs the required spawn-helper permission repair after lifecycle scripts were suppressed. Staging outside the workspace prevents pnpm from treating generated output as another workspace member; unlinking external symlinks before copying prevents Windows directory links from writing generated content back into source packages. Electron Builder stores the self-contained production dependency tree in `app.asar` and unpacks only native modules and executables. The desktop source does not maintain a second dependency inventory. Windows builds produce an NSIS installer. macOS builds produce DMG and ZIP artifacts, with a CI matrix building each target on its native operating system.

The desktop child loads a synchronous Node resolver hook before the CLI. Normal ESM resolution runs first, preserving profile-local dependencies; only a missing bare package specifier retries from the runtime manifest inside ASAR. The child also prepends the archived dependency directory to `NODE_PATH`: the browser roster resolves package metadata with `createRequire()` anchored at profile-local config, whose ordinary Windows directory link cannot target an ASAR virtual directory. Together these mechanisms replace that physical package-directory fallback for ESM loading and CommonJS metadata resolution.

The renderer disables Node integration, enables context isolation and Chromium sandboxing, rejects new Electron windows, and sends navigation outside the loopback application origin to the operating system browser. Application shutdown sends `SIGTERM` so the CLI can dispose the Cordis tree, then forces termination after a bounded grace period.

## Alternatives considered

Embedding only the frontend under `file://` was rejected because the current client transport uses HTTP and SSE. Replacing that transport with Electron IPC would add a second transport implementation and change browser-facing packages before packaging can deliver user value.

Shipping a system Node.js dependency was rejected because it would make installation sensitive to the user's PATH and Node version. Electron's executable already supports the Node runtime needed by the deployed CLI.

Leaving the deployed dependency tree under `resources/runtime` was rejected because Windows installation and real-time scanning must create tens of thousands of small files. NSIS compression settings cannot remove that filesystem cost.

Using one host to cross-build both platforms was rejected because macOS application packaging and signing require macOS. The workflow builds on Windows and macOS independently.

## Consequences

The desktop application reuses the assembled Web behavior and user data conventions, and installer contents follow the CLI's production dependency graph. It also runs a loopback HTTP server for the lifetime of the application. A Windows validation build contains 97 installed files instead of more than 31,000 and completes explicit current-user silent installation in 22.7 seconds on the validation host. An existing per-machine installation still requires elevation to upgrade or remove. Native code signing and Apple notarization remain release-environment responsibilities; local builds without credentials are installable development artifacts that may trigger operating-system warnings and prolonged real-time scanning.
