import test from "node:test";
import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAuditArgs, normalizeSettings, resolveRepoPath } from "../src/repovista.js";
import { renderPanel } from "../src/render-panel.js";
import { handleCommand } from "../src/runtime.js";
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

test("buildAuditArgs maps GitHub source scan options", () => {
  const args = buildAuditArgs({
    sourceMode: "github",
    githubRepo: "nordbyte/RepoVista",
    githubRef: "main",
    provider: "codex"
  }, normalizeSettings({ allowGithubSource: true }));

  assert.deepEqual(args.slice(0, 2), ["audit", "--no-progress"]);
  assert.equal(args.includes("--github-repo"), true);
  assert.equal(args.includes("nordbyte/RepoVista"), true);
  assert.equal(args.includes("--github-ref"), true);
  assert.equal(args.includes("main"), true);
});

test("buildAuditArgs ignores stale GitHub fields in local source mode", () => {
  const args = buildAuditArgs({
    sourceMode: "local",
    repoPath: "/repo",
    githubRepo: "nordbyte/RepoVista",
    githubRef: "main"
  }, normalizeSettings({ allowGithubSource: true }));

  assert.equal(args.includes("--github-repo"), false);
  assert.equal(args.includes("--github-ref"), false);
});

test("scan panel uses shared comparison header spacing classes", () => {
  const html = renderPanel({}, { runtime: { name: "Local node", workspace: "/repo" } }, {});

  assert.match(html, /class="stack monitor-comparison-panel repovista-scan-panel"/);
  assert.match(html, /<h2>Start Scan<\/h2>/);
  assert.match(html, /<summary>Advanced options<\/summary>/);
  assert.match(html, /<select name="phases" multiple size="4">/);
  assert.match(html, /<select name="exportFormats" multiple size="4">/);
  assert.match(html, /<select name="sourceMode">/);
  assert.match(html, /Local repository path/);
  assert.match(html, /data-source-section="github" hidden/);
});

test("scan panel shows GitHub source fields only when GitHub mode is selected", () => {
  const html = renderPanel({ sourceMode: "github", githubRepo: "nordbyte/RepoVista" }, { runtime: { name: "Local node" } }, {});

  assert.match(html, /<option value="github" selected>GitHub repository<\/option>/);
  assert.match(html, /data-source-section="local" hidden/);
  assert.match(html, /data-source-section="github"/);
  assert.doesNotMatch(html, /data-source-section="github" hidden/);
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

test("GitHub scan runs from plugin data dir without a local repository path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "repovista-plugin-github-"));
  const command = path.join(root, "repovista-mock.mjs");
  const dataDir = path.join(root, "data");
  try {
    await mkdir(dataDir, { recursive: true });
    await writeFile(command, "#!/usr/bin/env node\nconsole.log(JSON.stringify({ cwd: process.cwd(), argv: process.argv.slice(2) }));\n", "utf8");
    await chmod(command, 0o755);
    const result = await handleCommand("scan", {
      githubRepo: "nordbyte/RepoVista",
      githubRef: "main",
      outDir: ".repovista-github"
    }, normalizeSettings({
      repovistaCommand: command,
      allowGithubSource: true
    }), {
      dataDir,
      host: { requirePermission() {} }
    });

    assert.equal(result.ok, true);
    const payload = JSON.parse(result.output.stdout.trim());
    assert.equal(payload.cwd, await realpath(dataDir));
    assert.equal(payload.argv.includes("--github-repo"), true);
    assert.equal(payload.argv.includes("nordbyte/RepoVista"), true);
    assert.equal(payload.argv.includes("--github-ref"), true);
    assert.equal(payload.argv.includes("main"), true);
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
