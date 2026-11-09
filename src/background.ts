import { z } from "zod";

import {
  ClockifyError,
  deleteEntry,
  loadAccount,
  loadProjects,
  loadRunningEntry,
  startEntry,
  updateEntry,
} from "./clockify.ts";
import {
  changedMessageSchema,
  pageContextSchema,
  pageRequestSchema,
  requestSchema,
  STORAGE_KEY_ACCOUNT,
  STORAGE_KEY_API_KEY,
} from "./model.ts";

import type { Account, Entry, ProjectCatalog } from "./clockify.ts";
import type { PageContext, Problem, Reply, Request, Snapshot, Timer } from "./model.ts";

const UNRESOLVED_KEY = "unresolvedOperations";
const WIDGET_PAGE = "widget.html";
const LINEAR_ORIGIN = "https://linear.app/";

type Session = { apiKey: string; account: Account; catalog: ProjectCatalog };

type WriteRequest = Extract<Request, { type: "start" | "stop" | "save" | "discard" }>;

let session: Session | null = null;
let lastObservation: { accountId: string; timer: Timer } | null = null;
let epoch = 0;
let writeQueue: Promise<unknown> = Promise.resolve();

/** Bumped after every queued task, so a passive read started before a write is never shared with a view asking after it. */
let generation = 0;
let sharedRead: { generation: number; reply: Promise<Reply> } | null = null;

function timerOf(entry: Entry | null): Timer {
  if (entry === null) return { kind: "idle" };

  return {
    kind: "running",
    entry: {
      id: entry.id,
      description: entry.description ?? "",
      projectId: entry.projectId,
      startedAt: entry.timeInterval.start,
    },
  };
}

function problemOf(error: Error): Problem {
  if (error instanceof ClockifyError) return { kind: error.kind, message: error.message };

  return { kind: "invalid", message: "Something unexpected went wrong." };
}

async function storedKey(): Promise<string | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY_API_KEY);
  const key = stored[STORAGE_KEY_API_KEY];

  return key === undefined || key === null || key === "" ? null : String(key);
}

function accountIdOf(account: Account): string {
  return `${account.workspaceId}/${account.userId}`;
}

async function storedAccountId(): Promise<string | null> {
  const stored = await chrome.storage.local.get(STORAGE_KEY_ACCOUNT);
  const parsed = z.string().min(1).safeParse(stored[STORAGE_KEY_ACCOUNT]);

  return parsed.success ? parsed.data : null;
}

const unresolvedSchema = z.record(z.string(), z.string());

async function storedUnresolved(): Promise<Record<string, string>> {
  const stored = await chrome.storage.local.get(UNRESOLVED_KEY);
  const parsed = unresolvedSchema.safeParse(stored[UNRESOLVED_KEY]);

  return parsed.success ? parsed.data : {};
}

async function unresolvedFor(accountId: string | null): Promise<string | null> {
  if (accountId === null) return null;

  return (await storedUnresolved())[accountId] ?? null;
}

async function setUnresolved(accountId: string, operation: string | null): Promise<void> {
  const { [accountId]: _dropped, ...others } = await storedUnresolved();
  await chrome.storage.local.set({
    [UNRESOLVED_KEY]: operation === null ? others : { ...others, [accountId]: operation },
  });
}

/** Returns null when the credential was replaced mid-read, so a superseded read never writes shared state. */
async function openSession(apiKey: string, readEpoch: number): Promise<Session | null> {
  if (session?.apiKey === apiKey) return session;
  const account = await loadAccount(apiKey);
  const catalog = await loadProjects(apiKey, account);

  if (epoch !== readEpoch) return null;
  await chrome.storage.local.set({ [STORAGE_KEY_ACCOUNT]: accountIdOf(account) });
  session = { apiKey, account, catalog };

  return session;
}

/** Builds the UI's view of Clockify for one credential. A failed read keeps the last observation and says why it is stale. */
async function observe(apiKey: string | null): Promise<{
  snapshot: Snapshot;
  entry: Entry | null;
  error: Problem | null;
  open: Session | null;
}> {
  const readEpoch = epoch;

  if (apiKey === null) {
    session = null;
    lastObservation = null;

    return { snapshot: { connection: "disconnected" }, entry: null, error: null, open: null };
  }

  try {
    const open = await openSession(apiKey, readEpoch);

    if (open === null) return observe(await storedKey());
    const entry = await loadRunningEntry(open.apiKey, open.account);

    if (epoch !== readEpoch) return observe(await storedKey());
    const accountId = accountIdOf(open.account);
    const timer = timerOf(entry);
    lastObservation = { accountId, timer };

    const snapshot: Snapshot = {
      connection: "connected",
      accountId,
      timer,
      ...open.catalog,
      staleReason: null,
      unresolved: await unresolvedFor(accountId),
    };

    return { snapshot, entry, error: null, open };
  } catch (error) {
    if (epoch !== readEpoch) return observe(await storedKey());
    const problem = problemOf(error instanceof Error ? error : new Error());
    const accountId = session === null ? await storedAccountId() : accountIdOf(session.account);
    const cached = lastObservation?.accountId === accountId ? lastObservation.timer : null;

    const snapshot: Snapshot = {
      connection: "connected",
      accountId,
      timer: cached ?? { kind: "unknown" },
      ...(session?.catalog ?? { projects: [], favorites: "unavailable" }),
      staleReason: problem.message,
      unresolved: await unresolvedFor(accountId),
    };

    return { snapshot, entry: null, error: problem, open: null };
  }
}

/** Passive read for polling. It never clears the unresolved marker. */
async function readReply(): Promise<Reply> {
  const { snapshot, error } = await observe(await storedKey());

  return { snapshot, error };
}

/** The user's explicit confirmation that the timer was checked. Runs in the write queue so no write is in flight. */
async function acknowledge(accountId: string): Promise<Reply> {
  const first = await observe(await storedKey());

  if (first.error !== null) return { snapshot: first.snapshot, error: first.error };

  if (first.snapshot.connection !== "connected" || first.snapshot.accountId !== accountId) {
    return { snapshot: first.snapshot, error: staleAccount() };
  }

  await setUnresolved(accountId, null);

  return readReply();
}

async function connect(candidate: string): Promise<Reply> {
  try {
    const account = await loadAccount(candidate);
    const catalog = await loadProjects(candidate, account);
    epoch += 1;
    lastObservation = null;
    await chrome.storage.local.set({
      [STORAGE_KEY_API_KEY]: candidate,
      [STORAGE_KEY_ACCOUNT]: accountIdOf(account),
    });
    session = { apiKey: candidate, account, catalog };

    return readReply();
  } catch (error) {
    const reply = await readReply();

    return {
      snapshot: reply.snapshot,
      error: problemOf(error instanceof Error ? error : new Error()),
    };
  }
}

async function disconnect(): Promise<Reply> {
  epoch += 1;
  await chrome.storage.local.remove([STORAGE_KEY_API_KEY, STORAGE_KEY_ACCOUNT]);
  session = null;
  lastObservation = null;

  return readReply();
}

function describeWrite(request: WriteRequest): string {
  if (request.type === "start") return "Starting a timer";

  return `${request.type === "stop" ? "Stopping" : request.type === "save" ? "Editing" : "Discarding"} entry ${request.entryId}`;
}

function conflict(message: string): Problem {
  return { kind: "conflict", message };
}

function staleAccount(): Problem {
  return conflict("The connected Clockify account changed. Review the timer and try again.");
}

/** Checks the preflight read against what the user acted on, then performs one entry-addressed write. */
async function dispatch(
  open: Session,
  request: WriteRequest,
  running: Entry | null,
): Promise<Problem | null> {
  if (request.type === "start") {
    if (running !== null) return conflict("A timer is already running in Clockify.");
    await startEntry(open.apiKey, open.account, request);

    return null;
  }

  if (running === null || running.id !== request.entryId) {
    return conflict("The running timer changed in Clockify. Review it and try again.");
  }

  if (request.type === "discard") {
    await deleteEntry(open.apiKey, open.account, running.id);

    return null;
  }

  if (request.type === "save" && request.projectId === null && running.projectId !== null) {
    return {
      kind: "rejected",
      message: "Removing a project is not supported here. Change it in Clockify instead.",
    };
  }

  if (request.type === "stop") {
    const stopped = await updateEntry(open.apiKey, open.account, running, {
      description: running.description ?? "",
      projectId: running.projectId,
      end: new Date().toISOString(),
    });

    return stopped.timeInterval.end === null
      ? { kind: "rejected", message: "Clockify did not stop the timer." }
      : null;
  }

  const remote = { description: running.description ?? "", projectId: running.projectId };

  if (
    remote.description !== request.expect.description ||
    remote.projectId !== request.expect.projectId
  ) {
    return conflict("The timer was edited in Clockify. Review it and try again.");
  }

  const saved = await updateEntry(open.apiKey, open.account, running, request);

  if (saved.projectId !== request.projectId) {
    return { kind: "rejected", message: "Clockify did not apply the project change." };
  }

  return null;
}

async function runWrite(request: WriteRequest): Promise<Reply> {
  const apiKey = await storedKey();
  const before = await observe(apiKey);

  if (before.snapshot.connection === "disconnected" || apiKey === null) {
    return {
      snapshot: before.snapshot,
      error: { kind: "auth", message: "Connect Clockify first." },
    };
  }

  const { accountId, unresolved } = before.snapshot;

  if (accountId !== request.accountId) return { snapshot: before.snapshot, error: staleAccount() };

  if (unresolved !== null) {
    return {
      snapshot: before.snapshot,
      error: {
        kind: "blocked",
        message: `${unresolved} may not have finished. Check the timer in Clockify before changing it.`,
      },
    };
  }

  if (before.error !== null || before.open === null) {
    return { snapshot: before.snapshot, error: before.error };
  }

  await setUnresolved(request.accountId, describeWrite(request));
  let problem: Problem | null;

  try {
    problem = await dispatch(before.open, request, before.entry);
  } catch (error) {
    problem = problemOf(error instanceof Error ? error : new Error());
  }

  if (problem?.kind !== "unknown-outcome") await setUnresolved(request.accountId, null);
  const after = await observe(apiKey);

  return { snapshot: after.snapshot, error: problem ?? after.error };
}

/** Every open popup and widget re-reads when told; none of them need to wait for their next poll. */
function announceChange(): void {
  generation += 1;
  chrome.runtime
    .sendMessage(changedMessageSchema.parse({ type: "changed" }))
    .catch(() => undefined);
}

/** Views poll often, so concurrent passive reads share one Clockify request. */
function passiveRead(): Promise<Reply> {
  if (sharedRead !== null && sharedRead.generation === generation) return sharedRead.reply;
  const entry = { generation, reply: readReply() };
  sharedRead = entry;

  const release = (): void => {
    if (sharedRead === entry) sharedRead = null;
  };

  entry.reply.then(release, release);

  return entry.reply;
}

/** Writes, acknowledgements and account changes share one queue so none can interleave with another. */
function enqueue(task: () => Promise<Reply>): Promise<Reply> {
  const result = writeQueue.then(task).finally(announceChange);
  writeQueue = result.catch(() => undefined);

  return result;
}

function handle(request: Request): Promise<Reply> {
  switch (request.type) {
    case "state":
      return passiveRead();
    case "acknowledge":
      return enqueue(() => acknowledge(request.accountId));
    case "connect":
      return enqueue(() => connect(request.apiKey));
    case "disconnect":
      return enqueue(disconnect);
    default:
      return enqueue(() => runWrite(request));
  }
}

function isLinearTab(sender: chrome.runtime.MessageSender): boolean {
  return sender.tab?.url?.startsWith(LINEAR_ORIGIN) === true;
}

/** Only the toolbar popup may manage credentials. Timer requests also come from the widget frame the content script embeds in the top Linear frame. */
function senderMayCall(sender: chrome.runtime.MessageSender, request: Request): boolean {
  if (sender.id !== chrome.runtime.id) return false;

  if (sender.url === chrome.runtime.getURL("popup.html")) return true;
  const managesCredentials = request.type === "connect" || request.type === "disconnect";

  return (
    !managesCredentials &&
    sender.url === chrome.runtime.getURL(WIDGET_PAGE) &&
    sender.tab !== undefined &&
    sender.frameId !== undefined &&
    sender.frameId !== 0 &&
    isLinearTab(sender)
  );
}

/** The widget frame learns the issue and theme from the Linear tab through the background, never from the page's own messages. */
async function pageContext(sender: chrome.runtime.MessageSender): Promise<PageContext | null> {
  if (
    sender.id !== chrome.runtime.id ||
    sender.url !== chrome.runtime.getURL(WIDGET_PAGE) ||
    sender.tab?.id === undefined ||
    !isLinearTab(sender)
  ) {
    return null;
  }

  try {
    const reply: unknown = await chrome.tabs.sendMessage(sender.tab.id, "page", { frameId: 0 });
    const parsed = pageContextSchema.safeParse(reply);

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

chrome.runtime.onMessage.addListener((message: Request, sender, sendResponse) => {
  // Typed for the listener signature only: senders are untrusted, so the schema re-parses it.
  if (pageRequestSchema.safeParse(message).success) {
    void pageContext(sender).then(sendResponse);

    return true;
  }

  const parsed = requestSchema.safeParse(message);

  if (!parsed.success || !senderMayCall(sender, parsed.data)) {
    sendResponse({ rejected: true });

    return false;
  }

  handle(parsed.data).then(sendResponse, () => {
    sendResponse({ rejected: true });
  });

  return true;
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && STORAGE_KEY_API_KEY in changes) {
    epoch += 1;
    session = null;
    announceChange();
  }
});
