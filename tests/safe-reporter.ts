import type { Reporter, TestCase, TestResult, FullResult, FullConfig, Suite, TestStep } from '@playwright/test/reporter';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { diagnosticCategory, renderHtml, renderJunit, safeLabel, sensitiveValues } from './reporting.js';

type SafeCase = { name: string; status: 'passed' | 'failed' };
type SafeTest = { title: string; acceptanceIds: string[]; status: string; expectedStatus: string; worker: number; retry: number; durationMs: number; cases: SafeCase[]; browserVersion: string | null };
// Allowlisted metadata only. Never serialize TestResult/error/attachments/request data.
export default class SafeReporter implements Reporter {
  private tests: SafeTest[] = [];
  private cases = new Map<string, SafeCase[]>();
  private config: FullConfig | undefined;
  private started = new Date().toISOString();
  private discovered = 0;
  private fingerprints: Record<string, string> = {};
  private infrastructureErrors: { category: string }[] = [];
  private secrets = new Set(sensitiveValues());
  private sanitize(value: string): string {
    let output = safeLabel(value);
    for (const secret of this.secrets) if (secret.length >= 8) output = output.replaceAll(secret, '[REDACTED]');
    return output;
  }
  onBegin(config: FullConfig, suite: Suite) {
    this.config = config;
    const tests = suite.allTests();
    this.discovered = tests.length;
    const files = new Set(tests.map(test => test.location.file));
    for (const name of ['src/app.ts', 'src/views.ts', 'src/auth.ts', 'src/store.ts', 'src/validation.ts', 'src/server.ts', 'tests/fixtures.ts', 'tests/safe-reporter.ts', 'tests/reporting.ts', 'playwright.config.ts', 'eslint.config.mjs', 'package.json', 'package-lock.json', 'scripts/run-tests.mjs', 'scripts/verify-checks.mjs', 'scripts/validate-workflow.mjs', '.github/workflows/ci.yml', 'LICENSE', 'docs/test-plan.md']) files.add(path.resolve(name));
    for (const file of [...files].sort()) {
      const relative = path.relative(process.cwd(), file).replaceAll('\\', '/');
      if (relative.startsWith('../') || path.isAbsolute(relative)) throw new Error('Evidence source outside workspace.');
      this.fingerprints[relative] = createHash('sha256').update(readFileSync(file)).digest('hex');
    }
  }
  onStepEnd(test: TestCase, _result: TestResult, step: TestStep) {
    if (step.category === 'test.step' && /^case:[A-Za-z0-9 /:_-]+$/.test(step.title)) {
      const cases = this.cases.get(test.id) ?? [];
      const names = [step.title];
      for (let parent = step.parent; parent; parent = parent.parent) {
        if (parent.category === 'test.step' && /^case:[A-Za-z0-9 /:_-]+$/.test(parent.title)) names.unshift(parent.title);
      }
      cases.push({ name: safeLabel(names.join(' > ')), status: step.error ? 'failed' : 'passed' });
      this.cases.set(test.id, cases);
    }
  }
  onTestEnd(test: TestCase, result: TestResult) {
    for (const annotation of test.annotations) if (annotation.type === 'sensitive-sample' && annotation.description) this.secrets.add(annotation.description);
    const entry: SafeTest = {
      title: this.sanitize(test.title), acceptanceIds: [...new Set(test.title.match(/\b(?:UI|API|AUTH|VAL|DATA|SEC|ISO|EVD)-\d{2}\b/g) ?? [])],
      status: result.status, expectedStatus: test.expectedStatus, worker: result.workerIndex, retry: result.retry,
      durationMs: result.duration, cases: (this.cases.get(test.id) ?? []).map(item => ({ ...item, name: this.sanitize(item.name) })),
      browserVersion: test.annotations.find(value => value.type === 'browser-version' && /^\d+(\.\d+){1,3}$/.test(value.description ?? ''))?.description ?? null,
    };
    this.tests.push(entry);
    console.log(`${result.status.toUpperCase()} ${entry.title} (${result.duration}ms)`);
    for (const variant of entry.cases.filter(value => value.status === 'failed')) console.log(`FAILED ${variant.name}`);
    if (result.status !== 'passed') {
      console.log(`Source: ${path.relative(process.cwd(), test.location.file).replaceAll('\\', '/')}:${test.location.line}; raw diagnostics suppressed.`);
      console.log(`Diagnostic category: ${result.status === 'timedOut' ? 'TIMEOUT' : 'TEST_FAILURE'}`);
    }
  }
  onError(error: { message?: string }) {
    const category = diagnosticCategory(error.message);
    this.infrastructureErrors.push({ category });
    console.error(`Runner infrastructure diagnostic: ${category}`);
  }
  onEnd(result: FullResult) {
    const directory = path.resolve('docs/evidence/phase-3');
    mkdirSync(directory, { recursive: true });
    const suppliedId = process.env.QA_RUN_ID;
    const runId = suppliedId && /^qa-[A-Za-z0-9-]+$/.test(suppliedId) ? suppliedId : `qa-${this.started.replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
    const passed = this.tests.filter(test => test.status === 'passed').length;
    const report = {
      schemaVersion: 2, startedAtUtc: this.started, finishedAtUtc: new Date().toISOString(),
      command: safeLabel(process.env.TICKET_DESK_TEST_COMMAND ?? 'Direct Playwright invocation; command not captured'),
      runtime: { node: process.version, platform: process.platform, playwright: JSON.parse(readFileSync('node_modules/playwright/package.json', 'utf8')).version, chromium: [...new Set(this.tests.map(test => test.browserVersion).filter(Boolean))] },
      configuredWorkers: this.config?.workers ?? 0, workersUsed: new Set(this.tests.map(test => test.worker)).size,
      configuredRetries: this.config?.projects.map(project => ({ project: project.name, retries: project.retries })) ?? [],
      outcome: result.status, discoveredTests: this.discovered, executedTests: this.tests.filter(test => test.status !== 'skipped').length, passed,
      failed: this.tests.filter(test => test.status !== 'passed' && test.status !== 'skipped').length,
      skipped: this.tests.filter(test => test.status === 'skipped').length,
      executedAcceptanceIds: [...new Set(this.tests.filter(test => test.status !== 'skipped').flatMap(test => test.acceptanceIds))].sort(),
      artifacts: { trace: false, screenshot: false, video: false, rawErrors: false, rawRequestData: false },
      sourceSha256: this.fingerprints, infrastructureErrors: this.infrastructureErrors,
      registeredSensitiveSampleCount: this.secrets.size, tests: this.tests,
    };
    const outputs = { json: JSON.stringify(report, null, 2) + '\n', html: renderHtml(report), xml: renderJunit(report) };
    for (const output of Object.values(outputs)) {
      for (const secret of this.secrets) if (secret.length >= 8 && output.includes(secret)) throw new Error('Report safety gate rejected sensitive content. No report uploaded.');
    }
    for (const [extension, output] of Object.entries(outputs)) writeFileSync(path.join(directory, `${runId}.${extension}`), output);
    console.log(`RESULT ${result.status}: ${passed} passed, ${report.failed} failed, ${report.skipped} skipped; workers=${report.configuredWorkers}; retries=0`);
    console.log(`Sanitized evidence: docs/evidence/phase-3/${runId}.{json,html,xml}`);
  }
}
