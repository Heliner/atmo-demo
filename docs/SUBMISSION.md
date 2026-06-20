# Atoms Demo · 提交说明

## 一、实现思路与关键取舍

**定位**：复刻 atoms.dev 的多 Agent 协作 vibe-coding — 一句话描述想法，5 个 AI 员工协同把可运行 App 端到端造出来：Mike 队长 / Emma PM / Bob 架构师 / Alex 工程师 / Iris 调研。

**关键取舍**：

1. **Sandpack + sql.js + Doubao 三件套** — 浏览器内沙箱，免远程容器；wasm SQLite 跑真持久化而非 mock；Doubao OpenAI-Compatible 直连 Vercel AI SDK 的 `streamText` + 工具循环。代价：只跑无构建步骤的单页 HTML/CSS/JS（恰是 Atoms 当前形态）。
2. **跨 iframe DB 桥**：自研 `window.atomsDb` SDK（隐藏 `/atoms-sdk.js`）→ postMessage → 父页面 → `/api/projects/:id/db/run`。生成的 App 真连沙箱 SQLite，不是 localStorage 玩具。
3. **不写 fallback** — Alex 提示词明令禁止 `try/catch+localStorage`；atomsDb 出错直接红条抛给用户。早期更脆，但 bug 不被掩盖。
4. **SSE 自定义协议（13+ 事件类型）** — `agent-message-*` / `tool-call-*` / `ui-focus` / `files-snapshot` / `race-chunk` 驱动 4-tab 联动焦点（Alex 写文件自动切 Code、Bob 建表切 Database）。
5. **MetaGPT 风格 SOP** — Mike→Emma→Bob→Alex 顺序 + 工具循环（`stopWhen: stepCountIs(N)`），强制执行路径（survey→write→verify→focus→show），让用户看到"真有人在工作"。
6. **多轮 + 短期记忆** — Emma 把 `theme_color` 等 preferences 写进 PRD，下游 Agent 通过 `memorySection()` 注入；followup 携带完整历史。
7. **@ 提及 L2 真路由** — `@Iris 调研` 不只是 UI hint，是真在服务端把这一条直接路由给 Iris Agent。
8. **Daytona 真 Linux 容器（无 mock 无 fallback）** — `run_command` / `run_python` 直连 Daytona 云端真 sandbox（每 project 一个 ephemeral Linux VM），Bob 的 Python 真跑 IPython kernel 生种子数据、Alex 的 shell 真 `pwd` / `ls -la` 看真文件。vfiles 按 path+version 增量 `uploadFile` 到 `~/project`。`autoStopInterval=10min` / `autoDeleteInterval=60min` 让 Daytona 自管生命周期，无自建 reaper。没 `DAYTONA_API_KEY` 直接抛错。

**Stack**：Next.js 16 App Router + React 19 + Tailwind v4 + libsql/Turso 持久化 + Vercel AI SDK + Sandpack + sql.js + Doubao（pro/std/lite 三档 endpoint）+ `@daytona/sdk`。部署 Vercel。

## 二、当前完成程度

**已完成（P0 + P1 大半）**

- ✅ 主对话界面（删 Templates，进站即对话）
- ✅ Mike/Emma/Bob/Alex/Iris 5 角色全可用，@ 提及 L2 路由
- ✅ 4-tab AppViewer：Preview / Code / Database / Shell，按工具调用自动联动焦点
- ✅ Sandpack 静态预览全屏自适应（含文件树/CodeMirror 撑满修复）
- ✅ 沙箱 SQLite per project，atomsDb 跨 iframe 桥端到端跑通
- ✅ Database tab 3s 轮询 + 手动 Refresh，iframe 内 `atomsDb.exec` 建的表实时可见
- ✅ 多轮 followup + 短期记忆（Emma preferences 注入下游)
- ✅ Race Mode：多模型并行同题
- ✅ Billing：按 agent 累计 token（去掉占位单价列）
- ✅ 深色主题统一（生成 App 也默认深色，按 theme_color 调色）
- ✅ E2E 4 用例 Grade A：bookshelf / 单位换算器 / @Iris 调研 / followup 改需求
- ✅ Turso libsql 持久化，刷新不丢历史 / vfiles / shell record
- ✅ **Daytona 真容器** — `run_command` 真跑 Linux shell（`uname -a` 见真 Ubuntu kernel），`run_python` 真跑 Python 3.14 IPython kernel（`import random` 真生种子），vfiles 增量同步。E2E 实测：Bob `run_python` 冷启 ~8s + Alex `run_command(pwd)` → `/home/daytona/project` 暖路径 ~2s

**未做 / 主动砍**

- ❌ Templates 市场（用户明确删除）
- ❌ 多人协作 / 项目分享 / 真用户体系
- ❌ React/Vue 等带构建步骤的栈
- ❌ 一键 Publish 到独立子域名
- ❌ Iris 接真 web 搜索（仍走 LLM 内部知识）

## 三、继续投入的方向（按优先级）

**P0（再投 ≤ 1 天能交付）**

1. **多模板生成** — 加 React + Vite 模板（Sandpack 原生支持），"做个 dashboard" 能让 Alex 选栈。
2. **一键 Publish** — vfiles + sql.js BLOB 推到独立子域名（Vercel deploy hook 或自托管静态），生成的 App 能分享 URL。

**P1（一周）**

3. **协作流可视化** — 当前 Mike→Emma→Bob→Alex 是顺序 SSE 文本流，做成 swim-lane 时间线，强化"团队感"。
4. **Iris 接真 web 搜索** — Brave/Tavily 替代纯 LLM 知识，给真链接而非 "plausible source types"。
5. **Daytona sandbox 跨 lambda 复用** — 当前 cache 是单进程内存；Vercel serverless 每个 lambda 实例独立。把 `sandboxId` 存 `projects` 表，用 `daytona.get(sandboxId)` 跨函数实例 reattach，省冷启 8-10s。

**P2（长期）**

6. Templates 市场（成品复用）
7. 多用户多租户（Clerk + Turso 分库）
8. Agent 自评 + 自动重试（Bob/Mike 跑健康检查 → 自动 followup 修复）

**优先级逻辑**：先补"真实感"硬伤（容器✓、多栈、Publish）→ 升"产品感"（协作可视化、真搜索）→ 最后碰平台属性（市场、多租户）。当前 Demo 是单用户单项目能完整闭环的状态，任何方向加增量都不破坏现状。

---

## 4. 笔试结果回收

- 🌐 在线 Demo：<待 Vercel 部署后填写>
- 📦 GitHub 仓库：<待推送后填写，设 public>
- 💰 大模型用量：Doubao（pro/std/lite 三档分流）+ Vercel Edge — 一次完整 demo 流（含 race + followup）约 …… token，成本 ¥……

### 本地运行

```bash
pnpm install
cp .env.example .env.local  # 填 DOUBAO_API_KEY，可选 E2B_API_KEY / TURSO_URL
pnpm dev
# 打开 http://localhost:3000
```

- `DAYTONA_API_KEY` **必填**：`run_command` / `run_python` 走真 Daytona 云容器；没有 mock fallback
- 不填 `TURSO_URL`：用本地 sqlite 文件（`./atoms.db`）；填了就持久化到 Turso
