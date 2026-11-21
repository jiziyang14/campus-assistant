# 校园助手

面向课堂与校园场景的 DeepSeek 桌面客户端。前端使用 React 18 + TypeScript + rspack，生产环境由本地 Node 服务代理 DeepSeek API；Windows 版打包为单文件 exe，通过 Edge 应用窗口运行。

> 本项目基于 [deepseek-ai/chat-demo](https://github.com/deepseek-ai/chat-demo) 的 MIT 代码二次开发。

## 功能

- 流式对话、深度思考、联网搜索
- 图片上传与自动 OCR 双通道，相机拍照讲题
- 快捷卡片，支持自定义提示词
- 文档分屏放映，原文排版，不做改写
- 表格标记提取，生成名单、明细与统计放映稿
- 语音输入与朗读、会话历史导入导出
- 本地服务健康检查、诊断面板与错误兜底

## 目录

```text
campus-src/      React 前端源码、构建配置、自动化测试
campus-edition/  网页版本地服务（serve.mjs）、启动脚本、配置示例
campus-exe/      Windows 单文件 exe 打包脚本与服务模板
docs/            部署、运维与开发说明
scripts/         一键发布脚本
.github/         CI 与手动打包工作流
```

`campus-src/dist`、`campus-exe/out`、`campus-exe/release`、`campus-edition/static` 为生成物，不入库。

## 快速开始

要求 Node.js 22+、pnpm 10+。

```sh
cd campus-src
pnpm install
pnpm dev          # http://localhost:8090
```

生产构建：

```sh
cd campus-src
pnpm build        # 输出 campus-src/dist
```

检查：

```sh
cd campus-src
pnpm type
pnpm lint
pnpm test
```

## API 配置

网页版读取 `campus-edition/config.json`；exe 读取同目录的 `config.json`。格式见 `campus-edition/config.example.json`：

```json
{
  "apiBase": "https://api.deepseek.com",
  "apiKey": ""
}
```

说明：

- `config.json` 已被 `.gitignore` 排除，不要提交真实密钥
- exe 默认不嵌入 API Key；只有显式设置 `CAMPUS_EMBED_KEY=1` 构建时才会嵌入
- 多机部署建议使用校内网关或一机一 Key，避免共用同一把密钥

## 网页版

```sh
node scripts/release.mjs          # 构建前端并同步到 campus-edition
cd campus-edition
node serve.mjs                    # http://127.0.0.1:8130
```

Windows 也可以双击 `campus-edition/start.cmd`。

服务提供：

- `GET /health`：版本、端口、配置状态、日志目录；不返回 Key
- `GET /static/*`：长期缓存；`index.html` 不缓存
- 安全响应头：`nosniff`、`Referrer-Policy`、`X-Frame-Options`、CSP
- 只接受 `127.0.0.1` / `localhost` 的 Host 与同源 Origin

## Windows exe

先构建前端，再打包：

```sh
cd campus-src
pnpm build
cd ../campus-exe
npm ci
node build.mjs
```

输出 `campus-exe/out/校园助手.exe`。首次运行前，把 `campus-edition/config.example.json` 复制为 exe 同目录的 `config.json` 并填写 `apiKey`。

exe 启动时：

- 日志写入 `%LOCALAPPDATA%\CampusAssistant\logs\server.log`（2 MB 滚动）
- 8130 被同应用旧实例占用时打开已有实例；被其他程序占用时自动尝试 8131–8139
- `/health` 可确认当前版本、端口和配置来源

## 一键发布

```sh
node scripts/release.mjs --exe --usb <U盘目录>
```

步骤：构建前端 → 同步网页版与 `version.json` → 打包 exe → 同步到 U 盘 → 生成 SHA256 清单 `campus-exe/release/manifest.json`。

只构建网页版：

```sh
node scripts/release.mjs
```

## 诊断

应用内「设置 → 诊断」可以查看：

- 应用版本与构建时间
- 本地服务状态、端口、配置来源
- IndexedDB 存储占用
- 最近 40 条前端错误
- 导出 JSON 诊断包（不含 API Key、对话内容、附件）

渲染异常时，ErrorBoundary 会显示重新加载与导出诊断入口。

## CI

- `.github/workflows/ci.yml`：push / PR 时执行 type、lint、test、build
- `.github/workflows/build-exe.yml`：手动触发，在 Windows runner 上构建不含 Key 的 exe 并上传 artifact

## 素材说明

仓库不包含品牌图标素材（`campus-src/src/assets` 下的 logo、favicon、apple-touch-icon 与 `docs` 截图）。克隆后构建前，请自行准备这些文件并放回对应位置；也可以将 `AppLogo.tsx` 的引用替换为通用占位图。

## 许可

代码沿用上游 MIT 许可，见 `LICENSE`。第三方依赖（React、KaTeX、Mermaid、Prism 等）的许可证需在对外分发前汇总。
