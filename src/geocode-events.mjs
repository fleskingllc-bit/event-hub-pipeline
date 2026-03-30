#!/usr/bin/env node
/**
 * geocode-events.mjs
 * Google Places Text Search で会場名→正確な座標 + Place ID を取得。
 * キャッシュ付き（data/geocache.json）で同じクエリは再リクエストしない。
 *
 * 処理対象: data.json 内の全イベント（座標あり/なし問わず）
 * 出力:     data.json を上書き更新（lat, lng, placeId を追記）
 *
 * Usage: node src/geocode-events.mjs [--dry-run]
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './lib/config.js';
import { SheetsStorage } from './storage/sheets.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = resolve(__dirname, '..');
const DATA_JSON = resolve(ROOT, '..', 'event-hub-prototype', 'public', 'data.json');
const CACHE_FILE = resolve(ROOT, 'data', 'geocache.json');
const ENV_FILE = resolve(ROOT, '.env');

const dryRun = process.argv.includes('--dry-run');

// Load API key from .env
function loadApiKey() {
  if (!existsSync(ENV_FILE)) throw new Error('.env not found');
  const env = readFileSync(ENV_FILE, 'utf-8');
  const m = env.match(/GOOGLE_MAPS_API_KEY=(.+)/);
  if (!m) throw new Error('GOOGLE_MAPS_API_KEY not found in .env');
  return m[1].trim();
}

const API_KEY = loadApiKey();

// Cache: queryString → { lat, lng, placeId, name, address }
let cache = {};
if (existsSync(CACHE_FILE)) {
  try { cache = JSON.parse(readFileSync(CACHE_FILE, 'utf-8')); } catch {}
}

function saveCache() {
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

// Build search query from event fields
function buildQuery(ev) {
  const parts = [];
  if (ev.location) parts.push(ev.location);
  if (ev.address) parts.push(ev.address);
  else if (ev.area) parts.push(ev.area);
  // Fallback: at least area context for Google
  if (parts.length === 0) return null;
  // Append 山口県 for disambiguation if not already present
  const q = parts.join(' ');
  if (!q.includes('山口')) return q + ' 山口県';
  return q;
}

// Rate limit: 10 req/sec to stay safe
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function geocode(query) {
  if (cache[query]) return cache[query];

  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&language=ja&key=${API_KEY}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== 'OK' || !data.results?.length) {
    // Cache miss as null to avoid retrying
    cache[query] = null;
    return null;
  }

  const r = data.results[0];
  const result = {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    placeId: r.place_id,
    name: r.name,
    address: r.formatted_address,
  };
  cache[query] = result;
  return result;
}

// Main
async function main() {
  const data = JSON.parse(readFileSync(DATA_JSON, 'utf-8'));
  const events = data.events;

  // Connect to Sheets for write-back (fill blanks only)
  let storage = null;
  if (!dryRun) {
    try {
      const config = loadConfig();
      storage = new SheetsStorage(config);
    } catch (e) {
      console.warn(`⚠ Sheets write-back disabled: ${e.message}`);
    }
  }

  let updated = 0;
  let newLookups = 0;
  let skipped = 0;
  let failed = 0;
  let sheetsFilled = 0;

  for (const ev of events) {
    // Skip empty events
    if (!ev.title) { skipped++; continue; }

    const query = buildQuery(ev);
    if (!query) { skipped++; continue; }

    const cached = cache[query];
    if (cached === null) { skipped++; continue; } // Previously failed

    const needsLookup = !cached;
    if (needsLookup) newLookups++;

    const result = await geocode(query);
    if (needsLookup) await sleep(120); // Rate limit

    if (!result) {
      console.warn(`  ✗ ${ev.id} | ${ev.title} | query: ${query}`);
      failed++;
      continue;
    }

    // Update data.json
    const changed = ev.lat !== result.lat || ev.lng !== result.lng || !ev.placeId;
    if (changed) {
      ev.lat = result.lat;
      ev.lng = result.lng;
      ev.placeId = result.placeId;
      updated++;
      if (needsLookup) {
        console.log(`  ✓ ${ev.id} | ${ev.title} → ${result.name} (${result.lat}, ${result.lng})`);
      }
    }

    // Write back to Sheets (fill blanks only — never overwrite existing values)
    if (storage && result.lat != null) {
      const filled = await storage.fillBlanks('events', 'id', ev.id, {
        lat: String(result.lat),
        lng: String(result.lng),
        area: ev.area || '',
      });
      if (filled.length > 0) sheetsFilled++;
    }
  }

  // Save
  saveCache();

  if (!dryRun) {
    writeFileSync(DATA_JSON, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`\n✅ data.json updated: ${updated} events geocoded (${newLookups} new lookups, ${failed} failed, ${skipped} skipped)`);
    if (storage) console.log(`   Sheets: ${sheetsFilled} events had blanks filled`);
  } else {
    console.log(`\n🔍 DRY RUN: would update ${updated} events (${newLookups} new lookups, ${failed} failed, ${skipped} skipped)`);
  }
  console.log(`   Cache: ${Object.keys(cache).length} entries`);
}

main().catch((err) => { console.error(err); process.exit(1); });
