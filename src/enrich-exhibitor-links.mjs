#!/usr/bin/env node
/**
 * enrich-exhibitor-links.mjs
 *
 * 既存イベントの出展者紐づけを強化するバックフィルスクリプト。
 *
 * 3つのソースから出展者を登録・紐づけ:
 *   1. IG投稿主アカウント → メディアアカウント以外は出展者/主催者として登録
 *   2. キャプション内の@mention → マスターDB照合 or 新規登録
 *   3. Siteイベント → Sheetsの既存exhibitor行をマスターDBにマッピング
 *
 * Usage:
 *   node src/enrich-exhibitor-links.mjs              # 実行
 *   node src/enrich-exhibitor-links.mjs --dry-run    # プレビュー
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadMasterDB, saveMasterDB, matchExhibitor, matchOrRegister } from './exhibitor-matcher.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const DATA_PATH = join(ROOT, 'output', 'data.json');
const RAW_IG_DIR = join(ROOT, 'data', 'raw', 'instagram');
const CONFIG_PATH = join(ROOT, 'config.json');
const PROTO_PATH = join(homedir(), 'event-hub-prototype', 'public', 'data.json');

const dryRun = process.argv.includes('--dry-run');

// Media/aggregator accounts — NOT exhibitors
function loadMediaAccounts() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  return new Set((config.instagram?.accounts || []).map(a => a.toLowerCase()));
}

// Build shortCode → raw data index for fast lookup
function buildRawIndex() {
  const index = {}; // shortCode → { caption, ownerUsername }
  if (!existsSync(RAW_IG_DIR)) return index;
  for (const f of readdirSync(RAW_IG_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const raw = JSON.parse(readFileSync(join(RAW_IG_DIR, f), 'utf-8'));
      const item = raw.raw || {};
      const sc = item.shortCode || item.url?.match(/\/p\/([A-Za-z0-9_-]+)/)?.[1];
      if (sc) {
        index[sc] = {
          caption: item.caption || raw.processed?.caption || '',
          ownerUsername: (item.ownerUsername || raw.processed?.accountName || '').toLowerCase(),
        };
      }
    } catch {}
  }
  return index;
}

function extractMentions(caption) {
  return (caption.match(/@[\w.]{2,}/g) || [])
    .map(m => m.toLowerCase())
    .filter((v, i, a) => a.indexOf(v) === i); // dedupe
}

function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const masterDB = loadMasterDB();
  const mediaAccounts = loadMediaAccounts();
  const rawIndex = buildRawIndex();

  console.log(`Events: ${data.events.length}, Master exhibitors: ${masterDB.exhibitors.length}`);
  console.log(`Raw IG index: ${Object.keys(rawIndex).length} posts`);
  console.log(`Media accounts: ${[...mediaAccounts].join(', ')}`);

  const stats = {
    eventsProcessed: 0,
    ownerRegistered: 0,
    mentionRegistered: 0,
    mentionMatched: 0,
    linksAdded: 0,
    eventsEnriched: 0,
  };

  for (const ev of data.events) {
    if (ev.source !== 'instagram') continue;
    stats.eventsProcessed++;

    const sc = ev.sourceUrl?.match(/\/p\/([^/]+)/)?.[1];
    if (!sc || !rawIndex[sc]) continue;

    const { caption, ownerUsername } = rawIndex[sc];
    const existingIds = new Set(ev.exhibitorIds || []);
    const newIds = [];

    // --- 1. Posting account → exhibitor (if not media) ---
    if (ownerUsername && !mediaAccounts.has(ownerUsername)) {
      // Check if already linked
      const ownerResult = matchExhibitor({ name: ownerUsername, instagram: ownerUsername }, masterDB);
      if (ownerResult.matched) {
        if (!existingIds.has(ownerResult.matched.id)) {
          newIds.push(ownerResult.matched.id);
        }
      } else {
        // Register new exhibitor from account
        const id = matchOrRegister({
          name: ownerUsername,
          instagram: ownerUsername,
          category: '',
          description: '',
        }, masterDB);
        if (id && !existingIds.has(id)) {
          newIds.push(id);
          stats.ownerRegistered++;
        }
      }
    }

    // --- 2. @mentions → exhibitors ---
    const mentions = extractMentions(caption);
    for (const mention of mentions) {
      const handle = mention.replace(/^@/, '');
      // Skip media accounts and self-mention
      if (mediaAccounts.has(handle)) continue;
      if (handle === ownerUsername) continue;

      const result = matchExhibitor({ name: handle, instagram: handle }, masterDB);
      if (result.matched) {
        if (!existingIds.has(result.matched.id) && !newIds.includes(result.matched.id)) {
          newIds.push(result.matched.id);
          stats.mentionMatched++;
        }
      } else {
        // Register @mention as new exhibitor
        const id = matchOrRegister({
          name: handle,
          instagram: handle,
          category: '',
          description: '',
        }, masterDB);
        if (id && !existingIds.has(id) && !newIds.includes(id)) {
          newIds.push(id);
          stats.mentionRegistered++;
        }
      }
    }

    // Update event
    if (newIds.length > 0) {
      ev.exhibitorIds = [...existingIds, ...newIds];
      stats.linksAdded += newIds.length;
      stats.eventsEnriched++;
    }
  }

  // Update exhibitors list in data from master
  data.exhibitors = masterDB.exhibitors.map(e => ({
    id: e.id,
    name: e.name,
    category: e.category || 'その他',
    categoryTag: e.category || 'その他',
    instagram: e.instagram || '',
    description: e.description || '',
    menu: Array.isArray(e.menu) ? e.menu : [],
  }));
  data.totalExhibitors = data.exhibitors.length;

  console.log('\n=== Results ===');
  console.log(`IG events processed: ${stats.eventsProcessed}`);
  console.log(`Posting accounts registered: ${stats.ownerRegistered}`);
  console.log(`@mentions matched to existing: ${stats.mentionMatched}`);
  console.log(`@mentions registered as new: ${stats.mentionRegistered}`);
  console.log(`Total new links added: ${stats.linksAdded}`);
  console.log(`Events enriched: ${stats.eventsEnriched}`);
  console.log(`Master DB now: ${masterDB.exhibitors.length} exhibitors`);

  if (dryRun) {
    console.log('\n[dry-run] No files written.');
    return;
  }

  saveMasterDB(masterDB);
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log(`\nSaved master DB and output/data.json`);

  if (existsSync(join(homedir(), 'event-hub-prototype', 'public'))) {
    writeFileSync(PROTO_PATH, JSON.stringify(data, null, 2));
    console.log('Copied to prototype');
  }
}

main();
