import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export const SYNTHETIC_KEY = "synthetic-test-key-not-a-real-credential";

const CLOCKIFY_HOST = "api.clockify.me";
const CLOCKIFY_APP_HOST = "app.clockify.me";
const LINEAR_HOST = "linear.app";

export const SECOND_KEY = "second-synthetic-key-not-a-real-credential";

const ACCOUNTS = new Map([
  [SYNTHETIC_KEY, { userId: "user-1", workspaceId: "ws-1" }],
  [SECOND_KEY, { userId: "user-2", workspaceId: "ws-2" }],
]);

export type FakeProject = { id: string; name: string; color: string; clientName: string | null };

export type FakeEntry = {
  id: string;
  description: string;
  projectId: string | null;
  taskId: string | null;
  billable: boolean;
  tagIds: string[];
  type: string;
  userId: string;
  customFieldValues: never[];
  timeInterval: { start: string; end: string | null };
};

const bodySchema = z
  .object({
    start: z.string().optional(),
    end: z.string().optional(),
    description: z.string().optional(),
    projectId: z.string().optional(),
    taskId: z.string().optional(),
    billable: z.boolean().optional(),
    tagIds: z.array(z.string()).optional(),
    type: z.string().optional(),
  })
  .strict();

type RequestBody = z.infer<typeof bodySchema>;

export type LoggedRequest = {
  host: string;
  method: string;
  path: string;
  body: RequestBody | null;
  apiKey: string | null;
};

/** What the next matching request should do instead of behaving normally. */
type Fault = {
  method: string;
  pathPattern: RegExp;
  status: number | "drop";
  applyWrite: boolean;
  times?: number;
  delayMs?: number;
};

export class FakeWorld {
  readonly requests: LoggedRequest[] = [];
  readonly blockedConnections: string[] = [];
  entries: FakeEntry[] = [];
  projects: FakeProject[] = [
    { id: "proj-au", name: "AU1002440", color: "#0ea5e9", clientName: "Acme" },
    { id: "proj-other", name: "Internal", color: "#f97316", clientName: null },
  ];

  /** Project ids the fake user starred in Clockify, served by the web-app project picker endpoint. */
  favoriteIds: string[] = [];
  proxyUrl = "";
  certificatePem = "";
  private nextId = 1;
  private readonly faults: Fault[] = [];
  private readonly servers: { close: () => void }[] = [];

  failNext(fault: Fault): void {
    this.faults.push(fault);
  }

  clearFaults(): void {
    this.faults.length = 0;
  }

  seedRunning(description: string, projectId: string | null, userId = "user-1"): FakeEntry {
    const entry = this.newEntry(
      description,
      projectId,
      new Date(Date.now() - 65_000).toISOString(),
      userId,
    );

    this.entries.push(entry);

    return entry;
  }

  mutations(): LoggedRequest[] {
    return this.requests.filter((request) => request.method !== "GET");
  }

  async start(): Promise<void> {
    const directory = mkdtempSync(join(tmpdir(), "clockify-for-linear-cert-"));
    const keyFile = join(directory, "key.pem");
    const certFile = join(directory, "cert.pem");
    execFileSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=fake",
        "-addext",
        `subjectAltName=DNS:${CLOCKIFY_HOST},DNS:${CLOCKIFY_APP_HOST},DNS:${LINEAR_HOST}`,
        "-keyout",
        keyFile,
        "-out",
        certFile,
      ],
      { stdio: "ignore" },
    );
    this.certificatePem = readFileSync(certFile, "utf8");

    const tls = createTlsServer(
      { key: readFileSync(keyFile), cert: this.certificatePem },
      (request, response) => void this.route(request, response),
    );

    // A dropped fault or a closing browser resets sockets; that is expected, not a test failure.
    tls.on("secureConnection", (socket) => socket.on("error", () => undefined));
    tls.on("tlsClientError", () => undefined);
    await new Promise<void>((resolve) => tls.listen(0, "127.0.0.1", resolve));
    // SAFETY: a server listening on a TCP port reports an AddressInfo, not a pipe path.
    const tlsPort = (tls.address() as AddressInfo).port;

    const proxy = createHttpServer((_, response) => {
      response.writeHead(403).end();
    });

    proxy.on("connection", (socket) => socket.on("error", () => undefined));
    proxy.on("clientError", (_, socket) => socket.destroy());
    proxy.on("connect", (request, socket) => {
      socket.on("error", () => undefined);
      const [host = ""] = (request.url ?? "").split(":");

      if (host !== CLOCKIFY_HOST && host !== CLOCKIFY_APP_HOST && host !== LINEAR_HOST) {
        this.blockedConnections.push(request.url ?? "");
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");

        return;
      }

      const upstream = connect(tlsPort, "127.0.0.1", () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        upstream.pipe(socket);
        socket.pipe(upstream);
      });

      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
    });
    await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
    // SAFETY: a server listening on a TCP port reports an AddressInfo, not a pipe path.
    this.proxyUrl = `127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    this.servers.push(
      { close: () => tls.closeAllConnections() },
      { close: () => tls.close() },
      { close: () => proxy.closeAllConnections() },
      { close: () => proxy.close() },
    );
  }

  stop(): void {
    for (const server of this.servers) server.close();
  }

  private newEntry(
    description: string,
    projectId: string | null,
    start: string,
    userId: string,
  ): FakeEntry {
    const id = `entry-${this.nextId}`;
    this.nextId += 1;

    return {
      id,
      description,
      projectId,
      taskId: null,
      billable: false,
      tagIds: [],
      type: "REGULAR",
      userId,
      customFieldValues: [],
      timeInterval: { start, end: null },
    };
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const host = (request.headers.host ?? "").split(":")[0];

    if (host === LINEAR_HOST) {
      this.serveLinear(request, response);

      return;
    }

    const chunks: Buffer[] = [];

    for await (const chunk of request) chunks.push(Buffer.from(chunk));

    const text = Buffer.concat(chunks).toString("utf8");

    const parsedBody =
      text === "" ? { success: true as const, data: null } : bodySchema.safeParse(JSON.parse(text));

    if (!parsedBody.success) {
      response.writeHead(400).end("{}");

      return;
    }

    const body = parsedBody.data;
    const apiKeyHeader = request.headers["x-api-key"];
    const apiKey = apiKeyHeader === undefined ? null : String(apiKeyHeader);
    const path = request.url ?? "";
    const method = request.method ?? "GET";
    this.requests.push({ host: host ?? "", method, path, body, apiKey });
    const fault = this.takeFault(method, path);

    if (fault?.delayMs !== undefined) await new Promise((r) => setTimeout(r, fault.delayMs));

    if (fault?.status === "drop") {
      if (fault.applyWrite) this.apply(method, path, body, apiKey);
      request.socket.destroy();

      return;
    }

    if (fault?.status === 200) {
      const delayed = this.apply(method, path, body, apiKey);
      response
        .writeHead(delayed?.status ?? 204, { "content-type": "application/json" })
        .end(JSON.stringify(delayed?.json ?? {}));

      return;
    }

    if (fault !== undefined && !fault.applyWrite) {
      response.writeHead(fault.status).end("{}");

      return;
    }

    if (apiKey === null || !ACCOUNTS.has(apiKey)) {
      response.writeHead(401, { "content-type": "application/json" }).end("{}");

      return;
    }

    const result = this.apply(method, path, body, apiKey);

    if (fault !== undefined) {
      response.writeHead(fault.status).end("{}");

      return;
    }

    if (result === undefined) {
      response.writeHead(204).end();

      return;
    }

    response
      .writeHead(result.status, { "content-type": "application/json" })
      .end(JSON.stringify(result.json));
  }

  private takeFault(method: string, path: string): Fault | undefined {
    const index = this.faults.findIndex(
      (fault) => fault.method === method && fault.pathPattern.test(path),
    );

    const fault = this.faults[index];

    if (fault === undefined) return undefined;
    const remaining = (fault.times ?? 1) - 1;

    if (remaining > 0) fault.times = remaining;
    else this.faults.splice(index, 1);

    return fault;
  }

  private apply(
    method: string,
    path: string,
    body: RequestBody | null,
    apiKey: string | null,
  ): { status: number; json: object } | undefined {
    const base = "/api/v1";
    const account = ACCOUNTS.get(apiKey ?? "") ?? { userId: "", workspaceId: "" };
    const { userId, workspaceId } = account;

    if (method === "GET" && path === `${base}/user`) {
      return {
        status: 200,
        json: { id: userId, activeWorkspace: workspaceId, defaultWorkspace: workspaceId },
      };
    }

    const page = new URL(path, "https://x").searchParams.get("page");

    if (method === "GET" && path.startsWith(`${base}/workspaces/${workspaceId}/projects`)) {
      return { status: 200, json: page === "1" ? this.projects : [] };
    }

    const picker = `/api/workspaces/${workspaceId}/project-picker/projects?favorites=true`;

    if (method === "GET" && path.startsWith(picker)) {
      const favorites = this.projects.filter((project) => this.favoriteIds.includes(project.id));

      return {
        status: 200,
        json: page === "1" ? favorites.map((p) => ({ ...p, favorite: true })) : [],
      };
    }

    if (method === "GET" && path.includes(`/user/${userId}/time-entries`)) {
      const running = this.entries.filter(
        (entry) => entry.userId === userId && entry.timeInterval.end === null,
      );

      return { status: 200, json: running };
    }

    if (method === "POST" && path === `${base}/workspaces/${workspaceId}/time-entries`) {
      const entry = this.newEntry(
        body?.description ?? "",
        body?.projectId ?? null,
        body?.start ?? new Date().toISOString(),
        userId,
      );

      this.entries.push(entry);

      return { status: 201, json: entry };
    }

    const entryMatch = /\/time-entries\/(entry-\d+)$/u.exec(path);

    const entry = this.entries.find(
      (candidate) => candidate.id === entryMatch?.[1] && candidate.userId === userId,
    );

    if (entry === undefined) return { status: 404, json: {} };

    if (method === "DELETE") {
      this.entries = this.entries.filter((candidate) => candidate !== entry);

      return undefined;
    }

    if (method === "PUT" && body !== null) {
      entry.billable = body.billable === true;
      entry.description = body.description ?? "";
      entry.projectId = body.projectId ?? null;

      if (body.end !== undefined) entry.timeInterval.end = body.end;

      return { status: 200, json: entry };
    }

    return { status: 405, json: {} };
  }

  private serveLinear(request: IncomingMessage, response: ServerResponse): void {
    const path = (request.url ?? "/").split("?")[0] ?? "/";
    response.writeHead(200, { "content-type": "text/html" });
    response.end(linearPage(path));
  }
}

function linearPage(path: string): string {
  const match = /\/issue\/([A-Z]+-\d+)/u.exec(path);

  const title =
    match === null
      ? "Inbox - Linear"
      : `${match[1]} ${titles.get(match[1] ?? "") ?? "Untitled"} - Linear`;

  return `<!doctype html><html><head><title>${title}</title></head><body>
<main><p>page body</p>
<button id="go-eng-2">next</button><button id="go-inbox">inbox</button></main>
<script>
  const go = (path, title) => { history.pushState({}, "", path); setTimeout(() => { document.title = title; }, 150); };
  document.getElementById("go-eng-2").onclick = () => go("/acme/issue/ENG-2/second", "ENG-2 AU1002440: Second issue - Linear");
  document.getElementById("go-inbox").onclick = () => go("/acme/inbox", "Inbox - Linear");
</script></body></html>`;
}

const titles = new Map([["ENG-1", "First issue"]]);
