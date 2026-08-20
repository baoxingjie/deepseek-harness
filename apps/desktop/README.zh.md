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

打包步骤使用 pnpm 的 production deploy 模式、注入的 workspace 包和 hoisted 依赖树创建被忽略的 `runtime-build/` 目录。CLI manifest 显式闭合了组装后 profile 的插件 peer 依赖，包括构建后的 Web 前端。准备过程在 workspace 外的暂存目录中执行，把指向部署目录外的链接替换为包文件，并执行必要的 spawn-helper 权限修复。Electron Builder 将结果复制到 `resources/runtime`；该生成目录不得提交。

Windows 安装包使用 NSIS store 压缩。这会增大安装包下载体积，但可以避免在安装大型运行时依赖树时消耗时间解压。正式发布还应进行代码签名，因为实时恶意软件扫描会明显拖慢未签名安装包的生成和安装。

## 安全与限制

本地 HTTP 服务器只绑定 `127.0.0.1`；Electron 页面只能在应用源内导航，外部链接交给操作系统浏览器打开。渲染器禁用 Node 集成、启用上下文隔离和 Chromium 沙箱。

构建环境未提供 Windows 或 Apple 签名凭据时，安装包不会签名。未签名安装包会触发操作系统信任警告，仅适用于开发构建。
