import {
  issueSchema,
  layoutMessageSchema,
  parseIssuePath,
  titleFromDocumentTitle,
} from "./model.ts";

import type { Issue, LayoutMessage, PageContext, Theme } from "./model.ts";

type ContentQuery = "issue" | "page";

const HOST_ID = "clockify-for-linear-host";
const WIDGET_PAGE = "widget.html";
const POLL_MS = 500;
const MARGIN_PX = 16;

/** The widget draws its shadow inside the frame, so the frame extends this far past the card. */
const SHADOW_GUTTER_PX = 8;

/** Bars taller than this are page layout, not something docked to the bottom edge. */
const MAX_DOCKED_BAR_PX = 160;

/** Frame sizes depend only on the mode, so the page cannot read timer state from the frame's size. */
const EXPANDED_WIDTH_PX = 320 + 2 * SHADOW_GUTTER_PX;
const MINIMIZED_WIDTH_PX = 132 + 2 * SHADOW_GUTTER_PX;
const MINIMIZED_HEIGHT_PX = 40 + 2 * SHADOW_GUTTER_PX;

function currentIssue(): Issue | null {
  const parsed = parseIssuePath(location.pathname);

  if (parsed === null) return null;

  return { ...parsed, title: titleFromDocumentTitle(document.title, parsed.identifier) };
}

function detectTheme(): Theme {
  const root = document.documentElement;
  const declared = root.dataset["theme"] ?? root.className;

  if (/dark/iu.test(declared)) return "dark";

  if (/light/iu.test(declared)) return "light";

  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** How far a bar docked to the bottom edge (Linear's agent bar, for one) reaches up under the widget's columns. */
function dockedBarHeight(frame: HTMLElement, left: number, right: number): number {
  const viewportHeight = window.innerHeight;
  let reach = 0;

  for (const fraction of [0.1, 0.5, 0.9]) {
    const x = left + (right - left) * fraction;

    for (const node of document.elementsFromPoint(x, viewportHeight - 2)) {
      if (node === frame || node === document.documentElement || node === document.body) continue;
      const box = node.getBoundingClientRect();

      if (box.bottom < viewportHeight - 2 || box.bottom > viewportHeight + 1) continue;

      if (box.height > MAX_DOCKED_BAR_PX) continue;
      reach = Math.max(reach, viewportHeight - box.top);
    }
  }

  return Math.ceil(reach);
}

/**
 * Every property is `!important` on the element itself: Linear's or any page's stylesheet cannot repaint, resize,
 * or hide the frame. The frame's `color-scheme` follows the page so its transparent canvas stays transparent.
 */
function frameStyle(geometry: { width: number; height: number; bottom: number; theme: Theme }) {
  const declarations = {
    all: "initial",
    position: "fixed",
    top: "auto",
    left: "auto",
    right: `${MARGIN_PX - SHADOW_GUTTER_PX}px`,
    bottom: `${geometry.bottom}px`,
    width: `${geometry.width}px`,
    height: `${geometry.height}px`,
    "max-width": "none",
    "max-height": "none",
    "z-index": "2147483647",
    display: "block",
    visibility: "visible",
    opacity: "1",
    border: "0",
    margin: "0",
    padding: "0",
    background: "transparent",
    "box-shadow": "none",
    filter: "none",
    transform: "none",
    "color-scheme": geometry.theme,
  } satisfies Record<string, string>;

  return Object.entries(declarations)
    .map(([name, value]) => `${name}:${value} !important`)
    .join(";");
}

/** Clockify data lives only in the extension-origin frame; this script sees the issue and the frame's size. */
function mount(): void {
  const frame = document.createElement("iframe");
  frame.id = HOST_ID;
  frame.src = chrome.runtime.getURL(WIDGET_PAGE);
  frame.title = "Clockify";
  document.documentElement.append(frame);

  // Shown at a provisional size until the widget, which cannot measure itself while hidden, reports its own.
  let layout: LayoutMessage = { type: "layout", minimized: false, height: 160 };
  let attention = 0;
  let applied = "";

  const update = (): void => {
    let style = "display:none !important";

    if (currentIssue() !== null) {
      const theme = detectTheme();
      const wantedWidth = layout.minimized ? MINIMIZED_WIDTH_PX : EXPANDED_WIDTH_PX;
      const width = Math.min(wantedWidth, window.innerWidth - 2 * (MARGIN_PX - SHADOW_GUTTER_PX));
      const right = window.innerWidth - MARGIN_PX;
      const bar = dockedBarHeight(frame, right - width + 2 * SHADOW_GUTTER_PX, right);
      const bottom = MARGIN_PX - SHADOW_GUTTER_PX + bar;
      const wantedHeight = layout.minimized ? MINIMIZED_HEIGHT_PX : layout.height;
      const height = Math.min(wantedHeight, window.innerHeight - bottom - MARGIN_PX);
      style = frameStyle({ width, height: Math.max(height, 40), bottom, theme });
    }

    if (style === applied) return;
    applied = style;
    frame.style.cssText = style;
  };

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    const parsed = layoutMessageSchema.safeParse(event.data);

    if (!parsed.success) return;
    layout = parsed.data;
    update();
  });

  const noticeAttention = (): void => {
    if (document.visibilityState === "visible") attention += 1;
  };

  window.addEventListener("focus", noticeAttention);
  document.addEventListener("visibilitychange", noticeAttention);
  window.addEventListener("resize", update);
  update();
  window.setInterval(update, POLL_MS);

  chrome.runtime.onMessage.addListener((message: ContentQuery, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab !== undefined) return false;

    if (window !== window.top) return false;
    const issue = currentIssue();

    if (message === "issue") {
      sendResponse(issue === null ? null : issueSchema.parse(issue));
    } else if (message === "page") {
      const context: PageContext = { issue, theme: detectTheme(), attention };
      sendResponse(context);
    }

    return false;
  });
}

if (window === window.top && document.getElementById(HOST_ID) === null) mount();
