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

The packaging step creates the ignored `runtime-build/` directory with pnpm's production deploy mode, injected workspace packages, and a hoisted dependency tree. The CLI manifest explicitly closes the assembled profile's plugin peer dependencies, including the built Web frontend. Preparation happens in a staging directory outside the workspace, replaces links that escape the deployment with package files, and runs the required spawn-helper permission repair. Electron Builder copies the result to `resources/runtime`; the generated directory must not be committed.

Windows installers use NSIS store compression. This increases the installer download size but avoids spending installation time decompressing the large runtime dependency tree. Production releases should also be code-signed because real-time malware scanners can significantly delay unsigned installer creation and installation.

## Security and limitations

The local HTTP server binds only to `127.0.0.1`; Electron navigation is limited to its origin, and external links open in the operating system browser. The renderer has Node integration disabled, context isolation enabled, and Chromium sandboxing enabled.

Installers are unsigned unless the build environment provides Windows or Apple signing credentials. Unsigned installers trigger operating-system trust warnings and are intended only for development builds.
