#!/usr/bin/env node
/**
 * gen-event-heroes.mjs
 *
 * 全イベントのヒーロー背景画像を Imagen 4.0 で一括生成。
 * 既存画像はスキップ。
 *
 * Usage (CLI):
 *   node src/gen-event-heroes.mjs              # 全件（既存スキップ）
 *   node src/gen-event-heroes.mjs --force      # 全件（上書き）
 *   node src/gen-event-heroes.mjs evt_xxx      # 特定イベントのみ
 *
 * Usage (import):
 *   import { generateHeroes } from './gen-event-heroes.mjs';
 *   const result = await generateHeroes({ events, exhibitors });
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const ROOT = new URL('../', import.meta.url).pathname;
const PROTO = join(homedir(), 'event-hub-prototype', 'public');
const HERO_DIR = join(PROTO, 'images', 'heroes');
const SECRETS = join(ROOT, 'secrets.json');
const CONFIG_PATH = join(ROOT, 'config.json');

function loadHeroConfig() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    return config.heroImage || {};
  } catch { return {}; }
}

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

// area ベースのフォールバックアイテム
const AREA_FALLBACK_ITEMS = {
  '光市': ['a Japanese lighthouse by the sea', 'pine trees along a sandy beach', 'a traditional Japanese temple gate', 'fresh seafood sashimi on ice'],
  '周南市': ['an industrial harbor at sunset', 'a modern glass building', 'golden takoyaki on a wooden boat plate', 'a steaming bowl of ramen'],
  '下松市': ['a bowl of ramen with thick noodles', 'a red torii gate', 'fresh vegetables in a basket'],
  '柳井市': ['white-walled traditional storefronts', 'a goldfish paper lantern', 'handmade fabric crafts'],
  '岩国市': ['a traditional arched wooden bridge', 'cherry blossom branches in full bloom', 'a bento box with local specialties'],
  '山口市': ['a five-story pagoda', 'a hot spring steam rising', 'wagashi sweets on a small plate'],
  '防府市': ['a plum blossom branch', 'a traditional shrine', 'golden rice fields'],
  '萩市': ['a white ceramic Hagi-yaki tea bowl', 'a stone wall of a castle town', 'fresh squid on ice'],
  '下関市': ['a pufferfish (fugu) on a plate', 'the Kanmon Strait bridge', 'fresh sushi on a wooden board'],
  '宇部市': ['a sculptured art piece in a park', 'colorful flowers in a garden', 'a cup of coffee with latte art'],
};

// description キーワードからアイテムを推定
const DESC_KEYWORD_ITEMS = [
  { keywords: ['マルシェ', 'marché', 'マーケット', 'market'], items: ['colorful triangle pennant bunting', 'a kraft paper wrapped gift box', 'a woven basket of fresh vegetables', 'a jar of homemade jam'] },
  { keywords: ['ハンドメイド', '手作り', 'クラフト'], items: ['scissors and patterned fabric swatches', 'a ball of natural yarn', 'a handmade ceramic bowl', 'colorful beads and findings'] },
  { keywords: ['グルメ', '美食', 'フードフェス', '食'], items: ['golden takoyaki on a wooden boat plate', 'a steaming bowl of ramen', 'fresh sushi on a wooden board', 'a rice onigiri wrapped in nori'] },
  { keywords: ['アート', '展覧', '美術', '作品'], items: ['watercolor paint palette with brushes', 'a vintage film camera', 'a small handmade ceramic bowl', 'an open illustrated picture book'] },
  { keywords: ['花', 'フラワー', 'ガーデン', '庭'], items: ['a lush bouquet of seasonal wildflowers', 'a small potted succulent', 'a single stem of dried flower', 'a watering can'] },
  { keywords: ['子ども', 'キッズ', '親子', 'ファミリー'], items: ['colorful building blocks', 'a teddy bear', 'cotton candy on a stick', 'a red balloon'] },
  { keywords: ['健康', 'ウェルネス', 'リラックス'], items: ['a rolled yoga mat', 'a glass bottle of essential oil', 'a cup of herbal tea', 'smooth hot stones stacked'] },
];

// 汎用フォールバック
const UNIVERSAL_FALLBACK = [
  'colorful triangle pennant bunting',
  'a kraft paper wrapped gift box',
  'a ceramic cup of coffee with steam',
  'a small potted plant',
  'a woven basket',
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

  const titleItems = getTitleThemeItems(event);
  const items = [];

  if (titleItems.length >= 2) {
    items.push(...titleItems.slice(0, 4));
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
  } else if (sorted.length > 0) {
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

  // === フォールバック ===
  if (items.length < 2) {
    const desc = (event.title || '') + ' ' + (event.description || '');
    for (const rule of DESC_KEYWORD_ITEMS) {
      if (rule.keywords.some(kw => desc.includes(kw))) {
        for (const item of rule.items) {
          if (!items.includes(item) && items.length < 6) items.push(item);
        }
      }
    }
    if (items.length < 3 && event.area) {
      const areaItems = AREA_FALLBACK_ITEMS[event.area];
      if (areaItems) {
        for (const item of areaItems) {
          if (!items.includes(item) && items.length < 5) items.push(item);
        }
      }
    }
    if (items.length < 2) {
      for (const item of UNIVERSAL_FALLBACK) {
        if (!items.includes(item) && items.length < 5) items.push(item);
      }
    }
  }

  return [...new Set(items)].slice(0, 8);
}

function buildPrompt(items, heroConf = {}) {
  const itemList = items.join(', ');
  const layout = (heroConf.layout || 'A flat-lay arrangement of {count} food and lifestyle objects viewed from directly above, clustered together in the dead center of the image. Objects: {items}. The objects overlap and partially cover each other like layered magazine cutouts. Each item is tilted at a different playful angle.')
    .replace('{count}', items.length)
    .replace('{items}', itemList);
  const framing = heroConf.framing || 'CRITICAL FRAMING RULE: Every single object must be 100% visible and fully contained inside the image — nothing may touch or extend beyond any edge. The entire cluster occupies only the center 60% of the canvas, surrounded by empty white space on all sides.';
  const style = heroConf.style || 'refined editorial illustration in the style of a premium Japanese lifestyle magazine (&Premium, Brutus, Casa BRUTUS). Rendered with rich gouache and soft watercolor mixed-media technique — sophisticated, grown-up aesthetic, NOT cute or childlike. Realistic proportions and textures (wood grain, woven rattan, ceramic glaze, linen fabric), painterly but precise brushwork with visible but controlled texture. Warm natural lighting, gentle depth-of-field blur on edges. Naturally saturated warm color palette with tasteful earth tones and accent colors';
  const constraints = heroConf.constraints || 'NO TEXT anywhere. No people, no faces, no hands. Pure white background.';
  return `${layout} ${framing} Style: ${style}. ${constraints}`;
}

/**
 * 1件のイベントのヒーロー画像を生成
 * @param {Object} event - イベントオブジェクト
 * @param {Object[]} allExhibitors - 全出展者配列（event.exhibitorIds で参照）
 * @param {string} apiKey - Gemini API key
 * @param {Object} opts - { force, heroDir }
 * @returns {Promise<string>} 'ok' | 'skip' | 'no-items' | 'no-image' | 'error-{status}'
 */
async function generateOneHero(event, allExhibitors, apiKey, opts = {}) {
  const heroDir = opts.heroDir || HERO_DIR;
  const forceGen = opts.force || false;
  const heroConf = opts.heroConf || {};

  const heroPathPng = join(heroDir, `${event.id}.png`);
  const heroPathWebp = join(heroDir, `${event.id}.webp`);
  if (!forceGen && (existsSync(heroPathPng) || existsSync(heroPathWebp))) return 'skip';
  const heroPath = heroPathWebp;

  const exhibitors = (event.exhibitorIds || [])
    .map((id) => allExhibitors.find((e) => e.id === id))
    .filter(Boolean);

  const items = getIllustrationItems(event, exhibitors);
  if (items.length < 2) return 'no-items';

  const prompt = buildPrompt(items, heroConf);

  const model = heroConf.model || 'gemini-2.5-flash-image';
  const aspectRatio = heroConf.aspectRatio || '16:9';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseModalities: ['image', 'text'],
      imageConfig: { aspectRatio },
    },
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

  // Nano Banana returns image in candidates[0].content.parts[].inlineData
  const parts = result.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imgPart) return 'no-image';

  writeFileSync(heroPath, Buffer.from(imgPart.inlineData.data, 'base64'));
  return 'ok';
}

// ============================================================
// Export: パイプラインから呼べる関数
// ============================================================

/**
 * ヒーロー画像を一括生成（パイプライン統合用）
 *
 * @param {Object} opts
 * @param {Object[]} opts.events - 対象イベント配列
 * @param {Object[]} opts.exhibitors - 全出展者配列
 * @param {boolean} [opts.force=false] - 既存画像を上書きするか
 * @param {Function} [opts.log] - ログ関数 (message) => void
 * @returns {Promise<{ok:number, skip:number, noItems:number, fail:number}>}
 */
export async function generateHeroes({ events, exhibitors, force = false, log = console.log }) {
  if (!existsSync(HERO_DIR)) mkdirSync(HERO_DIR, { recursive: true });

  const heroConf = loadHeroConfig();

  let key;
  try {
    const secrets = JSON.parse(readFileSync(SECRETS, 'utf-8'));
    key = secrets.geminiApiKey;
  } catch (err) {
    log(`Hero generation skipped: secrets.json not found`);
    return { ok: 0, skip: 0, noItems: 0, fail: 0 };
  }

  log(`Generating heroes for ${events.length} events (model: ${heroConf.model || 'gemini-2.5-flash-image'})...`);

  let ok = 0, skip = 0, fail = 0, noItems = 0;
  const rateLimitMs = heroConf.rateLimitMs || 6500;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const result = await generateOneHero(ev, exhibitors, key, { force, heroConf });

    if (result === 'ok') {
      ok++;
      log(`  Hero [${i + 1}/${events.length}] OK: ${ev.title}`);
    } else if (result === 'skip') {
      skip++;
    } else if (result === 'no-items') {
      noItems++;
    } else {
      fail++;
      log(`  Hero [${i + 1}/${events.length}] FAIL(${result}): ${ev.title}`);
    }

    if (result === 'ok') await new Promise((r) => setTimeout(r, rateLimitMs));
  }

  log(`Heroes done. OK:${ok} Skip:${skip} NoItems:${noItems} Fail:${fail}`);
  return { ok, skip, noItems, fail };
}

// ============================================================
// CLI: 直接実行時のみ動く
// ============================================================
const isCLI = process.argv[1]?.endsWith('gen-event-heroes.mjs');

if (isCLI) {
  const DATA_PATH = join(PROTO, 'data.json');
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const args = process.argv.slice(2);
  const cliForce = args.includes('--force');
  const targetId = args.find((a) => a.startsWith('evt_'));

  let targets;
  if (targetId) {
    const ev = data.events.find((e) => e.id === targetId);
    if (!ev) { console.error('Not found:', targetId); process.exit(1); }
    targets = [ev];
  } else {
    targets = data.events;
  }

  generateHeroes({
    events: targets,
    exhibitors: data.exhibitors,
    force: cliForce,
  }).catch(console.error);
}
