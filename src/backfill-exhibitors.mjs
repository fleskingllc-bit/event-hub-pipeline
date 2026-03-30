/**
 * Backfill exhibitors for existing site events.
 * Re-extracts exhibitor info from raw mypl/TRYangle data using Gemini,
 * then matches against master DB and updates data.json.
 *
 * Usage:
 *   node src/backfill-exhibitors.mjs              # 実行
 *   node src/backfill-exhibitors.mjs --dry-run    # プレビュー
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig } from './lib/config.js';
import { GeminiClient } from './ai/gemini.js';
import { createRateLimiter } from './lib/rate-limiter.js';
import { log } from './lib/logger.js';
import { loadMasterDB, saveMasterDB, matchOrRegister } from './exhibitor-matcher.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const RAW_MYPL_DIR = join(ROOT, 'data/raw/mypl');
const RAW_TRYANGLE_DIR = join(ROOT, 'data/raw/tryangle');
const DATA_PATH = join(ROOT, 'output', 'data.json');
const PROTO_PATH = join(homedir(), 'event-hub-prototype', 'public', 'data.json');
const dryRun = process.argv.includes('--dry-run');

const EXHIBITOR_PROMPT = (title, description, source) => `
あなたはイベント出展者抽出AIです。
以下の「${source}」のイベント情報から、出展者・出店者・参加店舗の情報を抽出してください。

## イベント情報
タイトル: ${title}
説明: ${description}

## 出力（JSON）
{
  "exhibitors": [
    {
      "name": "店舗名・屋号（必ず固有名詞）",
      "category": "カテゴリ（コーヒー/パン/焼き菓子/雑貨/アクセサリー/飲食/物販/ワークショップ/ラーメン/スイーツ等）",
      "instagram": "@アカウント名（あれば）",
      "description": "出展内容の説明",
      "menu": []
    }
  ]
}

## ルール
- exhibitors.nameは必ず固有名詞（店舗名・屋号・団体名・個人名・ブランド名）
- 「お菓子」「パン」「ワークショップ」等のカテゴリ名や一般名詞は不可。名前が不明な出展者はスキップ
- 説明文中に出展者情報がなければ空配列 {"exhibitors": []} を返す
- menuは具体的なメニュー名と価格がわかる場合のみ
`;

async function main() {
  const config = loadConfig();
  const gemini = new GeminiClient(config);
  const limiter = createRateLimiter(4200); // ~14 RPM to stay safe under 15 RPM
  const masterDB = loadMasterDB();

  // Load current data
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf8'));
  const siteEvents = data.events.filter(e => e.source !== 'instagram');
  // Only process events without exhibitors
  const needsBackfill = siteEvents.filter(e => !(e.exhibitorIds || []).length);

  // Build raw data index
  const rawIndex = new Map();

  if (existsSync(RAW_MYPL_DIR)) {
    for (const f of readdirSync(RAW_MYPL_DIR).filter(f => f.endsWith('.json'))) {
      try {
        const raw = JSON.parse(readFileSync(join(RAW_MYPL_DIR, f), 'utf8'));
        if (raw.sourceUrl) rawIndex.set(raw.sourceUrl, raw);
      } catch {}
    }
  }

  if (existsSync(RAW_TRYANGLE_DIR)) {
    for (const f of readdirSync(RAW_TRYANGLE_DIR).filter(f => f.endsWith('.json'))) {
      try {
        const raw = JSON.parse(readFileSync(join(RAW_TRYANGLE_DIR, f), 'utf8'));
        const url = raw.sourceUrl || raw.link;
        if (url) rawIndex.set(url, raw);
      } catch {}
    }
  }

  log.info(`Site events needing backfill: ${needsBackfill.length}/${siteEvents.length}`);
  log.info(`Raw data entries: ${rawIndex.size}, Master DB: ${masterDB.exhibitors.length} exhibitors`);

  const stats = { extracted: 0, totalExhibitors: 0, matched: 0, added: 0, linksAdded: 0, skipped: 0 };

  for (const ev of needsBackfill) {
    const raw = rawIndex.get(ev.sourceUrl);
    const description = raw?.description || raw?.contentText || ev.description || '';
    const title = ev.title || '';

    if (!description || description.length < 20) {
      stats.skipped++;
      continue;
    }

    await limiter();

    try {
      const prompt = EXHIBITOR_PROMPT(title, description.slice(0, 3000), ev.source);
      const result = await gemini.generateContent(prompt);

      const exhibitors = result?.exhibitors || [];
      const valid = exhibitors.filter(ex => {
        const name = (ex.name || '').trim();
        return name.length >= 2 && name.length <= 50;
      });

      if (valid.length > 0) {
        const ids = [];
        for (const ex of valid) {
          const prevCount = masterDB.exhibitors.length;
          const id = matchOrRegister({
            name: ex.name,
            category: ex.category || '',
            instagram: (ex.instagram || '').replace(/^@+/, ''),
            description: ex.description || '',
            menu: ex.menu || [],
          }, masterDB);
          if (id && !ids.includes(id)) {
            ids.push(id);
            if (masterDB.exhibitors.length > prevCount) stats.added++;
            else stats.matched++;
          }
        }

        if (ids.length > 0) {
          ev.exhibitorIds = ids;
          stats.linksAdded += ids.length;
          stats.extracted++;
          console.log(`  ✓ ${ev.title}: ${ids.length}件 (${valid.map(e => e.name).join(', ')})`);
        }
        stats.totalExhibitors += valid.length;
      }
    } catch (err) {
      log.error(`Failed for "${ev.title}": ${err.message}`);
    }
  }

  console.log('\n=== Results ===');
  console.log(`Events processed: ${needsBackfill.length - stats.skipped}`);
  console.log(`Events with exhibitors extracted: ${stats.extracted}`);
  console.log(`Total exhibitors found: ${stats.totalExhibitors}`);
  console.log(`  Matched to existing: ${stats.matched}`);
  console.log(`  Registered as new: ${stats.added}`);
  console.log(`Links added: ${stats.linksAdded}`);
  console.log(`Master DB now: ${masterDB.exhibitors.length} exhibitors`);

  if (dryRun) {
    console.log('\n[dry-run] No files written.');
    return;
  }

  // Update exhibitors list in data from master DB
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

  saveMasterDB(masterDB);
  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  log.info(`Saved master DB and output/data.json`);

  if (existsSync(join(homedir(), 'event-hub-prototype', 'public'))) {
    writeFileSync(PROTO_PATH, JSON.stringify(data, null, 2));
    log.info('Copied to prototype');
  }
}

main().catch(err => {
  log.error(`Backfill failed: ${err.message}`);
  process.exit(1);
});
