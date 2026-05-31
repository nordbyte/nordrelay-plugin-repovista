export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function attr(value) {
  return escapeHtml(value);
}

export function badge(text, status = "disabled") {
  return `<span class="badge ${statusClass(status)}">${escapeHtml(text)}</span>`;
}

export function statusClass(status) {
  const value = String(status ?? "").toLowerCase();
  if (["ok", "success", "enabled", "latest"].includes(value)) return "enabled";
  if (["warn", "warning", "running", "queued"].includes(value)) return "warning";
  if (["error", "failed", "cancelled", "disabled"].includes(value)) return value === "disabled" ? "disabled" : "failed";
  return "disabled";
}

export function compactDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return `${hours}h ${restMinutes}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

export function formatDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "-";
}

export function truncate(value, max = 120) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

export function markdownPreview(value, max = 8000) {
  return `<pre class="log-view">${escapeHtml(truncate(value, max))}</pre>`;
}

export function splitList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
