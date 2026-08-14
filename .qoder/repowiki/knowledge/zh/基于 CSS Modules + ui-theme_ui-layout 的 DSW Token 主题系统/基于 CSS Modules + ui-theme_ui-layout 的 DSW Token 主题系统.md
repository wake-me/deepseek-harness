---
kind: frontend_style
name: 基于 CSS Modules + ui-theme/ui-layout 的 DSW Token 主题系统
category: frontend_style
scope:
    - '**'
source_files:
    - docs/web-styling.md
    - docs/web-styling.zh.md
    - packages/client/ui-theme/src/styles/base.css
    - packages/client/ui-theme/src/styles/scrollbar.css
    - packages/client/ui-theme/src/styles/design-platform.css
    - packages/client/ui-theme/src/styles/gradient-shadow-text.css
    - packages/client/ui-theme/src/styles/shiki.css
    - packages/client/ui-layout/src/index.ts
    - packages/client/ui-layout/src/client/theme-presenter.ts
    - packages/client/ui-layout/src/client/AppFrame.tsx
    - apps/web/vite.config.ts
    - packages/client/ui-conversation/src/client/chat/ChatView.module.css
    - packages/client/ui-conversation/src/client/chat/AssistantMarkdown.module.css
---

## 1. 采用的体系

仓库采用 **CSS Modules + 自定义设计令牌（`--dsw-*`）** 的前端样式方案，明确禁止使用 Tailwind、组件库或第三方 UI 框架。样式职责在 `packages/client/ui-theme`（主题/令牌）与 `packages/client/ui-layout`（应用主题快照到文档）之间严格分离，所有功能 UI 包（如 `ui-conversation`、`ui-sidebar`、`ui-primitives` 等）仅消费语义 token，不自行定义全局主题。

构建层由 `apps/web/vite.config.ts` 驱动：Vite + `@vitejs/plugin-react` 编译 React 源码，将各 `*.module.css` 经 Vite 的 CSS 管线处理；`resolve.alias` 把 `@deepseek-ai/dsh-client-*` 指向 workspace 源码，使浏览器 bundle 直接走 CSS Modules 而非已外部化的 lib 产物。

## 2. 关键文件与包

- `docs/web-styling.md` / `docs/web-styling.zh.md`：样式所有权与组件规则的权威说明，规定“CSS Modules + clsx”“不得添加组件库或 Tailwind”“使用 `--dsw-alias-*` 语义 token”“字体大小必须与行高配对”“保留键盘焦点与 reduced-motion”等约束。
- `packages/client/ui-theme/src/styles/`：集中存放全局样式表——`base.css`（基础变量）、`design-platform.css`、`gradient-shadow-text.css`、`scrollbar.css`、`shiki.css`，维护 `--dsw-static-*`、`--dsw-alias-*`、排版、动效、渐变、阴影、滚动条及明暗偏好。
- `packages/client/ui-layout/src/`：负责将解析后的主题快照应用到 document（`theme-presenter.ts`、`AppFrame.tsx`），是主题生效的入口。
- `apps/web/vite.config.ts`：Vite 构建配置，通过 `resolve.alias` 将客户端包映射到源码以启用 CSS Modules 管线；按包名拆分 vendor chunk（katex/shiki/micromark 等重型依赖）。
- `packages/client/ui-conversation/src/client/chat/*.module.css`：典型的功能组件样式，全部通过 `var(--dsw-alias-label-primary)`、`var(--dsw-alias-button-floating-fill)` 等语义 token 引用主题。

## 3. 架构与约定

- **Token 分层**：`ui-theme` 提供静态色阶（`--dsw-static-*`）与语义别名（`--dsw-alias-*`）；功能组件只消费后者，禁止复制静态色板或直接写颜色字面量。
- **作用域隔离**：全局样式集中在 `ui-theme/src/styles/`；组件样式以 `.module.css` 放在组件同级目录，类名通过 `import css from './X.module.css'` 引入并配合 `clsx` 拼接。
- **主题切换归属**：明暗主题覆盖、`prefers-color-scheme` 等选择器属于 `ui-theme` 所有方，功能组件 CSS 中不得包含主题选择器。
- **排版契约**：字体大小必须与行高配对；已有角色匹配时使用主题排版变量；源码文本、终端输出、diff 行在需要列对齐时保持不换行。
- **滚动条统一**：共享 `scrollbar.css` 提供的滚动条样式，组件不得定义专属滚动条选择器。
- **可访问性**：新增过渡动画或悬停控件时必须保留清晰的键盘焦点可见性与 `reduced-motion` 行为。
- **呈现位置**：视觉呈现规则写在 CSS 中；React 内联样式仅用于传递组件局部自定义属性值，不得编码主题分支。

## 4. 约束与强制点

- 文档 `docs/web-styling.md` 明文规定“使用 CSS Modules 和 `clsx`；不得添加组件库或 Tailwind”，这是风格层面的硬性约束。
- 变更流程要求：修改共享 token 必须在所属 `ui-theme` 样式表中进行，再在功能包中使用其语义别名；公共样式约定变化需更新所属包的参考文档。
- 视觉行为遵循仓库测试策略（`testing.md`），并通过 Agent Note `2026-07-19-web-styling-system.md` 记录框架依据。
- Vite 构建层面，所有客户端包通过 `resolve.alias` 指向源码，确保 CSS Modules 在浏览器 bundle 中生效，而非使用预构建的外部化产物。

## 5. 总结

该仓库的 frontend_style 是一套自研的 **DSW（DeepSeek Web）Token 系统**：以 `ui-theme` 为唯一主题源，以 `ui-layout` 注入文档，以 CSS Modules + `clsx` 作为组件样式组织方式，通过 `--dsw-alias-*` 语义 token 实现跨组件一致的视觉语言，并由 `docs/web-styling.md` 与 Vite alias 构建链路共同保障约束落地。