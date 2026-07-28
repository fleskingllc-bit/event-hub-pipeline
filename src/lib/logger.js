import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../../', import.meta.url).pathname;
const LOG_DIR = join(ROOT, 'logs');
mkdirSync(LOG_DIR, { recursive: true });

const levels = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
let minLevel = levels.INFO;

// EVENT_HUB_LOG_TAG が設定されていれば pipeline-{tag}-YYYY-MM-DD.log に出力。
// 未設定なら従来通り pipeline-YYYY-MM-DD.log。
const LOG_TAG = process.env.EVENT_HUB_LOG_TAG || '';

function ts() {
  return new Date().toISOString();
}

function write(level, ...args) {
  if (levels[level] < minLevel) return;
  const msg = `[${ts()}] [${level}] ${args.join(' ')}`;
  console.log(msg);

  const date = new Date().toISOString().slice(0, 10);
  const fileName = LOG_TAG
    ? `pipeline-${LOG_TAG}-${date}.log`
    : `pipeline-${date}.log`;
  const logFile = join(LOG_DIR, fileName);
  appendFileSync(logFile, msg + '\n');
}

export const log = {
  debug: (...a) => write('DEBUG', ...a),
  info: (...a) => write('INFO', ...a),
  warn: (...a) => write('WARN', ...a),
  error: (...a) => write('ERROR', ...a),
  setLevel: (l) => { minLevel = levels[l] || 0; },
};
