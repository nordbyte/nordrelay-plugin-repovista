import { spawn } from "node:child_process";
import path from "node:path";
import { access, realpath, stat } from "node:fs/promises";
import { splitList } from "./format.js";

const BOOLEAN_FLAGS = new Map([
  ["allowRepoProviderPlugin", "allow-repo-provider-plugin"],
  ["refresh", "refresh"],
  ["prMode", "pr"],
  ["allWorkspaces", "all-workspaces"],
  ["incremental", "incremental"],
  ["fastMode", "fast"],
  ["json", "json"],
  ["runChecks", "run-checks"],
  ["strictReports", "strict-reports"],
  ["repairReports", "repair-reports"],
  ["deepReview", "deep-review"],
  ["snapshot", "snapshot"],
  ["failOnDrift", "fail-on-drift"],
  ["failOnWeakEvidence", "fail-on-weak-evidence"],
  ["workspaceMatrix", "workspace-matrix"],
  ["ci", "ci"],
  ["failOnCritical", "fail-on-critical"],
  ["keepLogs", "keep-logs"],
  ["bugFindingsOnly", "bug-findings"],
]);

const NEGATED_FLAGS = new Map([
  ["prMode", "no-pr"],
  ["fastMode", "no-fast"],
  ["runChecks", "no-run-checks"],
  ["strictReports", "no-strict-reports"],
  ["repairReports", "no-repair-reports"],
  ["deepReview", "no-deep-review"],
  ["bugFindingsOnly", "no-bug-findings"],
]);

const VALUE_OPTIONS = new Map([
  ["provider", "provider"],
  ["parallel", "parallel"],
  ["outDir", "out"],
  ["resumeDir", "resume"],
  ["githubRepo", "github-repo"],
  ["githubRef", "github-ref"],
  ["since", "since"],
  ["baseRef", "base"],
  ["auditProfile", "audit-profile"],
  ["reviewMode", "review-mode"],
  ["promptFile", "prompt-file"],
  ["workspace", "workspace"],
  ["model", "model"],
  ["profile", "profile"],
  ["reasoning", "reasoning"],
  ["sandbox", "sandbox"],
  ["language", "language"],
  ["publishLanguage", "publish-language"],
  ["contributionPolicy", "contribution-policy"],
  ["checkTimeoutSeconds", "check-timeout"],
  ["phaseTimeoutSeconds", "timeout"],
  ["repairAttempts", "repair-attempts"],
  ["minQualityScore", "min-quality-score"],
  ["maxCritical", "max-critical"],
  ["maxHigh", "max-high"],
  ["maxMedium", "max-medium"],
]);

const ARRAY_OPTIONS = new Map([
  ["includes", "include"],
  ["ignores", "ignore"],
  ["phases", "phase"],
  ["checkCommands", "check"],
  ["exportFormats", "export"],
]);

export function normalizeSettings(settings = {}) {
  return {
    repovistaCommand: String(settings.repovistaCommand || "repovista"),
    allowedRepoRoots: splitList(settings.allowedRepoRoots),
    defaultRepoPath: String(settings.defaultRepoPath || ""),
    defaultOutDir: String(settings.defaultOutDir || ".repovista"),
    defaultProvider: String(settings.defaultProvider || "codex"),
    defaultReasoning: String(settings.defaultReasoning || "xhigh"),
    allowGithubSource: settings.allowGithubSource !== false,
    allowWriteActions: settings.allowWriteActions === true || settings.allowWriteActions === "true",
    allowGithubPublish: settings.allowGithubPublish === true || settings.allowGithubPublish === "true",
    commandTimeoutMs: positiveNumber(settings.commandTimeoutMs, 120000),
    scanTimeoutMs: positiveNumber(settings.scanTimeoutMs, 7200000),
  };
}

export async function resolveRepoPath(input = {}, settings = {}) {
  const requested = String(input.repoPath || settings.defaultRepoPath || process.cwd()).trim();
  if (!requested) throw new Error("Repository path is required.");
  const resolved = path.resolve(requested);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error(`Repository path is not a directory: ${resolved}`);
  await assertAllowedRoot(resolved, settings.allowedRepoRoots || []);
  return resolved;
}

export function buildAuditArgs(input = {}, settings = {}) {
  const args = ["audit", "--no-progress"];
  const options = {
    provider: input.provider || settings.defaultProvider,
    outDir: input.outDir || settings.defaultOutDir,
    reasoning: input.reasoning || settings.defaultReasoning,
    ...input
  };

  if (options.githubRepo && !settings.allowGithubSource) {
    throw new Error("GitHub source scans are disabled for this plugin.");
  }

  for (const [key, flag] of VALUE_OPTIONS) {
    addValue(args, flag, options[key]);
  }
  for (const [key, flag] of ARRAY_OPTIONS) {
    for (const value of arrayValues(options[key])) {
      addValue(args, flag, value);
    }
  }
  for (const [key, flag] of BOOLEAN_FLAGS) {
    const value = options[key];
    if (value === true || value === "true") args.push(`--${flag}`);
    if ((value === false || value === "false") && NEGATED_FLAGS.has(key)) args.push(`--${NEGATED_FLAGS.get(key)}`);
  }
  return args;
}

export function buildCommandArgs(command, input = {}, settings = {}) {
  if (command === "scan") return buildAuditArgs(input, settings);
  if (command === "plan") return ["plan", ...buildAuditArgs(input, settings).slice(2)];
  if (command === "doctor") return ["doctor", "--no-progress", ...commonProviderArgs(input, settings)];
  if (command === "providers") {
    const args = ["providers"];
    if (input.providerAction) args.push(String(input.providerAction));
    if (input.provider) args.push(String(input.provider));
    if (input.json !== false) args.push("--json");
    return args;
  }
  if (command === "profiles") return ["profiles", "--json"];
  if (command === "compare") return ["compare", required(input.oldRun, "oldRun"), required(input.newRun, "newRun"), "--format", String(input.format || "markdown")];
  if (command === "review") return ["review", required(input.runDir, "runDir"), "--json"];
  if (command === "findings") {
    const args = ["findings", "--json"];
    addValue(args, "run", input.runId || input.runDir);
    addValue(args, "status", input.status);
    if (input.all === true) args.push("--all");
    return args;
  }
  if (command === "triage") return ["triage", required(input.findingId, "findingId"), "--status", required(input.status, "status"), ...noteArgs(input)];
  if (command === "baseline") {
    const action = String(input.action || "list");
    const args = ["baseline", action];
    if (input.findingId) args.push(String(input.findingId));
    args.push(...noteArgs(input));
    return args;
  }
  if (command === "fix") {
    const args = ["fix", required(input.findingIds, "findingIds")];
    if (input.dryRun !== false) args.push("--dry-run");
    for (const commandValue of arrayValues(input.checkCommands)) addValue(args, "check", commandValue);
    return args;
  }
  if (command === "repair-run") {
    const args = ["repair-run", required(input.runDir, "runDir")];
    if (input.force === true) args.push("--force");
    if (input.json !== false) args.push("--json");
    return args;
  }
  if (command === "pr-comment") {
    const args = ["pr-comment", required(input.runDir, "runDir")];
    if (input.dryRun !== false) args.push("--dry-run");
    return args;
  }
  if (command === "next") {
    const args = ["next"];
    addValue(args, "status", input.status);
    return args;
  }
  if (command === "show") return ["show", required(input.findingId, "findingId")];
  if (command === "revalidate") {
    const args = ["revalidate", input.all === true ? "--all" : required(input.findingId, "findingId")];
    if (input.providerRevalidate === true) args.push("--provider-revalidate");
    return args;
  }
  if (command === "issue") {
    const args = ["issue", input.all === true ? "--all" : required(input.findingId, "findingId")];
    if (input.dryRun !== false) args.push("--dry-run");
    for (const label of arrayValues(input.labels)) addValue(args, "label", label);
    for (const assignee of arrayValues(input.assignees)) addValue(args, "assignee", assignee);
    if (input.updateExisting === true) args.push("--update-existing");
    if (input.syncIssues === true) args.push("--sync-issues");
    return args;
  }
  if (command === "github-status") {
    const args = ["github-status", input.all === true ? "--all" : input.findingId ? String(input.findingId) : "--all", "--json"];
    addValue(args, "run", input.runId || input.runDir);
    return args;
  }
  if (command === "publish") {
    const args = ["publish", input.all === true ? "--all" : required(input.findingId, "findingId"), "--as", required(input.as || input.target, "as")];
    addValue(args, "run", input.runId || input.runDir);
    if (input.dryRun !== false) args.push("--dry-run");
    if (input.fork === true) args.push("--fork");
    addValue(args, "publish-language", input.publishLanguage);
    addValue(args, "contribution-policy", input.contributionPolicy);
    return args;
  }
  if (command === "patches") {
    const args = ["patches"];
    if (input.patchId) args.push(String(input.patchId));
    if (input.json !== false) args.push("--json");
    if (input.dryRun === true) args.push("--dry-run");
    return args;
  }
  if (command === "rollback") {
    const args = ["rollback", required(input.patchId, "patchId")];
    if (input.dryRun !== false) args.push("--dry-run");
    return args;
  }
  if (command === "open-pr") {
    const args = ["open-pr", required(input.patchId, "patchId")];
    if (input.dryRun !== false) args.push("--dry-run");
    addValue(args, "base", input.base);
    addValue(args, "branch", input.branch);
    addValue(args, "title", input.title);
    return args;
  }
  if (command === "ci-init") {
    const args = ["ci", "init"];
    addValue(args, "template", input.template);
    if (input.dryRun !== false) args.push("--dry-run");
    if (input.force === true) args.push("--force");
    return args;
  }
  if (command === "clean-locks") {
    const args = ["clean-locks"];
    if (input.force === true) args.push("--force");
    return args;
  }
  if (command === "settings") return buildSettingsArgs(input, settings);
  throw new Error(`Unsupported RepoVista command: ${command}`);
}

export async function runRepoVista(command, args, options = {}) {
  const timeoutMs = positiveNumber(options.timeoutMs, 120000);
  const cwd = options.cwd || process.cwd();
  const executable = String(command || "repovista");
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...(options.env || {}) },
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 3000).unref();
    }, timeoutMs);
    timer.unref();
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, exitCode: null, stdout, stderr: `${stderr}${stderr ? "\n" : ""}${error.message}` });
    });
    child.on("close", (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: exitCode === 0, exitCode, signal, stdout, stderr });
    });
  });
}

export async function commandAvailable(command) {
  const result = await runRepoVista(command, ["version"], { timeoutMs: 10000 });
  return result.ok ? String(result.stdout || "").trim() : "";
}

async function assertAllowedRoot(target, roots) {
  if (!roots.length) return;
  const targetReal = await realpath(target);
  for (const root of roots) {
    const resolved = path.resolve(root);
    try {
      await access(resolved);
      const rootReal = await realpath(resolved);
      const relative = path.relative(rootReal, targetReal);
      if (!relative || (!relative.startsWith("..") && !path.isAbsolute(relative))) return;
    } catch {
      // Ignore invalid configured roots and continue.
    }
  }
  throw new Error(`Repository path is outside the configured allowed roots: ${target}`);
}

function addValue(args, flag, value) {
  if (value === undefined || value === null || value === "") return;
  args.push(`--${flag}`, String(value));
}

function arrayValues(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function commonProviderArgs(input, settings) {
  const args = [];
  addValue(args, "provider", input.provider || settings.defaultProvider);
  addValue(args, "model", input.model);
  addValue(args, "reasoning", input.reasoning || settings.defaultReasoning);
  return args;
}

function buildSettingsArgs(input = {}, settings = {}) {
  const action = String(input.action || "get");
  if (action === "get") return input.key ? ["settings", "get", String(input.key)] : ["settings", "get"];
  if (action === "reset") {
    if (!settings.allowWriteActions) throw new Error("RepoVista write actions are disabled.");
    return input.key ? ["settings", "reset", String(input.key)] : ["settings", "reset"];
  }
  if (action === "set") {
    if (!settings.allowWriteActions) throw new Error("RepoVista write actions are disabled.");
    return ["settings", "set", required(input.key, "key"), required(input.value, "value")];
  }
  throw new Error(`Unsupported settings action: ${action}`);
}

function noteArgs(input = {}) {
  const args = [];
  addValue(args, "note", input.note);
  return args;
}

function required(value, name) {
  if (value === undefined || value === null || value === "") throw new Error(`${name} is required.`);
  return String(value);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
