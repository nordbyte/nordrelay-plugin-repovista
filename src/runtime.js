import { mkdir, realpath } from "node:fs/promises";
import { runPlugin, ok, fail } from "@nordbyte/nordrelay-plugin-sdk";
import { renderPanel, panelScript } from "./render-panel.js";
import { buildCommandArgs, commandAvailable, normalizeSettings, resolveRepoPath, runRepoVista } from "./repovista.js";
import { latestStatus, listReports, readReportArtifact, readReportDetail, renderReportText } from "./reports.js";

export async function runRepoVistaPlugin() {
  await runPlugin(async (request) => {
    const settings = normalizeSettings(request.settings || {});
    const dataDir = request.dataDir || process.cwd();
    await mkdir(dataDir, { recursive: true });

    if (request.type === "web-panel") {
      const html = renderPanel(request.input || {}, request.context || {}, settings);
      return ok(undefined, { html, panel: { script: panelScript() } });
    }

    if (request.type === "diagnostics") {
      return diagnostics(settings, dataDir);
    }

    if (request.type !== "command") {
      return fail(`Unsupported RepoVista plugin request type: ${request.type}`);
    }

    return handleCommand(request.command || "", request.input || {}, settings, request);
  });
}

export async function handleCommand(command, input = {}, settings = {}, request = {}) {
  const dataDir = request.dataDir || process.cwd();
  if (command === "panel-data") return panelData(input, settings, dataDir);
  if (command === "list-reports") return listReportsCommand(input, settings, dataDir);
  if (command === "report-detail") return reportDetailCommand(input, settings, dataDir);
  if (command === "report-artifact") return reportArtifactCommand(input, settings, dataDir);
  if (command === "scan") request.host?.requirePermission?.("files.write");
  if (requiresWrite(command, input, settings)) {
    request.host?.requirePermission?.("files.write");
    if (!settings.allowWriteActions) {
      return fail("RepoVista write actions are disabled in plugin settings.");
    }
  }
  if (requiresGithubPublish(command) && !settings.allowGithubPublish) {
    return fail("RepoVista GitHub publishing is disabled in plugin settings.");
  }
  return runRepoVistaCommand(command, input, settings, dataDir);
}

async function panelData(input, settings, dataDir) {
  const version = await commandAvailable(settings.repovistaCommand);
  if (!input.repoPath && !settings.defaultRepoPath && !hasGithubSource(input)) {
    return ok({
      version,
      configured: Boolean(version),
      repoPath: "",
      outDir: settings.defaultOutDir,
      reports: [],
      status: undefined,
      note: "Set a repository path to load reports."
    });
  }
  const repoPath = await resolveReportRoot(input, settings, dataDir);
  const outDir = String(input.outDir || settings.defaultOutDir || ".repovista");
  const [reports, status] = await Promise.all([
    listReports(repoPath, outDir, { limit: 50 }),
    latestStatus(repoPath, outDir)
  ]);
  return ok({
    version,
    configured: Boolean(version),
    repoPath,
    outDir,
    reports,
    status,
    settings: safeSettings(settings)
  });
}

async function listReportsCommand(input, settings, dataDir) {
  const repoPath = await resolveReportRoot(input, settings, dataDir);
  const reports = await listReports(repoPath, String(input.outDir || settings.defaultOutDir || ".repovista"), { limit: Number(input.limit) || 100 });
  return ok({ repoPath, reports });
}

async function reportDetailCommand(input, settings, dataDir) {
  const repoPath = await resolveReportRoot(input, settings, dataDir);
  const detail = await readReportDetail(repoPath, String(input.outDir || settings.defaultOutDir || ".repovista"), input.runId || input.runDir);
  return ok({ detail, text: renderReportText(detail) });
}

async function reportArtifactCommand(input, settings, dataDir) {
  const repoPath = await resolveReportRoot(input, settings, dataDir);
  const artifact = await readReportArtifact(repoPath, String(input.outDir || settings.defaultOutDir || ".repovista"), input.runId || input.runDir, input.fileName);
  return ok(artifact);
}

async function runRepoVistaCommand(command, input, settings, dataDir) {
  const repoPath = await resolveExecutionCwd(input, settings, dataDir);
  const args = buildCommandArgs(command, input, settings);
  const timeoutMs = command === "scan" ? settings.scanTimeoutMs : settings.commandTimeoutMs;
  const result = await runRepoVista(settings.repovistaCommand, args, { cwd: repoPath, timeoutMs });
  const output = {
    command: settings.repovistaCommand,
    args,
    cwd: repoPath,
    exitCode: result.exitCode,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr
  };
  return result.ok ? ok(output, { stdout: result.stdout, stderr: result.stderr }) : fail(result.stderr || result.stdout || `RepoVista exited with ${result.exitCode}`, { output, stdout: result.stdout, stderr: result.stderr });
}

async function resolveExecutionCwd(input, settings, dataDir) {
  if (hasGithubSource(input)) {
    if (!settings.allowGithubSource) {
      throw new Error("GitHub source scans are disabled for this plugin.");
    }
    await mkdir(dataDir, { recursive: true });
    return realpath(dataDir);
  }
  return resolveRepoPath(input, settings);
}

async function resolveReportRoot(input, settings, dataDir) {
  if (hasGithubSource(input)) {
    await mkdir(dataDir, { recursive: true });
    return realpath(dataDir);
  }
  return resolveRepoPath(input, settings);
}

function hasGithubSource(input) {
  const mode = String(input.sourceMode || "").toLowerCase();
  if (mode === "local") return false;
  return mode === "github" || Boolean(String(input.githubRepo || "").trim());
}

async function diagnostics(settings, dataDir) {
  const version = await commandAvailable(settings.repovistaCommand);
  return ok(undefined, {
    diagnostics: {
      plugin: "repovista",
      dataDir,
      repovista: {
        command: settings.repovistaCommand,
        version: version || undefined,
        available: Boolean(version)
      },
      settings: safeSettings(settings)
    }
  });
}

function requiresWrite(command, input, settings) {
  if (command === "scan") return false;
  if (command === "fix") return input.dryRun === false;
  if (command === "baseline") return !["list", "prune"].includes(String(input.action || "list"));
  if (command === "settings") return ["set", "reset"].includes(String(input.action || "get"));
  return ["triage", "repair-run", "rollback", "open-pr", "issue", "publish", "ci-init", "clean-locks"].includes(command);
}

function requiresGithubPublish(command) {
  return ["issue", "publish", "open-pr"].includes(command);
}

function safeSettings(settings) {
  return {
    repovistaCommand: settings.repovistaCommand,
    allowedRepoRoots: settings.allowedRepoRoots,
    defaultRepoPath: settings.defaultRepoPath,
    defaultOutDir: settings.defaultOutDir,
    defaultProvider: settings.defaultProvider,
    defaultReasoning: settings.defaultReasoning,
    allowGithubSource: settings.allowGithubSource,
    allowWriteActions: settings.allowWriteActions,
    allowGithubPublish: settings.allowGithubPublish,
    commandTimeoutMs: settings.commandTimeoutMs,
    scanTimeoutMs: settings.scanTimeoutMs
  };
}
