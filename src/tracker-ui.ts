import { formatElapsed, issueKey, projectForTitle } from "./model.ts";
import { send } from "./messaging.ts";
import { TRACKER_CSS } from "./tracker-css.ts";

import type {
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

export type TrackerOptions = {
  /** The popup owns credentials; the Linear widget only points to it. */
  manageConnection: boolean;
  minimizable: boolean;
  /** Called after every render with the card's height and whether it is minimized. */
  onLayout?: (layout: { height: number; minimized: boolean }) => void;
};

const REFRESH_INTERVAL_MS = 30_000;

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string> = {},
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
  node.textContent = text;

  return node;
}

export class Tracker {
  private snapshot: Snapshot | null = null;
  private problem: Problem | null = null;
  private issue: Issue | null = null;
  private busy = false;
  private minimized = false;
  private confirmingDiscard = false;
  private readonly drafts = new Map<string, Draft>();
  private readonly card: HTMLElement;
  private readonly host: HTMLElement;
  private elapsed: HTMLElement | null = null;
  private lastRendered = "";
  private readonly timers: number[] = [];

  private readonly options: TrackerOptions;

  constructor(host: HTMLElement, options: TrackerOptions) {
    this.host = host;
    this.options = options;
    this.card = element("section", { class: "card", "data-testid": "tracker" });
    host.append(element("style", {}, TRACKER_CSS), this.card);
    this.timers.push(window.setInterval(() => this.tick(), 1000));
    this.timers.push(
      window.setInterval(() => void this.run({ type: "state" }), REFRESH_INTERVAL_MS),
    );
    void this.run({ type: "state" });
  }

  setIssue(issue: Issue | null): void {
    this.issue = issue;
    this.confirmingDiscard = false;
    this.render();
  }

  setTheme(theme: Theme): void {
    document.documentElement.dataset["theme"] = theme;
  }

  dispose(): void {
    for (const id of this.timers) window.clearInterval(id);
    this.host.replaceChildren();
  }

  private connected(): ConnectedSnapshot | null {
    return this.snapshot?.connection === "connected" ? this.snapshot : null;
  }

  private running(): RunningEntry | null {
    const timer = this.connected()?.timer;

    return timer?.kind === "running" ? timer.entry : null;
  }

  private async run(request: Request): Promise<Reply | null> {
    try {
      const reply = await send(request);
      this.snapshot = reply.snapshot;
      this.problem = reply.error;
      this.render();

      return reply;
    } catch {
      this.problem = { kind: "network", message: "The extension background is not responding." };
      this.render();

      return null;
    }
  }

  private accountId(): string | null {
    return this.connected()?.accountId ?? null;
  }

  private async act(request: Request): Promise<Reply | null> {
    this.busy = true;
    this.confirmingDiscard = false;
    this.render();
    const reply = await this.run(request);
    this.busy = false;
    this.render();

    return reply;
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

    if (this.elapsed === null || running === null) return;
    this.elapsed.textContent = formatElapsed(Date.now() - Date.parse(running.startedAt));
  }

  private render(): void {
    const running = this.running();
    const draft = this.connected() === null ? null : this.draft();

    const signature = JSON.stringify([
      this.snapshot,
      this.problem,
      this.issue,
      this.busy,
      this.minimized,
      this.confirmingDiscard,
      draft,
    ]);

    if (signature === this.lastRendered) return;
    this.lastRendered = signature;
    this.elapsed = null;
    const focused = document.activeElement;
    const focusId = focused?.getAttribute("data-testid");
    const caret = focused instanceof HTMLInputElement ? focused.selectionStart : null;
    this.card.replaceChildren(...this.body(running, draft));

    if (focusId !== null && focusId !== undefined) {
      const restored = this.card.querySelector<HTMLElement>(`[data-testid="${focusId}"]`);
      restored?.focus();

      if (restored instanceof HTMLInputElement && caret !== null) {
        restored.setSelectionRange(caret, caret);
      }
    }

    this.card.classList.toggle("minimized", this.minimized);
    this.tick();
    const box = this.card.getBoundingClientRect();

    this.options.onLayout?.({
      height: Math.ceil(box.height) + 24,
      minimized: this.minimized,
    });
  }

  private body(running: RunningEntry | null, draft: Draft | null): HTMLElement[] {
    if (this.minimized) return [this.minimizedButton(running)];
    const header = element("header");
    header.append(element("strong", {}, "Clockify"));

    if (this.options.minimizable) {
      const minimize = element(
        "button",
        { type: "button", "aria-label": "Minimize", "data-testid": "minimize" },
        "–",
      );

      minimize.addEventListener("click", () => {
        this.minimized = true;
        this.render();
      });
      header.append(minimize);
    }

    const nodes: HTMLElement[] = [header];

    if (this.issue !== null) {
      nodes.push(
        element(
          "p",
          { class: "issue", "data-testid": "issue" },
          `${this.issue.identifier} ${this.issue.title ?? ""}`.trim(),
        ),
      );
    }

    if (this.problem !== null) {
      nodes.push(
        element(
          "p",
          { class: `problem ${this.problem.kind}`, role: "alert", "data-testid": "problem" },
          this.problem.message,
        ),
      );
    }

    const connected = this.connected();

    if (connected === null || draft === null) {
      nodes.push(...this.connectionPanel(connected !== null));

      return nodes;
    }

    if (connected.staleReason !== null) {
      nodes.push(
        element(
          "p",
          { class: "stale", "data-testid": "stale" },
          "Showing the last known timer. Clockify could not be reached.",
        ),
      );
    }

    if (connected.unresolved !== null) {
      nodes.push(this.unresolvedPanel(connected.unresolved));
    }

    nodes.push(this.timerPanel(connected, running, draft));

    if (this.options.manageConnection) nodes.push(this.disconnectButton());

    return nodes;
  }

  private minimizedButton(running: RunningEntry | null): HTMLElement {
    const label = running === null ? "Clockify" : "Timer running";

    const button = element(
      "button",
      { type: "button", class: "bubble", "aria-label": `Expand ${label}`, "data-testid": "expand" },
      running === null ? "⏱" : "●",
    );

    button.addEventListener("click", () => {
      this.minimized = false;
      this.render();
    });

    return button;
  }

  private connectionPanel(hasSnapshot: boolean): HTMLElement[] {
    if (!hasSnapshot && this.snapshot === null) return [element("p", {}, "Loading…")];

    if (!this.options.manageConnection) {
      return [
        element(
          "p",
          { "data-testid": "connect-hint" },
          "Connect Clockify from the extension's toolbar popup.",
        ),
      ];
    }

    const form = element("form", { "data-testid": "connect-form" });
    const label = element("label", {}, "Clockify API key");

    const input = element("input", {
      type: "password",
      name: "apiKey",
      autocomplete: "off",
      required: "",
      "data-testid": "api-key",
    });

    label.append(input);
    const submit = element("button", { type: "submit", "data-testid": "connect" }, "Connect");
    submit.disabled = this.busy;
    form.append(label, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();

      if (!event.isTrusted) return;
      const apiKey = input.value;
      input.value = "";
      void this.act({ type: "connect", apiKey });
    });

    return [form];
  }

  private unresolvedPanel(operation: string): HTMLElement {
    const panel = element("div", { class: "unresolved", "data-testid": "unresolved" });
    panel.append(
      element("p", {}, `${operation} may not have finished. Check Clockify before trying again.`),
    );
    const check = element("button", { type: "button", "data-testid": "recheck" }, "Check Clockify");
    const accountId = this.accountId();
    check.disabled = this.busy || accountId === null;
    check.addEventListener("click", (event) => {
      if (event.isTrusted && accountId !== null) void this.act({ type: "acknowledge", accountId });
    });
    panel.append(check);

    return panel;
  }

  private disconnectButton(): HTMLElement {
    const button = element(
      "button",
      { type: "button", class: "secondary", "data-testid": "disconnect" },
      "Disconnect",
    );

    button.disabled = this.busy;
    button.addEventListener("click", (event) => {
      if (event.isTrusted) void this.act({ type: "disconnect" });
    });

    return button;
  }

  private timerPanel(
    connected: ConnectedSnapshot,
    running: RunningEntry | null,
    draft: Draft,
  ): HTMLElement {
    const panel = element("div", { class: "timer" });

    if (running !== null) {
      this.elapsed = element("p", { class: "elapsed", "data-testid": "elapsed" });
      panel.append(this.elapsed);
    }

    const description = element("input", {
      type: "text",
      "aria-label": "Description",
      "data-testid": "description",
      maxlength: "3000",
    });

    description.value = draft.description;
    description.addEventListener("input", () => {
      draft.description = description.value;
      draft.descriptionTouched = true;
      this.render();
    });
    const project = element("select", { "aria-label": "Project", "data-testid": "project" });
    project.append(element("option", { value: "" }, "No project"));

    for (const entry of connected.projects)
      project.append(element("option", { value: entry.id }, entry.name));
    project.value = draft.projectId ?? "";
    project.addEventListener("change", () => {
      draft.projectId = project.value === "" ? null : project.value;
      draft.projectTouched = true;
      this.render();
    });
    panel.append(description, project);
    panel.append(...this.actions(running, draft, connected));

    return panel;
  }

  private actions(
    running: RunningEntry | null,
    draft: Draft,
    connected: ConnectedSnapshot,
  ): HTMLElement[] {
    const accountId = connected.accountId;

    const blocked =
      this.busy ||
      accountId === null ||
      connected.staleReason !== null ||
      connected.unresolved !== null;

    const button = (
      label: string,
      testId: string,
      onClick: (accountId: string) => void,
      secondary = false,
    ): HTMLButtonElement => {
      const node = element(
        "button",
        { type: "button", "data-testid": testId, class: secondary ? "secondary" : "primary" },
        label,
      );

      node.disabled = blocked;
      node.addEventListener("click", (event) => {
        if (event.isTrusted && accountId !== null) onClick(accountId);
      });

      return node;
    };

    if (running === null) {
      const start = button(
        "Start",
        "start",
        (id) =>
          void this.act({
            type: "start",
            accountId: id,
            description: draft.description,
            projectId: draft.projectId,
          }),
      );

      start.disabled = blocked || connected.timer.kind !== "idle";

      return [start];
    }

    const dirty =
      draft.description !== running.description || draft.projectId !== running.projectId;

    const save = button(
      "Save changes",
      "save",
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

    const stop = button("Stop", "stop", (id) => {
      void this.act({ type: "stop", accountId: id, entryId: running.id });
    });

    const nodes: HTMLElement[] = [stop, save];

    if (this.confirmingDiscard) {
      const confirmation = element("div", {
        class: "confirm",
        role: "group",
        "aria-label": "Confirm discard",
      });

      confirmation.append(
        element("p", {}, "Delete this running entry from Clockify?"),
        button(
          "Delete entry",
          "discard-confirm",
          (id) => void this.act({ type: "discard", accountId: id, entryId: running.id }),
        ),
        button(
          "Keep",
          "discard-cancel",
          () => {
            this.confirmingDiscard = false;
            this.render();
          },
          true,
        ),
      );
      nodes.push(confirmation);
    } else {
      nodes.push(
        button(
          "Discard…",
          "discard",
          () => {
            this.confirmingDiscard = true;
            this.render();
          },
          true,
        ),
      );
    }

    return nodes;
  }
}
