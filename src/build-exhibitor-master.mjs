#!/usr/bin/env node
/**
 * build-exhibitor-master.mjs
 *
 * 既存出展者データ（output/data.json）から重複排除してマスターDBを構築。
 * 統合ロジック:
 *   1. Instagram完全一致 → 統合
 *   2. 名前完全一致 → 統合
 *   3. 一般名詞フィルタ（除外）
 *   4. category空 → 「その他」デフォルト
 *
 * Usage:
 *   node src/build-exhibitor-master.mjs              # 初期構築
 *   node src/build-exhibitor-master.mjs --dry-run    # プレビューのみ
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../', import.meta.url).pathname;
const DATA_JSON = join(ROOT, 'output', 'data.json');
const MASTER_PATH = join(ROOT, 'data', 'exhibitor-master.json');

const dryRun = process.argv.includes('--dry-run');

const GENERIC_NAMES = new Set([
  'ワークショップ', 'キッチンカー', '飲食ブース', '飲食', 'フード', 'ハンドメイド',
  '雑貨', '物販', 'アクセサリー', '人気飲食店', '活版印刷', 'マルシェ', 'イベント',
  'カフェ', 'パン', 'お菓子', '焼き菓子', 'スイーツ', 'ドリンク', 'フリマ',
  '体験', '展示', '売店', 'ブース', 'ステージ', 'コーナー', '子供服', 'バルーン',
]);

function isValidName(name) {
  if (!name || name.trim().length <= 1) return false;
  if (GENERIC_NAMES.has(name.trim())) return false;
  if (/^(近隣|周辺|地元|各種|その他|人気).*(店舗|売店|ブース|出店)$/.test(name)) return false;
  return true;
}

/** Instagram handle を正規化（@除去、小文字化） */
function normalizeIG(ig) {
  if (!ig) return '';
  return ig.replace(/^@+/, '').toLowerCase().trim();
}

/**
 * 2つの出展者レコードを統合（より情報の多い方をベースに）
 */
function mergeRecords(existing, incoming) {
  return {
    ...existing,
    // instagram: 既存を優先、なければ incoming
    instagram: existing.instagram || incoming.instagram || '',
    // category: 既存を優先
    category: existing.category || incoming.category || '',
    // description: 長い方を採用
    description: (existing.description || '').length >= (incoming.description || '').length
      ? existing.description : incoming.description,
    // menu: 多い方を採用
    menu: (existing.menu || []).length >= (incoming.menu || []).length
      ? existing.menu : incoming.menu,
    // aliases に incoming.name を追加（既存名と違う場合）
    aliases: [...new Set([
      ...(existing.aliases || []),
      ...(incoming.name !== existing.name ? [incoming.name] : []),
    ])],
    eventCount: (existing.eventCount || 1) + 1,
  };
}

function main() {
  const data = JSON.parse(readFileSync(DATA_JSON, 'utf-8'));
  const raw = data.exhibitors || [];
  console.log(`Input: ${raw.length} exhibitors from data.json`);

  // Also read events to extract area info and event associations
  const events = data.events || [];
  const exhToEvents = {};
  for (const ev of events) {
    for (const exId of (ev.exhibitorIds || [])) {
      if (!(exId in exhToEvents)) exhToEvents[exId] = [];
      exhToEvents[exId].push(ev);
    }
  }

  // Phase 1: Filter invalid names
  const valid = raw.filter(ex => isValidName(ex.name));
  const filtered = raw.length - valid.length;
  console.log(`Filtered: ${filtered} invalid/generic names removed`);

  // Phase 2: Group by Instagram (exact match)
  const igGroups = {};   // normalizedIG → [records]
  const noIG = [];       // records without instagram
  for (const ex of valid) {
    const ig = normalizeIG(ex.instagram);
    if (ig) {
      if (!(ig in igGroups)) igGroups[ig] = [];
      igGroups[ig].push(ex);
    } else {
      noIG.push(ex);
    }
  }

  // Phase 3: Merge IG duplicates
  const merged = [];
  for (const [ig, group] of Object.entries(igGroups)) {
    // Sort by info richness (category filled, description length)
    group.sort((a, b) => {
      const scoreA = (a.category ? 1 : 0) + (a.description || '').length;
      const scoreB = (b.category ? 1 : 0) + (b.description || '').length;
      return scoreB - scoreA;
    });
    let base = { ...group[0], aliases: [] };
    for (let i = 1; i < group.length; i++) {
      base = mergeRecords(base, group[i]);
    }
    base.instagram = ig; // normalized
    merged.push(base);
  }

  // Phase 4: Group remaining (no IG) by exact name match
  const nameGroups = {};
  for (const ex of noIG) {
    const name = ex.name.trim();
    if (!(name in nameGroups)) nameGroups[name] = [];
    nameGroups[name].push(ex);
  }
  for (const [name, group] of Object.entries(nameGroups)) {
    group.sort((a, b) => {
      const scoreA = (a.category ? 1 : 0) + (a.description || '').length;
      const scoreB = (b.category ? 1 : 0) + (b.description || '').length;
      return scoreB - scoreA;
    });
    let base = { ...group[0], aliases: [] };
    for (let i = 1; i < group.length; i++) {
      base = mergeRecords(base, group[i]);
    }
    merged.push(base);
  }

  // Phase 5: Check for cross-IG/noIG name dupes (IG record vs no-IG record with same name)
  const finalMap = new Map(); // canonical name → record
  const igLookup = new Map(); // normalized IG → record
  for (const rec of merged) {
    const ig = normalizeIG(rec.instagram);
    if (ig) igLookup.set(ig, rec);
  }

  const deduped = [];
  const seen = new Set();
  for (const rec of merged) {
    const name = rec.name.trim();
    const ig = normalizeIG(rec.instagram);

    // Skip if this name was already merged into an IG record
    if (seen.has(name) && !ig) continue;

    // Check if a no-IG record matches an existing IG record by name
    if (!ig && finalMap.has(name)) {
      const existing = finalMap.get(name);
      finalMap.set(name, mergeRecords(existing, rec));
      continue;
    }

    // Check if an IG record has same name as existing
    if (ig && finalMap.has(name)) {
      const existing = finalMap.get(name);
      // If existing has no IG, upgrade it
      if (!existing.instagram) {
        const m = mergeRecords(rec, existing);
        finalMap.set(name, m);
        // Remove old entry from deduped and add merged
        const idx = deduped.indexOf(existing);
        if (idx >= 0) deduped[idx] = m;
        continue;
      }
    }

    finalMap.set(name, rec);
    deduped.push(rec);
    seen.add(name);
  }

  // Replace deduped with finalMap values (handles in-place updates)
  const finalList = [...finalMap.values()];

  // Phase 6: Assign new sequential IDs, fill category, extract area
  const masterExhibitors = finalList.map((ex, i) => {
    const id = `ex_${String(i + 1).padStart(3, '0')}`;

    // Try to extract area from associated events
    const oldIds = [ex.id, ...(ex.aliases || []).map(() => '')].filter(Boolean);
    let area = '';
    for (const ev of Object.values(exhToEvents)) {
      // Find events linked to this exhibitor's old IDs
    }
    // Simpler: check all old IDs
    const linkedEvents = (exhToEvents[ex.id] || []);
    if (linkedEvents.length > 0) {
      // Use most common area
      const areaCounts = {};
      for (const ev of linkedEvents) {
        if (ev.area) areaCounts[ev.area] = (areaCounts[ev.area] || 0) + 1;
      }
      const sorted = Object.entries(areaCounts).sort((a, b) => b[1] - a[1]);
      if (sorted.length > 0) area = sorted[0][0];
    }

    // Find first seen date from events
    let firstSeen = '';
    for (const ev of linkedEvents) {
      if (ev.date && (!firstSeen || ev.date < firstSeen)) firstSeen = ev.date;
    }

    return {
      id,
      name: ex.name.trim(),
      aliases: (ex.aliases || []).filter(a => a && a !== ex.name.trim()),
      instagram: normalizeIG(ex.instagram),
      category: ex.category || ex.categoryTag || 'その他',
      area,
      firstSeen: firstSeen || new Date().toISOString().slice(0, 10),
      eventCount: ex.eventCount || 1,
      description: ex.description || '',
      menu: Array.isArray(ex.menu) ? ex.menu : (ex.menu ? JSON.parse(ex.menu) : []),
      _oldIds: [ex.id], // Keep for migration mapping
    };
  });

  // Build old→new ID mapping
  // We need to also map duplicate old IDs to the merged master ID
  const oldToNew = {};
  // First, build mapping from valid records
  for (const rawEx of valid) {
    const ig = normalizeIG(rawEx.instagram);
    const name = rawEx.name.trim();
    // Find matching master record
    const master = masterExhibitors.find(m => {
      if (ig && normalizeIG(m.instagram) === ig) return true;
      if (m.name === name) return true;
      if (m.aliases.includes(name)) return true;
      return false;
    });
    if (master) {
      oldToNew[rawEx.id] = master.id;
      if (!master._oldIds.includes(rawEx.id)) master._oldIds.push(rawEx.id);
    }
  }

  // Stats
  const withIG = masterExhibitors.filter(e => e.instagram).length;
  const withCat = masterExhibitors.filter(e => e.category && e.category !== 'その他').length;
  const withArea = masterExhibitors.filter(e => e.area).length;

  console.log(`\n=== Master DB Stats ===`);
  console.log(`Total unique exhibitors: ${masterExhibitors.length} (from ${raw.length})`);
  console.log(`Dedup removed: ${raw.length - filtered - masterExhibitors.length}`);
  console.log(`Instagram coverage: ${withIG}/${masterExhibitors.length} (${Math.round(withIG / masterExhibitors.length * 100)}%)`);
  console.log(`Category coverage: ${withCat}/${masterExhibitors.length} specific + ${masterExhibitors.length - withCat} 'その他'`);
  console.log(`Area coverage: ${withArea}/${masterExhibitors.length}`);
  console.log(`Old→New ID mappings: ${Object.keys(oldToNew).length}`);

  // Show duplicate merges
  const multiOldIds = masterExhibitors.filter(m => m._oldIds.length > 1);
  if (multiOldIds.length > 0) {
    console.log(`\nMerged records (${multiOldIds.length}):`);
    for (const m of multiOldIds) {
      console.log(`  ${m.id} ${m.name}: ${m._oldIds.join(', ')}`);
    }
  }

  if (dryRun) {
    console.log('\n[dry-run] No files written.');
    return;
  }

  // Clean _oldIds from output (store separately)
  const masterOutput = {
    exhibitors: masterExhibitors.map(({ _oldIds, ...rest }) => rest),
    idMapping: oldToNew,
    version: 1,
    builtAt: new Date().toISOString(),
    sourceCount: raw.length,
  };

  writeFileSync(MASTER_PATH, JSON.stringify(masterOutput, null, 2));
  console.log(`\nWritten to ${MASTER_PATH}`);

  // Also update data.json event exhibitorIds to use new master IDs
  const updatedEvents = events.map(ev => ({
    ...ev,
    exhibitorIds: (ev.exhibitorIds || [])
      .map(oldId => oldToNew[oldId])
      .filter(Boolean)
      // Deduplicate (two old IDs might map to same new ID)
      .filter((v, i, a) => a.indexOf(v) === i),
  }));

  const updatedData = {
    ...data,
    events: updatedEvents,
    exhibitors: masterOutput.exhibitors,
    totalExhibitors: masterOutput.exhibitors.length,
  };

  writeFileSync(join(ROOT, 'output', 'data.json'), JSON.stringify(updatedData, null, 2));
  console.log(`Updated output/data.json with master IDs`);

  // Copy to prototype
  const protoPath = join(ROOT, '..', 'event-hub-prototype', 'public', 'data.json');
  if (existsSync(join(ROOT, '..', 'event-hub-prototype', 'public'))) {
    writeFileSync(protoPath, JSON.stringify(updatedData, null, 2));
    console.log(`Copied to prototype: ${protoPath}`);
  }
}

main();
