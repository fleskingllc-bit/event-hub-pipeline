#!/usr/bin/env node
/**
 * link-exhibitors.mjs
 *
 * Instagramの生キャプションから出店者名を検索し、
 * data.json の events[].exhibitorIds を埋める。
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PIPELINE_ROOT = join(homedir(), 'event-hub-pipeline');
const PROTO_ROOT = join(homedir(), 'event-hub-prototype');
const DATA_PATH = join(PROTO_ROOT, 'public', 'data.json');
const RAW_IG_DIR = join(PIPELINE_ROOT, 'data', 'raw', 'instagram');

// Load data.json
const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
const { events, exhibitors } = data;

console.log(`Events: ${events.length}, Exhibitors: ${exhibitors.length}`);

// Build a map: postId → raw Instagram data
const rawFiles = readdirSync(RAW_IG_DIR).filter(f => f.endsWith('.json'));
const postIdToCaption = new Map();
for (const file of rawFiles) {
  const postId = file.replace('.json', '');
  try {
    const raw = JSON.parse(readFileSync(join(RAW_IG_DIR, file), 'utf-8'));
    const caption = raw.raw?.caption || raw.processed?.caption || '';
    postIdToCaption.set(postId, caption);
  } catch { /* skip */ }
}
console.log(`Raw IG posts loaded: ${postIdToCaption.size}`);

// Extract postId from event sourceUrl
function extractPostId(sourceUrl) {
  if (!sourceUrl) return null;
  // Format: https://www.instagram.com/p/{shortCode}/
  // or raw postId in the URL
  const match = sourceUrl.match(/\/p\/([^/]+)/);
  if (match) return match[1]; // shortCode
  return null;
}

// For matching, we also need to map shortCode → postId (numeric)
const shortCodeToPostId = new Map();
for (const file of rawFiles) {
  const postId = file.replace('.json', '');
  try {
    const raw = JSON.parse(readFileSync(join(RAW_IG_DIR, file), 'utf-8'));
    const shortCode = raw.raw?.shortCode;
    if (shortCode) shortCodeToPostId.set(shortCode, postId);
  } catch { /* skip */ }
}

// Build exhibitor name list for matching
// Normalize names for fuzzy matching
function normalize(s) {
  return s.toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[．・、。,.\-_]/g, '')
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
}

// Junk names: category names that AI sometimes outputs as exhibitor names
const JUNK_NAMES = new Set([
  'ワークショップ', '飲食', '物販', 'フード', 'コーヒー', '焼き菓子',
  'スイーツ', 'アクセサリー', '雑貨', '陶器', '花屋', '木工', 'ヨガ',
  'ガラス', 'レザー', 'キャンドル', '農家', 'ハンドメイド',
]);

const exhibitorIndex = exhibitors
  .filter(ex => ex.name && ex.name.trim().length > 1 && !JUNK_NAMES.has(ex.name.trim()))
  .map(ex => ({
    id: ex.id,
    name: ex.name,
    normalized: normalize(ex.name),
    instagram: (ex.instagram || '').replace(/^@/, '').toLowerCase(),
  }));

// Match exhibitors to events
let linkedCount = 0;
let totalLinks = 0;

for (const event of events) {
  if (event.source !== 'instagram') continue;

  // Find the caption for this event
  const shortCode = extractPostId(event.sourceUrl);
  if (!shortCode) continue;

  const postId = shortCodeToPostId.get(shortCode) || shortCode;
  const caption = postIdToCaption.get(postId) || postIdToCaption.get(shortCode);
  if (!caption) continue;

  const captionNorm = normalize(caption);
  const captionLower = caption.toLowerCase();

  const matchedIds = [];

  for (const ex of exhibitorIndex) {
    // Match by name (at least 3 chars to avoid false positives)
    if (ex.normalized.length >= 3 && captionNorm.includes(ex.normalized)) {
      matchedIds.push(ex.id);
      continue;
    }
    // Match by Instagram handle
    if (ex.instagram.length >= 3 && captionLower.includes(ex.instagram)) {
      matchedIds.push(ex.id);
      continue;
    }
  }

  if (matchedIds.length > 0) {
    // Deduplicate
    event.exhibitorIds = [...new Set(matchedIds)];
    linkedCount++;
    totalLinks += event.exhibitorIds.length;
    console.log(`  ${event.title} → ${event.exhibitorIds.length} exhibitors`);
  }
}

console.log(`\nLinked ${linkedCount} events with ${totalLinks} total exhibitor links`);

// Also check: how many exhibitors are now linked to at least one event?
const linkedExIds = new Set(events.flatMap(e => e.exhibitorIds || []));
console.log(`Exhibitors linked: ${linkedExIds.size} / ${exhibitors.length}`);

// Unlinked exhibitors
const unlinked = exhibitors.filter(ex => !linkedExIds.has(ex.id));
if (unlinked.length > 0 && unlinked.length <= 20) {
  console.log('\nUnlinked exhibitors:');
  for (const ex of unlinked) {
    console.log(`  ${ex.id}: ${ex.name}`);
  }
}

// Write updated data.json
writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log(`\nUpdated ${DATA_PATH}`);
