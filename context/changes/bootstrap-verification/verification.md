---
bootstrapped_at: 2026-11-07T20:59:20Z
starter_id: dotnet
starter_name: ".NET (ASP.NET Core webapi)"
project_name: trading-tutor
language_family: dotnet
package_manager: dotnet
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: "dotnet list package --vulnerable --include-transitive"
---

## Hand-off

```yaml
starter_id: dotnet
package_manager: dotnet
project_name: trading-tutor
hints:
  language_family: dotnet
  team_size: solo
  deployment_target: self-host
  ci_provider: github-actions
  ci_default_flow: manual-promotion
  bootstrapper_confidence: verified
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: false
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

## Why this stack

TradingTutor is a solo, 2-week, PC-local web app: ASP.NET Core API matches the CryptoTools backend shape, with a TypeScript/React UI as a companion (not part of `dotnet new webapi`). Self-host + GitHub Actions with manual promotion fits “run on my PC, no cloud deploy yet.” Auth and payments are out; AI coaching (FR-010) is in scope but not scaffolded by the starter — wire a local LLM after bootstrap. Realtime market feed is deferred.

## Pre-scaffold verification

| Signal             | Value                              | Severity | Notes                              |
| ------------------ | ---------------------------------- | -------- | ---------------------------------- |
| npm package        | not run                            | —        | non-JS starter; no create-* CLI    |
| GitHub repo        | not run                            | —        | docs_url is learn.microsoft.com, not github.com |

## Scaffold log

**Resolved invocation**: `dotnet new webapi -n .bootstrap-scaffold --no-restore`
**Strategy**: subdir-then-move
**Exit code**: 0
**Files moved**: 6
**Conflicts (.scaffold siblings)**: none
**.gitignore handling**: absent in scaffold
**.bootstrap-scaffold cleanup**: deleted

Move log:
- MOVE: `.bootstrap-scaffold.csproj`
- MOVE: `.bootstrap-scaffold.http`
- MOVE: `appsettings.Development.json`
- MOVE: `appsettings.json`
- MOVE: `Program.cs`
- MOVE: `Properties\launchSettings.json`

Note: the project assembly name follows the temp scaffold directory (`.bootstrap-scaffold`). Rename the `.csproj` / `.http` files to `trading-tutor` (or similar) if you want the hand-off project name reflected on disk.

## Post-scaffold audit

**Tool**: `dotnet list package --vulnerable --include-transitive`
**Summary**: 0 CRITICAL, 1 HIGH, 0 MODERATE, 0 LOW
**Direct vs transitive**: not distinguished by this tool beyond the Transitive Package column (finding below is transitive)

#### CRITICAL findings

(none)

#### HIGH findings

- **Package**: Microsoft.OpenApi 2.0.0 (transitive)
- **Severity**: High
- **Advisory**: https://github.com/advisories/GHSA-v5pm-xwqc-g5wc
- **Notes**: Surfaced during restore as NU1903 and confirmed by `dotnet list package --vulnerable`

#### MODERATE findings

(none)

#### LOW / INFO findings

(none)

## Hints recorded but not acted on

| Hint                       | Value                              |
| -------------------------- | ---------------------------------- |
| bootstrapper_confidence    | verified                           |
| quality_override           | false                              |
| path_taken                 | standard                           |
| self_check_answers         | null                               |
| team_size                  | solo                               |
| deployment_target          | self-host                          |
| ci_provider                | github-actions                     |
| ci_default_flow            | manual-promotion                   |
| has_auth                   | false                              |
| has_payments               | false                              |
| has_realtime               | false                              |
| has_ai                     | true                               |
| has_background_jobs        | false                              |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review any `.scaffold` siblings the conflict policy created and decide which version of each file to keep.
- Address audit findings per your project's risk tolerance — the full breakdown is in this log.
- Consider renaming `.bootstrap-scaffold.csproj` / `.bootstrap-scaffold.http` to match `trading-tutor`.
