#!/usr/bin/env node
/**
 * fetch-exhibitor-icons.mjs
 *
 * Instagramの生データ（taggedUsers）から出店者のプロフィール画像を取得し、
 * public/exhibitor-icons/ に保存、data.json に profileImage フィールドを追加。
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PIPELINE_ROOT = join(homedir(), 'event-hub-pipeline');
const PROTO_ROOT = join(homedir(), 'event-hub-prototype');
const DATA_PATH = join(PROTO_ROOT, 'public', 'data.json');
const RAW_IG_DIR = join(PIPELINE_ROOT, 'data', 'raw', 'instagram');
const ICONS_DIR = join(PROTO_ROOT, 'public', 'exhibitor-icons');

mkdirSync(ICONS_DIR, { recursive: true });

// Load data.json
const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
const { exhibitors } = data;

// Build map: instagram handle (lowercase, no @) → exhibitor
const handleToExhibitor = new Map();
for (const ex of exhibitors) {
  const handle = (ex.instagram || '').replace(/^@/, '').toLowerCase().trim();
  if (handle) handleToExhibitor.set(handle, ex);
}
console.log(`Exhibitors with Instagram handles: ${handleToExhibitor.size}`);

// Scan all raw IG data for taggedUsers and mentions
const rawFiles = readdirSync(RAW_IG_DIR).filter(f => f.endsWith('.json'));

// Collect: handle → { profilePicUrl, fullName }
const profilePics = new Map();

for (const file of rawFiles) {
  try {
    const raw = JSON.parse(readFileSync(join(RAW_IG_DIR, file), 'utf-8')).raw || {};
    const tagged = raw.taggedUsers || [];
    for (const user of tagged) {
      const username = (user.username || user.full_name || '').toLowerCase().trim();
      const picUrl = user.profile_pic_url;
      if (!username || !picUrl) continue;

      // Check if this matches any exhibitor handle
      // taggedUsers use the actual username, exhibitor.instagram might have slight variations
      if (handleToExhibitor.has(username) && !profilePics.has(username)) {
        profilePics.set(username, { url: picUrl, fullName: user.full_name });
      }
    }

    // Also check mentions - match against taggedUsers by position or name
    const mentions = raw.mentions || [];
    for (const mention of mentions) {
      const handle = mention.toLowerCase().trim();
      if (handleToExhibitor.has(handle) && !profilePics.has(handle)) {
        // Find matching taggedUser
        const taggedMatch = tagged.find(u =>
          (u.username || '').toLowerCase() === handle ||
          (u.full_name || '').toLowerCase().includes(handle)
        );
        if (taggedMatch?.profile_pic_url) {
          profilePics.set(handle, { url: taggedMatch.profile_pic_url, fullName: taggedMatch.full_name });
        }
      }
    }
  } catch { /* skip */ }
}

console.log(`Profile pics found from tagged users: ${profilePics.size}`);

// Download profile pics
let downloaded = 0;
let skipped = 0;
let failed = 0;

for (const [handle, { url }] of profilePics) {
  const filename = `${handle}.jpg`;
  const filepath = join(ICONS_DIR, filename);

  if (existsSync(filepath)) {
    skipped++;
    continue;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`  FAIL ${handle}: HTTP ${res.status}`);
      failed++;
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    writeFileSync(filepath, buffer);
    downloaded++;
    // Rate limit
    await new Promise(r => setTimeout(r, 100));
  } catch (err) {
    console.log(`  FAIL ${handle}: ${err.message}`);
    failed++;
  }
}

console.log(`Downloaded: ${downloaded}, Skipped (exists): ${skipped}, Failed: ${failed}`);

// --- Phase 2: Fuzzy-match unlinked icon files to exhibitors ---
// Some icon files exist from old runs but handles changed after master DB migration
const allIconFiles = readdirSync(ICONS_DIR).filter(f => f.endsWith('.jpg'));
const normalize = s => s.replace(/[._\-]/g, '').toLowerCase();

// Build reverse index: normalize(handle) → exhibitor
const normToExhibitor = new Map();
for (const ex of exhibitors) {
  const handle = (ex.instagram || '').replace(/^@/, '').toLowerCase().trim();
  if (handle) normToExhibitor.set(normalize(handle), { ex, handle });
}

let fuzzyLinked = 0;
for (const iconFile of allIconFiles) {
  const iconHandle = iconFile.replace('.jpg', '');
  // Already exact-matched?
  if (handleToExhibitor.has(iconHandle)) continue;

  // Try normalized match
  const normIcon = normalize(iconHandle);
  const match = normToExhibitor.get(normIcon);
  if (match) {
    // Rename/symlink not needed — just note the mapping
    const { ex, handle } = match;
    // Copy file to correct name if different
    const targetFile = `${handle}.jpg`;
    const targetPath = join(ICONS_DIR, targetFile);
    if (!existsSync(targetPath)) {
      const { copyFileSync } = await import('fs');
      copyFileSync(join(ICONS_DIR, iconFile), targetPath);
      fuzzyLinked++;
    }
  }
}
if (fuzzyLinked > 0) console.log(`Fuzzy-matched and copied: ${fuzzyLinked} icon files`);

// --- Phase 3: Collect ALL taggedUser profile pics (not just matched ones) ---
// Save pics for future exhibitors too
const allTaggedPics = new Map();
for (const file of rawFiles) {
  try {
    const raw = JSON.parse(readFileSync(join(RAW_IG_DIR, file), 'utf-8')).raw || {};
    for (const user of (raw.taggedUsers || [])) {
      const username = (user.username || '').toLowerCase().trim();
      const picUrl = user.profile_pic_url;
      if (username && picUrl && !allTaggedPics.has(username)) {
        allTaggedPics.set(username, picUrl);
      }
    }
  } catch {}
}

// Download any tagged user pics that match exhibitors but weren't downloaded yet
let extraDownloaded = 0;
for (const [handle] of handleToExhibitor) {
  const filepath = join(ICONS_DIR, `${handle}.jpg`);
  if (existsSync(filepath)) continue;
  const picUrl = allTaggedPics.get(handle);
  if (!picUrl) continue;
  try {
    const res = await fetch(picUrl);
    if (res.ok) {
      const buffer = Buffer.from(await res.arrayBuffer());
      writeFileSync(filepath, buffer);
      extraDownloaded++;
      await new Promise(r => setTimeout(r, 100));
    }
  } catch {}
}
if (extraDownloaded > 0) console.log(`Extra downloads from tagged users: ${extraDownloaded}`);

// Update data.json with profileImage paths
let linked = 0;
for (const ex of exhibitors) {
  const handle = (ex.instagram || '').replace(/^@/, '').toLowerCase().trim();
  if (!handle) continue;

  const filename = `${handle}.jpg`;
  if (existsSync(join(ICONS_DIR, filename))) {
    ex.profileImage = `/exhibitor-icons/${filename}`;
    linked++;
  }
}

console.log(`\nExhibitors with profile images: ${linked} / ${exhibitors.length}`);

// Also update output/data.json in pipeline
const pipelineDataPath = join(PIPELINE_ROOT, 'output', 'data.json');
writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
writeFileSync(pipelineDataPath, JSON.stringify(data, null, 2));
console.log(`Updated data.json (prototype + pipeline)`);
