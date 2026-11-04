import { issueSchema } from "./model.ts";
import { Tracker } from "./tracker-ui.ts";

import type { Issue } from "./model.ts";

async function activeIssue(): Promise<Issue | null> {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (tab?.id === undefined) return null;
    const reply = await chrome.tabs.sendMessage(tab.id, "issue", { frameId: 0 });
    const parsed = issueSchema.nullable().safeParse(reply);

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const root = document.getElementById("root");

if (root !== null) {
  const tracker = new Tracker(root, { manageConnection: true, minimizable: false });
  tracker.setTheme(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  void activeIssue().then((issue) => tracker.setIssue(issue));
}
