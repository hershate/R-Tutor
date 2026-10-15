// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "./testkit";
import { App } from "./App";
import { Nav } from "./Nav";
import { MockHub } from "../port/mock_hub";
import { dropDraft } from "./feedbackdraft";

afterEach(() => {
  cleanup();
  dropDraft();
  window.location.hash = "";
  localStorage.removeItem("rx-show-session-tabs");
  vi.restoreAllMocks();
});

const navProps = { at: null, onGo: vi.fn(), onFiles: vi.fn(), onHome: vi.fn(), onRail: vi.fn(), onFeedback: vi.fn(), onTutor: vi.fn(), onNew: vi.fn(), feedbackUnread: 0, shown: true };

// The same harness the feedback entry tests ride: a quiet feedback state, so
// the sidebar footer settles and the palette is reachable.
function hub() {
  const h = new MockHub();
  const build = h.portFor.bind(h);
  h.portFor = (rt) => {
    const port = build(rt);
    port.providerSetup = async () => null;
    port.welcomeSeen = async () => true;
    return port;
  };
  const mp = h.machinePort();
  const mine = mp.myFeedback.bind(mp);
  mp.myFeedback = vi.fn(async () => {
    const m = await mine();
    return { ...m, unread: 0, hasNew: false, items: m.items.map((i) => ({ ...i, needsInput: false, unreadReplies: 0 })) };
  });
  return h;
}

// The study tutor's entries on the stock shell: the rail button, the command
// palette row, and the #tutor address that hands over from the terminal.
describe("study tutor entries", () => {
  it("opens the sheet from the rail button", () => {
    const onTutor = vi.fn();
    const { container } = render(<Nav {...navProps} onTutor={onTutor} />);
    const btn = container.querySelector('button[aria-label="学习导师"]')!;
    expect(btn.getAttribute("data-action")).toBe("tutor.open");
    fireEvent.click(btn);
    expect(onTutor).toHaveBeenCalledOnce();
  });

  it("opens the sheet from the command palette", async () => {
    render(<App hub={hub()} />);
    await screen.findByRole("button", { name: "发送反馈" });
    await userEvent.keyboard("{Control>}k{/Control}");
    await userEvent.keyboard("导师");
    await userEvent.click(await screen.findByText("学习导师"));
    expect(await screen.findByRole("navigation", { name: "学习导航" })).toBeTruthy();
  });

  it("opens the sheet from a #tutor address and clears the hash", async () => {
    window.location.hash = "#tutor";
    render(<App hub={hub()} />);
    expect(await screen.findByRole("navigation", { name: "学习导航" })).toBeTruthy();
    expect(window.location.hash).toBe("");
  });
});
