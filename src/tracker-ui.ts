import { element, svg } from "./dom.ts";
import {
  changedMessageSchema,
  formatElapsed,
  issueKey,
  projectForTitle,
  STORAGE_KEY_API_KEY,
} from "./model.ts";
import { send } from "./messaging.ts";
import { ProjectPicker } from "./project-picker.ts";
import { TRACKER_CSS } from "./tracker-css.ts";

import type {
  ChangedMessage,
  ConnectedSnapshot,
  Issue,
  Problem,
  Reply,
  Request,
  RunningEntry,
  Snapshot,
  Theme,
} from "./model.ts";

/** `base*` is the last Clockify value this draft was synchronised from; saves are checked against it. */
type Draft = {
  description: string;
  projectId: string | null;
  baseDescription: string;
  baseProjectId: string | null;
  descriptionTouched: boolean;
  projectTouched: boolean;
};

/** The primary row, and the discard confirmation when it is open. */
type ActionControls = { row: HTMLElement; confirm: HTMLElement | null };

type Action = Exclude<Request["type"], "state">;

export type TrackerOptions = {
  /** The popup owns credentials; the Linear widget only points to it and can be minimized. */
  surface: "popup" | "widget";
  /** Called after every render with the card's height and whether it is minimized. */
  onLayout?: (layout: { height: number; minimized: boolean }) => void;
};

/** A visible view re-reads Clockify this often, so a timer started or stopped elsewhere shows up within seconds. */
const POLL_MS = 4_000;

/** Failed reads back off up to this, so an outage or rate limit is not hammered. */
const MAX_POLL_MS = 60_000;
const SAVED_NOTICE_MS = 2_000;

const PENDING_LABEL: Record<Action, string> = {
  acknowledge: "Checking…",
  connect: "Connecting…",
  disconnect: "Disconnecting…",
  start: "Starting…",
  stop: "Stopping…",
  save: "Saving…",
  discard: "Deleting…",
};

const ICONS = {
  clock:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8.5" r="5.75"/><path d="M8 5.5v3l2 1.5M6.5 1.75h3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  minimize:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 8h8" stroke-linecap="round"/></svg>',
  play: '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M5 3.4v9.2a.6.6 0 0 0 .92.5l7.1-4.6a.6.6 0 0 0 0-1L5.92 2.9A.6.6 0 0 0 5 3.4Z"/></svg>',
  stop: '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.5"/></svg>',
} as const;

function icon(name: keyof typeof ICONS): DocumentFragment {
  return svg(ICONS[name]);
}

export class Tracker {
  private snapshot: Snapshot | null = null;
  private problem: Problem | null = null;
  /** An action's problem stays until the next action; a read's problem clears with the next good read. */
  private problemFromRead = false;
  private issue: Issue | null = null;
  private pending: Action | null = null;
  private minimized = false;
  private confirmingDiscard = false;
  private savedNotice = false;
  private readonly drafts = new Map<string, Draft>();
  private readonly card: HTMLElement;
  private elapsed: HTMLElement[] = [];
  private lastRendered = "";
  private focusAfterRender: string | null = null;
  private readonly options: TrackerOptions;
  /** One instance for the view's lifetime, so a background refresh never drops a search being typed. */
  private readonly picker: ProjectPicker;
  /** A read applies only if no action started after it, so it never repaints state older than an action's reply. */
  private actionsStarted = 0;
  private reading = false;
  private rereadRequested = false;
  private failedReads = 0;
  private pollTimer = 0;
  private savedTimer = 0;

  constructor(host: HTMLElement, options: TrackerOptions) {
    this.options = options;
    this.card = element("section", { class: "card", "data-testid": "tracker" });
    host.append(element("style", {}, TRACKER_CSS), this.card);

    this.picker = new ProjectPicker("Project", (projectId) => {
      const draft = this.draft();
      draft.projectId = projectId;
      draft.projectTouched = true;
      this.render();
    });

    // The picker opens and filters without a re-render, so its size changes are reported on their own.
    new ResizeObserver(() => this.reportLayout()).observe(this.picker.root);
    window.setInterval(() => this.tick(), 1000);

    chrome.runtime.onMessage.addListener((message: ChangedMessage, sender) => {
      // Typed for the listener signature only: the schema re-parses every message.
      if (sender.id !== chrome.runtime.id || sender.tab !== undefined) return false;

      if (changedMessageSchema.safeParse(message).success) this.refresh();

      return false;
    });

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && STORAGE_KEY_API_KEY in changes) this.refresh();
    });

    document.addEventListener("visibilitychange", () => this.refresh());
    window.addEventListener("focus", () => this.refresh());
    window.addEventListener("resize", () => this.reportLayout());
    this.refresh();
  }

  /** Native controls, scrollbars and the frame canvas follow the root's color-scheme, which the theme sets. */
  setTheme(theme: Theme): void {
    document.documentElement.dataset["theme"] = theme;
  }

  setIssue(issue: Issue | null): void {
    this.issue = issue;
    this.confirmingDiscard = false;
    this.render();
  }

  /** Re-reads Clockify now. Hidden views skip the read and the polling; they refresh when shown again. */
  refresh(): void {
    window.clearTimeout(this.pollTimer);

    if (document.visibilityState !== "visible") return;

    if (this.reading || this.pending !== null) {
      this.rereadRequested = true;

      return;
    }

    this.reading = true;
    void this.read().then((failed) => {
      this.reading = false;
      this.failedReads = failed ? Math.min(this.failedReads + 1, 4) : 0;

      if (this.rereadRequested) {
        this.rereadRequested = false;
        this.refresh();

        return;
      }

      const delay = Math.min(POLL_MS * 2 ** this.failedReads, MAX_POLL_MS);
      this.pollTimer = window.setTimeout(() => this.refresh(), delay);
    });
  }

  private connected(): ConnectedSnapshot | null {
    return this.snapshot?.connection === "connected" ? this.snapshot : null;
  }

  private running(): RunningEntry | null {
    const timer = this.connected()?.timer;

    return timer?.kind === "running" ? timer.entry : null;
  }

  /** Returns whether the read failed. */
  private async read(): Promise<boolean> {
    const started = this.actionsStarted;
    let reply: Reply | null = null;

    try {
      reply = await send({ type: "state" });
    } catch {
      reply = null;
    }

    if (started !== this.actionsStarted || this.pending !== null) return reply?.error !== null;

    if (reply === null) {
      this.problem = { kind: "network", message: "The extension background is not responding." };
      this.problemFromRead = true;
    } else {
      this.snapshot = reply.snapshot;

      if (reply.error !== null || this.problemFromRead) {
        this.problem = reply.error;
        this.problemFromRead = reply.error !== null;
      }
    }

    this.render();

    return reply?.error !== null;
  }

  private accountId(): string | null {
    return this.connected()?.accountId ?? null;
  }

  private async act(request: Exclude<Request, { type: "state" }>): Promise<Reply | null> {
    this.actionsStarted += 1;
    this.pending = request.type;
    this.confirmingDiscard = false;
    this.render();
    let reply: Reply | null = null;

    try {
      reply = await send(request);
      this.snapshot = reply.snapshot;
      this.problem = reply.error;
    } catch {
      this.problem = { kind: "network", message: "The extension background is not responding." };
    }

    this.problemFromRead = false;
    this.pending = null;

    if (request.type === "save" && reply?.error === null) this.showSaved();
    this.render();
    this.refresh();

    return reply;
  }

  private showSaved(): void {
    this.savedNotice = true;
    window.clearTimeout(this.savedTimer);
    this.savedTimer = window.setTimeout(() => {
      this.savedNotice = false;
      this.render();
    }, SAVED_NOTICE_MS);
  }

  /** Drafts are scoped to the connected account. Idle drafts belong to an issue; a running draft belongs to its Clockify entry. */
  private draft(): Draft {
    const running = this.running();

    const owner = this.accountId() ?? "none";

    const key =
      running === null
        ? `${owner}|issue:${this.issue === null ? "none" : issueKey(this.issue)}`
        : `${owner}|entry:${running.id}`;

    const existing = this.drafts.get(key);

    if (existing !== undefined) {
      if (running === null) {
        if (!existing.descriptionTouched && !existing.projectTouched) this.prefill(existing);
      } else {
        this.synchronise(existing, running);
      }

      return existing;
    }

    const draft: Draft =
      running === null
        ? {
            description: "",
            projectId: null,
            baseDescription: "",
            baseProjectId: null,
            descriptionTouched: false,
            projectTouched: false,
          }
        : {
            description: running.description,
            projectId: running.projectId,
            baseDescription: running.description,
            baseProjectId: running.projectId,
            descriptionTouched: false,
            projectTouched: false,
          };

    if (running === null) this.prefill(draft);
    this.drafts.set(key, draft);

    return draft;
  }

  /** Untouched fields follow Clockify. Touched fields keep their baseline so a stale edit is caught on save. */
  private synchronise(draft: Draft, running: RunningEntry): void {
    if (draft.descriptionTouched && draft.description === running.description) {
      draft.descriptionTouched = false;
    }

    if (draft.projectTouched && draft.projectId === running.projectId) {
      draft.projectTouched = false;
    }

    if (!draft.descriptionTouched) {
      draft.description = running.description;
      draft.baseDescription = running.description;
    }

    if (!draft.projectTouched) {
      draft.projectId = running.projectId;
      draft.baseProjectId = running.projectId;
    }
  }

  private prefill(draft: Draft): void {
    if (this.issue === null) return;
    draft.description = this.issue.identifier;
    draft.projectId =
      projectForTitle(this.issue.title, this.connected()?.projects ?? [])?.id ?? null;
  }

  private tick(): void {
    const running = this.running();

    if (running === null) return;
    const text = formatElapsed(Date.now() - Date.parse(running.startedAt));

    for (const node of this.elapsed) node.textContent = text;
  }

  private render(): void {
    const running = this.running();
    const draft = this.connected() === null ? null : this.draft();

    const signature = JSON.stringify([
      this.snapshot,
      this.problem,
      this.issue,
      this.pending,
      this.minimized,
      this.confirmingDiscard,
      this.savedNotice,
      draft,
    ]);

    if (signature === this.lastRendered) return;
    this.lastRendered = signature;
    this.elapsed = [];
    const focused = document.activeElement;
    const focusId = this.focusAfterRender ?? focused?.getAttribute("data-testid") ?? null;
    const caret = focused instanceof HTMLInputElement ? focused.selectionStart : null;
    this.focusAfterRender = null;
    this.card.replaceChildren(...this.body(running, draft));

    if (focusId !== null) {
      const restored = this.card.querySelector<HTMLElement>(`[data-testid="${focusId}"]`);
      restored?.focus();

      if (restored instanceof HTMLInputElement && restored === focused && caret !== null) {
        restored.setSelectionRange(caret, caret);
      }
    }

    this.card.classList.toggle("minimized", this.minimized);
    this.tick();
    this.reportLayout();
  }

  /** Runs after renders and resizes: a frame measured while hidden or clamped must report again once it is shown. */
  private reportLayout(): void {
    // A clamped card scrolls, so its scroll height is the height it wants, not the height it was given.
    const height = Math.max(this.card.scrollHeight, this.card.getBoundingClientRect().height);

    if (height === 0) return;

    this.options.onLayout?.({
      height: Math.min(600, Math.max(40, Math.ceil(height) + 16)),
      minimized: this.minimized,
    });
  }

  private setMinimized(minimized: boolean): void {
    this.minimized = minimized;
    this.focusAfterRender = minimized ? "expand" : "minimize";
    this.render();
  }

  private body(running: RunningEntry | null, draft: Draft | null): HTMLElement[] {
    if (this.minimized) return [this.minimizedButton(running)];
    const nodes: HTMLElement[] = [this.header()];

    if (this.problem !== null) {
      nodes.push(
        element(
          "p",
          { class: `notice problem ${this.problem.kind}`, role: "alert", "data-testid": "problem" },
          this.problem.message,
        ),
      );
    }

    const connected = this.connected();

    if (connected === null || draft === null) {
      nodes.push(...this.connectionPanel());

      return nodes;
    }

    if (connected.staleReason !== null) {
      nodes.push(
        element(
          "p",
          { class: "notice warn", "data-testid": "stale" },
          "Showing the last known timer. Clockify could not be reached, so changes are paused.",
        ),
      );
    }

    if (connected.unresolved !== null) nodes.push(this.unresolvedPanel(connected.unresolved));

    nodes.push(this.clock(connected, running), ...this.timerPanel(connected, running, draft));

    if (this.options.surface === "popup") nodes.push(this.footer());

    return nodes;
  }

  private header(): HTMLElement {
    const top = element("header", { class: "top" });
    const subject = element("div", { class: "subject" });

    if (this.issue === null) {
      const brand = element("p", { class: "brand" });
      brand.style.margin = "0";
      brand.append(icon("clock"), "Clockify");
      subject.append(brand);
    } else {
      const issue = element("p", {
        class: "issue",
        "data-testid": "issue",
        title: `${this.issue.identifier} ${this.issue.title ?? ""}`.trim(),
      });

      issue.append(element("span", { class: "issue-key" }, this.issue.identifier));

      if (this.issue.title !== null) {
        issue.append(" ", element("span", { class: "issue-title" }, this.issue.title));
      }

      subject.append(issue);
    }

    top.append(subject);

    if (this.options.surface === "widget") {
      const minimize = element("button", {
        type: "button",
        class: "icon-button",
        "aria-label": "Minimize Clockify",
        title: "Minimize",
        "data-testid": "minimize",
      });

      minimize.append(icon("minimize"));
      minimize.addEventListener("click", () => this.setMinimized(true));
      top.append(minimize);
    }

    return top;
  }

  private minimizedButton(running: RunningEntry | null): HTMLElement {
    const button = element("button", {
      type: "button",
      class: running === null ? "bubble" : "bubble running",
      "aria-label": running === null ? "Expand Clockify" : "Expand Clockify, timer running",
      title: "Expand Clockify",
      "data-testid": "expand",
    });

    if (running === null) {
      button.append(icon("clock"));
    } else {
      const elapsed = element("span", { class: "elapsed" });
      this.elapsed.push(elapsed);
      const dot = element("span", { class: "running-dot" });
      dot.append(element("span", { class: "dot" }));
      button.append(dot, elapsed);
    }

    button.addEventListener("click", () => this.setMinimized(false));

    return button;
  }

  private connectionPanel(): HTMLElement[] {
    if (this.snapshot === null) return [element("p", { class: "hint" }, "Loading…")];

    if (this.options.surface === "widget") {
      const hint = element("div", { class: "connect-hint", "data-testid": "connect-hint" });
      hint.style.display = "grid";
      hint.style.gap = "4px";

      hint.append(
        element("p", { class: "lead" }, "Connect Clockify to track this issue"),
        element(
          "p",
          { class: "hint" },
          "Click the Clockify for Linear button in your browser toolbar and paste your API key.",
        ),
      );

      return [hint];
    }

    const form = element("form", { class: "fields", "data-testid": "connect-form" });
    const label = element("label", {}, "Clockify API key");

    const input = element("input", {
      type: "password",
      name: "apiKey",
      autocomplete: "off",
      spellcheck: "false",
      required: "",
      placeholder: "Paste your API key",
      "data-testid": "api-key",
    });

    label.append(input);
    const help = element("p", { class: "hint" }, "Find it under ");

    help.append(
      element(
        "a",
        {
          href: "https://clockify.me/user/settings",
          target: "_blank",
          rel: "noreferrer",
        },
        "Clockify profile settings",
      ),
      ". It stays in this browser.",
    );

    const submit = this.submitButton("connect", "Connect", "connect");
    submit.disabled = this.pending !== null;
    form.append(label, help, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      if (!event.isTrusted) return;
      const apiKey = input.value;
      input.value = "";
      void this.act({ type: "connect", apiKey });
    });

    return [form];
  }

  private submitButton(action: Action, label: string, testId: string): HTMLButtonElement {
    const pending = this.pending === action;

    const button = element(
      "button",
      { type: "submit", class: "primary", "data-testid": testId },
      pending ? PENDING_LABEL[action] : label,
    );

    if (pending) button.setAttribute("aria-busy", "true");

    return button;
  }

  private unresolvedPanel(operation: string): HTMLElement {
    const panel = element("div", {
      class: "notice warn",
      role: "status",
      "data-testid": "unresolved",
    });

    panel.append(
      element("p", {}, `${operation} may not have finished. Check Clockify, then confirm here.`),
    );
    const actions = element("div", { class: "actions" });
    const check = this.actionButton("acknowledge", "Check Clockify", "recheck", "secondary");
    const accountId = this.accountId();
    check.disabled = this.pending !== null || accountId === null;
    check.addEventListener("click", (event) => {
      if (event.isTrusted && accountId !== null) void this.act({ type: "acknowledge", accountId });
    });
    actions.append(check);
    panel.append(actions);

    return panel;
  }

  private footer(): HTMLElement {
    const footer = element("footer", { class: "footer" });
    const state = element("span", { class: "state" });
    state.append(element("span", { class: "dot" }), "Connected to Clockify");
    const disconnect = this.actionButton("disconnect", "Disconnect", "disconnect", "ghost");
    disconnect.disabled = this.pending !== null;
    disconnect.addEventListener("click", (event) => {
      if (event.isTrusted) void this.act({ type: "disconnect" });
    });
    footer.append(state, disconnect);

    return footer;
  }

  private actionButton(
    action: Action,
    label: string,
    testId: string,
    kind: "primary" | "secondary" | "ghost" | "ghost danger" | "primary danger",
  ): HTMLButtonElement {
    const pending = this.pending === action;

    const button = element(
      "button",
      { type: "button", class: kind, "data-testid": testId },
      pending ? PENDING_LABEL[action] : label,
    );

    if (pending) button.setAttribute("aria-busy", "true");

    return button;
  }

  private clock(connected: ConnectedSnapshot, running: RunningEntry | null): HTMLElement {
    const kind = running !== null ? "running" : connected.timer.kind;
    const clock = element("div", { class: `clock ${kind}` });
    const time = element("p", { class: "elapsed" }, "00:00:00");

    if (running !== null) {
      time.setAttribute("data-testid", "elapsed");
      this.elapsed.push(time);
    }

    const state = element("span", { class: "state", role: "status" });
    state.append(element("span", { class: "dot" }));

    state.append(
      kind === "running" ? "Running" : kind === "idle" ? "Not running" : "Timer unknown",
    );

    clock.append(time, state);

    return clock;
  }

  private timerPanel(
    connected: ConnectedSnapshot,
    running: RunningEntry | null,
    draft: Draft,
  ): HTMLElement[] {
    const form = element("form", { class: "fields" });
    const descriptionLabel = element("label", {}, "Description");

    const description = element("input", {
      type: "text",
      "data-testid": "description",
      maxlength: "3000",
      placeholder: "What are you working on?",
      autocomplete: "off",
    });

    description.value = draft.description;
    description.addEventListener("input", () => {
      draft.description = description.value;
      draft.descriptionTouched = true;
      this.render();
    });
    descriptionLabel.append(description);

    this.picker.show(connected.projects, connected.favorites, draft.projectId);
    const actions = this.actions(running, draft, connected);
    form.append(descriptionLabel, this.picker.root, actions.row);

    // Enter in the description starts an idle timer or saves an edited running one.
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      const primary = form.querySelector<HTMLButtonElement>(
        running === null ? '[data-testid="start"]' : '[data-testid="save"]',
      );

      if (event.isTrusted && primary !== null && !primary.disabled) primary.click();
    });

    const nodes: HTMLElement[] = [form];

    if (actions.confirm !== null) nodes.push(actions.confirm);

    if (this.savedNotice) {
      nodes.push(element("p", { class: "status", role: "status" }, "Saved to Clockify"));
    }

    return nodes;
  }

  private actions(
    running: RunningEntry | null,
    draft: Draft,
    connected: ConnectedSnapshot,
  ): ActionControls {
    const accountId = connected.accountId;
    const row = element("div", { class: "actions" });

    const blocked =
      this.pending !== null ||
      accountId === null ||
      connected.staleReason !== null ||
      connected.unresolved !== null;

    const button = (
      action: Action,
      label: string,
      testId: string,
      kind: Parameters<Tracker["actionButton"]>[3],
      onClick: (accountId: string) => void,
    ): HTMLButtonElement => {
      const node = this.actionButton(action, label, testId, kind);
      node.disabled = blocked;
      node.addEventListener("click", (event) => {
        if (event.isTrusted && accountId !== null) onClick(accountId);
      });

      return node;
    };

    if (running === null) {
      const start = button(
        "start",
        "Start timer",
        "start",
        "primary",
        (id) =>
          void this.act({
            type: "start",
            accountId: id,
            description: draft.description,
            projectId: draft.projectId,
          }),
      );

      start.classList.add("grow");
      start.prepend(icon("play"));
      start.disabled = blocked || connected.timer.kind !== "idle";
      row.append(start);

      return { row, confirm: null };
    }

    const dirty =
      draft.description !== running.description || draft.projectId !== running.projectId;

    const stop = button("stop", "Stop", "stop", "primary", (id) => {
      void this.act({ type: "stop", accountId: id, entryId: running.id });
    });

    stop.classList.add("grow");
    stop.prepend(icon("stop"));

    const save = button(
      "save",
      "Save",
      "save",
      "secondary",
      (id) =>
        void this.act({
          type: "save",
          accountId: id,
          entryId: running.id,
          description: draft.description,
          projectId: draft.projectId,
          expect: { description: draft.baseDescription, projectId: draft.baseProjectId },
        }),
    );

    save.disabled = blocked || !dirty;

    if (this.confirmingDiscard) {
      const confirm = element("div", {
        class: "notice confirm",
        role: "group",
        "aria-label": "Confirm discard",
      });

      const cancel = (): void => {
        this.confirmingDiscard = false;
        this.focusAfterRender = "discard";
        this.render();
      };

      const choices = element("div", { class: "actions" });

      choices.append(
        button("discard", "Keep", "discard-cancel", "secondary", cancel),
        button(
          "discard",
          "Delete entry",
          "discard-confirm",
          "primary danger",
          (id) => void this.act({ type: "discard", accountId: id, entryId: running.id }),
        ),
      );

      confirm.addEventListener("keydown", (event) => {
        if (event.key === "Escape") cancel();
      });
      confirm.append(element("p", {}, "Delete this running entry from Clockify?"), choices);
      row.append(stop, save);

      return { row, confirm };
    }

    const discard = button("discard", "Discard…", "discard", "ghost danger", () => {
      this.confirmingDiscard = true;
      this.focusAfterRender = "discard-cancel";
      this.render();
    });

    discard.title = "Delete this running entry";
    row.append(stop, save, discard);

    return { row, confirm: null };
  }
}
