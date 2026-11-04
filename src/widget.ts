import { layoutMessageSchema, pageContextSchema } from "./model.ts";

import { Tracker } from "./tracker-ui.ts";

import type { PageContext } from "./model.ts";

const POLL_MS = 500;

const root = document.getElementById("root");

async function pageContext(): Promise<PageContext | null> {
  try {
    const reply: unknown = await chrome.runtime.sendMessage({ type: "page" });
    const parsed = pageContextSchema.safeParse(reply);

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

if (root !== null && window !== window.top) {
  let lastLayout = "";

  const tracker = new Tracker(root, {
    manageConnection: false,
    minimizable: true,
    onLayout: (layout) => {
      const message = layoutMessageSchema.parse({ type: "layout", ...layout });
      const signature = JSON.stringify(message);

      if (signature === lastLayout) return;
      lastLayout = signature;
      window.parent.postMessage(message, "*");
    },
  });

  let lastContext = "";

  const poll = async (): Promise<void> => {
    const context = await pageContext();
    const signature = JSON.stringify(context);

    if (signature === lastContext) return;
    lastContext = signature;

    if (context !== null) tracker.setTheme(context.theme);
    tracker.setIssue(context?.issue ?? null);
  };

  void poll();
  window.setInterval(() => void poll(), POLL_MS);
}
