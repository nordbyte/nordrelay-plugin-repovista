# NordRelay RepoVista Plugin

Run RepoVista scans and browse generated reports from the NordRelay WebUI.

## Features

- Start RepoVista audits from a NordRelay plugin panel.
- Configure provider, model, reasoning, sandbox, phases, exports, quality gates, checks, source scope, and output location.
- Track running scans through RepoVista `status.json` files when the installed RepoVista version supports them.
- Browse completed report runs, sections, findings, and generated artifacts.
- Run RepoVista helper commands such as `plan`, `doctor`, `providers`, `profiles`, `compare`, `review`, `findings`, `patches`, and `settings`.
- Use dry-run-first write actions for triage, baseline, fixes, patch rollback, CI setup, and GitHub publishing when explicitly enabled.
- Aggregate data across NordRelay peers where the plugin is installed.

## Requirements

- NordRelay `>=0.9.14`
- Node.js `>=22`
- RepoVista available as `repovista` on `PATH`, or configure a custom command in plugin settings

## Install

```bash
nordrelay plugin install github:nordbyte/nordrelay-plugin-repovista --enable --approve
```

Install the plugin on every peer where RepoVista scans should run. Peers without the plugin will not return RepoVista reports.

## Safety

The plugin is read-oriented by default. Scans write RepoVista report output to the selected repository output directory. Mutating actions such as triage, baseline changes, fixes, rollback, settings writes, CI workflow creation, and GitHub publishing require `allowWriteActions=true`. GitHub publishing also requires `allowGithubPublish=true`.

Use `allowedRepoRoots` to restrict which local paths can be scanned from the WebUI.

## Data

RepoVista reports are stored in the configured repository output directory, normally `.repovista`. Plugin state is stored by NordRelay under:

```text
~/.nordrelay/plugins/data/repovista/
```
