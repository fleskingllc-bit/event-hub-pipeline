import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../../', import.meta.url).pathname;

let _config = null;

export function loadConfig() {
  if (_config) return _config;
  const raw = readFileSync(join(ROOT, 'config.json'), 'utf-8');
  _config = JSON.parse(raw);
  return _config;
}
