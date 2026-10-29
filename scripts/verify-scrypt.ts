import { totalmem, freemem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { hashPassword, verifyPassword, SCRYPT } from '../src/auth.js';

// Sequential verification only. This must pass before a two-worker run.
const start = performance.now();
const hash = await hashPassword('Synthetic-resource-check-only');
if (!await verifyPassword('Synthetic-resource-check-only', hash)) throw new Error('scrypt verification failed');
const memoryMiB = 128 * SCRYPT.N * SCRYPT.r / 1024 / 1024;
const budget = 2 * (SCRYPT.maxmem + 192 * 1024 * 1024);
const available = freemem();
console.log(JSON.stringify({
  node: process.version, parameters: SCRYPT, derivedKeyBytes: hash.key.length, saltBytes: hash.salt.length,
  estimatedWorkingMemoryMiBPerDerivation: memoryMiB,
  processPeakRssMiB: Math.ceil(process.resourceUsage().maxRSS / 1024),
  twoSequentialDerivationsMs: Math.round(performance.now() - start),
  totalMemoryMiB: Math.floor(totalmem() / 1024 / 1024), availableMemoryMiB: Math.floor(available / 1024 / 1024),
  twoWorkerBudgetMiB: budget / 1024 / 1024,
}));
if (available < budget) throw new Error('Insufficient available memory for the conservative two-worker budget.');
