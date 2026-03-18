#!/usr/bin/env node
/**
 * Google Sheets スプレッドシート初期化
 * 4シート（events, exhibitors, instagram_posts, scrape_log）を作成
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadConfig } from './lib/config.js';
import { SheetsStorage } from './storage/sheets.js';
import { log } from './lib/logger.js';

const ROOT = new URL('../', import.meta.url).pathname;

async function main() {
  const config = loadConfig();

  if (config.google.spreadsheetId) {
    log.info(`Spreadsheet already configured: ${config.google.spreadsheetId}`);
    return;
  }

  const storage = new SheetsStorage(config);
  const spreadsheetId = await storage.initSpreadsheet();

  // Update config.json with new spreadsheet ID
  config.google.spreadsheetId = spreadsheetId;
  writeFileSync(join(ROOT, 'config.json'), JSON.stringify(config, null, 2));
  log.info(`Updated config.json with spreadsheetId: ${spreadsheetId}`);
  log.info(`Open: https://docs.google.com/spreadsheets/d/${spreadsheetId}`);
}

main().catch((e) => { log.error(e.message); process.exit(1); });
