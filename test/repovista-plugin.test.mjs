import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAuditArgs, normalizeSettings, resolveRepoPath } from "../src/repovista.js";
import { listReports, readReportDetail } from "../src/reports.js";

test("buildAuditArgs maps scan options to RepoVista CLI flags", () => {
  const settings = normalizeSettings({ defaultProvider: "codex", defaultReasoning: "xhigh", defaultOutDir: ".repovista" });
  const args = buildAuditArgs({
    provider: "claude",
    reasoning: "high",
    sandbox: "read-only",
    phases: ["architecture", "risk-and-bug"],
    includes: "src,test",
    exportFormats: ["sarif", "html"],
    runChecks: false,
    strictReports: true,
    deepReview: true
  }, settings);
  assert.deepEqual(args.slice(0, 2), ["audit", "--no-progress"]);
  assert.equal(args.includes("--provider"), true);
  assert.equal(args.includes("claude"), true);
  assert.equal(args.includes("--no-run-checks"), true);
  assert.equal(args.includes("--deep-review"), true);
  assert.equal(args.filter((item) => item === "--phase").length, 2);
  assert.equal(args.filter((item) => item === "--include").length, 2);
});

test("resolveRepoPath respects allowed roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-plugin-root-"));
  const repo = path.join(root, "repo");
  try {
    await mkdir(repo, { recursive: true });
    const settings = normalizeSettings({ allowedRepoRoots: root });
    assert.equal(await resolveRepoPath({ repoPath: repo }, settings), repo);
    await assert.rejects(resolveRepoPath({ repoPath: os.tmpdir() }, settings), /outside the configured allowed roots/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("reports module lists and reads RepoVista runs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-plugin-reports-"));
  try {
    const runDir = path.join(root, ".repovista", "run-1");
    await mkdir(runDir, { recursive: true });
    await writeFile(path.join(runDir, "meta.json"), JSON.stringify({
      runId: "run-1",
      projectRoot: root,
      startedAt: "2026-05-31T00:00:00.000Z",
      completedAt: "2026-05-31T00:01:00.000Z",
      exitCode: 0,
      ai: { displayName: "Codex", model: "gpt-test", reasoning: "xhigh" },
      phases: []
    }), "utf8");
    await writeFile(path.join(runDir, "findings.json"), JSON.stringify([{ id: "f1", severity: "high", title: "Finding" }]), "utf8");
    await writeFile(path.join(runDir, "index.md"), "# Summary\n", "utf8");

    const reports = await listReports(root, ".repovista");
    assert.equal(reports.length, 1);
    assert.equal(reports[0].runId, "run-1");
    assert.equal(reports[0].findingCount, 1);

    const detail = await readReportDetail(root, ".repovista", "run-1");
    assert.equal(detail.sections[0].content, "# Summary\n");
    assert.match(await readFile(path.join(runDir, "meta.json"), "utf8"), /run-1/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
