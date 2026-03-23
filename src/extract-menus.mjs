#!/usr/bin/env node
/**
 * extract-menus.mjs
 *
 * post-meta.json のキャプションからメニュー（商品名+価格）を正規表現で抽出し、
 * data.json の exhibitors[].menu に追加する。
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROTO = join(homedir(), 'event-hub-prototype', 'public');
const DATA_PATH = join(PROTO, 'data.json');
const META_PATH = join(PROTO, 'post-meta.json');

const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
const postMeta = JSON.parse(readFileSync(META_PATH, 'utf-8'));

// Price patterns:
//   ◆商品名→1000円    ・商品名 ¥1,000    商品名…1000円    商品名 1,000円(税込)
const PRICE_RE = /^[◆◇●○・🔸🔹▪️▫️☆★\-\*※►▶︎]?\s*(.{2,30}?)\s*[→…＝=:：]\s*[¥￥]?\s*(\d[\d,]+)\s*円/;
const PRICE_RE2 = /^[◆◇●○・🔸🔹▪️▫️☆★\-\*※►▶︎]?\s*(.{2,30}?)\s+[¥￥](\d[\d,]+)/;
const PRICE_RE3 = /^[◆◇●○・🔸🔹▪️▫️☆★\-\*※►▶︎]?\s*(.{2,30}?)\s+(\d[\d,]+)\s*円/;

function extractMenuItems(caption) {
  if (!caption) return [];
  const items = [];
  const seen = new Set();

  for (const line of caption.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let match = trimmed.match(PRICE_RE) || trimmed.match(PRICE_RE2) || trimmed.match(PRICE_RE3);
    if (match) {
      let name = match[1].trim();
      const price = match[2].replace(/,/g, '');

      // Clean up name
      name = name.replace(/^[◆◇●○・🔸🔹▪️▫️☆★\-\*※►▶︎]\s*/, '').trim();

      // Skip if too short or looks like a date/time
      if (name.length < 2) continue;
      if (/^\d/.test(name)) continue;
      if (/月|日|時|分/.test(name) && name.length < 5) continue;

      const key = `${name}_${price}`;
      if (seen.has(key)) continue;
      seen.add(key);

      items.push({ name, price: `¥${Number(price).toLocaleString()}` });
    }
  }
  return items;
}

let updatedEvents = 0;
let totalItems = 0;

for (const event of data.events) {
  const meta = postMeta[event.id];
  if (!meta?.caption) continue;

  const menuItems = extractMenuItems(meta.caption);
  if (menuItems.length === 0) continue;

  const exIds = event.exhibitorIds || [];

  if (exIds.length === 1) {
    // Single exhibitor — all menu items go to them
    const ex = data.exhibitors.find(e => e.id === exIds[0]);
    if (ex) {
      ex.menu = menuItems;
      updatedEvents++;
      totalItems += menuItems.length;
      console.log(`  ${event.title} → ${ex.name}: ${menuItems.length} items`);
      for (const item of menuItems) console.log(`    ${item.name} ${item.price}`);
    }
  } else if (exIds.length > 1) {
    // Multiple exhibitors — try to match menu items to exhibitors by context
    // For now, check if the caption is from one specific exhibitor's post
    const account = meta.account?.toLowerCase() || '';
    const matchedEx = data.exhibitors.find(ex => {
      const handle = (ex.instagram || '').replace(/^@/, '').toLowerCase();
      return handle && handle === account;
    });

    if (matchedEx && exIds.includes(matchedEx.id)) {
      matchedEx.menu = menuItems;
      updatedEvents++;
      totalItems += menuItems.length;
      console.log(`  ${event.title} → ${matchedEx.name}: ${menuItems.length} items (matched by account)`);
      for (const item of menuItems) console.log(`    ${item.name} ${item.price}`);
    }
  }
}

console.log(`\nUpdated ${updatedEvents} events with ${totalItems} menu items`);

writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log(`Updated ${DATA_PATH}`);
