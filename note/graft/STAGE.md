---
owner: @esengine
backup: @SivanCola
status: active
reviewed: 2026-10-15
---

# STAGE.md — Deep Tutor → Reasonix 嫁接进度跟踪

> 本文件已纳入 git 跟踪，只保留当前状态；历史细节（S0–S8 阶段日志、八轮性能优化、
> 桌面导师修复、决策日志）见首笔快照：`git log --follow -- note/graft/STAGE.md`。
> note/ 其余内容（00-design.md 设计文档、report/ 报告、probe/ 探针）仍不跟踪，只在本地。

## 当前状态（2026-10-15）

**嫁接已完成并提交**：S1–S8 六层提交 efb0a1e…f4f3ccc（studio 分支，未推送），23 项 Feature
Checklist 全 ✅，Deep Tutor 语义逐条对位移植。架构与映射决策见 note/graft/00-design.md，
用户侧文档 docs/TUTOR.md。

**后续工作也已入库**（2026-10-15，细粒度八笔）：

- docs 7a9565d34（导师文档对现状刷新）+ STAGE 跟踪两笔 6a15570c9/9edafb614
- chore(studio) 68be5cf55：感知层注释去 Deep-tutor 措辞
- feat(studio) 36ff47c32：#tutor 深链 + TUI /tutor
- feat(tutor) 62eecb8cc：web 检索换 Reasonix 统一方案 + 拨号时 SSRF 审查
- perf(tutor) 6d3fc9da0：八轮优化 + benchmark/（SearchAll -87% / SessionsList -80% /
  Epub -61% / PDF -48%，报告在 note/report/perf/README.md）
- fix(studio) ec29a8635：桌面导师双层 bug——TutorSheet 端口接错（machinePort 的
  /host/settings 前缀使全部 /tutor/* 404，hub.tutorPort() 无基座端口修复）与空库存
  null 列表致 React 白屏（serve 层 tutorList + 前端 list() 容错）

**实机验证轮（2026-10-15 晚，安装版 + CDP 9448，四笔细粒度）**：

- fix(tutor) 14ad818e2：空库 kb/export 500 → 哨兵 ErrKbExportEmpty + 400
  tutor.kb_export_empty + 测试 + TUTOR.md 行（实测发现）
- docs 397b4e44f：TUTOR.md 备份格式勘误（单 JSON 文件，非 zip）
- fix(tutor) 4e85a69ad：错题本/错题队列条目补 answer 字段（重练答错时 UI 能显示
  正确答案；实测发现）
- fix(studio) c07148de4：复习空态补"再取一次最新数据"刷新按钮（挂载期间错题在
  别处产生时不再死胡同；实测发现）

验证覆盖（探针 note/probe/cdp-*.mjs，全部走真实 UI/页面源）：

- 免费路径 CRUD：笔记 / KB / 搜索 / 备份
- 面板压力：开关×10、分区扫×2、边缘搜索×5，零控制台异常
- 真实生成管线：表单→SSE 八工具→done→方案落库 4 阶段/14 主题/6 天 20 任务/
  校验全过→详情自动打开→首页与方案页可见
- 学习闭环：测验 10 题生成+UI 判分；故意错题判 false 含解析；错题重练判对→
  错题本清空；节点掌握度+间隔重复 k1→10-18 / k2→10-29；打卡 25 分钟+统计/连胜/日志
- 用量：模型 opencode（订阅型费率卡 0 价）token 34,508 已计量、cost=0 故台账不记
  ——机制有单测覆盖，非缺陷
- 重打包复验（build:host → electron-builder → 手工签名核验 → zip 重建 → robocopy
  部署）：kb/export 400、wrong-queue 带 answer、空态刷新按钮全过，存储跨重装保留

**打包**：dist/ 内有已签名的 windows-amd64 安装包 / 便携 zip / CLI 三目标；
源码分享包 dist/R-Tutor-src-studio-20261015.zip。

**产品翻转（2026-10-15 深夜，用户目标：前端以 Deep Tutor 功能为准）**：

- SPA（Studio 与 `reasonix web` 同源）从 Agent 优先翻转为学习工具优先：窗口默认
  落在导师面，Tutor 升格为根 surface，不再是浮层 sheet
- Agent 的完整界面收缩为导师页头的「聊天」页（App `surface: "tutor" | "chat"`）；
  tutor 面隐藏 Nav/Sidebar/RailToggle（精简），风格全沿用 Reasonix tokens
- `#tutor`/`#chat` 深链二选一，重载默认回导师面；设置浮层在 tutor 面经
  usePaneForSheets 照常取端口
- 顺手清掉存量欠账：c07148de4 的 `tutor.review-refresh` 未注册进 actions.ts
  （HEAD 上 actions.test.ts 即红）
- 验证：tsc 0、vitest 548 文件/4667 用例全绿、build、census:verify 金样不变

**前端全覆盖对账轮（2026-10-15 深夜续，route↔port↔UI 三张对账表 + 实机复验）**：

- feat(studio) 7c8fea744：对账后补齐的 UI——资料暂存行（文件行逐份解析模式
  full/fast/none、URL 行随目标发送、可移除）、首页学习数据卡（十二周热力图 +
  分方案进度米条）、复习总览（今日到期/错题总数/按方案错题直达该方案测验页）、
  测验统计与错题重练判分；actions.ts 补 mat-*/wrong-* 注册，EN 全量
- fix(studio) c86775b2f：内核 tutor DELETE 全 204 无体，端口层 del0 的 res.json()
  空体解析抛错——服务端已删、UI 报错行不消（实测发现；空体 settle undefined +
  2 单测，插件卸载的 JSON 形态保留）
- fix(studio) f201c9154：Tutor.css 幻影 token——--line/--ink/--ink-dim/
  --accent-soft/--bad/--good 无一定义，边框落 currentColor、热力图空格透明、
  原生输入框 UA 白底成"深色页面上的洞"（实测截图发现）→ 真词汇（--border/
  --text/--muted/--accent-wash + 文字用 *-ink）+ 字段配方（--raised/--text/
  --focus，:where 保页面覆盖力）
- 验证方法：mock OpenAI SSE（8199）+ config.toml 种子 provider + REASONIX_HOME
  隔离 + headless Edge CDP 17 检查零控制台异常 + 截图视觉复核（探针
  note/probe/cdp-ui-tour.mjs；目标页先 about:blank 再导航，防旧包缓存竞速）
- 发现未改（设计如此）：`reasonix web` 首跑向导是死胡同——Onboarding 走 grants
  门控的 /providers/*，仅桌面 host 调 AllowProviderEdit；web 循环回环只开
  /provider-setup 而 Onboarding 不调。安全取舍不动；web 首跑 seed config.toml
- IAB（ZCode 内置浏览器）宿主 rAF 不触发、Web Animations 冻结于 0，intro 的
  arrive() 永不完成，本应用验证不可用；headless Edge CDP 替代
- 闸门：tsc 0 / vitest 548 文件 4673 用例 / build / census 金样不变 / make
  check+lint clean（repolint 2697 零加宽）

**文档对齐轮（2026-10-15 深夜三，/goal「按实际代码更新全部文档」）**：

- 以翻转后产品形态为纲复核全部 docs/ 43 份 + 根 README±zh 等；改动七份、余下复核无需改
- README±zh 定位翻转：自学工具为主、Agent 为聊天页；30 秒上手改导师流程
- STUDIO_PARITY 导师行改"窗口首页"（原"侧栏按钮浮层"已不实）；CLI±zh /tutor 行同口径
  （TUI 无导师界面，命令只打印位置）
- GUIDE±zh 加窗口导向段 + web 首跑向导死胡同说明（provider.editing_disabled，seed 绕过）
- 顺手 GUIDE/CLI 四份补 owner 头（doc-owner 基线 -4，-update 收紧 2697→2693）
- 复核无需改：TUTOR/SPEC/CONFIG_PATHS/CONTRIBUTING/ROADMAP/MIGRATING/
  STUDIO_RELEASE/STUDIO_SHELL_BOUNDARIES/desktop±/REASONIX/AGENTS/CLAUDE/
  SECURITY/USAGE_CATALOG/BILLING
- 闸门 make check+lint 绿

**性能优化第 9 轮（2026-10-16 凌晨，/goal 持续性能优化，新面：前端首载）**：

- 前八轮全在 Go 侧（见 note/report/perf/README.md）；本轮换到 SPA 首屏
- feat：聊天面树原样搬 ChatPage.tsx（props 解构、JSX 逐字不变、hook 留 App），
  App 以 Settings 同款「随壳预取 + lazy」挂载——导师首屏不解析聊天面代码
- 量化（benchmark/frontend_bundle_bench.mjs，确定性）：eager JS 1309.6→883.4KB
  （-32.6%，gzip -31.1%）、index 单块 781→355KB（-54.6%）、聊天面 406KB 转预取懒块
- 验证：tsc 0 / vitest 548×4673 全绿（1 例同步查询改等懒块）/ census 金样不变 /
  CDP 实机 17 检查全绿（聊天翻转、#tutor 回返、零控制台异常）
- 坑位：`reasonix web` 的 -addr 而非 -addr/-port 混写；remote/ 令牌文件取最新要按
  mtime（ls -t），字典序会拿到旧 pid 的令牌 → assets 401 → 卡「正在连接内核…」

**性能优化第 10 轮（2026-10-16 凌晨，/goal 持续性能优化，面：i18n 按语言拆分）**：

- zh 恒等（中文即 key），只有 en 需要目录；语言会话期固定（切换=adopt 整窗
  reload）→ 目录可首帧前并行拉取，zh 窗口根本不拉
- perf：i18n/index.ts 去顶层 import EN，load(fixed) 仅 en 动态 import（目录记忆
  化，重复 boot 同步还原）；main.tsx loadLang(bootLang()) 与 pick() 一起
  Promise.all 后首渲染。eager JS 883.4→570.5KB（对基线累计 -56.4%，gzip -58.9%），
  en 目录 313KB 转懒块
- 测试侧与生产同款：显式 en 站点 await load(boot())；testsetup 每文件 preload
  目录进记忆（不动当前字典，未 boot 文件仍恒等 zh）——jsdom navigator 为英文的
  隐式 en 套件（modelpicker/effort_catalog）无需各自加载
- 验证：tsc 0 / vitest 548×4673 全绿 / CDP 实机：zh 默认 0 次 en-*.js 请求；
  内核 config language=en 时 adopt 落英文、目录恰拉一次；en 下 #chat 懒载正常
- 坑位：CDP 里手改 localStorage rx-lang 会被 adopt() 按内核 config 弹回——验证
  EN 要改 REASONIX_HOME 的 config.toml [desktop] language 并重启 web；#chat 哈希
  仅挂载时消费，翻转要带哈希整页导航而非 hashchange

## 闸门口径（复核用）

make lint（golangci 0 issues + repolint clean 2693 零加宽）；make check；tutor 全包
（-race 约 23s）；serve 全量（约 640s）；boot 用 -timeout 25m（本机 AV 慢，默认 10m 会假
警铃）；前端 tsc + vitest（548 文件）。大套件勿并发跑。

**本机已知假警铃（2026-10-15 夜实测，基线 f02046adb 无本地改动同样复现）**：

- ① t.TempDir() 清理竞态——unlinkat 报 "directory is not empty"，AV/索引器对临时
  目录持有 delete-pending 句柄所致。测试本体 0.02–0.03s 全过、随机分布在不同测试
  （SharedPlanView*/SlidesSpec/ShareOrphan 等），格率约 3/10，重跑即绿，与代码无关
- ② 高负载下 TestServiceGenerateAttachAndTerminalReplay 偶发 "stream stalled"
  （10s 时序门），独占重跑即绿。判定失败先看失败行是不是 TempDir cleanup/时序门
