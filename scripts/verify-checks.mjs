import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const startedAtUtc = new Date().toISOString();
const lint = spawnSync(process.execPath, ['node_modules/eslint/bin/eslint.js', '.'], { cwd: root, encoding: 'utf8' });
const typecheck = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { cwd: root, encoding: 'utf8' });
const resource = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/verify-scrypt.ts'], { cwd: root, encoding: 'utf8' });
let scrypt = null;
try { scrypt = JSON.parse(resource.stdout.trim()); } catch { /* Record failure without raw process output. */ }
const sourceSha256 = Object.fromEntries(['src/auth.ts', 'scripts/verify-scrypt.ts', 'tsconfig.json', 'package-lock.json'].map(file => [file, createHash('sha256').update(readFileSync(path.join(root, file))).digest('hex')]));
const report = {
  startedAtUtc, finishedAtUtc: new Date().toISOString(), node: process.version,
  lint: { command: 'node node_modules/eslint/bin/eslint.js .', exitCode: lint.status, passed: lint.status === 0 },
  typecheck: { command: 'node node_modules/typescript/bin/tsc --noEmit', exitCode: typecheck.status, passed: typecheck.status === 0 },
  resource: { command: 'node --import tsx scripts/verify-scrypt.ts', exitCode: resource.status, passed: resource.status === 0 && scrypt !== null, measurements: scrypt },
  sourceSha256,
};
mkdirSync(path.join(root, 'docs/evidence'), { recursive: true });
const file = `docs/evidence/checks-${startedAtUtc.replace(/[:.]/g, '-')}.json`;
writeFileSync(path.join(root, file), JSON.stringify(report, null, 2) + '\n');
mkdirSync(path.join(root, 'qa-reports'), { recursive: true });
writeFileSync(path.join(root, 'qa-reports/checks.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`Lint: ${report.lint.passed ? 'passed' : 'failed'}; TypeScript: ${report.typecheck.passed ? 'passed' : 'failed'}; scrypt resources: ${report.resource.passed ? 'passed' : 'failed'}; evidence: ${file}`);
if (!report.lint.passed || !report.typecheck.passed || !report.resource.passed) process.exitCode = 1;
