/**
 * exhibitor-matcher.mjs
 *
 * 出展者マスターDBとの照合モジュール。
 * Gemini抽出結果をマスターDBとマッチングし、既存IDを返すか新規追加する。
 *
 * matchExhibitor(extracted, masterDB) → { matched: Record | null, score, isNew }
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../', import.meta.url).pathname;
const MASTER_PATH = join(ROOT, 'data', 'exhibitor-master.json');

const GENERIC_NAMES = new Set([
  'ワークショップ', 'キッチンカー', '飲食ブース', '飲食', 'フード', 'ハンドメイド',
  '雑貨', '物販', 'アクセサリー', '人気飲食店', '活版印刷', 'マルシェ', 'イベント',
  'カフェ', 'パン', 'お菓子', '焼き菓子', 'スイーツ', 'ドリンク', 'フリマ',
  '体験', '展示', '売店', 'ブース', 'ステージ', 'コーナー', '子供服', 'バルーン',
]);

function normalizeIG(ig) {
  if (!ig) return '';
  return ig.replace(/^@+/, '').toLowerCase().trim();
}

function isValidName(name) {
  if (!name || name.trim().length <= 1) return false;
  if (GENERIC_NAMES.has(name.trim())) return false;
  if (/^(近隣|周辺|地元|各種|その他|人気).*(店舗|売店|ブース|出店)$/.test(name)) return false;
  return true;
}

/**
 * Load master DB from disk
 */
export function loadMasterDB() {
  const raw = JSON.parse(readFileSync(MASTER_PATH, 'utf-8'));
  return raw;
}

/**
 * Save master DB to disk
 */
export function saveMasterDB(masterDB) {
  writeFileSync(MASTER_PATH, JSON.stringify(masterDB, null, 2));
}

/**
 * 次のIDを自動採番
 */
function nextId(masterDB) {
  const max = masterDB.exhibitors.reduce((m, ex) => {
    const num = parseInt(ex.id.replace('ex_', ''));
    return num > m ? num : m;
  }, 0);
  return `ex_${String(max + 1).padStart(3, '0')}`;
}

/**
 * Match an extracted exhibitor against the master DB.
 *
 * @param {Object} extracted - { name, category, instagram, description, menu }
 * @param {Object} masterDB - The master DB object
 * @returns {{ matched: Object|null, score: number, isNew: boolean }}
 */
export function matchExhibitor(extracted, masterDB) {
  const name = (extracted.name || '').trim();
  const ig = normalizeIG(extracted.instagram);

  if (!isValidName(name)) {
    return { matched: null, score: 0, isNew: false };
  }

  // Priority 1: Instagram exact match (score 100)
  if (ig) {
    const igMatch = masterDB.exhibitors.find(ex => normalizeIG(ex.instagram) === ig);
    if (igMatch) {
      return { matched: igMatch, score: 100, isNew: false };
    }
  }

  // Priority 2: Name exact match including aliases (score 80)
  const nameMatch = masterDB.exhibitors.find(ex => {
    if (ex.name === name) return true;
    if ((ex.aliases || []).includes(name)) return true;
    return false;
  });
  if (nameMatch) {
    return { matched: nameMatch, score: 80, isNew: false };
  }

  // Priority 3: Partial name match — 3+ common characters (score 50)
  // Normalize for comparison (remove spaces, katakana/hiragana normalization)
  const nameNorm = name.replace(/[\s　]/g, '').toLowerCase();
  if (nameNorm.length >= 3) {
    for (const ex of masterDB.exhibitors) {
      const exNorm = ex.name.replace(/[\s　]/g, '').toLowerCase();
      const allNames = [exNorm, ...(ex.aliases || []).map(a => a.replace(/[\s　]/g, '').toLowerCase())];
      for (const candidate of allNames) {
        // Check substring containment (either direction)
        if (candidate.length >= 3 && nameNorm.length >= 3) {
          if (candidate.includes(nameNorm) || nameNorm.includes(candidate)) {
            return { matched: ex, score: 50, isNew: false };
          }
        }
      }
    }
  }

  return { matched: null, score: 0, isNew: true };
}

/**
 * Match and register an exhibitor.
 * If matched, update existing record. If new, add to master DB.
 *
 * @param {Object} extracted - { name, category, instagram, description, menu }
 * @param {Object} masterDB - Mutable master DB object
 * @returns {string} The exhibitor ID (existing or new)
 */
export function matchOrRegister(extracted, masterDB) {
  const { matched, score, isNew } = matchExhibitor(extracted, masterDB);

  if (matched) {
    // Update existing: fill blanks, increment eventCount
    if (!matched.instagram && extracted.instagram) {
      matched.instagram = normalizeIG(extracted.instagram);
    }
    if (matched.category === 'その他' && extracted.category) {
      matched.category = extracted.category;
    }
    if (!matched.description && extracted.description) {
      matched.description = extracted.description;
    }
    // Add name as alias if different
    const name = (extracted.name || '').trim();
    if (name && name !== matched.name && !(matched.aliases || []).includes(name)) {
      if (!matched.aliases) matched.aliases = [];
      matched.aliases.push(name);
    }
    matched.eventCount = (matched.eventCount || 1) + 1;
    return matched.id;
  }

  if (!isNew) return null; // Invalid name

  // Register new exhibitor
  const id = nextId(masterDB);
  const name = (extracted.name || '').trim();
  masterDB.exhibitors.push({
    id,
    name,
    aliases: [],
    instagram: normalizeIG(extracted.instagram),
    category: extracted.category || 'その他',
    area: '',
    firstSeen: new Date().toISOString().slice(0, 10),
    eventCount: 1,
    description: extracted.description || '',
    menu: Array.isArray(extracted.menu) ? extracted.menu : [],
  });

  return id;
}

/**
 * Batch match a list of extracted exhibitors for one event.
 *
 * @param {Array} extractedList - Array of { name, category, instagram, ... }
 * @param {Object} masterDB - Mutable master DB
 * @returns {string[]} Array of exhibitor IDs
 */
export function matchExhibitorsForEvent(extractedList, masterDB) {
  const ids = [];
  for (const ex of extractedList) {
    const id = matchOrRegister(ex, masterDB);
    if (id && !ids.includes(id)) {
      ids.push(id);
    }
  }
  return ids;
}
