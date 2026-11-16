# Archive (not served)

Files kept for the record or for restoring, outside `public/`, so the site never serves them.

- `demo-faces/`: 145 AI-generated portraits (FLUX.1 [schnell] on Cloudflare Workers AI, Apache License 2.0) that the
  made-up demo profiles showed from 2026-11-15 until 2026-11-16. Taken off with the owner's approval (no AI-generated
  images of people); demo profiles now show their initials. To bring them back, move the folder to
  `public/demo-faces` and restore `portrait()` in `src/assistant/demo-data.js` from git tag
  `pre-demo-cleanup-2026-11-16`.
- `demo-face-prompts.json`: the prompt used for each of those portraits (it was `scripts/demo-face-prompts.json`).
