# Contributing

Thanks for helping improve the PopNow CLI.

1. Fork the repository and create a branch.
2. `npm install`, then make your change.
3. Run `npm run typecheck && npm run build && npm test`, and commit the rebuilt `dist/` with your change
   (it is shipped so that installing from GitHub needs no build step; CI checks it matches the sources). Tests use a mocked `fetch` and never call the live
   API; `POPNOW_LIVE_TESTS=1 npm test` adds two live checks with a fake key.
4. Open a pull request that explains what changed and why, and add a line to `CHANGELOG.md`.

Guidelines:

- Follow the public API contract at [popnow.ai/docs/openapi.yaml](https://popnow.ai/docs/openapi.yaml). Do not
  add endpoints or fields that are not documented there.
- Keep the API key out of arguments: it is read from `POPNOW_API_KEY` only.
- Anything that spends credits or deletes content must ask first, and accept `--yes` for scripts.
- Keep runtime dependencies to `commander`.
- All text in the repository is English; a test fails on CJK characters.

For questions about the API itself (accounts, billing, models), contact [PopNow support](https://popnow.ai/contact).
