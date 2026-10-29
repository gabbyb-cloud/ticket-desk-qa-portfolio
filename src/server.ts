import { createApp } from './app.js';

export async function startServer(controlledClock = false) {
  let offset = 0;
  let origin = '';
  let pendingFault: string | undefined;
  const app = await createApp({
    origin: () => origin, now: () => Date.now() + offset,
    ...(controlledClock ? { testReadFault: () => {
      if (pendingFault === undefined) return;
      const detail = pendingFault;
      pendingFault = undefined;
      throw new Error(detail);
    } } : {}),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Loopback startup failed.');
  origin = `http://127.0.0.1:${address.port}`;
  if (controlledClock) {
    process.on('message', (message: unknown) => {
      const value = message as { type?: string; milliseconds?: number; id?: number; detail?: string };
      if (value.type === 'arm-read-fault' && typeof value.detail === 'string' && value.detail.length <= 2048) {
        pendingFault = value.detail;
        process.send?.({ type: 'fault-armed', id: value.id });
      }
      if (value.type === 'advance' && Number.isSafeInteger(value.milliseconds) && value.milliseconds! >= 0) {
        offset += value.milliseconds!;
        process.send?.({ type: 'advanced', id: value.id });
      }
    });
  }
  const close = () => { server.closeAllConnections(); server.close(() => process.exit(0)); };
  process.on('SIGTERM', close);
  process.on('SIGINT', close);
  process.on('disconnect', close);
  if (process.send) process.send({ type: 'ready', origin });
  else console.log(`Ticket Desk demo listening at ${origin}`);
  return server;
}

await startServer(process.argv.includes('--test-clock') && Boolean(process.send));
