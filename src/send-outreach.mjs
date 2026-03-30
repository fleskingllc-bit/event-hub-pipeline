#!/usr/bin/env node
/**
 * send-outreach.mjs — 半自動Instagram DM送信ツール
 *
 * 操作フロー（1件あたり）:
 *   1. メッセージをクリップボードにコピー
 *   2. Instagram DMスレッドをブラウザで直接開く
 *   3. ユーザーはペースト→送信するだけ
 *   4. 60秒カウントダウン後に自動で次へ進む（sent記録）
 *   5. 途中で s=スキップ / q=終了 を押せる
 *
 * Usage:
 *   node src/send-outreach.mjs
 */
import { loadConfig } from './lib/config.js';
import { SheetsStorage, HEADERS } from './storage/sheets.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ROOT = new URL('../', import.meta.url).pathname;
const STATE_PATH = join(ROOT, 'data', 'state.json');
const DAILY_LIMIT = 10;
const COOLDOWN_SEC = 60;

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
  return state.outreach.dailySent;
}

function copyToClipboard(text) {
  execSync('pbcopy', { input: text, stdio: ['pipe', 'ignore', 'ignore'] });
}

function openInstagramDM(username) {
  const handle = username.replace(/^@/, '');
  execSync(`open "https://ig.me/m/${handle}"`, { stdio: 'ignore' });
}

/** Wait for countdown, but allow 's' (skip) or 'q' (quit) keypress to interrupt */
function countdownWithKeypress(seconds) {
  return new Promise((resolve) => {
    let remaining = seconds;
    let resolved = false;

    // Enable raw mode to capture single keypresses
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
    }

    const onKey = (key) => {
      if (resolved) return;
      const ch = key.toString().toLowerCase();
      if (ch === 's' || ch === 'q' || ch === '\u0003') { // s, q, or Ctrl+C
        resolved = true;
        clearInterval(timer);
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
        }
        process.stdin.removeListener('data', onKey);
        process.stdout.write('\r                              \r');
        resolve(ch === '\u0003' ? 'q' : ch);
      }
    };

    process.stdin.on('data', onKey);

    const timer = setInterval(() => {
      remaining--;
      process.stdout.write(`\r  ⏳ ${remaining}秒 (s=スキップ / q=終了) `);
      if (remaining <= 0) {
        clearInterval(timer);
        if (!resolved) {
          resolved = true;
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
            process.stdin.pause();
          }
          process.stdin.removeListener('data', onKey);
          process.stdout.write('\r                              \r');
          resolve('done');
        }
      }
    }, 1000);

    process.stdout.write(`  ⏳ ${remaining}秒 (s=スキップ / q=終了) `);
  });
}

async function main() {
  const config = loadConfig();
  const storage = new SheetsStorage(config);

  await storage.ensureSheetExists('outreach');

  const allOutreach = await storage.readAll('outreach');
  const pending = allOutreach.filter((o) => o.status === 'pending' || o.status === 'reminder_pending');

  if (!pending.length) {
    console.log('\n✅ 未送信のアウトリーチはありません');
    return;
  }

  pending.sort((a, b) => new Date(a.eventDate) - new Date(b.eventDate));

  const dailySent = getDailySent();
  const remaining = DAILY_LIMIT - dailySent;

  if (remaining <= 0) {
    console.log(`\n⚠️  本日の送信上限（${DAILY_LIMIT}件）に達しています。明日また実行してください。`);
    return;
  }

  const batch = pending.slice(0, remaining);

  console.log(`\n📋 未送信: ${pending.length}件（本日残り枠: ${remaining}件）`);
  console.log(`🔄 ペースト→送信したら放置でOK。60秒後に自動で次へ進みます。`);

  // アカウント確認ステップ
  console.log(`\n⚠️  送信元アカウントを確認してください。`);
  execSync('open "https://www.instagram.com/accounts/edit/"', { stdio: 'ignore' });
  console.log(`   Instagramの設定画面を開きました。正しいアカウントですか？`);
  const confirmResult = await countdownWithKeypress(15);
  if (confirmResult === 'q') {
    console.log('\n🛑 終了します');
    return;
  }
  console.log('');

  const outreachHeaders = HEADERS.outreach;
  const statusCol = String.fromCharCode(65 + outreachHeaders.indexOf('status'));
  const sentAtCol = String.fromCharCode(65 + outreachHeaders.indexOf('sentAt'));

  let sentCount = 0;

  for (let i = 0; i < batch.length; i++) {
    const entry = batch[i];
    const rowIdx = allOutreach.findIndex((o) => o.outreachId === entry.outreachId);
    const rowNum = rowIdx + 2;

    console.log(`[${i + 1}/${batch.length}] ${entry.instagram} (${entry.exhibitorName}) — ${entry.eventTitle}（${entry.eventDate || ''}）`);

    // Copy + open DM thread
    const fullMessage = generateMessage(entry.exhibitorName, entry.eventTitle, entry.pageUrl);
    copyToClipboard(fullMessage);
    openInstagramDM(entry.instagram);
    console.log('  📋 コピー済み → DMスレッドを開きました → ペーストして送信してください');

    // Countdown — auto-advance after 60s, or s/q to interrupt
    const result = await countdownWithKeypress(COOLDOWN_SEC);

    if (result === 'q') {
      console.log('\n🛑 終了します');
      break;
    }

    if (result === 's') {
      console.log('  ⏭️  スキップ');
      continue;
    }

    // Auto-mark as sent
    const now = new Date().toISOString();
    const newStatus = entry.status === 'reminder_pending' ? 'reminder_sent' : 'sent';
    await storage.updateCell('outreach', rowNum, statusCol, newStatus);
    await storage.updateCell('outreach', rowNum, sentAtCol, now);
    sentCount++;
    incrementDailySent();
    console.log(`  ✅ 送信済み (${newStatus}) [${sentCount}]`);
  }

  // Summary
  const remainingPending = pending.length - sentCount;
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 送信: ${sentCount}件 / 残り: ${remainingPending}件 / 本日計: ${getDailySent()}/${DAILY_LIMIT}件`);
  if (remainingPending > 0) {
    console.log(`   明日の予定: 最大${Math.min(remainingPending, DAILY_LIMIT)}件`);
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((err) => {
  console.error(`❌ エラー: ${err.message}`);
  process.exit(1);
});
