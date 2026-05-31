import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { escapeHtml, truncate } from "./format.js";

const SECTION_FILES = [
  ["summary", "Summary", "index.md"],
  ["inventory", "Inventory", "00-inventory.md"],
  ["architecture", "Architecture", "01-architecture-report.md"],
  ["code-quality", "Code Quality", "02-code-quality-report.md"],
  ["risk-and-bug", "Risk and Bug", "03-risk-and-bug-report.md"],
  ["feature-roadmap", "Feature Roadmap", "04-feature-roadmap.md"],
];

const SAFE_ARTIFACTS = new Set([
  "index.md",
  "00-inventory.md",
  "01-architecture-report.md",
  "02-code-quality-report.md",
  "03-risk-and-bug-report.md",
  "04-feature-roadmap.md",
  "findings.json",
  "findings.jsonl",
  "findings.sarif",
  "features.json",
  "meta.json",
  "project-map.json",
  "prompt-manifest.json",
  "report.html",
  "report.json",
  "status.json",
  "structured-reports.json",
  "summary.json",
]);

export async function listReports(repoPath, outDir = ".repovista", options = {}) {
  const root = reportRoot(repoPath, outDir);
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const reports = await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => readReportSummary(path.join(root, entry.name), entry.name)));
  return reports
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.startedAt || b.updatedAt || "") - Date.parse(a.startedAt || a.updatedAt || "") || b.runId.localeCompare(a.runId))
    .slice(0, Number(options.limit) || 50);
}

export async function readReportDetail(repoPath, outDir, runIdOrDir) {
  const runDir = resolveRunDir(repoPath, outDir, runIdOrDir);
  const summary = await readReportSummary(runDir, path.basename(runDir));
  if (!summary) throw new Error(`RepoVista report not found: ${runIdOrDir}`);
  const sections = [];
  for (const [id, title, fileName] of SECTION_FILES) {
    const content = await readText(path.join(runDir, fileName));
    if (content !== undefined) sections.push({ id, title, fileName, content });
  }
  return { ...summary, sections };
}

export async function readReportArtifact(repoPath, outDir, runIdOrDir, fileName) {
  const normalized = normalizeArtifact(fileName);
  if (!SAFE_ARTIFACTS.has(normalized)) throw new Error(`Unsupported report artifact: ${fileName}`);
  const runDir = resolveRunDir(repoPath, outDir, runIdOrDir);
  const filePath = path.join(runDir, normalized);
  assertInside(runDir, filePath);
  const [content, info] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
  if (!info.isFile()) throw new Error(`Report artifact is not a file: ${normalized}`);
  return { fileName: normalized, filePath, size: info.size, content };
}

export async function latestStatus(repoPath, outDir = ".repovista") {
  const reports = await listReports(repoPath, outDir, { limit: 10 });
  const running = reports.find((report) => report.status?.status === "running");
  return running?.status || reports[0]?.status;
}

export function renderReportText(detail) {
  return [
    `# ${detail.runId}`,
    "",
    `Repository: ${detail.projectRoot || "-"}`,
    `Status: ${detail.statusLabel}`,
    `Provider: ${detail.provider || "-"}`,
    `Model: ${detail.model || "-"}`,
    `Findings: ${detail.findingCount}`,
    "",
    ...detail.sections.map((section) => `## ${section.title}\n\n${section.content}`)
  ].join("\n");
}

async function readReportSummary(runDir, fallbackRunId) {
  const [meta, summary, findings, status] = await Promise.all([
    readJson(path.join(runDir, "meta.json")),
    readJson(path.join(runDir, "summary.json")),
    readJson(path.join(runDir, "findings.json")),
    readJson(path.join(runDir, "status.json")),
  ]);
  if (!meta && !summary && !status) return undefined;
  const info = await stat(runDir).catch(() => undefined);
  const runId = meta?.runId || summary?.runId || status?.runId || fallbackRunId;
  const normalizedFindings = Array.isArray(findings) ? findings : Array.isArray(meta?.findings) ? meta.findings : Array.isArray(summary?.findings) ? summary.findings : [];
  const startedAt = meta?.startedAt || status?.startedAt;
  const completedAt = meta?.completedAt || status?.completedAt;
  const updatedAt = status?.updatedAt || completedAt || startedAt || info?.mtime?.toISOString();
  const statusLabel = status?.status || (meta?.exitCode === 0 ? "success" : meta?.exitCode === 130 ? "cancelled" : meta?.exitCode ? "failed" : "unknown");
  return {
    runId,
    runDir,
    projectRoot: meta?.projectRoot || status?.projectRoot,
    startedAt,
    completedAt,
    updatedAt,
    durationMs: meta?.durationMs || status?.durationMs,
    provider: meta?.ai?.displayName || meta?.ai?.provider || meta?.options?.provider,
    model: meta?.ai?.model || meta?.codex?.model,
    reasoning: meta?.ai?.reasoning || meta?.codex?.reasoning,
    exitCode: meta?.exitCode,
    statusLabel,
    findingCount: normalizedFindings.length || countFindings(meta?.findingCounts || summary?.findingCounts),
    findings: normalizedFindings.slice(0, 500),
    status
  };
}

function reportRoot(repoPath, outDir) {
  return path.resolve(repoPath, outDir || ".repovista");
}

function resolveRunDir(repoPath, outDir, runIdOrDir) {
  const root = reportRoot(repoPath, outDir);
  const raw = String(runIdOrDir || "").trim();
  if (!raw) throw new Error("Run id or directory is required.");
  const runDir = path.isAbsolute(raw) ? path.resolve(raw) : path.join(root, raw);
  assertInside(root, runDir);
  return runDir;
}

function normalizeArtifact(fileName) {
  const normalized = String(fileName || "").replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("..") || normalized.includes("\0")) {
    throw new Error(`Invalid artifact file name: ${fileName}`);
  }
  return normalized;
}

function assertInside(base, target) {
  const relative = path.relative(path.resolve(base), path.resolve(target));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Path resolves outside report root: ${target}`);
}

async function readJson(filePath) {
  try {
    const text = await readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function readText(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return undefined;
  }
}

function countFindings(counts) {
  if (!counts || typeof counts !== "object") return 0;
  return Object.values(counts).reduce((total, value) => total + (Number(value) || 0), 0);
}

export function reportTableRows(reports) {
  return reports.map((report) => ({
    run: `<button type="button" class="link-button" data-report-detail="${escapeHtml(report.runId)}">${escapeHtml(truncate(report.runId, 36))}</button>`,
    status: report.statusLabel,
    findings: String(report.findingCount),
    provider: report.provider || "-",
    updated: report.updatedAt || "-",
  }));
}
