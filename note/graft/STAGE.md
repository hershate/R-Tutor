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

**打包**：dist/ 内有已签名的 windows-amd64 安装包 / 便携 zip / CLI 三目标；
源码分享包 dist/R-Tutor-src-studio-20261015.zip。

## 闸门口径（复核用）

make lint（golangci 0 issues + repolint clean 2698 零加宽）；make check；tutor 全包
（-race 约 23s）；serve 全量（约 640s）；boot 用 -timeout 25m（本机 AV 慢，默认 10m 会假
警铃）；前端 tsc + vitest（548 文件）。大套件勿并发跑。
