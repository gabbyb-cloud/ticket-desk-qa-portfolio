# Verification scope

This fresh `ticket-desk-qa-portfolio` source-only copy derives from the approved `ticket-desk-qa` snapshot at commit `9c4c4a58c46da22f471f894fc7343894f70f4605`. It contains no imported Git history, recovery references, private evidence bundles, or specialized evidence probes. Local tests and hosted CI have not been executed or verified in this fresh copy.

## Predecessor: independently verified locally

Local verification of predecessor `ticket-desk-qa` completed on 2026-10-29 using Node.js **24.16.0**.

| Check | Recorded result |
| --- | --- |
| Locked dependency installation | Passed; lifecycle scripts disabled; lockfile unchanged |
| Workflow-policy validation | Passed locally |
| Lint and TypeScript | Passed |
| Existing scrypt resource verification | Passed; security parameters unchanged |
| Standard API/Chromium suite | **32 passed, 0 failed, 0 skipped** |
| Execution settings | **One concurrent worker; zero retries** |
| Sanitized reports and safety receipt | Passed |

These results were produced independently in the predecessor, not this fresh copy. No application, test, dependency, or security-control correction was required during that verification. The original private repository remained unchanged. Predecessor installation caches and generated reports have not been copied.

The reporter counted two lifetime worker processes across the API and browser projects; configured concurrency remained one. This does not represent a two-worker parallel run.

## Predecessor: verified hosted CI

The founder confirmed that **Ticket Desk QA #1** passed in GitHub Actions for portfolio repository `gabbyb-cloud/ticket-desk-qa` at commit `f1608e56e4489c38b6f2f7e0f82f5cee9ac4e8d8`. This is the predecessor's hosted result, not a run for `ticket-desk-qa-portfolio`, and is separate from the original project's CI and EVD-01 verification.

The standard workflow runs workflow-policy validation, lint, TypeScript and scrypt checks, then the standard API/Chromium suite. It is configured for two concurrent workers and zero retries; the independently recorded local run above used one worker. No hosted run URL or additional hosted test-count claim is supplied here.

The predecessor remains private. This fresh copy has no Git history, remote, or hosted CI history. Public release requires founder approval of the exact source, new commit identity, and any future Actions log/artifact exposure. No deployment or visibility change has occurred.

## Original project: historical results

The original Ticket Desk project recorded a separate 32-test local/hosted baseline with zero retries. Its hosted EVD-01 verification validated and uploaded six synthetic files; manifest sizes/hashes, security checks, and the GitHub artifact digest comparison passed. **Seven-day expiration observation remains pending.**

Those hosted results belong to the original project, not this candidate. Private logs and evidence are not included or linked. Specialized EVD-01 tooling is excluded; full EVD-01 acceptance is not claimed.

## Boundaries

The candidate retains the application and full standard suite. Runner options, reporter fingerprints, package commands, workflow-policy dependencies, and documentation were adapted to exclude specialized probes before the predecessor's local verification. This fresh copy changes only documentation provenance; inherited results do not establish fresh-repository verification.

This is a synthetic localhost demonstration, not a deployment, AI integration, penetration test, or comprehensive accessibility certification. See [setup and safety guidance](TESTING.md), the [behavior specification](test-plan.md), and [licensing](LICENSING.md).
