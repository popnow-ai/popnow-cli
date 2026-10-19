<p align="center">
  <a href="https://popnow.ai">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="assets/popnow-wordmark-dark.png">
      <source media="(prefers-color-scheme: light)" srcset="assets/popnow-wordmark.png">
      <img alt="PopNow" src="assets/popnow-wordmark.png" width="280">
    </picture>
  </a>
</p>

<h1 align="center">PopNow CLI — AI Video &amp; Image Generation from the Command Line</h1>

<p align="center">
  <strong><code>popnow</code> is the official command-line client for the PopNow API</strong>: it generates AI
  video, images, music and speech from a terminal, a shell script or CI with models such as Kling, Seedance,
  Wan, Vidu, MiniMax, Nano Banana, GPT Image, Flux and Suno.
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <img alt="TypeScript" src="https://img.shields.io/badge/language-TypeScript-3178c6.svg">
  <img alt="Node 22.12+" src="https://img.shields.io/badge/node-%3E%3D22.12-339933.svg">
  <a href="https://popnow.ai"><img alt="Website" src="https://img.shields.io/badge/site-popnow.ai-ff5c8a.svg"></a>
  <a href="https://popnow.ai/docs"><img alt="Docs" src="https://img.shields.io/badge/docs-popnow.ai%2Fdocs-111.svg"></a>
</p>

PopNow is a browser-based AI studio for videos, images and music: image-to-video, text-to-video, AI images,
music and speech, one-tap trending video effects and image styles. The CLI talks to the same models, prices
and credit wallet as [popnow.ai](https://popnow.ai). Every billable command shows the price in credits first
and asks before it spends anything; failed runs are refunded automatically.

## Quickstart

**1. Install** (Node.js 22.12 or newer):

```bash
npm install -g @popnow/cli
popnow status          # no key needed: checks that the API answers
```

Or run it once without installing: `npx @popnow/cli status`.

**2. Set your API key** from [popnow.ai/api/console/keys](https://popnow.ai/api/console/keys). The key is read
from the environment only, never from a command-line argument, so it does not end up in shell history or CI logs.

```bash
export POPNOW_API_KEY="sk-popnow-..."      # PowerShell: $env:POPNOW_API_KEY = "sk-popnow-..."
popnow balance
```

**3. Generate.** The CLI quotes the request, shows the price, asks for confirmation, creates the task with an
idempotency key and, with `--wait`, prints the result link:

```bash
popnow jobs create \
  --model alibaba/z-image-turbo/text-to-image \
  --input-json '{"prompt":"A small red fox curled up in a teacup, soft morning light"}' \
  --wait
```

## Features

| Command | What it does | Key needed |
| --- | --- | --- |
| `popnow status` | Checks that `api.popnow.ai` answers, in one sentence | No |
| `popnow models list` / `models get <model>` | Live model catalog with credit prices and input JSON Schemas | Yes |
| `popnow balance` | Available, held and total credits (1 credit = $0.01) | Yes |
| `popnow usage` | Settled usage for the current key, by day and model | Yes |
| `popnow jobs quote` | Prices a request without creating a task or holding credits | Yes |
| `popnow jobs create` | Quote, confirm, create; `--wait` polls until the task is final | Yes |
| `popnow jobs list` / `get` / `wait` | Task history, one task's state and outputs, wait for completion | Yes |
| `popnow jobs retry` | New task from a failed or expired one | Yes |
| `popnow jobs purge` | Deletes a finished task's files and prompt; billing records stay | Yes |
| `popnow files upload <path>` | Uploads an image, video, audio, document or `.safetensors` LoRA and prints its `popnow://f/` URI | Yes |
| `popnow files download-url <task-id>` | Fresh short-lived link to a task output | Yes |
| `popnow assets list` / `get` / `usage` | Your private asset library (`popnow://a/` URIs) and its plan | Yes |
| `popnow webhooks verify` | Checks a task callback or account endpoint signature from the raw body | No (secret from env) |
| `popnow docs` / `docs open <topic>` / `docs search <words>` | Documentation links, opened in the browser, or searched live | No |

Design choices that matter in scripts:

- **The key comes from `POPNOW_API_KEY` only.** There is no `--api-key` flag.
- **Billable and destructive commands ask first.** `jobs create` shows the quote (`expectedCredits` and the
  `maxCredits` hold), `jobs retry` and `jobs purge` ask too. Without a terminal they refuse unless you pass `--yes`.
- **Every create and retry carries an `Idempotency-Key`**, generated when you do not pass `--idempotency-key`,
  and printed to stderr. Replaying the same key returns the original task instead of charging twice.
- **The quoted price is locked in**: `jobs create` sends `quoteId` and `expectedCredits`, so a price change
  between quote and create is refused (`40901`) instead of charged.
- **`--json` on any command** prints the `data` of the API response on stdout (create and retry add the
  `idempotencyKey`); errors go to stderr as one JSON object. Progress lines (price, idempotency key, accepted task id) always go to stderr.
- **Every error ends with a `Next:` line** that says what to do for that business code (wrong key prefix, top-up,
  spend cap, IP allowlist, rate limit with `Retry-After`, a proxy answering instead of the API, and so on).
- **Proxies are honored**: with `HTTPS_PROXY` set, the CLI routes requests through it like curl does.

## Usage

### Find a model and its input

```bash
popnow models list --modality video --task image-to-video
popnow --json models get alibaba/wan-3.0/image-to-video     # price and input JSON Schema
```

Model IDs read `<maker>/<model>/<task>`. `models list` accepts `--modality image|video|audio`, `--provider`,
`--task`, `--search`, `--include-schema` and `--include-examples`.

### Quote and create

```bash
# Price only: nothing is created or held
popnow jobs quote --model alibaba/wan-3.0/image-to-video --input-file input.json

# Create from a file (or --input-file - to read stdin), wait, and keep outputs for one day at most
popnow jobs create --model alibaba/wan-3.0/image-to-video --input-file input.json \
  --retention 1d --wait

# In CI: no prompt, a stable key you can replay, and a webhook for the result
popnow --json jobs create --model alibaba/wan-3.0/image-to-video --input-file input.json \
  --yes --idempotency-key "render-order-8814" --callback-url https://your-app.example.com/hooks/popnow
```

`input.json` holds the model's own fields, for example:

```json
{
  "image_url": "https://media.popnow.ai/movie/lighthouse.webp",
  "prompt": "Waves roll in slowly, the camera drifts toward the lighthouse",
  "resolution": "480p",
  "duration_seconds": 5
}
```

`--retention` accepts `30m`, `1h`, `7d` or seconds and can only shorten how long the files and prompt are
kept (`0` removes them as soon as the task finishes). It is sent as `X-PopNow-Retention`.

### Follow, retry and purge tasks

```bash
popnow jobs list --state failed --from 2026-10-01
popnow jobs get job_01JH8Z4Q5W2N7R3K9M6P1C0VXD
popnow jobs wait job_01JH8Z4Q5W2N7R3K9M6P1C0VXD --wait-timeout-ms 900000
popnow jobs retry job_01JH8Z4Q5W2N7R3K9M6P1C0VXD --wait
popnow jobs purge job_01JH8Z4Q5W2N7R3K9M6P1C0VXD
```

If waiting is interrupted after a task was accepted (timeout, network drop, Ctrl-C), the task keeps running.
The CLI prints the task id and `popnow jobs wait <task-id>` to pick it up again; it never cancels a task.

### Upload your own files

```bash
popnow files upload ./photo.jpg          # prints { uri: "popnow://f/fil_..." }
popnow jobs create --model alibaba/wan-3.0/image-to-video \
  --input-json '{"image_url":"popnow://f/fil_...","prompt":"slow push-in"}' --wait
```

Images (JPEG, PNG, WebP, GIF) up to 10 MiB; MP4/WebM video, MP3/WAV audio and documents up to 90 MiB; LoRA
weights (`.safetensors`) up to 2 GiB. The type is inferred from the extension; override with `--content-type`.
Saved library assets are referenced as `popnow://a/<id>` (`popnow assets list`).

### Verify a webhook

The secret is read from an environment variable, never from an argument:

```bash
export POPNOW_WEBHOOK_SECRET="..."         # from https://popnow.ai/api/console/webhooks
popnow webhooks verify --body-file body.json \
  --timestamp "$X_WEBHOOK_TIMESTAMP" --signature "$X_WEBHOOK_SIGNATURE"

# Account endpoints (Standard Webhooks): add --webhook-id; the secret defaults to POPNOW_ENDPOINT_SECRET
popnow webhooks verify --body-file body.json --webhook-id "$WEBHOOK_ID" \
  --timestamp "$WEBHOOK_TIMESTAMP" --signature "$WEBHOOK_SIGNATURE"
```

The command exits 0 when the signature is valid and 1 when it is not, with the reason.

### Configuration

| Setting | Flag | Environment | Default |
| --- | --- | --- | --- |
| API key | (none, by design) | `POPNOW_API_KEY` | required for account commands |
| API origin | `--base-url` | `POPNOW_BASE_URL` | `https://api.popnow.ai` |
| Request timeout | `--timeout-ms` | | 60000 |
| Retries for safe requests | `--max-retries` | | 2 (at most 5) |
| Webhook secrets | `--secret-env <name>` | `POPNOW_WEBHOOK_SECRET`, `POPNOW_ENDPOINT_SECRET` | |
| Proxy | | `HTTPS_PROXY`, `HTTP_PROXY` (`NODE_USE_ENV_PROXY=0` to opt out) | |

Reads, quotes and idempotent writes are retried on `429`, `500`, `503`, `50301` and gateway errors, waiting for
`Retry-After` when the API sends it. A `400` is never retried.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success (for `--wait`: the task succeeded) |
| `1` | Error: API error, network error, invalid input, refused confirmation, invalid webhook signature |
| `2` | `--wait` / `jobs wait` finished, but the task ended `failed`, `expired` or `canceled` |

## FAQ

### How do I generate a video from an image with a command-line tool?

Install the CLI, export `POPNOW_API_KEY`, then run `popnow jobs create --model alibaba/wan-3.0/image-to-video
--input-json '{"image_url":"https://...","prompt":"..."}' --wait`. Upload a local image first with
`popnow files upload photo.jpg` and pass the returned `popnow://f/` URI as `image_url`.

### How much does a generation cost, and can I see the price before I pay?

Every model has a price in credits (1 credit = $0.01), listed by `popnow models list`. `popnow jobs quote`
prices the exact request without holding anything, and `popnow jobs create` always shows that quote and asks
before it creates the task. Failed tasks release their hold, so they cost nothing.

### How do I use the PopNow CLI in CI or a shell script without a prompt?

Pass `--yes` to confirm the charge, `--json` for machine-readable output, and a stable `--idempotency-key`
so a retried job never creates a second task. Check the exit code: `2` means the task finished but did not
succeed.

### Why is there no `--api-key` option?

Arguments end up in shell history, process lists and CI logs. The CLI reads the key from `POPNOW_API_KEY`
only, and prints at most its prefix when diagnosing a `401`.

### Which AI models can I call from the terminal?

Every image, video and audio model your key can call on PopNow, including Kling, Seedance, Wan, Vidu, MiniMax,
Nano Banana, GPT Image, Flux and Suno. `popnow models list` is the live list with prices.

### How do I verify a PopNow webhook signature?

Save the raw request body to a file and run `popnow webhooks verify --body-file body.json --timestamp ...
--signature ...` with `POPNOW_WEBHOOK_SECRET` set. The scheme is
`base64(HMAC-SHA256(secret, "<taskId>.<timestamp>.<sha256_hex(raw_body)>"))`, described at
[popnow.ai/docs/webhooks](https://popnow.ai/docs/webhooks).

### Does the CLI work behind a corporate proxy?

Yes. With `HTTPS_PROXY` (or `HTTP_PROXY`) set to an `http://` or `https://` proxy URL, requests go through it.
When something in between refuses the request, the error says it did not come from the PopNow API.

## Development

```bash
git clone https://github.com/popnow-ai/popnow-cli && cd popnow-cli
npm install
npm run typecheck && npm run build && npm test
node dist/cli/index.js --help
```

`dist/` is committed on purpose: installing from GitHub then needs no build step (npm does not install
devDependencies for a global git install). Rebuild and commit it with every source change; CI checks that it
matches. Tests use a mocked `fetch` and never call the live API. `POPNOW_LIVE_TESTS=1 npm test` adds two live checks
that use a fake key and cannot spend credits.

## Links

- Website: [popnow.ai](https://popnow.ai) · Pricing: [popnow.ai/pricing](https://popnow.ai/pricing)
- Docs: [popnow.ai/docs](https://popnow.ai/docs) · API reference: [popnow.ai/docs/openapi](https://popnow.ai/docs/openapi) ([openapi.yaml](https://popnow.ai/docs/openapi.yaml)) · [llms.txt](https://popnow.ai/llms.txt)
- MCP server for AI assistants: [popnow.ai/mcp](https://popnow.ai/mcp)
- Other PopNow repositories:
  [popnow-mcp](https://github.com/popnow-ai/popnow-mcp) ·
  [popnow-skills](https://github.com/popnow-ai/popnow-skills) ·
  [popnow-python](https://github.com/popnow-ai/popnow-python) ·
  [popnow-js](https://github.com/popnow-ai/popnow-js) ·
  [popnow-api](https://github.com/popnow-ai/popnow-api) ·
  [popnow-blender](https://github.com/popnow-ai/popnow-blender) ·
  [popnow-comfyui](https://github.com/popnow-ai/popnow-comfyui) ·
  [n8n-nodes-popnow](https://github.com/popnow-ai/n8n-nodes-popnow) ·
  [popnow-go](https://github.com/popnow-ai/popnow-go) ·
  [popnow-php](https://github.com/popnow-ai/popnow-php)

## License

[MIT](LICENSE) © PopNow
