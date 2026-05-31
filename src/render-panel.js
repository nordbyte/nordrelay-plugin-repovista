import { attr, badge, compactDuration, escapeHtml, formatDate, markdownPreview, truncate } from "./format.js";

const PROVIDERS = ["codex", "claude", "gemini", "opencode", "aider"];
const AUDIT_PROFILES = ["", "quick", "security", "pr-review", "release-readiness", "architecture"];
const REVIEW_MODES = ["default", "deslopify", "security", "test-gaps"];
const PHASES = ["architecture", "code-quality", "risk-and-bug", "feature-roadmap", "summary"];
const EXPORTS = ["sarif", "html", "jsonl", "github"];

export function renderPanel(input = {}, context = {}, settings = {}) {
  const aggregate = input.aggregate && typeof input.aggregate === "object" ? input.aggregate : {};
  const results = Array.isArray(aggregate.results) ? aggregate.results : [];
  const localResult = input.localData ? { node: context.runtime || { name: "Local node" }, ok: true, output: input.localData } : undefined;
  const nodes = results.length ? results : localResult ? [localResult] : [];
  const repoPath = input.repoPath || settings.defaultRepoPath || context.runtime?.workspace || "";
  const outDir = input.outDir || settings.defaultOutDir || ".repovista";
  const provider = input.provider || settings.defaultProvider || "codex";
  const reasoning = input.reasoning || settings.defaultReasoning || "xhigh";
  const selectedTab = normalizeTab(input.tab);
  return `<div class="stack" data-repovista-panel data-tab="${attr(selectedTab)}" data-repo-path="${attr(repoPath)}" data-out-dir="${attr(outDir)}">
    <div class="section-header">
      <div>
        <h1>RepoVista <small>- ${escapeHtml(nodes.length || 1)} node${(nodes.length || 1) === 1 ? "" : "s"}</small></h1>
        <small>Run scans, follow progress, and browse generated reports.</small>
      </div>
      <div class="row">
        <button type="button" class="secondary mini-button" data-repovista-reload>Reload</button>
      </div>
    </div>
    <div class="section-tabs" role="tablist">
      ${tabButton("scan", "Scan", selectedTab)}
      ${tabButton("jobs", "Jobs", selectedTab)}
      ${tabButton("reports", "Reports", selectedTab)}
      ${tabButton("findings", "Findings", selectedTab)}
      ${tabButton("tools", "Tools", selectedTab)}
      ${tabButton("settings", "Settings", selectedTab)}
    </div>
    <section class="panel" data-tab-panel="scan"${selectedTab === "scan" ? "" : " hidden"}>
      ${renderScanForm({ ...input, repoPath, outDir, provider, reasoning }, settings)}
    </section>
    <section class="panel" data-tab-panel="jobs"${selectedTab === "jobs" ? "" : " hidden"}>
      ${renderJobs(nodes)}
    </section>
    <section class="panel" data-tab-panel="reports"${selectedTab === "reports" ? "" : " hidden"}>
      ${renderReports(nodes)}
    </section>
    <section class="panel" data-tab-panel="findings"${selectedTab === "findings" ? "" : " hidden"}>
      ${renderFindings(nodes)}
    </section>
    <section class="panel" data-tab-panel="tools"${selectedTab === "tools" ? "" : " hidden"}>
      ${renderTools()}
    </section>
    <section class="panel" data-tab-panel="settings"${selectedTab === "settings" ? "" : " hidden"}>
      ${renderSettings(settings)}
    </section>
    <section class="panel" data-repovista-output hidden>
      <div class="section-header"><h2>Output</h2><button type="button" class="secondary mini-button" data-output-clear>Clear</button></div>
      <div data-output-body></div>
    </section>
  </div>`;
}

export function panelScript() {
  return `
  var root=(typeof api!=='undefined'&&api.root?api.root.querySelector('[data-repovista-panel]'):null)||(document.currentScript&&document.currentScript.closest('[data-repovista-panel]'));
  if(!root)return;
  function q(sel){return root.querySelector(sel)}
  function qa(sel){return Array.prototype.slice.call(root.querySelectorAll(sel))}
  function value(name){var el=q('[name="'+name+'"]');if(!el)return undefined;if(el.type==='checkbox')return el.checked;if(el.multiple)return Array.prototype.slice.call(el.selectedOptions).map(function(o){return o.value});return el.value}
  function payload(extra){
    var data={repoPath:value('repoPath'),outDir:value('outDir'),provider:value('provider'),model:value('model'),profile:value('profile'),reasoning:value('reasoning'),sandbox:value('sandbox'),parallel:value('parallel'),auditProfile:value('auditProfile'),reviewMode:value('reviewMode'),language:value('language'),githubRepo:value('githubRepo'),githubRef:value('githubRef'),since:value('since'),baseRef:value('baseRef'),workspace:value('workspace'),includes:value('includes'),ignores:value('ignores'),phases:value('phases'),exportFormats:value('exportFormats'),checkCommands:value('checkCommands'),runChecks:value('runChecks'),strictReports:value('strictReports'),repairReports:value('repairReports'),deepReview:value('deepReview'),snapshot:value('snapshot'),failOnDrift:value('failOnDrift'),failOnWeakEvidence:value('failOnWeakEvidence'),fastMode:value('fastMode'),keepLogs:value('keepLogs'),json:value('json')};
    Object.keys(data).forEach(function(key){if(data[key]===''||data[key]===undefined)data[key]=undefined});
    return Object.assign(data,extra||{});
  }
  function reload(extra){if(api&&api.reload)return api.reload(payload(extra||{tab:root.dataset.tab||'scan'}));}
  function showOutput(title,body){
    var section=q('[data-repovista-output]');var target=q('[data-output-body]');if(!section||!target)return;
    section.hidden=false;target.innerHTML='<h3>'+escapeHtml(title)+'</h3><pre class="log-view">'+escapeHtml(typeof body==='string'?body:JSON.stringify(body,null,2))+'</pre>';section.scrollIntoView({block:'nearest'});
  }
  function escapeHtml(v){return String(v==null?'':v).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',\"'\":'&#39;'}[ch]})}
  qa('[data-tab-id]').forEach(function(button){button.addEventListener('click',function(){root.dataset.tab=button.dataset.tabId;qa('[data-tab-id]').forEach(function(b){var active=b===button;b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false')});qa('[data-tab-panel]').forEach(function(panel){panel.hidden=panel.dataset.tabPanel!==button.dataset.tabId});reload({tab:button.dataset.tabId});});});
  var reloadButton=q('[data-repovista-reload]');if(reloadButton)reloadButton.addEventListener('click',function(){reload({tab:root.dataset.tab||'scan'});});
  var scanButton=q('[data-scan-start]');if(scanButton)scanButton.addEventListener('click',async function(){scanButton.disabled=true;try{var job=await api.jobs.start('scan',payload({tab:'jobs'}));api.toast&&api.toast('RepoVista scan started');showOutput('Scan job',job);root.dataset.tab='jobs';reload({tab:'jobs'});}catch(e){showOutput('Scan failed',e&&e.message?e.message:e);}finally{scanButton.disabled=false;}});
  qa('[data-command]').forEach(function(button){button.addEventListener('click',async function(){button.disabled=true;try{var result=await api.invokeCommand(button.dataset.command,payload(commandExtra(button)));showOutput(button.textContent.trim(),result&&result.output!==undefined?result.output:result);}catch(e){showOutput('Command failed',e&&e.message?e.message:e);}finally{button.disabled=false;}});});
  qa('[data-report-detail]').forEach(function(button){button.addEventListener('click',async function(){try{var result=await api.invokeCommand('report-detail',payload({runId:button.dataset.reportDetail}));showOutput('Report '+button.dataset.reportDetail,result&&result.output&&result.output.text?result.output.text:result);}catch(e){showOutput('Report failed',e&&e.message?e.message:e);}});});
  var clear=q('[data-output-clear]');if(clear)clear.addEventListener('click',function(){q('[data-repovista-output]').hidden=true;q('[data-output-body]').innerHTML='';});
  function commandExtra(button){var extra={};if(button.dataset.runId)extra.runId=button.dataset.runId;if(button.dataset.runDir)extra.runDir=button.dataset.runDir;if(button.dataset.providerAction)extra.providerAction=button.dataset.providerAction;return extra;}
  `;
}

function renderScanForm(input, settings) {
  return `<div class="stack monitor-comparison-panel repovista-scan-panel">
    <div class="section-header"><h2>Start Scan</h2><div class="row">${badge("write actions " + (settings.allowWriteActions ? "enabled" : "disabled"), settings.allowWriteActions ? "warning" : "disabled")}</div></div>
    <div class="form-grid">
      ${field("Repository path", "repoPath", input.repoPath, "text")}
      ${field("Output dir", "outDir", input.outDir, "text")}
      ${selectField("Provider", "provider", PROVIDERS, input.provider)}
      ${field("Model", "model", input.model || "", "text")}
      ${field("Profile", "profile", input.profile || "", "text")}
      ${field("Reasoning", "reasoning", input.reasoning, "text")}
      ${selectField("Sandbox", "sandbox", ["read-only", "workspace-write"], input.sandbox || "read-only")}
      ${selectField("Parallel", "parallel", ["auto", "off", "1", "2", "3", "4", "5"], input.parallel || "auto")}
      ${selectField("Audit profile", "auditProfile", AUDIT_PROFILES, input.auditProfile || "")}
      ${selectField("Review mode", "reviewMode", REVIEW_MODES, input.reviewMode || "default")}
      ${field("Language", "language", input.language || "English", "text")}
      ${field("GitHub repo", "githubRepo", input.githubRepo || "", "text")}
      ${field("GitHub ref", "githubRef", input.githubRef || "", "text")}
      ${field("Since", "since", input.since || "", "text")}
      ${field("Base ref", "baseRef", input.baseRef || "", "text")}
      ${field("Workspace", "workspace", input.workspace || "", "text")}
      ${field("Includes", "includes", listValue(input.includes), "text")}
      ${field("Ignores", "ignores", listValue(input.ignores), "text")}
      ${multiSelectField("Phases", "phases", PHASES, input.phases)}
      ${multiSelectField("Exports", "exportFormats", EXPORTS, input.exportFormats || ["sarif", "html", "jsonl"])}
      ${field("Check commands", "checkCommands", listValue(input.checkCommands), "text")}
    </div>
    <div class="row">
      ${checkbox("Run checks", "runChecks", input.runChecks !== false)}
      ${checkbox("Strict reports", "strictReports", input.strictReports !== false)}
      ${checkbox("Repair reports", "repairReports", input.repairReports !== false)}
      ${checkbox("Deep review", "deepReview", input.deepReview === true)}
      ${checkbox("Snapshot", "snapshot", input.snapshot === true)}
      ${checkbox("Fast", "fastMode", input.fastMode === true)}
      ${checkbox("Keep logs", "keepLogs", input.keepLogs === true)}
      ${checkbox("JSON", "json", input.json === true)}
      ${checkbox("Fail on drift", "failOnDrift", input.failOnDrift === true)}
      ${checkbox("Fail on weak evidence", "failOnWeakEvidence", input.failOnWeakEvidence === true)}
    </div>
    <div class="toolbar">
      <button type="button" data-scan-start>Start scan</button>
      <button type="button" class="secondary" data-command="plan">Plan</button>
      <button type="button" class="secondary" data-command="doctor">Doctor</button>
      <button type="button" class="secondary" data-command="providers">Providers</button>
      <button type="button" class="secondary" data-command="profiles">Profiles</button>
    </div>
  </div>`;
}

function renderJobs(nodes) {
  const rows = nodes.flatMap((item, index) => {
    const node = item.node || {};
    const output = item.result?.output || item.output || {};
    const reports = output.reports || [];
    const running = reports.filter((report) => report.statusLabel === "running" || report.status?.status === "running");
    return running.map((report) => `<tr><td>${escapeHtml(node.name || node.id || `Node ${index + 1}`)}</td><td>${escapeHtml(report.runId)}</td><td>${badge("running", "warning")}</td><td>${escapeHtml(report.status?.currentStep || "-")}</td><td>${escapeHtml(report.startedAt ? compactDuration(Date.now() - Date.parse(report.startedAt)) : "-")}</td></tr>`);
  });
  return table(["Node", "Run", "Status", "Step", "Duration"], rows, "No running RepoVista scans found.");
}

function renderReports(nodes) {
  const rows = nodes.flatMap((item, index) => {
    const node = item.node || {};
    const output = item.result?.output || item.output || {};
    const reports = output.reports || [];
    if (!item.ok) return [`<tr><td>${escapeHtml(node.name || node.id || `Node ${index + 1}`)}</td><td colspan="6">${escapeHtml(item.error || "Unavailable")}</td></tr>`];
    return reports.map((report) => `<tr><td>${escapeHtml(node.name || node.id || `Node ${index + 1}`)}</td><td><button type="button" class="link-button" data-report-detail="${attr(report.runId)}">${escapeHtml(truncate(report.runId, 34))}</button></td><td>${badge(report.statusLabel, report.statusLabel)}</td><td>${escapeHtml(String(report.findingCount ?? 0))}</td><td>${escapeHtml(report.provider || "-")}</td><td title="${attr(formatDate(report.updatedAt))}">${escapeHtml(report.updatedAt ? compactDuration(Date.now() - Date.parse(report.updatedAt)) + " ago" : "-")}</td><td>${escapeHtml(report.projectRoot || "-")}</td></tr>`);
  });
  return table(["Node", "Run", "Status", "Findings", "Provider", "Updated", "Repository"], rows, "No RepoVista reports found.");
}

function renderFindings(nodes) {
  const findings = nodes.flatMap((item) => {
    const output = item.result?.output || item.output || {};
    return (output.reports || []).flatMap((report) => (report.findings || []).slice(0, 20).map((finding) => ({ report, finding, node: item.node || {} })));
  });
  const rows = findings.map(({ node, report, finding }) => `<tr><td>${escapeHtml(node.name || node.id || "Node")}</td><td>${escapeHtml(report.runId)}</td><td>${badge(finding.severity || "unknown", severityStatus(finding.severity))}</td><td>${escapeHtml(finding.status || "open")}</td><td>${escapeHtml(truncate(finding.title || finding.id || "Finding", 120))}</td></tr>`);
  return table(["Node", "Run", "Severity", "Status", "Finding"], rows, "No findings found in the loaded reports.");
}

function renderTools() {
  return `<div class="toolbar">
    <button type="button" class="secondary" data-command="list-reports">List reports JSON</button>
    <button type="button" class="secondary" data-command="settings">Read settings</button>
  </div><p><small>Write-capable RepoVista commands are available through plugin commands and remain gated by plugin settings.</small></p>`;
}

function renderSettings(settings) {
  const rows = Object.entries(settings).map(([key, value]) => `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(Array.isArray(value) ? value.join(", ") : String(value))}</td></tr>`);
  return table(["Setting", "Value"], rows, "No plugin settings.");
}

function table(headers, rows, empty) {
  if (!rows.length) return `<div class="empty-state">${escapeHtml(empty)}</div>`;
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

function tabButton(id, label, active) {
  const isActive = id === active;
  return `<button type="button" role="tab" class="${isActive ? "active" : ""}" aria-selected="${isActive ? "true" : "false"}" data-tab-id="${attr(id)}">${escapeHtml(label)}</button>`;
}

function field(label, name, value, type) {
  return `<label><span>${escapeHtml(label)}</span><input type="${attr(type)}" name="${attr(name)}" value="${attr(value || "")}"></label>`;
}

function selectField(label, name, options, value) {
  return `<label><span>${escapeHtml(label)}</span><select name="${attr(name)}">${options.map((option) => `<option value="${attr(option)}"${String(option) === String(value) ? " selected" : ""}>${escapeHtml(option || "default")}</option>`).join("")}</select></label>`;
}

function multiSelectField(label, name, options, value) {
  const selected = new Set(Array.isArray(value) ? value.map(String) : String(value || "").split(",").map((item) => item.trim()).filter(Boolean));
  return `<label><span>${escapeHtml(label)}</span><select name="${attr(name)}" multiple size="4">${options.map((option) => `<option value="${attr(option)}"${selected.has(option) ? " selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
}

function checkbox(label, name, checked) {
  return `<label class="checkbox"><input type="checkbox" name="${attr(name)}"${checked ? " checked" : ""}> <span>${escapeHtml(label)}</span></label>`;
}

function listValue(value) {
  return Array.isArray(value) ? value.join(",") : String(value || "");
}

function normalizeTab(value) {
  const tab = String(value || "");
  return ["scan", "jobs", "reports", "findings", "tools", "settings"].includes(tab) ? tab : "scan";
}

function severityStatus(value) {
  const severity = String(value || "").toLowerCase();
  if (severity === "critical" || severity === "high") return "failed";
  if (severity === "medium") return "warning";
  return "disabled";
}
