#!/usr/bin/env node
/**
 * download-profile-images.mjs
 *
 * data.json内のexhibitors.profileImageがリモートURL（Instagram CDN）の場合、
 * ローカルにダウンロードしてパスを書き換える。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import https from 'https';
import http from 'http';

const PROTO = join(homedir(), 'event-hub-prototype', 'public');
const DATA_PATH = join(PROTO, 'data.json');
const ICON_DIR = join(PROTO, 'exhibitor-icons');

if (!existsSync(ICON_DIR)) mkdirSync(ICON_DIR, { recursive: true });

const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    proto.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return download(res.headers.location, dest).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const ws = createWriteStream(dest);
      res.pipe(ws);
      ws.on('finish', () => { ws.close(); resolve(true); });
      ws.on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  const toDownload = data.exhibitors.filter(
    (e) => e.profileImage && e.profileImage.startsWith('http')
  );

  console.log(`${toDownload.length} exhibitors with remote profile images`);

  let downloaded = 0;
  let failed = 0;
  let skipped = 0;

  for (const ex of toDownload) {
    const handle = (ex.instagram || '').replace(/^@/, '') || ex.id;
    const safeName = handle.replace(/[^a-zA-Z0-9._-]/g, '_');
    const localPath = `/exhibitor-icons/${safeName}.jpg`;
    const dest = join(ICON_DIR, `${safeName}.jpg`);

    if (existsSync(dest)) {
      ex.profileImage = localPath;
      skipped++;
      continue;
    }

    try {
      await download(ex.profileImage, dest);
      ex.profileImage = localPath;
      downloaded++;
      console.log(`  OK: ${ex.name} → ${safeName}.jpg`);
    } catch (err) {
      ex.profileImage = '';
      failed++;
      console.log(`  FAIL: ${ex.name} (${err.message})`);
    }
  }

  console.log(`\nDownloaded: ${downloaded}, Already local: ${skipped}, Failed: ${failed}`);

  writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
  console.log(`Updated ${DATA_PATH}`);
}

main();
