# Agent Note: Electron desktop installers

English | [中文](2026-08-19-electron-desktop-installers.zh.md)

Status: implemented

## Problem

The browser application requires users to install Node.js, install the CLI, start a Web profile, and manage its terminal process. Windows and macOS users need a desktop installation that owns those steps without creating a second application runtime.

## Decision

`apps/desktop` is an Electron shell over the shipped Web profile. Its main process launches the deployed `dsh` CLI through Electron's Node mode, binds the server to `127.0.0.1` on an OS-assigned port, and waits for the existing `dsh web:` readiness line before showing a window. The renderer uses the existing HTTP, SSE, static-file, plugin, and permission paths.

The packaged application carries a runtime created by pnpm production deploy with injected workspace packages and a hoisted dependency tree. Preparation uses a staging directory outside the workspace, replaces links that escape the deployment with package files, and runs the required spawn-helper permission repair after lifecycle scripts were suppressed. Staging outside the workspace prevents pnpm from treating generated output as another workspace member; unlinking external symlinks before copying prevents Windows directory links from writing generated content back into source packages. Electron Builder places that self-contained production dependency tree under `resources/runtime`; the desktop source does not maintain a second dependency inventory. Windows builds produce an NSIS installer with store compression to favor installation time over download size. macOS builds produce DMG and ZIP artifacts, with a CI matrix building each target on its native operating system.

The renderer disables Node integration, enables context isolation and Chromium sandboxing, rejects new Electron windows, and sends navigation outside the loopback application origin to the operating system browser. Application shutdown sends `SIGTERM` so the CLI can dispose the Cordis tree, then forces termination after a bounded grace period.

## Alternatives considered

Embedding only the frontend under `file://` was rejected because the current client transport uses HTTP and SSE. Replacing that transport with Electron IPC would add a second transport implementation and change browser-facing packages before packaging can deliver user value.

Shipping a system Node.js dependency was rejected because it would make installation sensitive to the user's PATH and Node version. Electron's executable already supports the Node runtime needed by the deployed CLI.

Packing the runtime into Electron's ASAR archive was rejected because profile module fallbacks are Windows junctions to physical package directories. A junction cannot target a virtual directory inside `app.asar`, so packaged plugins would fail module resolution. NSIS store compression retains the physical directory layout while removing decompression work from installation.

Using one host to cross-build both platforms was rejected because macOS application packaging and signing require macOS. The workflow builds on Windows and macOS independently.

## Consequences

The desktop application reuses the assembled Web behavior and user data conventions, and installer contents follow the CLI's production dependency graph. It also runs a loopback HTTP server for the lifetime of the application. Windows installation performs less CPU work but distributes a larger executable. Native code signing and Apple notarization remain release-environment responsibilities; local builds without credentials are installable development artifacts that may trigger operating-system warnings and prolonged real-time scanning.
