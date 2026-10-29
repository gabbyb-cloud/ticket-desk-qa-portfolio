# Setup and standard verification

Requires Node.js 24.x, npm, and Windows PowerShell. Work from the candidate root. No private credentials or environment file are required.

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
New-Item -ItemType Directory -Force -Path .cache/tmp | Out-Null
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path $PWD '.cache/pw-browsers'
$env:TEMP = Join-Path $PWD '.cache/tmp'
$env:TMP = $env:TEMP
node node_modules/playwright/cli.js install chromium --only-shell
npm.cmd run verify:workflow
npm.cmd run verify:checks
npm.cmd run test:all -- --workers=1
```

This setup and the combined one-worker suite passed independent local verification in predecessor `ticket-desk-qa` on Node.js 24.16.0; see [recorded results](VERIFICATION.md). These commands are instructions for the fresh copy, not a record of execution here; its local tests and hosted CI have not been executed or verified. The separate API-only and browser-only commands below are supported alternatives, not additional recorded runs. API-only testing needs no browser binary: `npm.cmd run test:api -- --workers=1`. Browser-only: `npm.cmd run test:ui -- --workers=1`. Start the demo with `npm.cmd start`.

The checks command runs lint, TypeScript, and sequential scrypt resource verification. Review its conservative two-worker memory budget before increasing workers. Do not reduce security parameters to fit a host; the budget does not bound browser or total host memory. Lint uses syntax rules compatible with TypeScript 7; TypeScript owns type checking.

Each test gets fresh state and sessions. Clock/read-fault controls require a forked process with IPC; normal startup exposes no HTTP reset/fault endpoint.

Reports are generated under ignored `docs/evidence/`; sanitized CI copies use ignored `qa-reports/`. The reporter excludes raw errors, requests, attachments, stdout/stderr, traces, screenshots, and video. Sensitive samples are registered, redacted, and checked before staging. Use synthetic data only; do not enable raw debugging/captures or share unreviewed outputs.

The workflow uses push/pull-request triggers, read-only permissions, locked installation without lifecycle scripts, SHA-pinned actions, zero retries, and failure-only upload of four sanitized reports. Seven-day retention is requested; configuration is not proof of expiration. Logs and permitted artifacts must be treated as public after publication.

Specialized probes, source mutators, private runners, and hosted EVD-01 workflows are excluded.
