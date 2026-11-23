/** Starts the worker on its own (the checker before CR-13, and for local runs): the checker and an HTTP server. */
import { createServer } from 'node:http';
import { loadConfig } from './config.ts';
import { createLogger } from './log.ts';
import { startChecker } from './mount.ts';

const cfg = loadConfig(process.env);
const log = createLogger((line) => process.stdout.write(line + '\n'));
const checker = await startChecker(process.env);
const server = createServer((req, res) => void checker.handle(req, res));
server.requestTimeout = 120_000;
// Longer than the proxy's idle time, so the server never closes a kept-alive
// connection just as a request arrives on it.
server.keepAliveTimeout = 70_000;
server.headersTimeout = 75_000;
server.listen(cfg.port, '0.0.0.0', () => log.log('start', { port: cfg.port, waiting: checker.maxWaiting }));
