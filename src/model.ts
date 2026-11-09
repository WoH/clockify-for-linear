import { z } from "zod";

/** `favorite` is the user's own Clockify favorite flag; `color` is Clockify's CSS color for the project. */
export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.string().nullable(),
  clientName: z.string().nullable(),
  favorite: z.boolean(),
});

/** Whether `favorite` flags are real. Clockify's favorites come from an undocumented endpoint that may fail on its own. */
export const favoritesSchema = z.enum(["loaded", "unavailable"]);

export const runningEntrySchema = z.object({
  id: z.string().min(1),
  description: z.string(),
  projectId: z.string().min(1).nullable(),
  startedAt: z.string().min(1),
});

export const timerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }),
  z.object({ kind: z.literal("idle") }),
  z.object({ kind: z.literal("running"), entry: runningEntrySchema }),
]);

export const snapshotSchema = z.discriminatedUnion("connection", [
  z.object({ connection: z.literal("disconnected") }),
  z.object({
    connection: z.literal("connected"),
    accountId: z.string().min(1).nullable(),
    timer: timerSchema,
    projects: z.array(projectSchema),
    favorites: favoritesSchema,
    staleReason: z.string().nullable(),
    unresolved: z.string().nullable(),
  }),
]);

export const problemKindSchema = z.enum([
  "auth",
  "network",
  "rate-limit",
  "conflict",
  "unknown-outcome",
  "rejected",
  "blocked",
  "invalid",
]);

export const replySchema = z.object({
  snapshot: snapshotSchema,
  error: z.object({ kind: problemKindSchema, message: z.string() }).nullable(),
});

const descriptionSchema = z.string().max(3000);
const projectIdSchema = z.string().min(1).nullable();
const entryIdSchema = z.string().min(1);
const accountIdSchema = z.string().min(1);

export const requestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("state") }),
  z.object({ type: z.literal("acknowledge"), accountId: accountIdSchema }),
  z.object({ type: z.literal("connect"), apiKey: z.string().trim().min(1).max(200) }),
  z.object({ type: z.literal("disconnect") }),
  z.object({
    type: z.literal("start"),
    accountId: accountIdSchema,
    description: descriptionSchema,
    projectId: projectIdSchema,
  }),
  z.object({ type: z.literal("stop"), accountId: accountIdSchema, entryId: entryIdSchema }),
  z.object({
    type: z.literal("save"),
    accountId: accountIdSchema,
    entryId: entryIdSchema,
    description: descriptionSchema,
    projectId: projectIdSchema,
    expect: z.object({ description: z.string(), projectId: projectIdSchema }),
  }),
  z.object({ type: z.literal("discard"), accountId: accountIdSchema, entryId: entryIdSchema }),
]);

export const themeSchema = z.enum(["light", "dark"]);

export const pageRequestSchema = z.object({ type: z.literal("page") });

export const issueSchema = z.object({
  workspace: z.string().min(1),
  identifier: z.string().min(1),
  title: z.string().nullable(),
});

/** The only message the widget frame sends to the Linear page. It carries no Clockify data. */
export const layoutMessageSchema = z.object({
  type: z.literal("layout"),
  minimized: z.boolean(),
  height: z.number().int().min(40).max(600),
});

/** The Linear tab as the content script reports it to extension pages. `attention` counts focus and visibility returns so views can refresh. */
export const pageContextSchema = z.object({
  issue: issueSchema.nullable(),
  theme: themeSchema,
  attention: z.number().int().min(0),
});

/** Sent by the background to extension views after any account or timer write, so every open view re-reads. */
export const changedMessageSchema = z.object({ type: z.literal("changed") });

export type Project = z.infer<typeof projectSchema>;

export type Favorites = z.infer<typeof favoritesSchema>;

export type RunningEntry = z.infer<typeof runningEntrySchema>;

export type Timer = z.infer<typeof timerSchema>;

export type Snapshot = z.infer<typeof snapshotSchema>;

export type ConnectedSnapshot = Extract<Snapshot, { connection: "connected" }>;

export type Reply = z.infer<typeof replySchema>;

export type Problem = NonNullable<Reply["error"]>;

export type ProblemKind = z.infer<typeof problemKindSchema>;

export type Request = z.infer<typeof requestSchema>;

export type Issue = z.infer<typeof issueSchema>;

export type Theme = z.infer<typeof themeSchema>;

export type LayoutMessage = z.infer<typeof layoutMessageSchema>;

export type PageContext = z.infer<typeof pageContextSchema>;

export type ChangedMessage = z.infer<typeof changedMessageSchema>;

export const STORAGE_KEY_API_KEY = "clockifyApiKey";

export const STORAGE_KEY_ACCOUNT = "clockifyAccount";

export function issueKey(issue: Issue): string {
  return `${issue.workspace}/${issue.identifier}`;
}

export function parseIssuePath(pathname: string): Pick<Issue, "workspace" | "identifier"> | null {
  const match = /^\/([^/]+)\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:\/|$)/u.exec(pathname);

  if (match === null) return null;
  const [, workspace, identifier] = match;

  if (workspace === undefined || identifier === undefined) return null;

  return { workspace, identifier: identifier.toUpperCase() };
}

/** Linear titles reach us as `ENG-12 Title - Linear`; the identifier and product suffix are not the title. */
export function titleFromDocumentTitle(documentTitle: string, identifier: string): string | null {
  const prefix = `${identifier} `;

  if (!documentTitle.toUpperCase().startsWith(prefix)) return null;

  const title = documentTitle
    .slice(prefix.length)
    .replace(/(?:^|\s+)[-–—|]\s+Linear$/u, "")
    .trim();

  return title === "" ? null : title;
}

/** A project is suggested only when exactly one project is named by the title's code. */
export function projectForTitle<P extends Pick<Project, "name">>(
  title: string | null,
  projects: readonly P[],
): P | null {
  if (title === null) return null;
  const leading = /^([A-Za-z]+\d+)(?![A-Za-z0-9])/u.exec(title);
  const parenthesised = /\(([A-Za-z]+\d+)\)/u.exec(title);
  const code = (leading?.[1] ?? parenthesised?.[1])?.toUpperCase();

  if (code === undefined) return null;

  const matches = projects.filter((project) => {
    const name = project.name.trim().toUpperCase();

    return name === code || new RegExp(`^${code}[^A-Z0-9]`, "u").test(name);
  });

  return matches.length === 1 ? (matches[0] ?? null) : null;
}

export function formatElapsed(milliseconds: number): string {
  const total = Math.max(0, Math.floor(milliseconds / 1000));
  const parts = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];

  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}
