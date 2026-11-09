import assert from "node:assert/strict";
import { test } from "node:test";

import { buildEntryUpdate, ClockifyError } from "../../src/clockify.ts";

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

test("entries whose update semantics are undocumented are refused", () => {
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
