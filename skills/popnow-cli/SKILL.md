---
name: popnow-cli
description: Use the PopNow CLI (@popnow/cli) to generate AI images, videos, music and speech from the terminal or CI - list models and schemas, quote exact USD prices, create and wait for jobs, upload reference files, retry or purge tasks and verify webhooks. Use when the user wants to generate media from a shell, script or pipeline with PopNow.
---

# PopNow CLI

The `popnow` command calls the PopNow API with the key in `POPNOW_API_KEY`. There is deliberately no `--api-key` option: never put a key on the command line, in shell history or in committed files.

## Install and check

```bash
npm install -g @popnow/cli     # or run once: npx @popnow/cli status
popnow status                  # no key needed: checks the API answers
popnow balance                 # API balance in USD
```

The API balance is prepaid in USD at https://popnow.ai/api/console/billing and is separate from popnow.ai website credits. Create keys at https://popnow.ai/api/console/keys.

## Find a model and its input

```bash
popnow models list --modality video --task image-to-video
popnow --json models get alibaba/wan-3.0/image-to-video   # price and input JSON Schema
```

Build the input file from the schema the CLI returns. Do not guess field names.

## Quote, confirm, create

```bash
popnow jobs quote --model alibaba/wan-3.0/image-to-video --input-file input.json   # nothing is created or held
popnow jobs create --model alibaba/wan-3.0/image-to-video --input-file input.json
```

Show the user the quoted price and get a clear yes before `jobs create`. Use `--json` when you need to parse output. In CI, run non-interactively with a stable idempotency key so a retried step does not create a second job; read `popnow jobs create --help` for the exact flags in the installed version.

## Follow tasks

```bash
popnow jobs list --state failed --from 2026-10-01
popnow jobs get <job-id>
popnow jobs wait <job-id> --wait-timeout-ms 900000
popnow jobs retry <job-id> --wait
popnow jobs purge <job-id>
```

## Your own files

```bash
popnow files upload ./photo.jpg     # prints { uri: "popnow://f/fil_..." }
```

Use the returned `popnow://` URI in the model input wherever the schema expects an image, video or audio URL.

## Webhooks

`popnow webhooks verify --body-file body.json ...` checks a task callback signature. See `popnow webhooks verify --help` for the header and secret options.

## Agent skills

```bash
popnow skills search product video --type video
popnow skills add <slug>
```

## Rules

- Quote before every paid job and wait for approval; do not raise a price cap silently.
- Retry a timed-out create only with the same idempotency key.
- Only upload material the user has the rights to use.

Docs: https://popnow.ai/docs · CLI source: https://github.com/popnow-ai/popnow-cli · Support: support@popnow.ai
