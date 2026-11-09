import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("signed XPI verification rejects changed or extra payload files", () => {
  const work = mkdtempSync(join(tmpdir(), "firefox-xpi-test-"));
  const source = join(work, "build");
  const signed = join(work, "signed");
  const submission = join(work, "submission");
  const archive = join(work, "signed.xpi");

  try {
    mkdirSync(source);
    mkdirSync(submission);
    mkdirSync(join(signed, "META-INF"), { recursive: true });
    writeFileSync(join(source, "manifest.json"), '{"version":"1.0"}\n');
    writeFileSync(join(source, "widget.js"), "original");
    writeFileSync(join(signed, "manifest.json"), '{"version":"1.0"}');
    writeFileSync(join(signed, "widget.js"), "original");
    writeFileSync(join(signed, "META-INF", "mozilla.rsa"), "test marker");
    execFileSync("zip", ["-q", "-r", archive, "."], { cwd: signed });
    copyFileSync(archive, join(work, "base.xpi"));

    const verify = () =>
      execFileSync(process.execPath, ["scripts/verify-firefox-xpi.ts", archive, source], {
        stdio: "pipe",
      });

    verify();
    writeFileSync(join(source, "manifest.json"), '{"version":"1.1"}\n');
    assert.throws(verify);
    writeFileSync(join(source, "manifest.json"), '{"version":"1.0"}\n');
    copyFileSync(join(source, "manifest.json"), join(submission, "manifest.json"));
    copyFileSync(join(source, "widget.js"), join(submission, "widget.js"));
    writeFileSync(join(submission, ".amo-upload-uuid"), "upload state");
    verify();
    assert.throws(() =>
      execFileSync(process.execPath, ["scripts/verify-firefox-xpi.ts", archive, submission], {
        stdio: "pipe",
      }),
    );
    writeFileSync(join(source, "widget.js"), "changed");
    assert.throws(verify);
    writeFileSync(join(source, "widget.js"), "original");
    writeFileSync(join(signed, "extra.js"), "unexpected");
    execFileSync("zip", ["-q", archive, "extra.js"], { cwd: signed });
    assert.throws(verify);
    copyFileSync(join(work, "base.xpi"), archive);
    execFileSync(
      "python3",
      [
        "-c",
        "import sys, zipfile; z = zipfile.ZipFile(sys.argv[1], 'a'); z.writestr('widget.js', 'original'); z.close()",
        archive,
      ],
      { stdio: "pipe" },
    );
    assert.throws(verify);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
