import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../../', import.meta.url).pathname;
const LOG_DIR = join(ROOT, 'logs');
mkdirSync(LOG_DIR, { recursive: true });

const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let minLevel = levels.INFO;

function ts() {
  return new Date().toISOString();
}

function write(level, ...args) {
  if (levels[level] < minLevel) return;
  const msg = `[${ts()}] [${level}] ${args.join(' ')}`;
  console.log(msg);

  const logFile = join(LOG_DIR, `pipeline-${new Date().toISOString().slice(0, 10)}.log`);
  appendFileSync(logFile, msg + '\n');
}

export const log = {
  debug: (...a) => write('DEBUG', ...a),
  info: (...a) => write('INFO', ...a),
  warn: (...a) => write('WARN', ...a),
  error: (...a) => write('ERROR', ...a),
  setLevel: (l) => { minLevel = levels[l] || 0; },
};
