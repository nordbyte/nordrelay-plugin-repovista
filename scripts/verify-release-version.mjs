import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const expected = process.env.NORDRELAY_RELEASE_VERSION
  || process.env.GITHUB_RELEASE_TAG
  || (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : "");
const normalized = String(expected || "").replace(/^v/, "");

if (!normalized) {
  console.error("Release version is required.");
  process.exit(1);
}
if (pkg.version !== normalized) {
  console.error(`package.json version ${pkg.version} does not match release ${normalized}.`);
  process.exit(1);
}
console.log(`Package version ${pkg.version} matches release ${normalized}.`);
