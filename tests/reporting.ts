import { DEMO_PASSWORD } from '../src/auth.js';

export function sensitiveValues(): string[] {
  return [DEMO_PASSWORD, process.env.QA_SENTINEL, process.env.QA_FAKE_COOKIE, process.env.QA_FAKE_CSRF].filter((value): value is string => Boolean(value));
}
export function safeLabel(value: string): string {
  let safe = value.replace(/[\u0000-\u001f\u007f]/g, ' ');
  for (const secret of sensitiveValues()) safe = safe.replaceAll(secret, '[REDACTED]');
  return safe.replace(/ticketdesk\.sid=[^;\s]+/gi, 'ticketdesk.sid=[REDACTED]')
    .replace(/X-CSRF-Token\s*:\s*[^;\s]+/gi, 'CSRF=[REDACTED]');
}
export function diagnosticCategory(message = ''): string {
  if (/timeout|timed out/i.test(message)) return 'TIMEOUT';
  if (/worker.*(?:exit|crash)|ECONNRESET/i.test(message)) return 'WORKER_FAILURE';
  if (/config|syntax|cannot find module/i.test(message)) return 'CONFIGURATION_ERROR';
  return 'RUNNER_ERROR';
}
const escape = (value: unknown) => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);
type RenderInput = {
  outcome: string; command: string; executedTests: number; passed: number; failed: number; skipped: number;
  configuredWorkers: number; infrastructureErrors: { category: string }[];
  tests: { title: string; status: string; durationMs: number; acceptanceIds: string[]; cases: { name: string; status: string }[] }[];
};
export function renderHtml(report: RenderInput): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'"><title>Sanitized QA results</title></head><body><h1>QA: ${escape(report.outcome)}</h1><p>${escape(report.command)}</p><p>Executed ${report.executedTests}; passed ${report.passed}; failed ${report.failed}; skipped ${report.skipped}; configured concurrency ${report.configuredWorkers}.</p><table><caption>Executed test results</caption><thead><tr><th>Test</th><th>Outcome</th><th>Acceptance IDs</th><th>Cases</th></tr></thead><tbody>${report.tests.map(test => `<tr><td>${escape(test.title)}</td><td>${escape(test.status)}</td><td>${escape(test.acceptanceIds.join(', '))}</td><td><ul>${test.cases.map(item => `<li>${escape(item.name)}: ${escape(item.status)}</li>`).join('')}</ul></td></tr>`).join('')}</tbody></table><h2>Infrastructure diagnostics</h2><ul>${report.infrastructureErrors.map(error => `<li>${escape(error.category)}</li>`).join('')}</ul><p>Raw errors, requests, cookies, tokens, traces and browser captures are excluded.</p></body></html>\n`;
}
export function renderJunit(report: RenderInput): string {
  const cases = report.tests.map(test => {
    const detail = test.status === 'skipped' ? '<skipped/>' : test.status === 'passed' ? '' : `<failure type="${test.status === 'timedOut' ? 'TIMEOUT' : 'TEST_FAILURE'}">${escape(test.cases.filter(item => item.status === 'failed').map(item => item.name).join('; ') || 'Sanitized failure; inspect the QA JSON report.')}</failure>`;
    return `<testcase classname="TicketDesk" name="${escape(test.title)}" time="${(test.durationMs / 1000).toFixed(3)}">${detail}</testcase>`;
  });
  for (const error of report.infrastructureErrors) cases.push(`<testcase classname="Infrastructure" name="${escape(error.category)}"><error type="${escape(error.category)}">Raw diagnostics suppressed.</error></testcase>`);
  return `<?xml version="1.0" encoding="UTF-8"?><testsuites><testsuite name="TicketDesk" tests="${cases.length}" failures="${report.failed}" errors="${report.infrastructureErrors.length}" skipped="${report.skipped}">${cases.join('')}</testsuite></testsuites>\n`;
}
