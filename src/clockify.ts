import { z } from "zod";

import type { ProblemKind, Project } from "./model.ts";

const API_BASE = "https://api.clockify.me/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const PROJECT_PAGE_SIZE = 100;
const PROJECT_PAGE_LIMIT = 20;

export class ClockifyError extends Error {
  readonly kind: ProblemKind;

  constructor(kind: ProblemKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const userSchema = z.object({
  id: z.string().min(1),
  activeWorkspace: z.string().min(1).optional(),
  defaultWorkspace: z.string().min(1).optional(),
});

const optionalNull = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v) => v ?? null);

const entrySchema = z.object({
  id: z.string().min(1),
  description: optionalNull(z.string()),
  projectId: optionalNull(z.string().min(1)),
  taskId: optionalNull(z.string().min(1)),
  billable: z.boolean().optional(),
  tagIds: optionalNull(z.array(z.string())),
  type: z.string().optional(),
  userId: z.string().min(1),
  customFieldValues: optionalNull(z.array(z.object({}).passthrough())),
  timeInterval: z.object({ start: z.string().min(1), end: optionalNull(z.string()) }),
});

const projectsSchema = z.array(z.object({ id: z.string().min(1), name: z.string() }));
const entriesSchema = z.array(entrySchema);
const nothingSchema = z.null();

export type Entry = z.infer<typeof entrySchema>;

export type Account = { userId: string; workspaceId: string };

/** Writable time-entry fields from Clockify's documented create and update schemas. */
export type EntryBody = {
  start?: string;
  end?: string;
  description?: string;
  projectId?: string;
  taskId?: string;
  billable?: boolean;
  tagIds?: string[];
  type?: string;
};

type Method = "GET" | "POST" | "PUT" | "DELETE";

type Call<T> = {
  apiKey: string;
  method: Method;
  path: string;
  body?: EntryBody;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
};

/** Reads fail definitively; a failed write may or may not have reached Clockify. */
async function call<T>(request: Call<T>): Promise<T> {
  const isWrite = request.method !== "GET";
  const uncertain = isWrite ? "unknown-outcome" : undefined;
  const headers = new Headers({ "X-Api-Key": request.apiKey });

  if (request.body !== undefined) headers.set("Content-Type", "application/json");
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${request.path}`, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new ClockifyError(uncertain ?? "network", "Could not reach Clockify.");
  }

  if (response.status === 401 || response.status === 403) {
    throw new ClockifyError("auth", "Clockify rejected the API key.");
  }

  if (response.status === 429) {
    throw new ClockifyError("rate-limit", "Clockify is rate limiting requests. Try again shortly.");
  }

  if (response.status >= 500) {
    throw new ClockifyError(uncertain ?? "network", `Clockify returned HTTP ${response.status}.`);
  }

  if (!response.ok) {
    throw new ClockifyError("rejected", `Clockify rejected the request (HTTP ${response.status}).`);
  }

  try {
    const payload = response.status === 204 ? null : await response.json();

    return request.schema.parse(payload);
  } catch {
    throw new ClockifyError(
      uncertain ?? "invalid",
      "Clockify sent a response this extension does not understand.",
    );
  }
}

export async function loadAccount(apiKey: string): Promise<Account> {
  const user = await call({ apiKey, method: "GET", path: "/user", schema: userSchema });
  const workspaceId = user.activeWorkspace ?? user.defaultWorkspace;

  if (workspaceId === undefined) {
    throw new ClockifyError("invalid", "Clockify did not report a workspace for this user.");
  }

  return { userId: user.id, workspaceId };
}

export async function loadProjects(apiKey: string, account: Account): Promise<Project[]> {
  const projects: Project[] = [];

  for (let page = 1; page <= PROJECT_PAGE_LIMIT; page += 1) {
    const path = `/workspaces/${account.workspaceId}/projects?archived=false&page=${page}&page-size=${PROJECT_PAGE_SIZE}`;
    const batch = await call({ apiKey, method: "GET", path, schema: projectsSchema });
    projects.push(...batch);

    if (batch.length < PROJECT_PAGE_SIZE) break;
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadRunningEntry(apiKey: string, account: Account): Promise<Entry | null> {
  const path = `/workspaces/${account.workspaceId}/user/${account.userId}/time-entries?in-progress=true&page-size=10`;
  const entries = await call({ apiKey, method: "GET", path, schema: entriesSchema });
  const running = entries.filter((entry) => entry.timeInterval.end === null);
  running.sort((a, b) => b.timeInterval.start.localeCompare(a.timeInterval.start));

  return running[0] ?? null;
}

export type EntryChange = { description: string; projectId: string | null; end?: string };

/**
 * Builds the documented PUT /time-entries/{id} body from the fields the schema lists as writable.
 * Entries with custom field values or non-regular types are refused because their PUT semantics
 * are not documented well enough to prove they would be preserved.
 */
export function buildEntryUpdate(entry: Entry, change: EntryChange): EntryBody {
  if (entry.type !== undefined && entry.type !== "REGULAR" && entry.type !== "BREAK") {
    throw new ClockifyError("blocked", "This entry type cannot be changed from the extension.");
  }

  if (entry.customFieldValues !== null && entry.customFieldValues.length > 0) {
    throw new ClockifyError(
      "blocked",
      "This entry has custom fields. Change it in Clockify instead.",
    );
  }

  const body: EntryBody = { start: entry.timeInterval.start, description: change.description };

  if (change.projectId !== null) body.projectId = change.projectId;

  if (entry.taskId !== null && change.projectId === entry.projectId) body.taskId = entry.taskId;

  if (entry.billable !== undefined) body.billable = entry.billable;

  if (entry.tagIds !== null) body.tagIds = entry.tagIds;

  if (entry.type !== undefined) body.type = entry.type;

  if (change.end !== undefined) body.end = change.end;

  return body;
}

export async function startEntry(
  apiKey: string,
  account: Account,
  draft: { description: string; projectId: string | null },
): Promise<Entry> {
  const body: EntryBody = { start: new Date().toISOString(), description: draft.description };

  if (draft.projectId !== null) body.projectId = draft.projectId;
  const path = `/workspaces/${account.workspaceId}/time-entries`;

  return call({ apiKey, method: "POST", path, body, schema: entrySchema });
}

export async function updateEntry(
  apiKey: string,
  account: Account,
  entry: Entry,
  change: EntryChange,
): Promise<Entry> {
  const body = buildEntryUpdate(entry, change);
  const path = `/workspaces/${account.workspaceId}/time-entries/${entry.id}`;

  return call({ apiKey, method: "PUT", path, body, schema: entrySchema });
}

export async function deleteEntry(
  apiKey: string,
  account: Account,
  entryId: string,
): Promise<void> {
  const path = `/workspaces/${account.workspaceId}/time-entries/${entryId}`;
  await call({ apiKey, method: "DELETE", path, schema: nothingSchema });
}
