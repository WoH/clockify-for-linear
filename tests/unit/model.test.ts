import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatElapsed,
  parseIssuePath,
  projectForTitle,
  requestSchema,
  titleFromDocumentTitle,
} from "../../src/model.ts";

const projects = [
  { id: "p1", name: "AU1002440" },
  { id: "p2", name: "AU100" },
  { id: "p3", name: "" },
  { id: "p4", name: "A" },
];

test("issue paths need a workspace and a team-key identifier", () => {
  assert.deepEqual(parseIssuePath("/acme/issue/eng2-12/some-slug"), {
    workspace: "acme",
    identifier: "ENG2-12",
  });
  assert.equal(parseIssuePath("/acme/team/ENG/active"), null);
  assert.equal(parseIssuePath("/acme/issue/ENG-12x"), null);
});

test("document titles yield the issue title or nothing", () => {
  assert.equal(titleFromDocumentTitle("ENG-12 Fix it - Linear", "ENG-12"), "Fix it");
  assert.equal(titleFromDocumentTitle("Inbox - Linear", "ENG-12"), null);
  assert.equal(titleFromDocumentTitle("ENG-12 - Linear", "ENG-12"), null);
});

test("project suggestions need one exact code match", () => {
  assert.equal(projectForTitle("AU1002440: Fix", projects)?.id, "p1");
  assert.equal(projectForTitle("Fix (AU100)", projects)?.id, "p2");
  assert.equal(projectForTitle("AU1002441: Fix", projects), null);
  assert.equal(projectForTitle("Fix it", projects), null);
  assert.equal(projectForTitle(null, projects), null);
  assert.equal(projectForTitle("AU100: x", [...projects, { id: "p5", name: "au100 extra" }]), null);
});

test("requests from other contexts are rejected unless they match the schema", () => {
  assert.equal(requestSchema.safeParse({ type: "connect" }).success, false);
  assert.equal(requestSchema.safeParse({ type: "stop", entryId: "" }).success, false);
  assert.equal(requestSchema.safeParse({ type: "acknowledge" }).success, false);
  assert.equal(
    requestSchema.safeParse({ type: "acknowledge", accountId: "ws/user" }).success,
    true,
  );
});

test("elapsed time never goes negative", () => {
  assert.equal(formatElapsed(3_661_000), "01:01:01");
  assert.equal(formatElapsed(-5), "00:00:00");
});
