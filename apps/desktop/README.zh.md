# DeepSeek Harness 桌面应用

[English](README.md) | 中文

桌面应用把现有 Web GUI 和 Harness 运行时打包为 Electron 应用。它会在回环地址上以操作系统分配的端口启动 `dsh --profile web`，等待启动器输出就绪信息，然后在沙箱化渲染器中打开该地址。关闭应用时，桌面主进程会先要求 Harness 进程释放插件树；超过限定宽限期后才会强制终止。

## 构建安装包

先构建仓库中的全部产物，再在目标操作系统上运行对应命令：

```sh
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run dist:win
pnpm --filter @deepseek-ai/dsh-desktop run dist:mac
```

`dist:win` 在 Windows 上生成 NSIS 安装程序；`dist:mac` 在 macOS 上生成 DMG 和 ZIP。产物写入 `apps/desktop/dist/installers/`。macOS 安装包必须在 macOS 上构建；发布环境提供签名凭据时，代码签名和公证使用 electron-builder 的标准环境变量。

打包步骤使用 pnpm 的 production deploy 模式、注入的 workspace 包和 hoisted 依赖树创建被忽略的 `runtime-build/` 目录。CLI manifest 显式闭合了组装后 profile 的插件 peer 依赖，包括构建后的 Web 前端。准备过程在 workspace 外的暂存目录中执行，把指向部署目录外的链接替换为包文件，并执行必要的 spawn-helper 权限修复。该生成目录不得提交。

Electron Builder 把运行时存入 `app.asar`，只把原生模块和可执行文件留在 `app.asar.unpacked`。子进程在 CLI 启动前安装解析钩子：先执行普通模块解析，无法解析的内置 profile 插件才回退到 ASAR 内的运行时。这样可以避免安装数万个依赖文件，同时不改变 profile 本地插件的优先级。正式发布还应进行代码签名，因为实时恶意软件扫描会明显拖慢未签名安装包的生成和安装。

Windows 辅助安装程序提供当前用户和所有用户两种模式；除非每个账户都需要该应用，否则应优先选择当前用户安装。升级或删除已有的所有用户安装需要管理员权限，未提升权限的安装程序可能因此表现为长时间停滞。自动执行当前用户安装时可传入 `/currentuser /S`。

## 安全与限制

本地 HTTP 服务器只绑定 `127.0.0.1`；Electron 页面只能在应用源内导航，外部链接交给操作系统浏览器打开。渲染器禁用 Node 集成、启用上下文隔离和 Chromium 沙箱。

构建环境未提供 Windows 或 Apple 签名凭据时，安装包不会签名。未签名安装包会触发操作系统信任警告，仅适用于开发构建。
