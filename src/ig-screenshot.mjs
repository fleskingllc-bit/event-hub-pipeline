#!/usr/bin/env node
/**
 * ig-screenshot.mjs — Instagram投稿用の画像生成（Playwright）
 *
 * 3種類の画像を生成:
 *   1. カバー画像: ヒーロー画像 + タイトルオーバーレイ（4:5）
 *   2. リポスト画像: イベント画像 + リポストバッジ（4:5）
 *   3. EventPageスクショ: (レガシー、参考用)
 *
 * Usage:
 *   node src/ig-screenshot.mjs cover <eventId>
 *   node src/ig-screenshot.mjs repost <eventId> <imageUrl> <sourceAccount> [index]
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { loadConfig } from './lib/config.js';

const config = loadConfig();
const BASE_URL = config.igPosting?.netlifyBaseUrl || 'https://machi-event-cho.netlify.app';
const VIEWPORT = config.igPosting?.captureViewport || { width: 390, height: 488 };
const CAPTURE_DIR = join(new URL('../', import.meta.url).pathname, '..', 'event-hub-prototype', 'public', 'images', 'ig-captures');

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}（${DAY_NAMES[d.getDay()]}）`;
}

/**
 * カバー画像: ヒーロー画像(Gemini生成) + タイトルオーバーレイ
 * → カルーセル1枚目用
 */
export async function captureCoverImage(eventId, event, { force = false, eventImages = [] } = {}) {
  const outputPath = join(CAPTURE_DIR, `${eventId}_cover.png`);
  if (!force && existsSync(outputPath)) {
    console.log(`⏭️  カバー済み: ${eventId}`);
    return outputPath;
  }
  mkdirSync(CAPTURE_DIR, { recursive: true });

  const heroUrl = `${BASE_URL}/images/heroes/${eventId}.webp`;
  const dateLine = event.date ? formatDate(event.date) : '';
  const locationLine = event.location || '';

  // 一言コピー: descriptionから短いキャッチを生成
  let tagline = (event.description || '').replace(/\n/g, ' ').trim();
  if (tagline.length > 40) tagline = tagline.slice(0, 38) + '…';

  // プレビュー写真（最大3枚）
  const previewUrls = eventImages.slice(0, 3).map(p =>
    p.startsWith('http') ? p : `${BASE_URL}${p}`
  );
  const previewCount = previewUrls.length;

  const previewHtml = previewCount > 0
    ? `<div class="preview preview-${previewCount}">${previewUrls.map(u => `<div class="preview-img"><img src="${escapeHtml(u)}" alt=""></div>`).join('')}</div>`
    : '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${VIEWPORT.width}px; height:${VIEWPORT.height}px; overflow:hidden; font-family:'Noto Sans JP',sans-serif; }
  .cover {
    width:100%; height:100%; position:relative;
    background: url('${heroUrl}') center/cover no-repeat;
  }
  .cover::after {
    content:''; position:absolute; inset:0;
    background: rgba(0,0,0,0.3);
  }
  .content {
    position:absolute; inset:0; z-index:1;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding: 24px 28px 80px;
    text-align:center;
  }
  .tagline {
    font-size:13px; font-weight:700; color:rgba(255,255,255,0.9);
    letter-spacing:0.08em;
    text-shadow: 0 1px 6px rgba(0,0,0,0.6);
    margin-bottom:12px;
  }
  .title {
    font-size:28px; font-weight:900; color:#fff; line-height:1.35;
    text-shadow: 0 2px 12px rgba(0,0,0,0.6);
    letter-spacing: 0.02em;
  }
  .divider {
    width:40px; height:2px; background:rgba(255,255,255,0.6);
    margin:16px 0;
    border-radius:1px;
  }
  .date {
    font-size:18px; font-weight:700; color:#fff;
    text-shadow: 0 1px 8px rgba(0,0,0,0.5);
    letter-spacing:0.04em;
  }
  .location {
    font-size:13px; font-weight:400; color:rgba(255,255,255,0.85);
    text-shadow: 0 1px 4px rgba(0,0,0,0.5);
    margin-top:6px;
  }
  .bottom-bar {
    position:absolute; bottom:0; left:0; right:0; z-index:1;
    display:flex; flex-direction:column; align-items:center; gap:8px;
    padding:0 20px 14px;
  }
  .preview {
    display:flex; gap:6px; justify-content:center;
    width:100%;
  }
  .preview-img {
    border-radius:8px; overflow:hidden;
    border:2px solid rgba(255,255,255,0.7);
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
  }
  .preview-img img {
    width:100%; height:100%; object-fit:cover; display:block;
  }
  /* 1枚: 横長ワイドに */
  .preview-1 .preview-img { width:260px; height:90px; }
  /* 2枚: 並列 */
  .preview-2 .preview-img { width:128px; height:90px; }
  /* 3枚 */
  .preview-3 .preview-img { width:104px; height:78px; }
  .brand {
    display:inline-flex; align-items:center; gap:6px;
    padding:5px 12px;
    background:rgba(255,255,255,0.15); backdrop-filter:blur(8px);
    border-radius:6px; font-size:11px; color:rgba(255,255,255,0.85);
    font-weight:700; letter-spacing:0.05em;
  }
</style></head>
<body>
  <div class="cover">
    <div class="content">
      ${tagline ? `<div class="tagline">${escapeHtml(tagline)}</div>` : ''}
      <div class="title">${escapeHtml(event.title)}</div>
      <div class="divider"></div>
      ${dateLine ? `<div class="date">${escapeHtml(dateLine)}${event.time ? ' ' + escapeHtml(event.time) : ''}</div>` : ''}
      ${locationLine ? `<div class="location">${escapeHtml(locationLine)}</div>` : ''}
    </div>
    <div class="bottom-bar">
      ${previewHtml}
      <div class="brand">まちのイベント帖</div>
    </div>
  </div>
</body></html>`;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: outputPath });
    console.log(`✅ カバー保存: ${outputPath}`);
    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * リポスト画像: 元画像 + リポストバッジ（引用元クレジット表示）
 * → カルーセル2枚目以降用
 */
export async function captureRepostImage(eventId, imageUrl, sourceAccount, index = 0, { force = false } = {}) {
  const outputPath = join(CAPTURE_DIR, `${eventId}_repost_${index}.png`);
  if (!force && existsSync(outputPath)) {
    return outputPath;
  }
  mkdirSync(CAPTURE_DIR, { recursive: true });

  const handle = sourceAccount ? sourceAccount.replace(/^@/, '') : '';
  const badgeText = handle ? `@${handle}` : 'repost';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${VIEWPORT.width}px; height:${VIEWPORT.height}px; overflow:hidden; font-family:'Noto Sans JP',sans-serif; }
  .frame {
    width:100%; height:100%; position:relative;
    background:#f0f0f0;
  }
  .frame img {
    width:100%; height:100%; object-fit:cover;
  }
  .badge {
    position:absolute; bottom:0; left:0;
    display:inline-flex; align-items:center; gap:5px;
    background:rgba(0,0,0,0.55); backdrop-filter:blur(6px);
    color:#fff; font-size:11px; font-weight:700;
    padding:5px 10px; border-radius:0 6px 0 0;
    letter-spacing:0.02em;
  }
  .badge svg {
    width:14px; height:14px; fill:#fff; flex-shrink:0;
  }
</style></head>
<body>
  <div class="frame">
    <img src="${escapeHtml(imageUrl)}" alt="">
    <div class="badge">
      <svg viewBox="0 0 24 24"><path d="M2 12a10 10 0 0 1 18-6h-4v2h7V1h-2v4A12 12 0 0 0 0 12h2zm20 0a10 10 0 0 1-18 6h4v-2H1v7h2v-4a12 12 0 0 0 21-7h-2z"/></svg>
      ${escapeHtml(badgeText)}
    </div>
  </div>
</body></html>`;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: outputPath });
    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * ストーリーズ画像: ヒーロー画像 + タイトル/日時/場所（中央） + メンション
 * → 9:16 縦長（1080x1920相当、ビューポート270x480でRetina2x）
 */
const STORY_VIEWPORT = { width: 270, height: 480 };

export async function captureStoryImage(eventId, event, { force = false, sourceAccount = '' } = {}) {
  const outputPath = join(CAPTURE_DIR, `${eventId}_story.png`);
  if (!force && existsSync(outputPath)) {
    console.log(`⏭️  ストーリー済み: ${eventId}`);
    return outputPath;
  }
  mkdirSync(CAPTURE_DIR, { recursive: true });

  const heroUrl = `${BASE_URL}/images/heroes/${eventId}.webp`;
  const dateLine = event.date ? formatDate(event.date) : '';
  const locationLine = event.location || '';

  let tagline = (event.description || '').replace(/\n/g, ' ').trim();
  if (tagline.length > 35) tagline = tagline.slice(0, 33) + '…';

  const sourceHandle = sourceAccount ? sourceAccount.replace(/^@/, '') : '';

  const areaLine = event.area || '';

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${STORY_VIEWPORT.width}px; height:${STORY_VIEWPORT.height}px; overflow:hidden; font-family:'Noto Sans JP',sans-serif; }
  .story {
    width:100%; height:100%; position:relative;
    background: #fff url('${heroUrl}') center/auto 60% no-repeat;
  }
  .story::after {
    content:''; position:absolute; inset:0;
    background: rgba(0,0,0,0.3);
  }
  .content {
    position:absolute; inset:0; z-index:1;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    padding:40px 16px;
    text-align:center;
  }
  .tags {
    display:flex; flex-wrap:wrap; justify-content:center; gap:6px;
    margin-bottom:14px;
  }
  .tag {
    display:inline-flex; align-items:center; gap:3px;
    padding:4px 10px; border-radius:20px;
    font-size:10px; font-weight:700; letter-spacing:0.03em;
    backdrop-filter:blur(6px);
  }
  .tag-area {
    background:rgba(255,255,255,0.85); color:#555;
  }
  .tag-date {
    background:rgba(255,255,255,0.85); color:#555;
  }
  .title {
    font-size:22px; font-weight:900; color:#fff; line-height:1.35;
    text-shadow: 0 2px 10px rgba(0,0,0,0.6);
  }
  .divider {
    width:32px; height:2px; background:rgba(255,255,255,0.6);
    margin:14px 0; border-radius:1px;
  }
  .location {
    font-size:11px; color:rgba(255,255,255,0.85);
    text-shadow: 0 1px 4px rgba(0,0,0,0.5);
    margin-top:4px;
  }
  .bottom {
    position:absolute; bottom:20px; left:0; right:0; z-index:1;
    display:flex; flex-direction:column; align-items:center; gap:6px;
  }
  .mention-source {
    font-size:10px; color:rgba(255,255,255,0.7);
    text-shadow: 0 1px 3px rgba(0,0,0,0.5);
  }
  .brand {
    display:inline-flex; align-items:center; gap:4px;
    padding:4px 10px;
    background:rgba(255,255,255,0.15); backdrop-filter:blur(8px);
    border-radius:5px; font-size:10px; color:rgba(255,255,255,0.85);
    font-weight:700; letter-spacing:0.05em;
  }
</style></head>
<body>
  <div class="story">
    <div class="content">
      <div class="tags">
        ${areaLine ? `<span class="tag tag-area">${escapeHtml(areaLine)}</span>` : ''}
        ${dateLine ? `<span class="tag tag-date">${escapeHtml(dateLine)}${event.time ? ' ' + escapeHtml(event.time) : ''}</span>` : ''}
      </div>
      <div class="title">${escapeHtml(event.title)}</div>
      <div class="divider"></div>
      ${locationLine ? `<div class="location">${escapeHtml(locationLine)}</div>` : ''}
    </div>
    <div class="bottom">
      ${sourceHandle ? `<div class="mention-source">photo: @${escapeHtml(sourceHandle)}</div>` : ''}
      <div class="brand">@machi_ymg</div>
    </div>
  </div>
</body></html>`;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: STORY_VIEWPORT, deviceScaleFactor: 4 });
    await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: outputPath });
    console.log(`✅ ストーリー保存: ${outputPath}`);
    return outputPath;
  } finally {
    await browser.close();
  }
}

/**
 * 公開URLを返す（Netlifyデプロイ後に有効）
 */
export function getCaptureUrl(filename) {
  return `${BASE_URL}/images/ig-captures/${filename}`;
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Direct execution
if (process.argv[1].endsWith('ig-screenshot.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'cover') {
    const eventId = process.argv[3];
    if (!eventId) { console.error('Usage: node src/ig-screenshot.mjs cover <eventId>'); process.exit(1); }
    const { readFileSync, existsSync: ex } = await import('fs');
    const root = new URL('../', import.meta.url).pathname;
    const data = JSON.parse(readFileSync(join(root, 'output', 'data.json'), 'utf-8'));
    const event = data.events.find(e => e.id === eventId);
    if (!event) { console.error(`Event not found: ${eventId}`); process.exit(1); }
    // image-links.json からイベント画像取得
    let eventImages = [];
    const ilPath = join(root, 'data', 'image-links.json');
    try { eventImages = JSON.parse(readFileSync(ilPath, 'utf-8'))[eventId] || []; } catch {}
    captureCoverImage(eventId, event, { force: true, eventImages })
      .then(p => console.log(`\n🎉 カバー画像完了: ${p}`))
      .catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
  } else if (cmd === 'repost') {
    const [,, , eventId, imageUrl, sourceAccount, idx] = process.argv;
    if (!eventId || !imageUrl) {
      console.error('Usage: node src/ig-screenshot.mjs repost <eventId> <imageUrl> <sourceAccount> [index]');
      process.exit(1);
    }
    captureRepostImage(eventId, imageUrl, sourceAccount || '', parseInt(idx) || 0, { force: true })
      .then(p => console.log(`\n🎉 リポスト画像完了: ${p}`))
      .catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
  } else if (cmd === 'story') {
    const eventId = process.argv[3];
    if (!eventId) { console.error('Usage: node src/ig-screenshot.mjs story <eventId>'); process.exit(1); }
    const { readFileSync } = await import('fs');
    const root = new URL('../', import.meta.url).pathname;
    const data = JSON.parse(readFileSync(join(root, 'output', 'data.json'), 'utf-8'));
    const event = data.events.find(e => e.id === eventId);
    if (!event) { console.error(`Event not found: ${eventId}`); process.exit(1); }
    // image-sources.json から引用元アカウント取得
    let sourceAccount = '';
    const srcPath = join(root, 'data', 'image-sources.json');
    try { sourceAccount = JSON.parse(readFileSync(srcPath, 'utf-8'))[eventId] || ''; } catch {}
    captureStoryImage(eventId, event, { force: true, sourceAccount })
      .then(p => console.log(`\n🎉 ストーリー画像完了: ${p}`))
      .catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
  } else {
    console.error('Usage:');
    console.error('  node src/ig-screenshot.mjs cover <eventId>');
    console.error('  node src/ig-screenshot.mjs repost <eventId> <imageUrl> <sourceAccount> [index]');
    console.error('  node src/ig-screenshot.mjs story <eventId>');
    process.exit(1);
  }
}
