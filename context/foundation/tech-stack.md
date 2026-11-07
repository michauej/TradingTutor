---
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
---

## Why this stack

TradingTutor is a solo, 2-week, PC-local web app: ASP.NET Core API matches the CryptoTools backend shape, with a TypeScript/React UI as a companion (not part of `dotnet new webapi`). Self-host + GitHub Actions with manual promotion fits “run on my PC, no cloud deploy yet.” Auth and payments are out; AI coaching (FR-010) is in scope but not scaffolded by the starter — wire a local LLM after bootstrap. Realtime market feed is deferred.
