import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { downloadSignedFile, lookupVersionState, type AmoClient } from "../../scripts/amo.ts";
import { obtainSignedXpi } from "../../scripts/firefox-signed-xpi.ts";

const GUID = "fake@example.test";
const SECRET = "fake-secret-value";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type Hits = { amo: string[]; cdn: string[] };

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

async function withServers(
  amo: Handler,
  cdn: Handler,
  run: (client: AmoClient, hits: Hits) => Promise<void>,
): Promise<void> {
  const hits: Hits = { amo: [], cdn: [] };

  const record =
    (list: string[], handler: Handler): Handler =>
    (request, response) => {
      list.push(`${request.url} auth=${request.headers.authorization ?? "none"}`);
      handler(request, response);
    };

  const amoServer = createServer(record(hits.amo, amo));
  const cdnServer = createServer(record(hits.cdn, cdn));

  await Promise.all(
    [amoServer, cdnServer].map(
      (server) => new Promise<void>((done) => server.listen(0, "127.0.0.1", done)),
    ),
  );

  const origin = (server: typeof amoServer) => {
    const address = server.address();

    assert.ok(address instanceof Object, "server is listening");

    return `http://127.0.0.1:${address.port}`;
  };

  try {
    await run(
      {
        baseUrl: new URL(origin(amoServer)),
        credentials: { issuer: "fake-issuer", secret: SECRET },
        cdnOrigins: [origin(cdnServer)],
        retryDelayMs: 1,
      },
      hits,
    );
  } finally {
    amoServer.close();
    cdnServer.close();
  }
}

function json(response: ServerResponse, status: number, body: JsonValue): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const sha = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

function amoApi(options: {
  status: string;
  fileUrl: string | null;
  hash: string | null;
  channel?: string;
  disabled?: boolean;
}): Handler {
  return (request, response) => {
    if (request.url?.startsWith(`/api/v5/addons/addon/${encodeURIComponent(GUID)}/versions/?`)) {
      return json(response, 200, { next: null, results: [{ id: 7, version: "1.0.0" }] });
    }

    if (request.url === `/api/v5/addons/addon/${encodeURIComponent(GUID)}/versions/7/`) {
      return json(response, 200, {
        id: 7,
        version: "1.0.0",
        channel: options.channel ?? "unlisted",
        is_disabled: options.disabled ?? false,
        file: {
          status: options.status,
          url: options.fileUrl,
          hash: options.hash === null ? null : `sha256:${options.hash}`,
        },
      });
    }

    response.writeHead(404).end();
  };
}

const absent: Handler = (_request, response) => json(response, 404, { detail: "Not found." });

test("lookup reports absent, pending, and approved", async () => {
  await withServers(absent, absent, async (client) => {
    assert.deepEqual(await lookupVersionState(client, GUID, "1.0.0"), { kind: "absent" });
  });
  await withServers(
    amoApi({ status: "unreviewed", fileUrl: null, hash: null }),
    absent,
    async (client) => {
      assert.deepEqual(await lookupVersionState(client, GUID, "1.0.0"), {
        kind: "pending",
        versionId: 7,
      });
    },
  );
  await withServers(
    amoApi({ status: "public", fileUrl: "http://x/f", hash: sha("a") }),
    absent,
    async (client) => {
      const state = await lookupVersionState(client, GUID, "1.0.0");
      assert.equal(state.kind, "approved");
    },
  );
});

test("lookup fails closed on malformed, disabled, listed, or duplicate AMO data", async () => {
  const cases: Handler[] = [
    (_request, response) => json(response, 200, { nope: true }),
    (_request, response) => json(response, 403, {}),
    amoApi({ status: "disabled", fileUrl: "x", hash: sha("a") }),
    amoApi({ status: "public", fileUrl: "x", hash: "short" }),
    amoApi({ status: "public", fileUrl: "x", hash: sha("a"), channel: "listed" }),
    amoApi({ status: "public", fileUrl: "x", hash: sha("a"), disabled: true }),
    (_request, response) =>
      json(response, 200, {
        next: null,
        results: [
          { id: 1, version: "1.0.0" },
          { id: 2, version: "1.0.0" },
        ],
      }),
  ];

  for (const handler of cases) {
    await withServers(handler, absent, async (client) => {
      await assert.rejects(lookupVersionState(client, GUID, "1.0.0"));
    });
  }
});

test("lookup retries transient AMO errors and then answers", async () => {
  let calls = 0;

  await withServers(
    (_request, response) => {
      calls += 1;

      if (calls < 3) return json(response, 503, {});
      json(response, 404, {});
    },
    absent,
    async (client) => {
      assert.deepEqual(await lookupVersionState(client, GUID, "1.0.0"), { kind: "absent" });
      assert.equal(calls, 3);
    },
  );
});

test("downloads send credentials to AMO only and refuse untrusted redirects", async () => {
  const xpi = Buffer.from("signed bytes");
  let redirectTarget = "";
  let fileHash = sha(xpi);

  await withServers(
    (request, response) => {
      if (request.url === "/file") {
        response.writeHead(302, { location: redirectTarget }).end();
      }
    },
    (request, response) => {
      if (request.url === "/ok") response.writeHead(200).end(xpi);
      else response.writeHead(404).end();
    },
    async (client, hits) => {
      const cdn = client.cdnOrigins[0];

      assert.ok(cdn !== undefined);

      const state = (): Extract<
        Awaited<ReturnType<typeof lookupVersionState>>,
        { kind: "approved" }
      > => ({
        kind: "approved",
        versionId: 7,
        fileUrl: `${client.baseUrl.origin}/file`,
        sha256: fileHash,
      });

      redirectTarget = `${cdn}/ok`;
      assert.deepEqual(await downloadSignedFile(client, state()), xpi);
      assert.ok(hits.amo[0]?.includes("auth=JWT "));
      assert.ok(hits.cdn.every((hit) => hit.endsWith("auth=none")));
      assert.ok(!hits.cdn.join().includes(SECRET));

      fileHash = sha("other");
      await assert.rejects(downloadSignedFile(client, state()), /SHA-256/u);

      fileHash = sha(xpi);
      redirectTarget = "http://localhost:1/evil";
      await assert.rejects(downloadSignedFile(client, state()), /Refusing redirect/u);
      await assert.rejects(
        downloadSignedFile(client, { ...state(), fileUrl: "http://localhost:1/file" }),
        /Untrusted/u,
      );
    },
  );
});

function makeBuildAndXpi(work: string) {
  const build = join(work, "build");
  const signed = join(work, "signed");

  mkdirSync(build);
  mkdirSync(join(signed, "META-INF"), { recursive: true });

  for (const directory of [build, signed]) writeFileSync(join(directory, "manifest.json"), "{}");
  writeFileSync(join(signed, "META-INF", "mozilla.rsa"), "sig");
  execFileSync("zip", ["-q", "-r", join(work, "signed.xpi"), "."], { cwd: signed });

  return { build, xpi: readFileSync(join(work, "signed.xpi")) };
}

test("obtainSignedXpi submits only when AMO has no version, and never in recovery", async () => {
  const work = mkdtempSync(join(tmpdir(), "amo-flow-"));

  try {
    const { build, xpi } = makeBuildAndXpi(work);
    let submissions = 0;

    const submit = async (directory: string) => {
      submissions += 1;
      writeFileSync(join(directory, "signed.xpi"), xpi);
    };

    const request = (mode: "submit" | "recover", client: AmoClient, name: string) => ({
      client,
      guid: GUID,
      version: "1.0.0",
      mode,
      buildDirectory: build,
      artifactsDirectory: join(work, `artifacts-${name}`),
      outputXpi: join(work, `${name}.xpi`),
      submit,
    });

    await withServers(absent, absent, async (client) => {
      await assert.rejects(obtainSignedXpi(request("recover", client, "r1")), /never submits/u);
      assert.equal(submissions, 0);
      await obtainSignedXpi(request("submit", client, "s1"));
      assert.equal(submissions, 1);
      assert.ok(existsSync(join(work, "s1.xpi")));
    });

    await withServers(
      amoApi({ status: "unreviewed", fileUrl: "x", hash: sha(xpi) }),
      absent,
      async (client) => {
        await assert.rejects(obtainSignedXpi(request("submit", client, "p1")), /awaiting review/u);
        await assert.rejects(obtainSignedXpi(request("recover", client, "p2")), /awaiting review/u);
        assert.equal(submissions, 1);
        assert.ok(!existsSync(join(work, "p1.xpi")));
      },
    );

    let origin = "";

    const api = (hash: string): Handler =>
      amoApi({ status: "public", fileUrl: `${origin}/file`, hash });

    for (const [hash, served] of [
      [sha(xpi), xpi],
      [sha(xpi), Buffer.from("tampered")],
    ] as const) {
      await withServers(
        (request_, response) =>
          request_.url === "/file"
            ? response.writeHead(200).end(served)
            : api(hash)(request_, response),
        absent,
        async (client) => {
          origin = client.baseUrl.origin;
          const name = served === xpi ? "a1" : "a2";
          const attempt = obtainSignedXpi(request("recover", client, name));

          if (served === xpi) await attempt;
          else await assert.rejects(attempt, /SHA-256/u);
          assert.equal(existsSync(join(work, `${name}.xpi`)), served === xpi);
        },
      );
    }

    assert.equal(submissions, 1);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
