# Changelog

## 0.3.0 — 2026-11-03

- Support the expanded live model catalog and embedding task outputs, including measured input usage.
- Preserve exact multimodal USD rate metadata and document native embedding/speech interfaces.


All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-01

The PopNow API bills in exact USD from its own API balance, separate from website credits. The CLI now shows,
confirms and explains every amount in USD.

### Changed

- `jobs create` confirms the hold with `expectedCostUsd`, the quote's exact `maxChargeUsd`, instead of
  `expectedCredits`. The price line reads `Price: $0.0342 expected; at most $0.0405 is held from your API balance`.
- `balance` prints `Available`, `Held` and `Total` in USD from `availableUsd`, `heldUsd` and `totalUsd`, with a
  link to add funds. `jobs quote` adds the same price line; `jobs get`, `jobs wait` and `jobs create --wait` add
  `Charged:` or `Held:` in USD from `costUsd`.
- Human-readable output leaves out a deprecated credit field (`maxCredits`, `expectedCredits`,
  `estimatedCredits`, `credits`, `exactCredits`, `availableCredits`, `heldCredits`, `totalCredits`) whenever the
  same object carries its USD field. `--json` output is unchanged and still passes every field through.
- Insufficient balance (`40201`) points to https://popnow.ai/api/console/billing. The asset library hints no
  longer suggest that a top-up unlocks storage.
- `docs` lists the developer MCP server (`https://api.popnow.ai/api/v1/mcp`, setup at https://popnow.ai/api/mcp)
  and the agent skills catalog (https://popnow.ai/api/skills); `docs open mcp` describes the developer server,
  and the new `agent-skills` and `skills` topics open the skills docs and catalog.
- README and llms.txt describe the USD API balance and link API pricing, API billing and the developer MCP.

### Deprecated

- The credit fields in the client types (`TaskQuote.maxCredits`, `TaskQuote.expectedCredits`,
  `CreatedTask.estimatedCredits`, `TaskRecord.credits`, `TaskRecord.exactCredits`,
  `CreateTaskRequest.expectedCredits` and the new `Balance` credit fields). They are read only when a response
  carries no USD field, and `expectedCredits` is sent only when a quote has no USD amount at all.

### Added

- `skills search|info|add|list-installed|remove` (alias `agent-skills`): find PopNow agent skills and install
  them for Claude Code, Codex, Cursor, Gemini CLI, GitHub Copilot or OpenCode, in the user or the project
  skills folder. The agent is detected from its folder when `--agent` is omitted; `--dir`, `--force` and
  `--dry-run` are supported.
- Skill downloads follow the API's redirect to a short-lived link without sending the API key there. Every archive
  is checked before anything is written (one `popnow-<slug>/` folder with a `SKILL.md`; no absolute paths, `..`
  or symbolic links; about 100 MB at most) and installed in a single move.

### Fixed

- Credit unit in help text, README and llms.txt: 1 credit = $0.001 (PopNow changed the unit on 2026-10-19; credit amounts are 10x the old ones).

## [0.1.0] - 2026-10-19

### Added

- First release of the `popnow` command-line client for the PopNow API.
- `status`, `models list|get`, `balance`, `usage`.
- `jobs list|get|wait|quote|create|retry|purge` with quote-then-confirm, `--yes`, `--wait`, automatic
  `Idempotency-Key`, `--retention` and exit code 2 for tasks that finished without succeeding.
- `files upload|download-url`, including documents and `.safetensors` LoRA weights.
- `assets list|get|usage` for the private asset library.
- `webhooks verify` for task callbacks and account endpoints (Standard Webhooks).
- `docs`, `docs open <topic>` and `docs search <words>`.
- `--json` output everywhere, a `Next:` hint for every documented error code, and `HTTPS_PROXY` support.
