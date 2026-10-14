// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "../testkit";
import { MockPort } from "../../port/mock";
import type { AgentPort } from "../../port/port";
import { Tutor } from "./Tutor";
import type { TutorView } from "./Tutor";

afterEach(cleanup);

function mounted() {
  const port = new MockPort() as unknown as AgentPort;
  const views: TutorView[] = [{ k: "home" }];
  const tree = (v: TutorView) => (
    <Tutor port={port} view={v} onGo={go} onClose={() => undefined} onError={() => undefined} />
  );
  // Defined after render hands it back; go only runs on a later click.
  let rerender: (v: TutorView) => void = () => undefined;
  const go = (v: TutorView) => {
    views[0] = v;
    rerender(v);
  };
  const utils = render(tree(views[0]!));
  rerender = (v) => utils.rerender(tree(v));
  return { port, go, views, ...utils };
}

it("opens on the goal page with the navigation present", async () => {
  mounted();
  const start = await screen.findByRole("button", { name: "制定学习方案" }) as HTMLButtonElement;
  expect(start.disabled).toBe(true);
  expect(screen.getByRole("navigation", { name: "学习导航" })).toBeTruthy();
});

it("runs a generation end to end: goal → progress steps → plan view", async () => {
  const user = userEvent.setup();
  const { views } = mounted();
  const box = await screen.findByPlaceholderText(/用一段话描述你的学习目标/);
  await user.type(box, "三个月掌握 React");
  await user.click(screen.getByRole("button", { name: "制定学习方案" }));

  // The scripted stream walks two tools then lands done; the sheet switches
  // to the progress view first.
  await screen.findByText("正在生成你的学习方案");
  await waitFor(() => {
    expect(screen.getByText(/理解学习目标/)).toBeTruthy();
  });

  // done switches to the plan view after the redirect beat.
  await waitFor(() => {
    expect(views[0]?.k).toBe("plan");
  }, { timeout: 5000 });
  expect((await screen.findAllByText(/组件与 JSX/)).length).toBeGreaterThan(0);
});

it("shares a plan read-only, then revokes it", async () => {
  const user = userEvent.setup();
  const { views } = mounted();
  const box = await screen.findByPlaceholderText(/用一段话描述你的学习目标/);
  await user.type(box, "三个月掌握 React");
  await user.click(screen.getByRole("button", { name: "制定学习方案" }));
  await waitFor(() => {
    expect(views[0]?.k).toBe("plan");
  }, { timeout: 5000 });

  // Create the share: the header swaps the button for the link surface.
  await user.click(await screen.findByRole("button", { name: "只读分享" }));
  const revoke = await screen.findByRole("button", { name: "撤销分享" });
  expect(screen.getByRole("link", { name: "查看分享页" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "复制链接" })).toBeTruthy();

  // Revoke: the create button comes back and the link surface is gone.
  await user.click(revoke);
  await screen.findByRole("button", { name: "只读分享" });
  expect(screen.queryByRole("link", { name: "查看分享页" })).toBeNull();
});

it("previews a backup file before importing it", async () => {
  const user = userEvent.setup();
  mounted();
  // The mock preview reports the demo store's own (empty) counts; the flow
  // under test is upload → preview card → confirm → summary.
  const input = await screen.findByLabelText("选择备份文件");
  const file = new File(["{\"format\":\"reasonix-tutor-backup\"}"], "backup.json", { type: "application/json" });
  await user.upload(input, file);
  expect(await screen.findByText("这份备份包含：")).toBeTruthy();
  expect(screen.getByText("0 个会话")).toBeTruthy();
  await user.click(screen.getByRole("button", { name: /确认导入/ }));
  await waitFor(() => {
    expect(screen.getByText(/已导入 0 个会话/)).toBeTruthy();
  });
});

it("exports the plan as an Anki deck, its wrong-book, slides, and degraded pdf", async () => {
  const user = userEvent.setup();
  const { port } = mounted();
  const box = await screen.findByPlaceholderText(/用一段话描述你的学习目标/);
  await user.type(box, "三个月掌握 React");
  await user.click(screen.getByRole("button", { name: "制定学习方案" }));
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "导出 Anki 卡片" })).toBeTruthy();
  }, { timeout: 5000 });

  // jsdom has neither blob URLs nor downloads; capture the port calls.
  const calls: Array<[string, boolean | undefined]> = [];
  port.tutorPlanApkg = async (id: string, wrongOnly?: boolean) => {
    calls.push([id, wrongOnly]);
    return new Blob(["pk"], { type: "application/octet-stream" });
  };
  const slideCalls: string[] = [];
  port.tutorPlanSlides = async (id: string) => {
    slideCalls.push(id);
    return "<!DOCTYPE html><html><body>deck</body></html>";
  };
  const pdfCalls: string[] = [];
  port.tutorPlanPDF = async (id: string) => {
    pdfCalls.push(id);
    return { content: "# md", degraded: true };
  };
  HTMLAnchorElement.prototype.click = () => undefined;
  URL.createObjectURL = (() => "blob:mock") as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL;

  await user.click(screen.getByRole("button", { name: "导出 Anki 卡片" }));
  await user.click(screen.getByRole("button", { name: "导出错题卡片" }));
  await user.click(screen.getByRole("button", { name: "导出幻灯片" }));
  await user.click(screen.getByRole("button", { name: "导出 PDF" }));
  await waitFor(() => {
    expect(calls).toHaveLength(2);
    expect(slideCalls).toHaveLength(1);
    expect(pdfCalls).toHaveLength(1);
  });
  expect(calls[0]![1]).toBe(false);
  expect(calls[1]![1]).toBe(true);
  expect(calls[0]![0]).toBe(calls[1]![0]);
  expect(slideCalls[0]).toBe(calls[0]![0]);
  expect(pdfCalls[0]).toBe(calls[0]![0]);
});

it("switches to notes, creates one, and lists it", async () => {
  const user = userEvent.setup();
  const { views } = mounted();
  await user.click(await screen.findByRole("button", { name: "笔记" }));
  expect(views[0]?.k).toBe("notes");
  await user.click(await screen.findByRole("button", { name: "新建" }));
  const title = await screen.findByPlaceholderText("标题");
  await user.type(title, "第一篇笔记");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => {
    expect(screen.getByText("第一篇笔记")).toBeTruthy();
  });
});

it("shows the honest empty state for a session with no pending questions", async () => {
  const port = new MockPort() as unknown as AgentPort;
  const session = await port.tutorCreateSession("目标");
  const utils = render(
    <Tutor port={port} view={{ k: "clarify", sid: session.id }} onGo={() => undefined} onClose={() => undefined} onError={() => undefined} />,
  );
  expect(await utils.findByText("这个会话当前没有待回答的问题。")).toBeTruthy();
});

it("files a text document and asks the knowledge base about it", async () => {
  const user = userEvent.setup();
  const { views } = mounted();
  await user.click(await screen.findByRole("button", { name: "知识库" }));
  expect(views[0]?.k).toBe("kb");
  expect(await screen.findByText(/知识库还是空的/)).toBeTruthy();

  // Text in, parsed straight away; the row shows the parsed status.
  await user.click(screen.getByRole("button", { name: "添加文本" }));
  await user.type(await screen.findByPlaceholderText("标题（可空，取正文首行）"), "Rust 手册");
  await user.type(screen.getByPlaceholderText("粘贴文本内容"), "所有权是 Rust 的核心概念。");
  await user.click(screen.getByRole("button", { name: "入库" }));
  await waitFor(() => {
    expect(screen.getAllByText(/Rust 手册/).length).toBeGreaterThan(0);
  });

  // Ask: the mock answers citing the first context document.
  await user.click(screen.getByRole("tab", { name: "问答" }));
  await user.type(await screen.findByPlaceholderText("就知识库内容提问…"), "什么是所有权？");
  await user.click(screen.getByRole("button", { name: "提问" }));
  await waitFor(() => {
    expect(screen.getByText(/演示回答/)).toBeTruthy();
  });
  // The citation chip names the source doc (the answer body names it too).
  expect(screen.getAllByText(/《Rust 手册》/).length).toBeGreaterThanOrEqual(2);
  // The question lands in the persisted history.
  await waitFor(() => {
    expect(screen.getByText("什么是所有权？")).toBeTruthy();
  });
});
