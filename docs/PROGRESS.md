# Atoms Demo · 项目进度

> 范围档 **B**：一阶段 MVP + 简化二阶段。详见 [DELIVERY-SPEC.md](./DELIVERY-SPEC.md)。

**图例**：☐ 待做 · ◐ 进行中 · ☑ 完成 · ✗ 不做

---

## 总览

| 阶段 | 估时 | 完成 | 状态 |
|---|---|---|---|
| Phase 0 · 项目骨架 + lib | 1h | 1h | ☑ |
| Phase 1 · Agent 能力底盘 | 9.5h | 0h | ☐ |
| Phase 2 · 前端 + 交互 | 5.5h | 0.5h | ◐ |
| 部署 + 验收 | 1h | 0h | ☐ |
| **合计** | **~15h** | **1.5h** | |

---

## Phase 0 · 项目骨架 + lib（☑ 已完成）

- ☑ Next.js 16 + React 19 + Tailwind v4 + pnpm 初始化
- ☑ 依赖：`@libsql/client` `nanoid` `zod` `lucide-react` `clsx` `tailwind-merge`
- ☑ `src/lib/utils.ts` — cn() / formatRelative()
- ☑ `src/lib/db.ts` — libsql 单例 + `ensureSchema()`（4 张旧表）
- ☑ `src/lib/llm/doubao.ts` — chat / chatStream + 3 模型常量
- ☑ `src/lib/agents/roles.ts` — 5 个角色卡
- ☑ `src/lib/agents/prompts.ts` — 5 套 system prompt
- ☑ `src/lib/agents/orchestrate.ts` — mikeIntro/emmaPlanStream/bobNotes/alexBuildStream + extractJSON/extractHTML
- ☑ `src/app/globals.css` — 深色 + radial 渐变
- ☑ `src/app/layout.tsx` — metadata
- ☑ 文档：ARCHITECTURE.md / MODULES.md / DELIVERY-SPEC.md v2

---

## Phase 1 · Agent 能力底盘（MVP）

### 1.1 多 agent 分发（0.5h）

- ☑ 5 角色定义
- ☑ 硬编码 Mike→Emma→Bob→Alex 流水线
- ☐ textarea `@Agent` 解析（前端正则 + 后端 dispatch）
- ☐ Engineer/Team Mode toggle wire-up（PromptBox 已搭，需接 API）
- ☐ 新 API：`POST /api/projects/:id/mention` — 单 agent 直调

### 1.2 多 agent 上下文交互（1h）

- ☑ 三层共享模型设计（DELIVERY-SPEC §4）
- ☑ Plan 文件接力（Emma JSON PRD → Bob/Alex 喂 user_msg）
- ☐ Stop/Resume 时 partial 注入新 user_msg
- ☐ 不传 chat 历史的实现验证

### 1.3 短期记忆（prompt 注入版，1h）

- ☐ `memories(id, project_id, key, value, source_agent, created_at)` 表
- ☐ Emma PRD schema 加 `preferences: {key, value}[]` 字段
- ☐ Emma 输出后写入 memories 表
- ☐ Bob/Alex system_prompt 顶部注入 `## Active memories:` 段
- ☐ Resolve 流程也注入 memories（防 LLM 忘了用户的 preference）

### 1.4 工具执行（OpenAI function calling，**3.5h** — 从 2.5h 上调，加 4 个展示 tool）

**协议层**
- ☐ 豆包客户端加 `tools` 参数 + 流式 tool_calls 累积解析
- ☐ `lib/agents/executor.ts` — `runAgentWithTools` 循环 + 安全上限 8 轮
- ☐ `executeTool(projectId, name, args)` dispatcher
- ☐ SSE 新事件：`tool-call-start / tool-call-args-chunk / tool-call-end / tool-result / ui-focus`
- ☐ 改 `execute/route.ts` 用 tool loop 替代裸 `alexBuildStream`

**副作用 tool（2 个）**
- ☐ `write_file(path, content)` schema + handler（写 vfiles）
- ☐ `exec_sql(sql)` schema + handler（写 sandbox_tables/rows）

**展示 tool（4 个，**用户新加**）**
- ☐ `focus_file(path, line?)` schema + handler（emit `ui-focus` SSE）
- ☐ `show_table(table)` schema + handler
- ☐ `show_preview()` schema + handler
- ☐ `show_console()` schema + handler
- ☐ Alex/Bob system_prompt 追加"be a director — call show_* tools to guide user's eyes"

**前端**
- ☐ tool-call 卡片 UI（kind: `tool-call` / `tool-result`）
- ☐ `ProjectClient` 接收 `ui-focus` 事件 reducer：切 tab + 高亮文件/table/line

### 1.5 文件沙箱（1.5h）

- ☐ `vfiles(id, project_id, path, content, version, created_at)` 表 + 索引
- ☐ `write_file(path, content)` tool 实现
- ☐ path 校验防越界
- ☐ 同 path 多版本 append-only，最新版本查询
- ☐ Alex system prompt 改为"调 write_file 而不是裸输出 HTML"
- ☐ MVP-A：Alex 默认把 CSS/JS inline 到 index.html
- ☐ （可选）`GET /api/projects/:id/file?path=` 同源服务多文件资源

### 1.6 数据库沙箱（2h）

- ☐ `sandbox_tables(id, project_id, name, schema_json, created_at)` 表
- ☐ `sandbox_rows(id, project_id, table_name, row_json, created_at)` 表
- ☐ `lib/sqlmini.ts` — 100 行 SQL 子集 parser：CREATE TABLE / INSERT / SELECT
- ☐ `exec_sql(sql)` tool 实现
- ☐ Bob system prompt 改为"先调 exec_sql 创建 schema + seed 数据"
- ☐ 解析失败 friendly error 让 LLM 重试
- ☐ `GET /api/projects/:id/db` 拉 schema + rows 给 DataGrid

---

## Phase 2 · 前端 + 用户交互（简化）

### 2.1 基础会话界面（1.5h）

- ☑ `Header.tsx`
- ☑ `AgentAvatar.tsx`
- ☑ `AgentMessage.tsx`（5 种 kind）
- ☑ `AppViewer.tsx`（基础版，要扩 4 tab）
- ☑ `PromptBox.tsx`（Mode toggle 已搭）
- ☑ `RaceArena.tsx`
- ☐ `src/app/page.tsx` — 首页：Hero + 4-tab 模板画廊 + 底部 roster
- ☐ `src/app/dashboard/page.tsx` — Dashboard：PromptBox 居中 + 最近项目网格
- ☐ `src/app/project/[id]/page.tsx` — server shell
- ☐ `src/components/ProjectClient.tsx` — SSE 订阅 + 消息状态机 + AppViewer 集成

### 2.2 会话 ↔ 预览联动（1h）

- ☐ AppViewer 顶部 4 tab：Preview / Code / Database / Console
- ☐ file 卡片点击 → 切 Code tab + 高亮文件
- ☐ DB 操作卡片点击 → 切 Database tab + 高亮 table
- ☐ Console error 出现 → 顶部小红点提示

### 2.3 编辑器（0.5h）

- ☐ `@monaco-editor/react` lazy-load
- ☐ 只读模式 + 语法高亮 + 行号
- ☐ Code tab 集成

### 2.4 文件（1h）

- ☐ 左侧迷你文件树 from vfiles
- ☐ 文件类型路由：html/js/css → Monaco；md → react-markdown；img → `<img>`
- ☐ 文件大小/版本/写入时间 metadata
- ☐ 简单 breadcrumb

### 2.5 agent 计费（1.5h）

- ☐ `agent_billing(id, project_id, agent, model, input_tokens, output_tokens, cost_cents, kind, created_at)` 表
- ☐ 单价表常量（pro/std/lite 三档，按豆包公开价）
- ☐ 每次 LLM 调用记账（`x-ratelimit-*` headers / 响应 usage 字段）
- ☐ sidebar widget：累计 token + 累计 cost + 折线图（可选）
- ☐ 如果时间紧：只 backend 记账，UI 砍掉，只显示一行 `Used $0.043 · 12,300 tokens`

---

## Phase 3 · 不做（明确）

- ✗ 对话版本（branch/fork/diff/rollback）
- ✗ SSH/真终端（xterm.js + 真 pty）
- ✗ 短期记忆 tool 化版本（`save_memory` tool）
- ✗ 真部署到生产域名（用 Vercel `*.vercel.app` 兜底）
- ✗ 真 Supabase / GitHub OAuth
- ✗ Visual Editor 跨 iframe 改 DOM
- ✗ Supervisor LLM 动态路由
- ✗ Agent group chat / 互相 @
- ✗ Vector / long-term memory / 跨项目记忆
- ✗ WebContainer / 真跑 Node
- ✗ Iris Deep Research / Sarah SEO / Adrian Ads

---

## Stop + Race 跨阶段任务（分散在 1.4 + 2.x）

- ☐ Stop 按钮：每个 agent message 卡片左下角 stop icon
- ☐ Race Mode 顶部独立 Stop（断 3 个 AbortController）
- ☐ AbortController 端到端 wire-up
- ☐ `messages.meta.partial` 保留半成品
- ☐ Resume 时 partial + 用户修正打包发新 user_msg

---

## 部署 + 验收（1h）

- ☐ Turso prod 库创建
- ☐ env vars：`DOUBAO_API_KEY` / `TURSO_URL` / `TURSO_TOKEN` / `DOUBAO_MODEL_PRO/STD/LITE`
- ☐ `ensureSchema()` 在 prod 跑一次（含 9 张表）
- ☐ Vercel 项目导入 + 配 env
- ☐ E2E 跑一遍：首页 → Dashboard → 项目页 → Team Mode → Approve → Tool calls → 4 tab 切换 → Race Mode → Stop
- ☐ 写 README.md：在线链接 + 本地跑指令 + 演示脚本
- ☐ GitHub repo public

---

## 里程碑

- **M1** · Tool use loop 跑通（1.4 + 1.5 + 1.6 + ProjectClient SSE）— 当 Alex 能调 write_file 把代码写进 vfiles + iframe 真渲染时
- **M2** · 4 tab 联动完整（2.2 + 2.3 + 2.4）— 切 tab 都有真内容
- **M3** · 计费 + Stop + Race 全跑通
- **M4** · 部署上线 + E2E 演示

---

## 估时调整记录

| 日期 | 调整 | 原因 |
|---|---|---|
| 初始 | Phase 1 + 2 = 14h | 详细任务铺开后估时 |
| | 砍 #9 计费 widget UI 一半（→ 1h） | 时间紧时优先保 backend 记账 |
| | 砍 #5 SQL parser 子集（→ 1h） | 时间紧时只支持 CREATE TABLE 不支持 INSERT/SELECT |
| | 砍下限 ~12h | 在 13/15 行可调 |
