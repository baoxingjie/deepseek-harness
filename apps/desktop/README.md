# DeepSeek Harness Desktop

English | [中文](README.zh.md)

The desktop app packages the existing Web GUI and Harness runtime as an Electron application. It starts `dsh --profile web` on loopback with an OS-assigned port, waits for the launcher's readiness line, and opens that URL in a sandboxed renderer. Closing the application asks the Harness process to dispose its plugin tree before forcing termination after a bounded grace period.

## Build installers

Build all repository artifacts first, then run the installer command on the target operating system:

```sh
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run dist:win
pnpm --filter @deepseek-ai/dsh-desktop run dist:mac
```

`dist:win` produces an NSIS installer on Windows. `dist:mac` produces DMG and ZIP artifacts on macOS. Outputs are written to `apps/desktop/dist/installers/`. macOS packages must be built on macOS; code signing and notarization use electron-builder's standard environment variables when release credentials are present.

The packaging step creates `dist/runtime/` with pnpm's production legacy deploy mode because this workspace does not inject workspace packages. The CLI manifest explicitly closes the assembled profile's plugin peer dependencies, including the built Web frontend. The preparation script replaces workspace-relative dependency links with package files so the result does not refer to the checkout. This directory is generated and must not be committed.

## Security and limitations

The local HTTP server binds only to `127.0.0.1`; Electron navigation is limited to its origin, and external links open in the operating system browser. The renderer has Node integration disabled, context isolation enabled, and Chromium sandboxing enabled.

Installers are unsigned unless the build environment provides Windows or Apple signing credentials. Unsigned installers trigger operating-system trust warnings and are intended only for development builds.
