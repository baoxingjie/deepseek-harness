# DeepSeek Harness Desktop

English | [中文](README.zh.md)

The desktop app packages the existing Web GUI and Harness runtime as an Electron application. It starts `dsh --profile web` on loopback with an OS-assigned port, waits for the launcher's readiness line, and opens that URL in a sandboxed renderer. Closing the application asks the Harness process to dispose its plugin tree before forcing termination after a bounded grace period.

The window opens on a local loading page immediately and swaps to the served address once the runtime answers, so a slow start never looks like a failed launch. A single instance lock keeps one runtime per user: a second launch, or activating the app from the dock, raises the existing window instead of binding another port.

## Bundled UniClaw plugins

The runtime deploys this package's production closure rather than the CLI's, which is how the UniClaw host and browser halves reach an installed machine: they are ordinary dependencies here, so the bundled skills and the browser plugin bundle ship inside the archive. `config/uniclaw.cordis.yml` travels with the app and is passed as `--patch`, mounting both entries by bare name. A packaged profile directory holds no `node_modules`, so ESM resolution falls back through the resolver hook and CommonJS metadata lookups fall back through `NODE_PATH`, both landing in the archived runtime.

## Harness data directory

The app uses the same `DSH_HOME` as the `dsh` CLI (`~/.dsh` unless the environment overrides it), so one login, skill set, MCP roster, and session history serve both. Running the CLI's own `dsh web` at the same time as the desktop app points two servers at that one directory; the single instance lock covers only a second desktop launch, so prefer one at a time.

## Build installers

Build all repository artifacts first, then run the installer command on the target operating system:

```sh
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run dist:win
pnpm --filter @deepseek-ai/dsh-desktop run dist:mac
```

For an unsigned macOS DMG — local distribution and testing, no credentials needed — run the script instead. It owns the whole chain, refuses to start when the Electron binary never downloaded, and fails loudly when the deployed runtime carries no UniClaw plugins:

```sh
apps/desktop/scripts/build-mac.sh
apps/desktop/scripts/build-mac.sh --skip-build
apps/desktop/scripts/build-mac.sh --skip-runtime
```

The first form runs the whole chain. `--skip-build` reuses the current repository artifacts and `--skip-runtime` reuses the current `runtime-build/` deployment, for iterating on the packaging step alone.

`dist:dir` builds an unpacked application directory for local inspection and skips macOS signing, which otherwise adds minutes to every run over a runtime of this size. `dist:win` produces an NSIS installer on Windows. `dist:mac` produces DMG and ZIP artifacts on macOS. Outputs are written to `apps/desktop/dist/installers/`. macOS packages must be built on macOS; code signing and notarization use electron-builder's standard environment variables when release credentials are present.

The packaging step creates the ignored `runtime-build/` directory with pnpm's production deploy mode, injected workspace packages, and a hoisted dependency tree. The CLI manifest explicitly closes the assembled profile's plugin peer dependencies, including the built Web frontend. Preparation happens in a staging directory outside the workspace, replaces links that escape the deployment with package files, and runs the required spawn-helper permission repair. The generated directory must not be committed.

Electron Builder stores the runtime in `app.asar` and leaves only native modules and executables in `app.asar.unpacked`. The child process installs an ESM resolver hook before the CLI starts and adds the archived dependency directory to `NODE_PATH` for CommonJS package metadata lookups from profile-local config anchors. Ordinary local resolution remains first; unresolved in-box packages fall back to the runtime inside ASAR. This publishes the complete browser plugin roster without installing tens of thousands of dependency files or changing profile-local plugin precedence. Production releases should also be code-signed because real-time malware scanners can significantly delay unsigned installer creation and installation.

The assisted Windows installer offers per-user and per-machine modes; prefer per-user installation unless every account needs the app. An existing per-machine installation requires administrator permission to upgrade or remove and can make a non-elevated launch appear stalled. Automated per-user installation may pass `/currentuser /S`.

## Security and limitations

The local HTTP server binds only to `127.0.0.1`; Electron navigation is limited to its origin, and external links open in the operating system browser. The renderer has Node integration disabled, context isolation enabled, and Chromium sandboxing enabled.

Installers are unsigned unless the build environment provides Windows or Apple signing credentials. Unsigned installers trigger operating-system trust warnings and are intended only for development builds.
