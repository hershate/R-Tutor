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

**工作区未提交改动**（验证全绿，可按细粒度惯例提交）：

- perf(tutor)：八轮性能优化 + `benchmark/`（SearchAll -87% / SessionsList -80% / Epub -61% /
  PDF -48%，报告在 note/report/perf/README.md）
- feat(tutor)：web 检索换 Reasonix 方案（boot.NewWebSearchModel）+ SSRF 拨号时审查统一
  + BING_API_KEY 入凭证仓
- feat(studio)：TUI `/tutor` + `#tutor` 深链 + 感知层注释清理
- fix(studio)：桌面导师两层 bug——TutorSheet 端口接错（machinePort 的 /host/settings 前缀
  使全部 /tutor/* 404，新增 hub.tutorPort() 无基座端口）与空库存 null 列表致 React 白屏
  （serve 层 tutorList + 前端 list() 容错）

**打包**：dist/ 内有已签名的 windows-amd64 安装包 / 便携 zip / CLI 三目标；
源码分享包 dist/R-Tutor-src-studio-20261015.zip。

## 闸门口径（复核用）

make lint（golangci 0 issues + repolint clean 2698 零加宽）；make check；tutor 全包
（-race 约 23s）；serve 全量（约 640s）；boot 用 -timeout 25m（本机 AV 慢，默认 10m 会假
警铃）；前端 tsc + vitest（548 文件）。大套件勿并发跑。
