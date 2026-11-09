import { element, svg } from "./dom.ts";

import type { Favorites, Project } from "./model.ts";

/** One row of the list: a project, or `null` for "No project". */
type Choice = Project | null;

type Row = { choice: Choice; node: HTMLElement };

const NO_PROJECT_KEY = "none";

const ICONS = {
  check:
    '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>',
  chevron:
    '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 4.5 3 3 3-3"/></svg>',
  folder:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M2 4.5c0-.55.45-1 1-1h3.2l1.4 1.5H13c.55 0 1 .45 1 1v6c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1v-7.5Z"/></svg>',
  search:
    '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><circle cx="7" cy="7" r="4.25"/><path d="m10.25 10.25 3 3"/></svg>',
  star: '<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2l-3.9 2.2.9-4.3-3.3-3 4.4-.5L8 1.6Z"/></svg>',
} as const;

let instances = 0;

function keyOf(choice: Choice): string {
  return choice === null ? NO_PROJECT_KEY : choice.id;
}

/** Case- and accent-insensitive, so "cafe" finds "Café". */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The project's mark: a star for a Clockify favorite, a dot otherwise, both in the project's color. */
function mark(project: Project): HTMLElement {
  const node = element("span", { class: project.favorite ? "mark star" : "mark dot" });

  if (project.favorite) node.append(svg(ICONS.star));

  // Assigned through the CSSOM, which drops anything that is not a color, so Clockify data cannot inject CSS.
  if (project.color !== null) node.style.color = project.color;

  return node;
}

/**
 * A searchable project field (an ARIA 1.2 combobox with a listbox). Click it or start typing to
 * search by project or client name; arrows move, Enter chooses, Escape and Tab leave the choice
 * as it was. Clockify favorites are listed first. Text that matches nothing never becomes a choice.
 *
 * The caller owns the chosen project id and hears about changes through `onChoose`. The query,
 * open state and highlighted row live here, so re-rendering around the same instance, or calling
 * `show` on every background refresh, never loses what the user is typing.
 */
export class ProjectPicker {
  /** Keep this node across renders; the field's query and open state live in it. */
  readonly root: HTMLElement;
  private readonly input: HTMLInputElement;
  private readonly leading: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly note: HTMLElement;
  private readonly list: HTMLElement;
  private readonly empty: HTMLElement;
  private readonly onChoose: (projectId: string | null) => void;
  private readonly id = `project-picker-${(instances += 1)}`;
  private projects: readonly Project[] = [];
  private favorites: Favorites = "loaded";
  private projectId: string | null = null;
  private open = false;
  /** Rows currently in the list, in display order. */
  private rows: Row[] = [];
  private activeKey: string | null = null;
  /** The list's scroll offset, read before each repaint because a re-render that detaches the field resets it. */
  private listScroll = 0;

  constructor(label: string, onChoose: (projectId: string | null) => void) {
    this.onChoose = onChoose;
    this.root = element("div", { class: "picker" });

    this.input = element("input", {
      id: `${this.id}-input`,
      type: "text",
      role: "combobox",
      "aria-autocomplete": "list",
      "aria-expanded": "false",
      "aria-controls": `${this.id}-list`,
      autocomplete: "off",
      spellcheck: "false",
      "data-testid": "project",
    });

    this.leading = element("span", { class: "picker-leading", "aria-hidden": "true" });
    const chevron = element("span", { class: "picker-chevron", "aria-hidden": "true" });
    chevron.append(svg(ICONS.chevron));
    const field = element("div", { class: "picker-field" });
    field.append(this.leading, this.input, chevron);

    this.note = element("p", { id: `${this.id}-note`, class: "picker-note" });
    this.list = element("div", {
      id: `${this.id}-list`,
      role: "listbox",
      "aria-label": "Projects",
      class: "picker-list",
      "data-testid": "project-list",
    });

    this.empty = element("p", { class: "picker-empty", role: "status" });
    this.panel = element("div", { class: "picker-panel", hidden: "" });
    this.panel.append(this.note, this.list, this.empty);
    this.root.append(element("label", { for: this.input.id }, label), field, this.panel);

    this.input.addEventListener("click", () => this.setOpen(true));
    this.input.addEventListener("input", () => {
      // Text that reached a closed field (a paste, an IME) is kept as the query.
      const query = this.input.value;
      this.setOpen(true);
      this.input.value = query;
      this.activeKey = null;
      this.paint();
    });
    this.input.addEventListener("keydown", (event) => this.onKey(event));
    // A re-render may detach and re-focus the field; only a focus that stays away closes the list.
    this.input.addEventListener("blur", () => {
      window.setTimeout(() => {
        if (document.activeElement !== this.input) this.setOpen(false);
      });
    });

    chevron.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      this.input.focus();
      this.setOpen(!this.open);
    });

    // Pressing a row must not blur the field, or the list would close before the click lands.
    // Firefox still moves focus on mousedown after a cancelled pointerdown, so both are cancelled.
    this.panel.addEventListener("pointerdown", (event) => event.preventDefault());
    this.panel.addEventListener("mousedown", (event) => event.preventDefault());
    this.list.addEventListener("click", (event) => {
      const row = this.rowAt(event.target);

      if (row !== undefined) this.choose(row.choice);
    });
    this.list.addEventListener("pointermove", (event) => {
      const row = this.rowAt(event.target);

      if (row !== undefined && keyOf(row.choice) !== this.activeKey) this.highlight(row, false);
    });
  }

  /** Shows these projects (already in display order) and this choice. Safe to call on every render. */
  show(projects: readonly Project[], favorites: Favorites, projectId: string | null): void {
    this.projects = projects;
    this.favorites = favorites;
    this.projectId = projectId;
    this.paint();
  }

  private chosen(): Project | undefined {
    return this.projects.find((project) => project.id === this.projectId);
  }

  /** The closed field's text. A name shared by several projects also shows the client, so the choice is unambiguous. */
  private chosenName(): string {
    if (this.projectId === null) return "";
    const chosen = this.chosen();

    if (chosen === undefined) return "Project not in your list";
    const shared = this.projects.some((p) => p !== chosen && p.name === chosen.name);

    return shared && chosen.clientName !== null
      ? `${chosen.name} · ${chosen.clientName}`
      : chosen.name;
  }

  private setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.activeKey = null;
    this.listScroll = 0;
    // Opening starts an empty search with the current project as the placeholder; closing shows the choice again.
    this.input.value = open ? "" : this.chosenName();
    this.paint();
  }

  private choose(choice: Choice): void {
    const projectId = choice === null ? null : choice.id;
    const changed = projectId !== this.projectId;
    this.projectId = projectId;
    this.setOpen(false);

    if (changed) this.onChoose(projectId);
  }

  private onKey(event: KeyboardEvent): void {
    // Typing into the closed field starts a fresh search instead of editing the chosen name.
    if (!this.open && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      this.setOpen(true);

      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();

      if (!this.open) {
        this.setOpen(true);

        return;
      }

      this.move(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Home" || event.key === "End") {
      if (!this.open) return;
      event.preventDefault();
      this.move(event.key === "Home" ? -Infinity : Infinity);
    } else if (event.key === "Enter") {
      // Enter never submits the form from here, so a mistyped project cannot start or save a timer.
      event.preventDefault();

      if (!this.open) {
        this.setOpen(true);

        return;
      }

      const active = this.rows.find((row) => keyOf(row.choice) === this.activeKey);

      if (active !== undefined) this.choose(active.choice);
    } else if (event.key === "Escape" && this.open) {
      event.preventDefault();
      event.stopPropagation();
      this.setOpen(false);
    } else if (event.key === "Tab") {
      this.setOpen(false);
    }
  }

  private move(step: number): void {
    if (this.rows.length === 0) return;
    const current = this.rows.findIndex((row) => keyOf(row.choice) === this.activeKey);
    const next = Math.min(this.rows.length - 1, Math.max(0, current + step));
    const row = this.rows[Number.isFinite(next) ? next : 0];

    if (row !== undefined) this.highlight(row, true);
  }

  private rowAt(target: EventTarget | null): Row | undefined {
    const node = target instanceof Element ? target.closest('[role="option"]') : null;

    return this.rows.find((row) => row.node === node);
  }

  private highlight(row: Row, reveal: boolean): void {
    for (const other of this.rows) other.node.setAttribute("aria-selected", "false");
    row.node.setAttribute("aria-selected", "true");
    this.activeKey = keyOf(row.choice);
    this.input.setAttribute("aria-activedescendant", row.node.id);

    if (reveal) this.scroll(row.node);
  }

  /**
   * Restores the list's scroll, then brings `node` into view if given. It waits for the current
   * task's render to re-attach the field, since a detached list has no layout and loses its scroll.
   * It scrolls only the list: scrollIntoView could also scroll the Linear page around the frame.
   */
  private scroll(node: HTMLElement | null): void {
    queueMicrotask(() => {
      if (!this.open || !this.list.isConnected) return;
      this.list.scrollTop = this.listScroll;

      if (node !== null && node.isConnected) this.reveal(node);
    });
  }

  private reveal(node: HTMLElement): void {
    const top = node.offsetTop;
    const bottom = top + node.offsetHeight;

    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (bottom > this.list.scrollTop + this.list.clientHeight) {
      this.list.scrollTop = bottom - this.list.clientHeight;
    }
  }

  /** Projects whose name or client contains the query; every project for an empty query. */
  private matching(query: string): Project[] {
    const folded = fold(query);

    return this.projects.filter((project) =>
      fold(`${project.name} ${project.clientName ?? ""}`).includes(folded),
    );
  }

  private paint(): void {
    if (this.list.isConnected) this.listScroll = this.list.scrollTop;
    const chosen = this.chosen();
    this.input.setAttribute("aria-expanded", String(this.open));
    this.input.placeholder = this.open
      ? this.projectId === null
        ? "Search projects"
        : this.chosenName()
      : "No project";

    // A closed field holds no query, so it always shows the choice, including one Clockify changed.
    if (!this.open) this.input.value = this.chosenName();

    this.leading.replaceChildren();

    if (this.open) this.leading.append(svg(ICONS.search));
    else if (chosen !== undefined) this.leading.append(mark(chosen));
    else this.leading.append(svg(ICONS.folder));

    const unavailable = this.favorites === "unavailable";
    this.note.hidden = !unavailable;
    this.note.textContent = unavailable
      ? "Favorites could not be loaded from Clockify, so projects are listed by name."
      : "";

    if (unavailable) this.input.setAttribute("aria-describedby", this.note.id);
    else this.input.removeAttribute("aria-describedby");

    this.panel.hidden = !this.open;
    this.rows = [];

    if (!this.open) {
      this.list.replaceChildren();
      this.input.removeAttribute("aria-activedescendant");

      return;
    }

    // "No project" is offered only before a search, then favorites in their own group, then the rest.
    const query = this.input.value.trim();
    const found = this.matching(query);
    const favorites = found.filter((project) => project.favorite);
    const others = found.filter((project) => !project.favorite);
    const groups: HTMLElement[] = [];

    if (query === "") groups.push(this.row(null));

    if (favorites.length === 0) {
      groups.push(...others.map((project) => this.row(project)));
    } else {
      groups.push(this.group("Favorites", favorites));

      if (others.length > 0) groups.push(this.group("Projects", others));
    }

    this.list.replaceChildren(...groups);
    this.list.hidden = this.rows.length === 0;
    this.empty.hidden = this.rows.length > 0;
    this.empty.textContent = this.rows.length > 0 ? "" : `No projects match “${query}”.`;

    const previous = this.activeKey;

    const active =
      this.rows.find((row) => keyOf(row.choice) === this.activeKey) ??
      (query === ""
        ? this.rows.find((row) => keyOf(row.choice) === (this.projectId ?? NO_PROJECT_KEY))
        : undefined) ??
      this.rows[0];

    if (active === undefined) {
      this.activeKey = null;
      this.input.removeAttribute("aria-activedescendant");
    } else {
      // A repaint that keeps the highlight (a background refresh) keeps the user's scroll too.
      this.highlight(active, false);
      this.scroll(keyOf(active.choice) === previous ? null : active.node);
    }
  }

  private group(title: string, projects: Project[]): HTMLElement {
    const heading = element("p", {
      id: `${this.id}-${title.toLowerCase()}`,
      class: "picker-group",
      role: "presentation",
    });

    heading.textContent = title;
    const group = element("div", { role: "group", "aria-labelledby": heading.id });
    group.append(heading, ...projects.map((project) => this.row(project)));

    return group;
  }

  private row(choice: Choice): HTMLElement {
    const node = element("div", {
      id: `${this.id}-option-${this.rows.length}`,
      role: "option",
      class: "picker-option",
      "aria-selected": "false",
    });

    const current = keyOf(choice) === (this.projectId ?? NO_PROJECT_KEY);

    if (choice === null) {
      node.classList.add("none");
      const icon = element("span", { class: "mark" });
      icon.append(svg(ICONS.folder));
      node.append(icon, element("span", { class: "picker-name" }, "No project"));
    } else {
      node.append(mark(choice), element("span", { class: "picker-name" }, choice.name));

      if (choice.clientName !== null && choice.clientName !== "") {
        node.append(element("span", { class: "picker-client" }, choice.clientName));
        // The visual separator is drawn by CSS; screen readers hear "name, client".
        node.setAttribute("aria-label", `${choice.name}, ${choice.clientName}`);
      }
    }

    if (current) {
      node.dataset["current"] = "";
      const check = element("span", { class: "picker-check" });
      check.append(svg(ICONS.check));
      node.append(check);
    }

    this.rows.push({ choice, node });

    return node;
  }
}
