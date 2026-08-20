# Agent Note：Electron 桌面安装包

[English](2026-08-19-electron-desktop-installers.md) | 中文

Status: implemented

## Problem

浏览器应用要求用户安装 Node.js、安装 CLI、启动 Web profile，并管理对应的终端进程。Windows 和 macOS 用户需要一个负责这些步骤、且不引入第二套应用运行时的桌面安装方式。

## Decision

`apps/desktop` 是已发布 Web profile 的 Electron 外壳。主进程通过 Electron 的 Node 模式启动部署后的 `dsh` CLI，让服务器在 `127.0.0.1` 上使用操作系统分配的端口监听，并等待现有 `dsh web:` 就绪信息后再显示窗口。渲染器沿用现有 HTTP、SSE、静态文件、插件和权限路径。

打包后的应用携带由 `pnpm --filter @deepseek-ai/dsh deploy --prod --legacy` 创建的运行时；由于 workspace 不注入 workspace 包，这里需要 legacy deploy。CLI manifest 显式提供组装后 profile 的插件 peer 依赖，准备过程再把指向部署目录以外的链接替换为包文件。Electron Builder 将这个自包含生产依赖树放在 `resources/runtime` 下；桌面应用源码不维护第二份依赖清单。Windows 构建生成 NSIS 安装程序，macOS 构建生成 DMG 和 ZIP，CI 矩阵在各自原生操作系统上构建目标产物。

渲染器禁用 Node 集成、启用上下文隔离和 Chromium 沙箱、拒绝创建新的 Electron 窗口，并把回环应用源以外的导航交给操作系统浏览器。应用关闭时会发送 `SIGTERM`，让 CLI 释放 Cordis 树；超过限定宽限期后才强制终止。

## Alternatives considered

没有采用只通过 `file://` 嵌入前端的方案，因为当前客户端传输使用 HTTP 和 SSE。改用 Electron IPC 会增加第二套传输实现，并在打包交付用户价值之前改变浏览器侧包。

没有依赖系统 Node.js，因为这会让安装结果取决于用户的 PATH 和 Node 版本。Electron 可执行文件已经支持部署后 CLI 所需的 Node 运行时。

没有在一台主机上交叉构建两个平台，因为 macOS 应用打包和签名需要 macOS。工作流分别在 Windows 和 macOS 上构建。

## Consequences

桌面应用复用组装后的 Web 行为和用户数据约定，安装包内容跟随 CLI 的生产依赖图。应用生命周期内也会运行一个回环 HTTP 服务器。原生代码签名和 Apple 公证仍由发布环境负责；缺少凭据的本地构建是可安装的开发产物，可能触发操作系统警告。
