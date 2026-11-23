import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEntryUpdate, ClockifyError, updateEntry } from "../../src/clockify.ts";

import type { Entry } from "../../src/clockify.ts";

function entry(overrides: Partial<Entry>): Entry {
  return {
    id: "e1",
    description: "old",
    projectId: "p1",
    taskId: "t1",
    billable: true,
    tagIds: ["g1"],
    type: "REGULAR",
    userId: "u1",
    customFieldValues: null,
    timeInterval: { start: "2026-01-01T10:00:00Z", end: null },
    ...overrides,
  };
}

test("a rejected stop shows Clockify's reason when it provides one", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", () =>
    Promise.resolve(Response.json({ message: "Project is required.", code: 123 }, { status: 400 })),
  );

  const account = { userId: "u1", workspaceId: "w1" };
  const change = { end: "2026-01-01T11:00:00Z" };

  await assert.rejects(updateEntry("fake-key", account, entry({}), change), {
    kind: "rejected",
    message: "Clockify rejected the request (HTTP 400). Project is required.",
  });

  fetch.mock.mockImplementation(() => Promise.resolve(new Response("not JSON", { status: 400 })));
  await assert.rejects(updateEntry("fake-key", account, entry({}), change), {
    kind: "rejected",
    message: "Clockify rejected the request (HTTP 400).",
  });
});

test("an update preserves documented writable fields", () => {
  const body = buildEntryUpdate(entry({}), { description: "new", projectId: "p1" });
  assert.deepEqual(body, {
    start: "2026-01-01T10:00:00Z",
    description: "new",
    projectId: "p1",
    taskId: "t1",
    billable: true,
    tagIds: ["g1"],
    type: "REGULAR",
  });
});

test("clearing the project omits it and drops the project's task", () => {
  const body = buildEntryUpdate(entry({}), { description: "new", projectId: null });
  assert.equal("projectId" in body, false);
  assert.equal("taskId" in body, false);
});

test("Stop refuses custom fields it cannot write back", () => {
  const end = "2026-01-01T11:00:00Z";

  for (const fields of [[{ customFieldId: "missing-value" }], { value: 0 }]) {
    assert.throws(() => buildEntryUpdate(entry({ customFieldValues: fields }), { end }), {
      kind: "blocked",
    });
  }
});

test("editing without changing the project preserves its custom fields", () => {
  const fields = [{ customFieldId: "c", value: 0 }];
  const current = entry({ customFieldValues: fields });

  assert.deepEqual(
    buildEntryUpdate(current, { description: "new", projectId: current.projectId }).customFields,
    fields,
  );
});

test("editing entries with unreadable custom fields or unsupported types is blocked", () => {
  const custom = entry({ customFieldValues: [{ customFieldId: "c" }] });
  assert.throws(
    () => buildEntryUpdate(custom, { description: "x", projectId: null }),
    ClockifyError,
  );
  assert.throws(
    () => buildEntryUpdate(entry({ type: "HOLIDAY" }), { description: "x", projectId: null }),
    ClockifyError,
  );
});
