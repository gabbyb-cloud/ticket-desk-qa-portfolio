import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, copyFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const stageCi = args.includes('--stage-ci');
if (stageCi) for (const extension of ['json', 'html', 'xml']) {
  const staged = path.join(root, 'qa-reports', `qa.${extension}`);
  if (existsSync(staged)) unlinkSync(staged);
}
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--stage-ci') continue;
  if (/^--(?:project=(?:api|ui)|workers=[12])$/.test(args[i])) continue;
  if (args[i] === '--grep' && /^[A-Za-z0-9 _:\-|.]+$/.test(args[i + 1] ?? '')) { i++; continue; }
  throw new Error('Only project, one/two workers and a safe test-title filter are supported.');
}
const temp = path.join(root, '.cache', 'tmp');
mkdirSync(temp, { recursive: true });
const runId = `qa-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const sentinel = `qa-sentinel-${randomBytes(24).toString('hex')}`;
const cookie = randomBytes(24).toString('hex');
const csrf = randomBytes(32).toString('hex');
const cliArgs = args.filter(value => value !== '--stage-ci');
const result = spawnSync(process.execPath, [path.join(root, 'node_modules/playwright/cli.js'), 'test', ...cliArgs], {
  cwd: root, stdio: 'inherit', env: {
    ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.join(root, '.cache', 'pw-browsers'), TEMP: temp, TMP: temp,
    PLAYWRIGHT_NO_COPY_PROMPT: '1', DEBUG: '', PWDEBUG: '0',
    QA_RUN_ID: runId, QA_SENTINEL: sentinel, QA_FAKE_COOKIE: cookie, QA_FAKE_CSRF: csrf,
    TICKET_DESK_TEST_COMMAND: `node scripts/run-tests.mjs${args.length ? ' ' + args.join(' ') : ''}`,
  },
});
const outputs = ['json', 'html', 'xml'].map(extension => path.join(root, 'docs/evidence/phase-3', `${runId}.${extension}`));
let safe = true;
try {
  for (const file of outputs) {
    const output = readFileSync(file, 'utf8');
    if ([sentinel, cookie, csrf].some(value => output.includes(value))) safe = false;
  }
  const report = JSON.parse(readFileSync(outputs[0], 'utf8'));
  if (report.schemaVersion !== 2 || Object.values(report.artifacts).some(Boolean)) safe = false;
} catch { safe = false; }
if (stageCi && safe) {
  const staging = path.join(root, 'qa-reports');
  mkdirSync(staging, { recursive: true });
  for (const [index, extension] of ['json', 'html', 'xml'].entries()) copyFileSync(outputs[index], path.join(staging, `qa.${extension}`));
}
mkdirSync(path.join(root, 'docs/evidence/phase-3'), { recursive: true });
writeFileSync(path.join(root, 'docs/evidence/phase-3', `${runId}.safety.json`), JSON.stringify({
  runId, command: `node scripts/run-tests.mjs${args.length ? ' ' + args.join(' ') : ''}`, testExitCode: result.status,
  reportSafetyPassed: safe, reportFiles: outputs.map(file => path.relative(root, file).replaceAll('\\', '/')),
  knownRuntimeSentinelsAbsent: safe, stagedForCi: stageCi && safe,
}, null, 2) + '\n');
if (!safe) { console.error('Report validation failed; artifacts were not staged.'); process.exit(1); }
process.exit(result.status ?? 1);
