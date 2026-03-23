#!/usr/bin/env node
/**
 * build-post-meta.mjs
 * Instagram raw JSON → post-meta.json (account, caption, timestamp, hashtags)
 * Output: ~/event-hub-prototype/public/post-meta.json
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PIPELINE_ROOT = resolve(__dirname, '..');
const RAW_DIR = join(PIPELINE_ROOT, 'data', 'raw', 'instagram');
const DATA_JSON = resolve(PIPELINE_ROOT, '..', 'event-hub-prototype', 'public', 'data.json');
const OUTPUT = resolve(PIPELINE_ROOT, '..', 'event-hub-prototype', 'public', 'post-meta.json');

// Load events from data.json
const data = JSON.parse(readFileSync(DATA_JSON, 'utf-8'));
const igEvents = data.events.filter((e) => e.source === 'instagram' && e.sourceUrl);

// Build postId → raw data index
const rawFiles = new Set(readdirSync(RAW_DIR).filter((f) => f.endsWith('.json')));

// Extract postId from sourceUrl like https://www.instagram.com/p/{postId}/
function extractPostId(url) {
  const m = url.match(/\/p\/([^/]+)/);
  return m ? m[1] : null;
}

const postMeta = {};
let found = 0;
let skipped = 0;

for (const ev of igEvents) {
  const postId = extractPostId(ev.sourceUrl);
  if (!postId) { skipped++; continue; }

  const rawFile = `${postId}.json`;
  if (!rawFiles.has(rawFile)) { skipped++; continue; }

  try {
    const raw = JSON.parse(readFileSync(join(RAW_DIR, rawFile), 'utf-8'));
    const r = raw.raw || raw;

    postMeta[ev.id] = {
      account: r.ownerUsername || '',
      caption: r.caption || '',
      timestamp: r.timestamp || '',
      hashtags: r.hashtags || [],
      url: r.url || (r.shortCode ? `https://www.instagram.com/p/${r.shortCode}/` : ''),
    };
    found++;
  } catch (err) {
    console.warn(`⚠️  Failed to read ${rawFile}: ${err.message}`);
    skipped++;
  }
}

writeFileSync(OUTPUT, JSON.stringify(postMeta, null, 2), 'utf-8');
console.log(`✅ post-meta.json generated: ${found} events (${skipped} skipped)`);
console.log(`   → ${OUTPUT}`);
