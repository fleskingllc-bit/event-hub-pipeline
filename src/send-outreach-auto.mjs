#!/usr/bin/env node
/**
 * send-outreach-auto.mjs — Playwright自動Instagram DM送信
 *
 * 初回: ブラウザが開くので手動でInstagramにログイン → セッション保存
 * 以降: 自動でDM送信（pending → sent）
 *
 * Usage:
 *   node src/send-outreach-auto.mjs              # 自動送信
 *   node src/send-outreach-auto.mjs --login      # ログインセッション作成
 *   node src/send-outreach-auto.mjs --dry-run    # 送信せず動作確認のみ
 */
import { loadConfig } from './lib/config.js';
import { SheetsStorage, HEADERS } from './storage/sheets.js';
import { log } from './lib/logger.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';

const ROOT = new URL('../', import.meta.url).pathname;
const STATE_PATH = join(ROOT, 'data', 'state.json');
const SESSION_DIR = join(ROOT, 'data', 'ig-session');
const DAILY_LIMIT = 10;
const COOLDOWN_MS = 60_000;
const BASE_URL = 'https://www.instagram.com';

const args = process.argv.slice(2);
const loginMode = args.includes('--login');
const dryRun = args.includes('--dry-run');

function generateMessage(name, eventTitle, pageUrl) {
  return `${name}さん、こんにちは！

「${eventTitle}」のイベントページができています🎪
${pageUrl}

このページをスクリーンショットしてInstagramストーリーに投稿すると、イベントの告知が簡単にできます✨

イベント頑張ってください！

——
まちイベント帖は、山口県のマルシェやイベントをマップで探せる無料のサービスです。
「出展者さんのイベント告知をもっとラクに、もっと届くように」がコンセプト。Instagramの投稿から自動でイベント情報を集めて、出展者さんと来場者さんをつないでいます🗺️`;
}

function loadState() {
  if (!existsSync(STATE_PATH)) return { processedIds: {}, lastRun: {} };
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function getDailySent() {
  const state = loadState();
  const outreach = state.outreach || {};
  const todayStr = new Date().toISOString().slice(0, 10);
  if (outreach.lastSentDate !== todayStr) return 0;
  return outreach.dailySent || 0;
}

function incrementDailySent() {
  const state = loadState();
  const todayStr = new Date().toISOString().slice(0, 10);
  if (!state.outreach) state.outreach = {};
  if (state.outreach.lastSentDate !== todayStr) {
    state.outreach.dailySent = 1;
    state.outreach.lastSentDate = todayStr;
  } else {
    state.outreach.dailySent = (state.outreach.dailySent || 0) + 1;
  }
  saveState(state);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** ログインセッション作成モード */
async function setupLogin() {
  console.log('\n🔐 Instagramログインセッションを作成します');
  console.log('   ブラウザが開いたらInstagramにログインしてください');
  console.log('   ログイン完了したらブラウザを閉じてください\n');

  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 800 },
    locale: 'ja-JP',
  });

  const page = browser.pages()[0] || await browser.newPage();
  await page.goto(`${BASE_URL}/accounts/login/`);

  // Wait for user to close the browser
  await new Promise((resolve) => browser.on('close', resolve));
  console.log('\n✅ セッション保存完了。次回から自動送信できます。');
}

/** デプロイ済みdata.jsonからイベントID一覧を取得 */
async function fetchLiveEventIds(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/data.json`);
    if (!res.ok) return null;
    const data = await res.json();
    return new Set((data.events || []).map((e) => e.id));
  } catch {
    return null;
  }
}

/** 自動DM送信 */
async function autoSend() {
  const config = loadConfig();
  const storage = new SheetsStorage(config);

  await storage.ensureSheetExists('outreach');

  const allOutreach = await storage.readAll('outreach');
  const pending = allOutreach.filter((o) => o.status === 'pending' || o.status === 'reminder_pending');

  if (!pending.length) {
    log.info('Outreach auto-send: 未送信なし');
    return;
  }

  pending.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));

  const dailySent = getDailySent();
  const remaining = DAILY_LIMIT - dailySent;

  if (remaining <= 0) {
    log.info('Outreach auto-send: 本日の上限到達');
    return;
  }

  // デプロイ済みイベントページの存在確認
  const igConfig = config.igPosting || {};
  const netlifyBaseUrl = igConfig.netlifyBaseUrl || 'https://machi-event-cho.netlify.app';
  const liveEventIds = await fetchLiveEventIds(netlifyBaseUrl);
  if (!liveEventIds) {
    log.warn('Outreach auto-send: Netlify data.json 取得失敗 — イベントページ確認なしで続行');
  }

  // 過去イベント & ページ未デプロイのエントリを除外
  const todayStr = new Date().toISOString().slice(0, 10);
  const verified = pending.filter((entry) => {
    // 当日以前のイベントはスキップ（DMは前日までに届けるべき）
    if (entry.eventDate && entry.eventDate <= todayStr) {
      log.warn(`  ⏭️ スキップ: ${entry.eventTitle} (@${entry.instagram}) — イベント当日or終了済み (${entry.eventDate})`);
      return false;
    }
    // イベントページの存在確認
    if (liveEventIds && !liveEventIds.has(entry.eventId)) {
      log.warn(`  ⏭️ スキップ: ${entry.eventTitle} (@${entry.instagram}) — イベントページが未デプロイ`);
      return false;
    }
    return true;
  });

  if (!verified.length) {
    log.info('Outreach auto-send: 送信可能なエントリなし（イベントページ未デプロイ）');
    return;
  }

  const batch = verified.slice(0, remaining);
  log.info(`Outreach auto-send: ${batch.length}件送信開始${dryRun ? ' (dry-run)' : ''}（${pending.length - verified.length}件はページ未デプロイでスキップ）`);

  // Launch browser with saved session
  const browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false, // IGはheadlessだとブロックされやすい
    viewport: { width: 1280, height: 800 },
    locale: 'ja-JP',
  });

  const outreachHeaders = HEADERS.outreach;
  const statusCol = String.fromCharCode(65 + outreachHeaders.indexOf('status'));
  const sentAtCol = String.fromCharCode(65 + outreachHeaders.indexOf('sentAt'));

  let sentCount = 0;

  try {
    // ログイン状態確認
    const checkPage = browser.pages()[0] || await browser.newPage();
    await checkPage.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await sleep(2000);

    // ログインページにリダイレクトされたらセッション切れ
    if (checkPage.url().includes('/accounts/login')) {
      log.error('Outreach auto-send: セッション切れ。--login で再ログインしてください');
      await browser.close();
      return;
    }

    log.info('Outreach auto-send: ログイン確認OK');

    for (let i = 0; i < batch.length; i++) {
      const entry = batch[i];
      const rowIdx = allOutreach.findIndex((o) => o.outreachId === entry.outreachId);
      const rowNum = rowIdx + 2;
      const handle = entry.instagram.replace(/^@/, '');

      log.info(`[${i + 1}/${batch.length}] @${handle} (${entry.exhibitorName}) — ${entry.eventTitle}`);

      if (dryRun) {
        log.info('  [dry-run] スキップ');
        continue;
      }

      try {
        // イベントページの表示確認（スクショ保存）
        const verifyPage = await browser.newPage();
        await verifyPage.goto(entry.pageUrl, { waitUntil: 'networkidle', timeout: 30000 });
        await sleep(3000); // SPA描画待ち

        const screenshotDir = join(ROOT, 'logs', 'outreach-screenshots');
        mkdirSync(screenshotDir, { recursive: true });
        const ssPath = join(screenshotDir, `${entry.eventId}_${handle}_${new Date().toISOString().slice(0, 10)}.png`);
        await verifyPage.screenshot({ path: ssPath, fullPage: true });

        // ページ内にイベントタイトルが表示されているか確認
        const pageText = await verifyPage.textContent('body');
        await verifyPage.close();

        if (!pageText || !pageText.includes(entry.eventTitle)) {
          log.warn(`  ⏭️ スキップ: イベントページが正しく表示されていません（スクショ: ${ssPath}）`);
          continue;
        }
        log.info(`  ✅ ページ確認OK（スクショ: ${ssPath}）`);

        const page = await browser.newPage();

        // DMスレッドを開く
        await page.goto(`https://ig.me/m/${handle}`, { waitUntil: 'domcontentloaded' });
        await sleep(3000);

        // 「Not Now」や通知ダイアログがあれば閉じる
        try {
          const notNowBtn = page.getByRole('button', { name: /Not Now|後で/i });
          if (await notNowBtn.isVisible({ timeout: 2000 })) {
            await notNowBtn.click();
            await sleep(1000);
          }
        } catch { /* no dialog */ }

        // メッセージ入力欄を探す
        const messageInput = page.getByRole('textbox', { name: /message/i })
          .or(page.locator('textarea[placeholder]'))
          .or(page.locator('[contenteditable="true"]'));

        await messageInput.waitFor({ state: 'visible', timeout: 10000 });

        // メッセージをクリップボード経由でペースト（fill/typeだと改行が壊れるため）
        const fullMessage = generateMessage(entry.exhibitorName, entry.eventTitle, entry.pageUrl);
        await page.evaluate((text) => navigator.clipboard.writeText(text), fullMessage);
        await messageInput.click();
        await page.keyboard.press('Meta+V');
        await sleep(500);

        await sleep(1000);

        // 送信ボタンを押す（exactで他のボタンとの誤マッチを防止）
        const sendBtn = page.getByRole('button', { name: '送信', exact: true })
          .or(page.getByRole('button', { name: 'Send', exact: true }));
        await sendBtn.click();
        await sleep(2000);

        await page.close();

        // Sheets更新
        const now = new Date().toISOString();
        const newStatus = entry.status === 'reminder_pending' ? 'reminder_sent' : 'sent';
        await storage.updateCell('outreach', rowNum, statusCol, newStatus);
        await storage.updateCell('outreach', rowNum, sentAtCol, now);
        sentCount++;
        incrementDailySent();

        log.info(`  ✅ 送信完了 (${newStatus})`);
      } catch (err) {
        log.error(`  ❌ 送信失敗: ${err.message}`);
        // エラーでも続行（次のエントリへ）
      }

      // クールダウン（最後以外）
      if (i < batch.length - 1) {
        log.info(`  ⏳ ${COOLDOWN_MS / 1000}秒待機...`);
        await sleep(COOLDOWN_MS);
      }
    }
  } finally {
    await browser.close();
  }

  log.info(`Outreach auto-send完了: ${sentCount}/${batch.length}件送信`);
}

// Main
if (loginMode) {
  setupLogin().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
} else {
  autoSend().catch((err) => {
    log.error(`Outreach auto-send fatal: ${err.message}`);
    process.exit(1);
  });
}
