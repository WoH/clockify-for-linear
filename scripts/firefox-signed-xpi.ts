import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { downloadSignedFile, lookupVersionState, type AmoClient } from "./amo.ts";

export type SignedXpiRequest = {
  client: AmoClient;
  guid: string;
  version: string;
  mode: "submit" | "recover";
  buildDirectory: string;
  artifactsDirectory: string;
  outputXpi: string;
  submit: (artifactsDirectory: string) => Promise<void>;
};

const verifier = join(import.meta.dirname, "verify-firefox-xpi.ts");

function verifyPayload(xpi: string, buildDirectory: string): void {
  execFileSync(process.execPath, [verifier, xpi, buildDirectory], { stdio: "inherit" });
}

/**
 * Produces a verified signed XPI. AMO is the authority on whether a version was already submitted,
 * so a version is submitted only when AMO has no record of it and the mode allows submitting.
 */
export async function obtainSignedXpi(request: SignedXpiRequest): Promise<void> {
  if (existsSync(request.outputXpi)) throw new Error(`Refusing to replace ${request.outputXpi}.`);

  mkdirSync(request.artifactsDirectory, { recursive: true });

  const state = await lookupVersionState(request.client, request.guid, request.version);

  if (state.kind === "pending") {
    throw new Error(
      `Mozilla has version ${request.version} awaiting review. Nothing was submitted or released; run the recovery workflow after approval.`,
    );
  }

  if (state.kind === "approved") {
    const data = await downloadSignedFile(request.client, state);
    const staged = join(request.artifactsDirectory, "downloaded.xpi");

    writeFileSync(staged, data, { flag: "wx" });
    verifyPayload(staged, request.buildDirectory);
    copyFileSync(staged, request.outputXpi);

    return;
  }

  if (request.mode === "recover") {
    throw new Error(`Mozilla has no version ${request.version}; recovery never submits.`);
  }

  await request.submit(request.artifactsDirectory);

  const produced = readdirSync(request.artifactsDirectory);

  if (produced.length !== 1 || !produced[0]?.endsWith(".xpi")) {
    throw new Error(`Expected exactly one signed XPI but found: ${produced.join(", ") || "none"}.`);
  }

  const xpi = join(request.artifactsDirectory, produced[0]);

  verifyPayload(xpi, request.buildDirectory);
  copyFileSync(xpi, request.outputXpi);
}
