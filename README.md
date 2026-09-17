# AnyComment (VS Code 个人专属翻译与函数文档解析插件)

> 🚀 **极致轻量 · 多 Provider 解耦 · 双分区硬盘持久化 · 预置标准库文档 · 沉浸式行内阅读**

AnyComment 是一款为你量身打造的 VS Code 源码注释与函数文档翻译解析扩展。支持主流 AI 接口（DeepSeek / Ollama / Copilot / Google）无缝切换，并配备双分区物理隔离的全局持久化存储。

---

## 🌟 核心特性

1. **PI-Agent 风格多模型解耦与自由切换**：
   * **OpenAI Compatible**：支持 DeepSeek、通义千问、Kimi、Ollama 本地模型，API Key 加密存放在 VS Code 原生 `context.secrets`。
   * **VS Code LM (Copilot)**：直接调用 VS Code 官方 `vscode.lm` 原生模型通道，**免 API Key、免额外扣费**。
   * **Google Translate**：支持免费公用通道作为客观基准机翻与兜底通道。
2. **双分区物理隔离全局持久化存储**：
   * **分区 1 (标准库与基线 `standard_store`)**：随插件分发高频 Go/TS/Python 标准库中文文档种子包，首次悬停**零冷启动、零 Token 消耗、毫秒级秒读**。
   * **分区 2 (自定义 AI 风格 `custom_style_store`)**：按提示词风格独立子目录隔离。无论如何调试或清空提示词，绝不污染官方标准库。
3. **多模态交互体验**：
   * **LSP Hover 追加**：悬停时命中缓存直接在底部显示中文释义；未命中时显示可点击的 `[🌐 翻译]` 链接，按需触发。
   * **沉浸式行内阅读 (Ghost Text)**：快捷键 `Cmd+Shift+B`（Windows: `Ctrl+Shift+B`）一键开启/关闭源码行末虚灰色中文注释。
   * **状态栏快捷切换**：右下角一键呼出菜单切换 Provider、切换 Prompt 风格、或切换沉浸模式。
   * **侧边栏控制中心 (Webview)**：可视化调整模型参数、编写自定义提示词、一键测试连接并治理磁盘缓存。

---

## 🛠️ 技术栈与工程规范

* **包管理器**：`pnpm v11.5.1`
* **运行环境**：Node.js 20+ / VS Code API `^1.90.0`
* **语言标准**：TypeScript 5.4+（遵循 Modern Coding Spec，开启 `strict: true` 与 `noUncheckedIndexedAccess: true`，杜绝 raw `any`）
* **打包工具**：esbuild 单文件打包（编译产物仅 **~37KB**，编译耗时 **~14ms**）
* **测试框架**：Vitest 1.6+ 单元测试（10/10 测试全部通过）

---

## 🚀 快速上手与调试

### 1. 安装依赖与构建
```bash
pnpm install
pnpm build
```

### 2. 本地调试运行
在 VS Code 中打开本项目，直接按下 **`F5`** 键，系统将启动一个全新的「扩展开发宿主 (Extension Development Host)」窗口，插件即刻生效。

### 3. 运行测试与类型检查
```bash
pnpm test   # 运行 Vitest 单元测试
pnpm lint   # 运行 TypeScript 类型检查
```

---

## 📁 项目目录结构

```
AnyComment/
├── .vscode/
│   ├── launch.json              # F5 调试启动配置
│   └── tasks.json               # 预构建任务
├── assets/
│   └── seeds/
│       └── standard_seeds.json  # 预置高频标准库中文翻译种子包
├── docs/
│   ├── adr/                     # 架构决策记录 (ADR 0001)
│   └── agents/                  # 代理与领域约定
├── src/
│   ├── extension.ts             # 插件激活入口
│   ├── config/                  # 配置管理 (Provider, Style, Secrets)
│   ├── providers/               # PI-Agent 风格多 Provider 解耦实现
│   ├── storage/                 # 双分区物理隔离全局存储引擎
│   ├── parser/                  # 跨语言代码注释提取与清理
│   ├── features/                # Hover 拦截、沉浸式 Ghost Text、状态栏
│   └── webview/                 # 侧边栏控制中心 Webview
├── tests/                       # Vitest 单元测试
├── package.json                 # 插件清单与命令绑定
├── pnpm-lock.yaml               # 锁版本清单
├── tsconfig.json                # TS 现代规范配置
└── esbuild.config.js            # 极速打包配置
```
