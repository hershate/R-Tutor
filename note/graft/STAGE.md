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

验证覆盖（探针 note/probe/cdp-*.mjs，全部走真实 UI/页面源）：免费路径 CRUD（笔记/
KB/搜索/备份）；面板压力（开关×10、分区扫×2、边缘搜索×5，零控制台异常）；真实
生成管线（表单→SSE 八工具→done→方案落库 4 阶段/14 主题/6 天 20 任务/校验全过→
详情自动打开→首页与方案页可见）；学习闭环（测验 10 题生成+UI 判分、故意错题判
false 含解析、错题重练判对→错题本清空、节点掌握度+间隔重复 k1→10-18 / k2→10-29、
打卡 25 分钟+统计/连胜/日志）。用量：模型 opencode（订阅型费率卡 0 价）token
34,508 已计量、cost=0 故台账不记——机制有单测覆盖，非缺陷。重打包（build:host →
electron-builder → 手工签名核验 → zip 重建 → robocopy 部署）后在新二进制上复验
kb/export 400、wrong-queue 带 answer、空态刷新按钮，全部通过，存储跨重装保留。

**打包**：dist/ 内有已签名的 windows-amd64 安装包 / 便携 zip / CLI 三目标；
源码分享包 dist/R-Tutor-src-studio-20261015.zip。

## 闸门口径（复核用）

make lint（golangci 0 issues + repolint clean 2698 零加宽）；make check；tutor 全包
（-race 约 23s）；serve 全量（约 640s）；boot 用 -timeout 25m（本机 AV 慢，默认 10m 会假
警铃）；前端 tsc + vitest（548 文件）。大套件勿并发跑。
