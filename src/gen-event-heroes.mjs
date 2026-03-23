#!/usr/bin/env node
/**
 * gen-event-heroes.mjs
 *
 * 全イベントのヒーロー背景画像を Imagen 4.0 で一括生成。
 * 既存画像はスキップ。
 *
 * Usage:
 *   node src/gen-event-heroes.mjs              # 全件（既存スキップ）
 *   node src/gen-event-heroes.mjs --force      # 全件（上書き）
 *   node src/gen-event-heroes.mjs evt_xxx      # 特定イベントのみ
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROTO = join(homedir(), 'event-hub-prototype', 'public');
const DATA_PATH = join(PROTO, 'data.json');
const HERO_DIR = join(PROTO, 'images', 'heroes');
const SECRETS = join(homedir(), 'event-hub-pipeline', 'secrets.json');

if (!existsSync(HERO_DIR)) mkdirSync(HERO_DIR, { recursive: true });

const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
const secrets = JSON.parse(readFileSync(SECRETS, 'utf-8'));
const apiKey = secrets.geminiApiKey;

const args = process.argv.slice(2);
const force = args.includes('--force');
const targetId = args.find((a) => a.startsWith('evt_'));

const CATEGORY_ITEMS = {
  'コーヒー': ['a ceramic cup of drip coffee with steam rising', 'scattered roasted coffee beans', 'a glass pour-over dripper'],
  'パン': ['a crusty round sourdough bread loaf', 'a golden baguette with crispy crust', 'a flaky butter croissant'],
  '焼き菓子': ['frosted cupcakes with colorful toppings', 'a stack of pastel macarons', 'golden brown cookies on parchment paper'],
  '雑貨': ['a hand-poured soy candle in a ceramic jar', 'a small handmade ceramic bowl', 'a woven rattan basket'],
  'アクセサリー': ['a delicate handmade beaded bracelet', 'small resin earrings', 'a tiny gemstone ring on a cloth'],
  '飲食': ['a steaming bowl of ramen with egg and chashu', 'golden takoyaki on a wooden boat plate', 'a rice onigiri wrapped in nori'],
  'ワークショップ': ['watercolor paint palette with brushes', 'scissors and patterned fabric swatches', 'a ball of natural yarn'],
  '花': ['a lush bouquet of seasonal wildflowers', 'a small potted succulent', 'a single stem of dried flower'],
  'クレープ': ['a folded crepe with fresh strawberries and cream', 'sliced fresh strawberries'],
  'ネイルチップ': ['a small bottle of nail polish', 'colorful decorative nail tips'],
  '占い': ['a spread of illustrated tarot cards', 'a clear crystal ball'],
  'マッサージ': ['a brown glass bottle of essential oil', 'smooth hot stones stacked'],
  'その他': ['a kraft paper wrapped gift box', 'colorful triangle pennant bunting'],
  '写真': ['a vintage film camera', 'a polaroid photo print'],
  'アロマ': ['a glass bottle of amber essential oil', 'a sprig of dried lavender'],
};

// タイトル・説明文からイベントテーマを推定
const TITLE_THEMES = [
  { keywords: ['落語', '独演会', '寄席', '噺家'], items: ['a traditional Japanese folding fan (sensu)', 'a zabuton cushion on a raised wooden stage', 'a noren curtain with calligraphy'] },
  { keywords: ['音楽', 'ライブ', 'LIVE', 'コンサート', 'アコースティック', 'ジャズ', 'jazz'], items: ['an acoustic guitar', 'a vintage microphone on a stand', 'musical notes floating'] },
  { keywords: ['ヨガ', 'yoga', 'ピラティス'], items: ['a rolled yoga mat', 'a small potted plant', 'a glass water bottle'] },
  { keywords: ['映画', '上映', 'シネマ'], items: ['a film reel', 'a bucket of popcorn', 'a movie clapperboard'] },
  { keywords: ['読み聞かせ', '絵本', '朗読'], items: ['an open illustrated picture book', 'a stack of colorful books', 'a reading lamp'] },
  { keywords: ['ダンス', 'dance', 'バレエ'], items: ['ballet shoes', 'a flowing silk ribbon'] },
  { keywords: ['書道', '書'], items: ['a calligraphy brush and ink stone', 'washi paper with ink strokes'] },
  { keywords: ['茶道', 'お茶会', '茶会'], items: ['a matcha bowl (chawan) with frothy green tea', 'a bamboo whisk (chasen)', 'wagashi sweets on a small plate'] },
  { keywords: ['陶芸', '窯', '焼き物'], items: ['a handmade ceramic cup on a pottery wheel', 'glazed pottery bowls'] },
  { keywords: ['キッチンカー', 'フードトラック'], items: ['a colorful food truck', 'a paper food tray with fries'] },
  { keywords: ['ホワイトデー', 'バレンタイン', 'チョコ'], items: ['a heart-shaped box of chocolates', 'wrapped gift boxes with ribbons', 'a bouquet of roses'] },
  { keywords: ['ハロウィン', 'Halloween'], items: ['carved jack-o-lantern pumpkins', 'scattered candy', 'a witch hat'] },
  { keywords: ['クリスマス', 'Xmas'], items: ['a decorated Christmas tree', 'wrapped presents with bows', 'a gingerbread cookie'] },
  { keywords: ['春まつり', '桜まつり', '花見'], items: ['cherry blossom branches in full bloom', 'a bento box', 'dango on a stick'] },
  { keywords: ['夏まつり', '盆踊り', '祭り', 'まつり'], items: ['a red paper lantern', 'cotton candy', 'a goldfish in a bag'] },
  { keywords: ['フリマ', 'フリーマーケット'], items: ['a vintage suitcase', 'stacked old books', 'a retro alarm clock'] },
  { keywords: ['スイーツ', 'ビュッフェ', 'ケーキ'], items: ['a layered strawberry shortcake', 'a parfait glass with fruits', 'a slice of cheesecake'] },
  { keywords: ['パン'], items: ['a crusty round sourdough bread loaf', 'a golden baguette with crispy crust', 'a flaky butter croissant'] },
];

function getTitleThemeItems(event) {
  const text = (event.title || '') + ' ' + (event.description || '');
  const items = [];
  for (const theme of TITLE_THEMES) {
    if (theme.keywords.some((kw) => text.includes(kw))) {
      items.push(...theme.items);
    }
  }
  return items;
}

function getIllustrationItems(event, exhibitors) {
  const catCount = {};
  for (const ex of exhibitors) {
    const cat = ex.categoryTag || ex.category || '';
    if (cat && CATEGORY_ITEMS[cat]) {
      catCount[cat] = (catCount[cat] || 0) + 1;
    }
  }

  const total = Object.values(catCount).reduce((a, b) => a + b, 0);
  const sorted = Object.entries(catCount).sort((a, b) => b[1] - a[1]);
  const isSpecialized = sorted.length > 0 && sorted[0][1] / Math.max(total, 1) > 0.4;
  const topCat = sorted[0]?.[0];

  // タイトルからテーマアイテムを取得
  const titleItems = getTitleThemeItems(event);

  const items = [];

  // タイトルテーマが強い場合（落語、音楽等）、それを優先
  if (titleItems.length >= 2) {
    items.push(...titleItems.slice(0, 4));
    // 残り枠で出展者カテゴリからも追加
    for (const [cat] of sorted.slice(0, 4)) {
      const catItems = CATEGORY_ITEMS[cat] || [];
      if (catItems.length && items.length < 7) items.push(catItems[0]);
    }
  } else if (isSpecialized && topCat) {
    const themeItems = CATEGORY_ITEMS[topCat] || [];
    for (const item of themeItems.slice(0, 5)) items.push(item);
    for (const [cat] of sorted.slice(1, 4)) {
      const catItems = CATEGORY_ITEMS[cat] || [];
      if (catItems.length) items.push(catItems[0]);
    }
  } else {
    // タイトルテーマが1つでもあれば混ぜる
    items.push(...titleItems);
    for (const [cat] of sorted.slice(0, 7)) {
      const catItems = CATEGORY_ITEMS[cat] || [];
      if (catItems.length) items.push(catItems[Math.floor(Math.random() * catItems.length)]);
    }
  }

  for (const ex of exhibitors) {
    const text = ((ex.name || '') + ' ' + (ex.description || '')).toLowerCase();
    if (text.includes('トマト') || text.includes('野菜')) items.push('a ripe red tomato');
    if (text.includes('いちご') || text.includes('苺')) items.push('fresh strawberries');
    if (text.includes('焼き芋') || text.includes('芋')) items.push('a roasted sweet potato split open');
    if (text.includes('ワッフル')) items.push('a golden waffle with cream');
    if (text.includes('チーズ')) items.push('a wedge of cheese');
    if (text.includes('カレー')) items.push('a bowl of curry rice');
    if (text.includes('ベーグル')) items.push('a toasted bagel');
    if (text.includes('カヌレ')) items.push('a caramelized cannelé');
    if (items.length >= 8) break;
  }

  return [...new Set(items)].slice(0, 8);
}

function buildPrompt(items) {
  const itemList = items.join(', ');
  return `${items.length} food and lifestyle objects floating in zero gravity, overlapping each other in the center of the image. Objects: ${itemList}. The objects overlap and partially cover each other like layered magazine cutouts. Each item is tilted at a different playful angle, tumbling weightlessly. Liquids splash from tilted cups. IMPORTANT: all objects must stay well within the image frame — leave generous white margins on all four sides. The cluster of overlapping objects is compact in the center. Style: semi-realistic editorial illustration, Japanese food magazine aesthetic (Dancyu, Brutus), gouache watercolor, visible brushstrokes, rich warm saturated colors, glossy highlights. NO TEXT anywhere. No people, no faces, no hands. Pure white background.`;
}

async function generateHero(event) {
  const heroPath = join(HERO_DIR, `${event.id}.png`);
  if (!force && existsSync(heroPath)) return 'skip';

  const exhibitors = (event.exhibitorIds || [])
    .map((id) => data.exhibitors.find((e) => e.id === id))
    .filter(Boolean);

  const items = getIllustrationItems(event, exhibitors);
  if (items.length < 2) return 'no-items';

  const prompt = buildPrompt(items);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-fast-generate-001:predict?key=${apiKey}`;
  const payload = {
    instances: [{ prompt }],
    parameters: { sampleCount: 1, aspectRatio: '16:9' },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text();
    return `error-${res.status}`;
  }

  const result = await res.json();
  const b64 = result.predictions?.[0]?.bytesBase64Encoded;
  if (!b64) return 'no-image';

  writeFileSync(heroPath, Buffer.from(b64, 'base64'));
  return 'ok';
}

async function main() {
  let targets;
  if (targetId) {
    const ev = data.events.find((e) => e.id === targetId);
    if (!ev) { console.error('Not found:', targetId); process.exit(1); }
    targets = [ev];
  } else {
    targets = data.events;
  }

  console.log(`Generating heroes for ${targets.length} events...\n`);

  let ok = 0, skip = 0, fail = 0, noItems = 0;

  for (let i = 0; i < targets.length; i++) {
    const ev = targets[i];
    const result = await generateHero(ev);

    if (result === 'ok') {
      ok++;
      console.log(`  [${i + 1}/${targets.length}] OK: ${ev.title}`);
    } else if (result === 'skip') {
      skip++;
    } else if (result === 'no-items') {
      noItems++;
    } else {
      fail++;
      console.log(`  [${i + 1}/${targets.length}] FAIL(${result}): ${ev.title}`);
    }

    // Rate limit: ~30 req/min for Imagen
    if (result === 'ok') await new Promise((r) => setTimeout(r, 2500));
  }

  console.log(`\nDone. OK:${ok} Skip:${skip} NoItems:${noItems} Fail:${fail}`);
}

main().catch(console.error);
