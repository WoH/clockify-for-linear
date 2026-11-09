import { createHash, createHmac, randomUUID } from "node:crypto";

import { z } from "zod";

export type AmoCredentials = { issuer: string; secret: string };

export type AmoClient = {
  baseUrl: URL;
  credentials: AmoCredentials;
  cdnOrigins: readonly string[];
  retryDelayMs: number;
};

export type AmoVersionState =
  | { kind: "absent" }
  | { kind: "pending"; versionId: number }
  | { kind: "approved"; versionId: number; fileUrl: string; sha256: string };

const MAX_ATTEMPTS = 4;
const MAX_REDIRECTS = 3;
const MAX_PAGES = 10;
const MAX_XPI_BYTES = 20_000_000;

const versionListSchema = z.object({
  next: z.string().nullable(),
  results: z.array(z.object({ id: z.number().int(), version: z.string() })),
});

const versionDetailSchema = z.object({
  id: z.number().int(),
  version: z.string(),
  channel: z.string(),
  is_disabled: z.boolean(),
  file: z.object({ status: z.string(), url: z.string().nullable(), hash: z.string().nullable() }),
});

export function createAmoClient(credentials: AmoCredentials): AmoClient {
  return {
    baseUrl: new URL("https://addons.mozilla.org"),
    credentials,
    cdnOrigins: ["https://addons.cdn.mozilla.net"],
    retryDelayMs: 2000,
  };
}

function assertTransportAllowed(url: URL): void {
  const loopback = url.protocol === "http:" && url.hostname === "127.0.0.1";

  if (url.protocol !== "https:" && !loopback) {
    throw new Error(`Refusing to contact ${url.origin}: HTTPS is required.`);
  }
}

function authorizationHeader(credentials: AmoCredentials): string {
  const issuedAt = Math.floor(Date.now() / 1000);

  const encode = (value: Record<string, string | number>) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: credentials.issuer,
    jti: randomUUID(),
    iat: issuedAt,
    exp: issuedAt + 60,
  })}`;

  const signature = createHmac("sha256", credentials.secret).update(unsigned).digest("base64url");

  return `JWT ${unsigned}.${signature}`;
}

// Credentials only go to the AMO origin. Redirects are never followed by fetch.
async function get(client: AmoClient, url: URL): Promise<Response> {
  assertTransportAllowed(url);

  const headers: Record<string, string> =
    url.origin === client.baseUrl.origin
      ? { Authorization: authorizationHeader(client.credentials) }
      : {};

  for (let attempt = 1; ; attempt += 1) {
    const retryable = attempt < MAX_ATTEMPTS;
    let response: Response | null = null;

    try {
      response = await fetch(url, { headers, redirect: "manual" });
    } catch (error) {
      if (!retryable) throw error;
    }

    if (response !== null && response.status !== 429 && response.status < 500) return response;

    if (!retryable && response !== null) return response;

    await new Promise((resolve) => setTimeout(resolve, client.retryDelayMs));
  }
}

async function getJson<Schema extends z.ZodTypeAny>(
  client: AmoClient,
  url: URL,
  schema: Schema,
): Promise<z.infer<Schema> | null> {
  if (url.origin !== client.baseUrl.origin) throw new Error(`Untrusted AMO URL: ${url.origin}`);

  const response = await get(client, url);

  if (response.status === 404) return null;

  if (response.status !== 200) throw new Error(`AMO request failed with HTTP ${response.status}.`);

  return schema.parse(await response.json());
}

/** Reads the state of one add-on version from AMO. Throws when the state is ambiguous. */
export async function lookupVersionState(
  client: AmoClient,
  guid: string,
  version: string,
): Promise<AmoVersionState> {
  const addon = new URL(`/api/v5/addons/addon/${encodeURIComponent(guid)}/`, client.baseUrl);
  let page: URL | null = new URL("versions/?filter=all_with_unlisted&page_size=50", addon);
  const matches: number[] = [];

  for (let pages = 0; page !== null; pages += 1) {
    if (pages === MAX_PAGES) throw new Error("AMO version list has too many pages.");

    const list: z.infer<typeof versionListSchema> | null = await getJson(
      client,
      page,
      versionListSchema,
    );

    if (list === null) {
      if (pages === 0) return { kind: "absent" };
      throw new Error("AMO version list disappeared while paging.");
    }

    for (const entry of list.results) if (entry.version === version) matches.push(entry.id);

    page = list.next === null ? null : new URL(list.next);
  }

  if (matches.length === 0) return { kind: "absent" };

  const versionId = matches[0];

  if (matches.length > 1 || versionId === undefined) {
    throw new Error(`AMO lists version ${version} more than once.`);
  }

  const detail = await getJson(
    client,
    new URL(`versions/${versionId}/`, addon),
    versionDetailSchema,
  );

  if (detail === null) throw new Error(`AMO version ${versionId} vanished.`);

  if (detail.id !== versionId || detail.version !== version) {
    throw new Error("AMO version detail does not match the requested version.");
  }

  if (detail.channel !== "unlisted") {
    throw new Error(`AMO version ${version} is on the ${detail.channel} channel.`);
  }

  if (detail.is_disabled) throw new Error(`AMO version ${version} is disabled.`);

  if (detail.file.status === "unreviewed") return { kind: "pending", versionId };

  if (detail.file.status !== "public") {
    throw new Error(`AMO version ${version} has file status ${detail.file.status}.`);
  }

  if (detail.file.url === null || detail.file.hash === null) {
    throw new Error("AMO returned an approved file without a download URL or hash.");
  }

  const hash = /^sha256:([0-9a-f]{64})$/u.exec(detail.file.hash);

  if (hash === null || hash[1] === undefined) throw new Error("AMO returned no SHA-256 hash.");

  return { kind: "approved", versionId, fileUrl: detail.file.url, sha256: hash[1] };
}

/** Downloads an approved file and checks its hash. The file URL must be on the AMO origin. */
export async function downloadSignedFile(
  client: AmoClient,
  state: Extract<AmoVersionState, { kind: "approved" }>,
): Promise<Buffer> {
  let url = new URL(state.fileUrl);

  if (url.origin !== client.baseUrl.origin) throw new Error(`Untrusted file URL: ${url.origin}`);

  for (let redirects = 0; ; redirects += 1) {
    const response = await get(client, url);

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");

      if (location === null || redirects === MAX_REDIRECTS) {
        throw new Error("AMO file download redirected incorrectly.");
      }

      url = new URL(location, url);

      const trusted =
        url.origin === client.baseUrl.origin || client.cdnOrigins.includes(url.origin);

      if (!trusted) throw new Error(`Refusing redirect to ${url.origin}.`);

      continue;
    }

    if (response.status !== 200)
      throw new Error(`AMO download failed with HTTP ${response.status}.`);

    const data = Buffer.from(await response.arrayBuffer());

    if (data.length === 0 || data.length > MAX_XPI_BYTES) throw new Error("Bad XPI size.");

    if (createHash("sha256").update(data).digest("hex") !== state.sha256) {
      throw new Error("The downloaded XPI does not match the SHA-256 hash from AMO.");
    }

    return data;
  }
}
