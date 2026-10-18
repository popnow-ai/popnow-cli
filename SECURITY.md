# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems.

- Open a [private security advisory](https://github.com/popnow-ai/popnow-cli/security/advisories/new) on GitHub, or
- email **support@popnow.ai** with "Security" in the subject.

Include a description, steps to reproduce and the CLI version (`popnow --version`). We aim to acknowledge
reports within a few business days.

## Keeping your API key safe

- The CLI reads the key from `POPNOW_API_KEY` only; it never accepts it as an argument and never prints more
  than its prefix.
- In CI, store the key as a secret and expose it to the step as an environment variable.
- If a key leaks, revoke it in the [API console](https://popnow.ai/api/console/keys) and create a new one.
- Webhook secrets are also read from environment variables (`POPNOW_WEBHOOK_SECRET`, `POPNOW_ENDPOINT_SECRET`).
