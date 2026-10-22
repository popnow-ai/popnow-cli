# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
