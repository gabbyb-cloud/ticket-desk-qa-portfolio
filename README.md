# Ticket Desk | QA Engineering Portfolio

A local ticket-management application with a JSON API, server-rendered forms, and Playwright API/browser tests. My engineering work focuses on test design, security validation, isolated infrastructure, and CI evidence review, developed with AI assistance.

## Engineering highlights

- **Coverage:** the full 32-test standard suite for workflows, validation, authentication, CSRF, and ownership.
- **Isolation:** fresh application state, sessions, and localhost ports per test; zero configured retries.
- **Diagnostics:** sanitized JSON, HTML, and JUnit reports without raw errors or browser captures.
- **CI:** Windows GitHub Actions, locked dependencies, pinned actions, and allowlisted failure reports.

**Verification:** In the predecessor `gabbyb-cloud/ticket-desk-qa`, all 32 API/Chromium tests passed locally with no failures, skips, or retries; checks and sanitized-report validation also passed.

The fresh `ticket-desk-qa-portfolio` repository independently passed **Ticket Desk QA #1** on GitHub Actions at commit `40b82ab` (October 29, 2026). Local application tests have not been rerun in the fresh copy. See [verification details](docs/VERIFICATION.md) for historical evidence and the original project's separate EVD-01 results; its artifact-expiration observation remains pending.

## Stack

TypeScript | Node.js 24 | Express | Zod | server-side sessions | Playwright / Chromium | GitHub Actions

## Quick start

Requires Node.js **24.x**, npm, and Windows PowerShell. No external account or environment file is needed.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd start
```

Open the printed localhost address with `/login` appended. Use the [synthetic demo accounts](docs/test-plan.md#2-synthetic-identities-and-ticket-model); never reuse their password for real accounts.

See [setup and verification](docs/TESTING.md) for browser installation, test commands, resource guidance, and reporting safeguards.

## Scope and safety

Synthetic localhost HTTP demo only. Data/sessions are memory-only; secrets reset on restart, cookies lack `Secure`, and login rate limiting is absent. Chromium is the only browser covered. This is not production software, an AI integration, or a security/accessibility certification.

Keep credentials and private evidence out of commits. Captures, traces, and video are disabled; specialized evidence probes and private tooling are excluded.

## Documentation and license

- [Architecture and API contract](docs/test-plan.md)
- [Verification scope](docs/VERIFICATION.md) | [Standard CI](.github/workflows/ci.yml)
- [MIT license](LICENSE) | [Licensing and attribution](docs/LICENSING.md) | [Third-party notices](docs/THIRD-PARTY-NOTICES.txt)

This standalone portfolio project is maintained in a private GitHub repository pending final public-release approval. Its source code has been committed and its GitHub Actions CI has passed. The application has not been deployed.
