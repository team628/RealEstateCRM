# End-to-end smoke test

Drives the built app in headless Chromium through the demo-mode vertical slice:
dashboard → contacts → lead capture (validation, idempotent submit) → contact
detail timeline (capture/assignment/note/stage-change) → kill-switch toggle.
Fails on any console or page error.

```bash
npm run build
npx vite preview --port 8080 --host 127.0.0.1 &
npm install --no-save playwright-core   # chromium expected at /opt/pw-browsers/chromium
BASE_URL=http://127.0.0.1:8080 node e2e/smoke.mjs   # CHROMIUM_PATH overrides the browser
```
