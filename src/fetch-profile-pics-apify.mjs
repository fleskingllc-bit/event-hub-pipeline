#!/usr/bin/env node
/**
 * fetch-profile-pics-apify.mjs
 *
 * Apify Instagram Profile Scraperを使って出展者のプロフィール画像を一括取得。
 * 既にアイコンがある出展者はスキップ。
 *
 * Usage:
 *   node src/fetch-profile-pics-apify.mjs              # 実行
 *   node src/fetch-profile-pics-apify.mjs --dry-run    # プレビュー
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ApifyClient } from 'apify-client';
import { loadConfig } from './lib/config.js';

const ROOT = new URL('../', import.meta.url).pathname;
const PROTO_ROOT = join(homedir(), 'event-hub-prototype');
const DATA_PATH = join(ROOT, 'output', 'data.json');
const PROTO_DATA_PATH = join(PROTO_ROOT, 'public', 'data.json');
const ICONS_DIR = join(PROTO_ROOT, 'public', 'exhibitor-icons');
const dryRun = process.argv.includes('--dry-run');

mkdirSync(ICONS_DIR, { recursive: true });

const config = loadConfig();
if (!config.apify?.apiToken) {
  console.error('Apify API token not configured');
  process.exit(1);
}

const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

// Find exhibitors with IG handle but no icon file
const needsIcon = [];
for (const ex of data.exhibitors) {
  const handle = (ex.instagram || '').replace(/^@/, '').toLowerCase().trim();
  if (!handle) continue;
  // Skip non-Latin handles (Japanese text etc.)
  if (/[^\x00-\x7F]/.test(handle)) continue;
  const iconPath = join(ICONS_DIR, `${handle}.jpg`);
  if (!existsSync(iconPath)) {
    needsIcon.push(handle);
  }
}

console.log(`Exhibitors needing profile pics: ${needsIcon.length}`);

if (needsIcon.length === 0) {
  console.log('All exhibitors with valid IG handles already have icons.');
  process.exit(0);
}

if (dryRun) {
  console.log('Handles to fetch:', needsIcon.join(', '));
  console.log(`\n[dry-run] Would fetch ${needsIcon.length} profile pics via Apify.`);
  process.exit(0);
}

// Use Apify Instagram Profile Scraper to get profile pics
// Batch in groups of 30 to stay within reasonable limits
const BATCH_SIZE = 30;
const client = new ApifyClient({ token: config.apify.apiToken });

let downloaded = 0;
let failed = 0;

for (let i = 0; i < needsIcon.length; i += BATCH_SIZE) {
  const batch = needsIcon.slice(i, i + BATCH_SIZE);
  console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} profiles...`);

  try {
    const run = await client.actor('apify/instagram-profile-scraper').call({
      usernames: batch,
      resultsLimit: 0, // Only profile info, no posts
    });

    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    for (const profile of items) {
      const username = (profile.username || '').toLowerCase();
      const profilePicUrl = profile.profilePicUrlHD || profile.profilePicUrl;

      if (!username || !profilePicUrl) continue;

      const iconPath = join(ICONS_DIR, `${username}.jpg`);
      try {
        const res = await fetch(profilePicUrl);
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          writeFileSync(iconPath, buffer);
          downloaded++;
          console.log(`  ✓ ${username}`);
        } else {
          console.log(`  ✗ ${username}: HTTP ${res.status}`);
          failed++;
        }
      } catch (err) {
        console.log(`  ✗ ${username}: ${err.message}`);
        failed++;
      }
    }

    // Rate limit between batches
    if (i + BATCH_SIZE < needsIcon.length) {
      await new Promise(r => setTimeout(r, 2000));
    }
  } catch (err) {
    console.error(`Batch failed: ${err.message}`);
    failed += batch.length;
  }
}

console.log(`\n=== Results ===`);
console.log(`Downloaded: ${downloaded}`);
console.log(`Failed: ${failed}`);

// Update data.json with profileImage paths
let linked = 0;
for (const ex of data.exhibitors) {
  const handle = (ex.instagram || '').replace(/^@/, '').toLowerCase().trim();
  if (!handle) continue;
  const iconPath = join(ICONS_DIR, `${handle}.jpg`);
  if (existsSync(iconPath)) {
    ex.profileImage = `/exhibitor-icons/${handle}.jpg`;
    linked++;
  }
}

console.log(`Exhibitors with profile images: ${linked} / ${data.exhibitors.length}`);

writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
writeFileSync(PROTO_DATA_PATH, JSON.stringify(data, null, 2));
console.log('Updated data.json (pipeline + prototype)');
