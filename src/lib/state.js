import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../../', import.meta.url).pathname;
const STATE_PATH = join(ROOT, 'data', 'state.json');

function load() {
  if (!existsSync(STATE_PATH)) return { processedIds: {}, lastRun: {} };
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}

function save(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export function isProcessed(source, id) {
  const state = load();
  return !!state.processedIds?.[source]?.[id];
}

export function markProcessed(source, id) {
  const state = load();
  if (!state.processedIds[source]) state.processedIds[source] = {};
  state.processedIds[source][id] = new Date().toISOString();
  save(state);
}

export function setLastRun(source, timestamp) {
  const state = load();
  state.lastRun[source] = timestamp;
  save(state);
}

export function getLastRun(source) {
  const state = load();
  return state.lastRun[source] || null;
}
