import {
  issueSchema,
  layoutMessageSchema,
  parseIssuePath,
  titleFromDocumentTitle,
} from "./model.ts";

import type { Issue, PageContext, Theme } from "./model.ts";

type ContentQuery = "issue" | "page";

const HOST_ID = "clockify-for-linear-host";
const WIDGET_PAGE = "widget.html";
const POLL_MS = 500;
const MARGIN_PX = 16;

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

/** Clockify data lives only in the extension-origin frame; this script sees the issue and the frame's size. */
function mount(): void {
  const frame = document.createElement("iframe");
  frame.id = HOST_ID;
  frame.src = chrome.runtime.getURL(WIDGET_PAGE);
  frame.title = "Clockify";
  frame.style.cssText = `position:fixed;right:${MARGIN_PX}px;bottom:${MARGIN_PX}px;z-index:2147483647;display:none;border:0;width:360px;height:260px;background:transparent;color-scheme:normal`;
  document.documentElement.append(frame);

  const update = (): void => {
    frame.style.display = currentIssue() === null ? "none" : "block";
  };

  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return;
    const parsed = layoutMessageSchema.safeParse(event.data);

    if (!parsed.success) return;
    frame.style.width = parsed.data.minimized ? "60px" : "360px";
    frame.style.height = parsed.data.minimized ? "60px" : `${parsed.data.height}px`;
  });

  update();
  window.setInterval(update, POLL_MS);

  chrome.runtime.onMessage.addListener((message: ContentQuery, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || sender.tab !== undefined) return false;

    if (window !== window.top) return false;
    const issue = currentIssue();

    if (message === "issue") {
      sendResponse(issue === null ? null : issueSchema.parse(issue));
    } else if (message === "page") {
      const context: PageContext = { issue, theme: detectTheme() };
      sendResponse(context);
    }

    return false;
  });
}

if (window === window.top && document.getElementById(HOST_ID) === null) mount();
