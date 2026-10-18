# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/).

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
