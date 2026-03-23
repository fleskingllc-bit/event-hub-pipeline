#!/usr/bin/env node
/**
 * extract-exhibitors-vision.mjs
 *
 * Gemini Vision APIでイベントのカルーセル画像を解析し、
 * フライヤー/ポスターに記載された出店者名を抽出する。
 *
 * 対象: exhibitorIdsが空 or 少ないイベントで画像があるもの
 *
 * Usage:
 *   node src/extract-exhibitors-vision.mjs                    # 出店者なしイベント全件
 *   node src/extract-exhibitors-vision.mjs evt_0c4939a0_063   # 特定イベントのみ
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig } from './lib/config.js';
import { GeminiClient } from './ai/gemini.js';
import { createRateLimiter } from './lib/rate-limiter.js';

const PROTO = join(homedir(), 'event-hub-prototype', 'public');
const DATA_PATH = join(PROTO, 'data.json');
const IMAGES_DIR = join(PROTO, 'images', 'events');

const config = loadConfig();
const gemini = new GeminiClient(config);
const rateLimiter = createRateLimiter(2000); // Gemini rate limit

const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

// Target event ID from CLI arg, or process all
const targetId = process.argv[2];

// Build existing exhibitor lookup by name (normalized)
const existingByName = new Map();
const existingByHandle = new Map();
for (const ex of data.exhibitors) {
  const norm = ex.name.toLowerCase().replace(/\s+/g, '');
  existingByName.set(norm, ex);
  if (ex.instagram) {
    existingByHandle.set(ex.instagram.replace(/^@/, '').toLowerCase(), ex);
  }
}

// ID counter
let maxId = 0;
for (const ex of data.exhibitors) {
  const m = ex.id.match(/(\d+)$/);
  if (m) maxId = Math.max(maxId, parseInt(m[0]));
}
function nextId() {
  maxId++;
  return `exh_vision_${String(maxId).padStart(4, '0')}`;
}

const VISION_PROMPT = `この画像はマルシェ・イベントのフライヤー/ポスター/告知画像です。
画像内に記載されている出店者・出展者の名前をすべて抽出してください。

## ルール
- 店舗名・屋号・ブランド名のみ抽出（「飲食」「雑貨」等のカテゴリ名は不要）
- イベント名自体は出店者ではないので除外
- 会場名・主催者名は除外
- Instagramのアカウント名（@xxx）が見えたら一緒に記録
- 商品名やメニュー名ではなく、店舗・作家の名前を抽出
- 画像がフライヤーでない場合（商品写真、風景等）は空配列を返す

## 出力（JSON）
{
  "exhibitors": [
    {
      "name": "店舗名",
      "instagram": "@アカウント名（見えれば）",
      "category": "推測されるカテゴリ（コーヒー/パン/焼き菓子/雑貨/アクセサリー/飲食/ワークショップ等）"
    }
  ]
}

出店者情報が見つからない場合は {"exhibitors": []} を返してください。`;

async function processEvent(event) {
  const images = (event.imageUrls || [])
    .filter((url) => url.startsWith('/images/'))
    .slice(0, 5); // Max 5 images per event

  if (images.length === 0) return null;

  // Read image files
  const imageBuffers = [];
  for (const url of images) {
    const filePath = join(PROTO, url);
    if (existsSync(filePath)) {
      imageBuffers.push({
        data: readFileSync(filePath),
        mimeType: 'image/jpeg',
      });
    }
  }

  if (imageBuffers.length === 0) return null;

  await rateLimiter();
  console.log(`  Analyzing ${event.title} (${imageBuffers.length} images)...`);

  const result = await gemini.generateWithImages(VISION_PROMPT, imageBuffers);

  if (result.error) {
    console.log(`    Error: ${result.error}`);
    return null;
  }

  const exhibitors = result.exhibitors || [];
  if (exhibitors.length === 0) {
    console.log(`    No exhibitors found in images`);
    return null;
  }

  console.log(`    Found ${exhibitors.length} exhibitors in images`);

  // Match or create exhibitors
  const eventExIds = event.exhibitorIds || [];
  let added = 0;

  for (const ex of exhibitors) {
    const name = (ex.name || '').trim();
    if (!name || name.length < 2) continue;

    const norm = name.toLowerCase().replace(/\s+/g, '');
    const handle = (ex.instagram || '').replace(/^@/, '').toLowerCase();

    // Check if already exists
    let existing = existingByName.get(norm);
    if (!existing && handle) existing = existingByHandle.get(handle);

    if (existing) {
      // Link existing
      if (!eventExIds.includes(existing.id)) {
        eventExIds.push(existing.id);
        added++;
        console.log(`    Link: ${existing.name}`);
      }
    } else {
      // Create new
      const newEx = {
        id: nextId(),
        name,
        category: ex.category || '',
        categoryTag: ex.category || '',
        instagram: ex.instagram || '',
        description: '',
        menu: [],
        profileImage: '',
        status: 'pending_review',
        createdAt: new Date().toISOString(),
      };

      data.exhibitors.push(newEx);
      existingByName.set(norm, newEx);
      if (handle) existingByHandle.set(handle, newEx);
      eventExIds.push(newEx.id);
      added++;
      console.log(`    New: ${name}${handle ? ' @' + handle : ''} [${ex.category || '?'}]`);
    }
  }

  if (added > 0) {
    event.exhibitorIds = eventExIds;
  }

  return added;
}

async function main() {
  let targets;

  if (targetId) {
    // Single event
    const ev = data.events.find((e) => e.id === targetId);
    if (!ev) {
      console.error(`Event not found: ${targetId}`);
      process.exit(1);
    }
    targets = [ev];
  } else {
    // All events without exhibitors (or few) that have images
    targets = data.events.filter((e) => {
      const exCount = e.exhibitorIds ? e.exhibitorIds.length : 0;
      const imgCount = e.imageUrls ? e.imageUrls.length : 0;
      return exCount <= 2 && imgCount > 0;
    });
  }

  console.log(`Processing ${targets.length} events with Gemini Vision...\n`);

  let totalNew = 0;
  let processed = 0;

  for (const event of targets) {
    const added = await processEvent(event);
    if (added) totalNew += added;
    processed++;

    if (processed % 10 === 0) {
      console.log(`\n  Progress: ${processed}/${targets.length}\n`);
    }
  }

  console.log(`\nDone. ${totalNew} exhibitors added/linked across ${targets.length} events`);
  console.log(`Total exhibitors: ${data.exhibitors.length}`);

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log(`Updated ${DATA_PATH}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
