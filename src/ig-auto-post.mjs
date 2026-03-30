#!/usr/bin/env node
/**
 * ig-auto-post.mjs — Instagram 自動投稿オーケストレーター
 *
 * 毎日8:00 AMにlaunchdから実行。
 * 日替わりで投稿タイプを切り替え:
 *   偶数日: フィード1件（カルーセル）+ ストーリーズ3件
 *   奇数日: リール1件 + ストーリーズ3件
 *
 * Usage:
 *   node src/ig-auto-post.mjs              # 本番投稿
 *   node src/ig-auto-post.mjs --dry-run    # ドライラン（投稿しない）
 *   node src/ig-auto-post.mjs --feed       # 強制フィードの日
 *   node src/ig-auto-post.mjs --reel       # 強制リールの日
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { loadConfig } from './lib/config.js';
import { log } from './lib/logger.js';
import { selectEventsForPosting } from './lib/ig-event-selector.js';
import { buildFeedCaption, buildStoryCaption } from './lib/ig-caption-builder.js';
import { postFeedCarousel, postFeedSingle, postStory, postStoryVideo, postReel, verifyToken } from './lib/ig-graph-api.js';
import { captureCoverImage, captureRepostImage, captureStoryImage, getCaptureUrl } from './ig-screenshot.mjs';
import { generateStoryVideo, generateReelVideo } from './ig-story-video.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STATE_PATH = join(ROOT, 'data', 'state.json');
const IMAGE_LINKS_PATH = join(ROOT, 'data', 'image-links.json');
const IMAGE_SOURCES_PATH = join(ROOT, 'data', 'image-sources.json');
const OUTPUT_DATA_PATH = join(ROOT, 'output', 'data.json');
const RAW_IG_DIR = join(ROOT, 'data', 'raw', 'instagram');
const PROTOTYPE_DIR = join(ROOT, '..', 'event-hub-prototype');

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE_FEED = process.argv.includes('--feed');
const FORCE_REEL = process.argv.includes('--reel');

function loadState() {
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function loadImageLinks() {
  if (!existsSync(IMAGE_LINKS_PATH)) return {};
  return JSON.parse(readFileSync(IMAGE_LINKS_PATH, 'utf-8'));
}

function loadEventData() {
  if (!existsSync(OUTPUT_DATA_PATH)) {
    throw new Error('output/data.json が見つかりません。パイプラインを先に実行してください。');
  }
  return JSON.parse(readFileSync(OUTPUT_DATA_PATH, 'utf-8'));
}

/**
 * イベント → 引用元IGアカウントのマッピングを構築
 */
function loadImageSources(events) {
  if (existsSync(IMAGE_SOURCES_PATH)) {
    try {
      return JSON.parse(readFileSync(IMAGE_SOURCES_PATH, 'utf-8'));
    } catch { /* fallthrough */ }
  }

  const sources = {};
  if (!existsSync(RAW_IG_DIR)) return sources;

  const shortCodeToOwner = new Map();
  try {
    for (const f of readdirSync(RAW_IG_DIR)) {
      if (!f.endsWith('.json')) continue;
      const d = JSON.parse(readFileSync(join(RAW_IG_DIR, f), 'utf-8'));
      const sc = d.raw?.shortCode || d.processed?.shortCode;
      const owner = d.raw?.ownerUsername || d.processed?.accountName;
      if (sc && owner) shortCodeToOwner.set(sc, owner);
    }
  } catch { /* ignore read errors */ }

  for (const e of events) {
    if (e.source !== 'instagram' || !e.sourceUrl) continue;
    const match = e.sourceUrl.match(/\/p\/([^/]+)/);
    if (match) {
      const owner = shortCodeToOwner.get(match[1]);
      if (owner) sources[e.id] = owner;
    }
  }

  if (Object.keys(sources).length > 0) {
    writeFileSync(IMAGE_SOURCES_PATH, JSON.stringify(sources, null, 2));
  }

  return sources;
}

/**
 * 今日がフィードの日かリールの日か判定
 * 偶数日=フィード、奇数日=リール（--feed/--reelで上書き可）
 */
function getTodayPostType() {
  if (FORCE_FEED) return 'feed';
  if (FORCE_REEL) return 'reel';
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / (24 * 60 * 60 * 1000));
  return dayOfYear % 2 === 0 ? 'feed' : 'reel';
}

/**
 * Netlify にデプロイ
 */
function deployToNetlify() {
  log.info('IG Post: Netlifyデプロイ開始...');
  try {
    execSync('npm run build', { cwd: PROTOTYPE_DIR, stdio: 'pipe', timeout: 120000 });
    const result = execSync('npx netlify deploy --prod --dir=dist --json', {
      cwd: PROTOTYPE_DIR, stdio: 'pipe', timeout: 120000,
    });
    const deployResult = JSON.parse(result.toString());
    log.info(`IG Post: Netlifyデプロイ完了 → ${deployResult.deploy_url || deployResult.url}`);
    return true;
  } catch (err) {
    log.error(`IG Post: Netlifyデプロイ失敗: ${err.message}`);
    return false;
  }
}

/**
 * カルーセル画像を生成しURLを返す
 */
async function buildCarouselImages(event, imageLinks, imageSources, baseUrl) {
  const eventId = event.id;
  const sourceAccount = imageSources[eventId] || '';
  const generatedFiles = [];

  const eventImages = imageLinks[eventId] || [];
  log.info(`IG Post: カバー画像生成 → ${eventId}`);
  await captureCoverImage(eventId, event, { force: true, eventImages });
  generatedFiles.push(`${eventId}_cover.png`);

  const maxRepost = 9;
  for (let i = 0; i < Math.min(eventImages.length, maxRepost); i++) {
    const fullUrl = `${baseUrl}${eventImages[i]}`;
    log.info(`IG Post: リポスト画像 ${i + 1}/${Math.min(eventImages.length, maxRepost)}`);
    await captureRepostImage(eventId, fullUrl, sourceAccount, i, { force: true });
    generatedFiles.push(`${eventId}_repost_${i}.png`);
  }

  return { generatedFiles, sourceAccount };
}

async function main() {
  const config = loadConfig();
  const igConfig = config.igPosting || {};
  const baseUrl = igConfig.netlifyBaseUrl || 'https://machi-event-cho.netlify.app';

  const postType = getTodayPostType();
  log.info(`IG Post: 開始${DRY_RUN ? ' (DRY RUN)' : ''} — 本日は【${postType === 'feed' ? 'フィード' : 'リール'}】の日`);

  // 1. トークン検証
  if (!DRY_RUN) {
    try {
      const info = await verifyToken();
      log.info(`IG Post: アカウント確認 → @${info.username} (投稿数: ${info.media_count})`);
    } catch (err) {
      log.error(`IG Post: トークン検証失敗: ${err.message}`);
      return;
    }
  }

  // 2. データ読み込み
  const { events, exhibitors } = loadEventData();
  const imageLinks = loadImageLinks();
  const imageSources = loadImageSources(events);
  const state = loadState();

  if (!state.igPosted) state.igPosted = {};

  // 3. イベント選定（メイン1件 + ストーリー最大3件）
  const selection = selectEventsForPosting(events, exhibitors, state.igPosted, imageLinks);

  if (!selection.mainEvent && selection.storyEvents.length === 0) {
    log.info('IG Post: 投稿対象イベントなし');
    return;
  }

  log.info(`IG Post: メイン候補 → ${selection.mainEvent?.title || 'なし'} (score: ${selection.mainScore || 0})`);
  for (let i = 0; i < selection.storyEvents.length; i++) {
    const s = selection.storyEvents[i];
    log.info(`IG Post: ストーリー${i + 1} → ${s.event.title} (score: ${s.score})`);
  }

  let deployed = false;

  // 4. メイン投稿（フィード or リール）
  let mainResult = null;
  if (selection.mainEvent) {
    const event = selection.mainEvent;
    const sourceAccount = imageSources[event.id] || '';

    if (postType === 'feed') {
      // --- フィード投稿 ---
      const feedCaption = buildFeedCaption(event, selection.mainExhibitors, sourceAccount);
      const eventImages = imageLinks[event.id] || [];

      if (DRY_RUN) {
        log.info(`IG Post: [DRY RUN] フィード投稿 → ${event.title}`);
        log.info(`  画像構成: カバー + リポスト×${Math.min(eventImages.length, 9)}`);
      } else {
        try {
          const { generatedFiles } = await buildCarouselImages(event, imageLinks, imageSources, baseUrl);
          deployed = deployToNetlify();
          if (!deployed) {
            log.warn('IG Post: デプロイ失敗 → フィード投稿スキップ');
          } else {
            const carouselUrls = generatedFiles.map(f => getCaptureUrl(f));
            if (carouselUrls.length >= 2) {
              mainResult = await postFeedCarousel(carouselUrls, feedCaption);
            } else {
              mainResult = await postFeedSingle(carouselUrls[0], feedCaption);
            }
            log.info(`IG Post: フィード投稿成功 → mediaId: ${mainResult.mediaId}`);
            if (!state.igPosted[event.id]) state.igPosted[event.id] = {};
            state.igPosted[event.id].feed = {
              postedAt: new Date().toISOString(),
              igMediaId: mainResult.mediaId,
            };
            saveState(state);
          }
        } catch (err) {
          log.error(`IG Post: フィード投稿失敗: ${err.message}`);
        }
      }
    } else {
      // --- リール投稿 ---
      const reelCaption = buildFeedCaption(event, selection.mainExhibitors, sourceAccount);

      if (DRY_RUN) {
        log.info(`IG Post: [DRY RUN] リール投稿 → ${event.title}`);
      } else {
        try {
          log.info(`IG Post: リール動画生成（Remotion） → ${event.id}`);
          const reelVideoPath = await generateReelVideo(event.id, event, imageLinks, imageSources);

          deployed = deployToNetlify();
          if (!deployed) {
            log.warn('IG Post: デプロイ失敗 → リール投稿スキップ');
          } else {
            const reelVideoUrl = getCaptureUrl(`${event.id}_reel.mp4`);
            log.info(`IG Post: リール投稿中 → ${event.title}`);
            mainResult = await postReel(reelVideoUrl, reelCaption);
            log.info(`IG Post: リール投稿成功 → mediaId: ${mainResult.mediaId}`);
            if (!state.igPosted[event.id]) state.igPosted[event.id] = {};
            state.igPosted[event.id].reel = {
              postedAt: new Date().toISOString(),
              igMediaId: mainResult.mediaId,
            };
            saveState(state);
          }
        } catch (err) {
          log.error(`IG Post: リール投稿失敗: ${err.message}`);
        }
      }
    }
  }

  // 5. ストーリーズ投稿（最大3件）
  const storyResults = [];
  for (let i = 0; i < selection.storyEvents.length; i++) {
    const { event, exhibitors: storyExhibitors } = selection.storyEvents[i];
    const sourceAccount = imageSources[event.id] || '';

    if (DRY_RUN) {
      log.info(`IG Post: [DRY RUN] ストーリー${i + 1}/3 → ${event.title}`);
      storyResults.push({ dryRun: true });
      continue;
    }

    try {
      // ストーリー動画生成（Remotion MP4）
      log.info(`IG Post: ストーリー動画生成 ${i + 1}/3 → ${event.id}`);
      const storyImageLinks = loadImageLinks();
      const videoPath = await generateStoryVideo(event.id, event, storyImageLinks, imageSources);

      // Netlifyデプロイ（未デプロイの場合のみ）
      if (!deployed) {
        deployed = deployToNetlify();
        if (!deployed) {
          log.warn('IG Post: デプロイ失敗 → ストーリー投稿スキップ');
          continue;
        }
      }

      const videoUrl = getCaptureUrl(`${event.id}_story.mp4`);
      log.info(`IG Post: ストーリー投稿中 ${i + 1}/3 → ${event.title}`);
      const result = await postStoryVideo(videoUrl);

      log.info(`IG Post: ストーリー投稿成功 ${i + 1}/3 → mediaId: ${result.mediaId}`);
      if (!state.igPosted[event.id]) state.igPosted[event.id] = {};
      state.igPosted[event.id].story = {
        postedAt: new Date().toISOString(),
        igMediaId: result.mediaId,
        type: 'video',
      };
      saveState(state);
      storyResults.push(result);
    } catch (err) {
      log.error(`IG Post: ストーリー${i + 1}/3 投稿失敗: ${err.message}`);

      // フォールバック: 静止画
      try {
        log.info(`IG Post: 静止画フォールバック → ${event.id}`);
        await captureStoryImage(event.id, event, { force: true, sourceAccount });
        if (!deployed) {
          deployed = deployToNetlify();
        }
        if (deployed) {
          const storyUrl = getCaptureUrl(`${event.id}_story.png`);
          const result = await postStory(storyUrl);
          log.info(`IG Post: ストーリー投稿成功（静止画） ${i + 1}/3`);
          if (!state.igPosted[event.id]) state.igPosted[event.id] = {};
          state.igPosted[event.id].story = {
            postedAt: new Date().toISOString(),
            igMediaId: result.mediaId,
            type: 'image_fallback',
          };
          saveState(state);
          storyResults.push(result);
        }
      } catch (err2) {
        log.error(`IG Post: フォールバックも失敗: ${err2.message}`);
      }
    }
  }

  // 6. サマリー
  const mainStatus = mainResult ? '✅' : (selection.mainEvent ? '❌' : '⏭️');
  const storyOk = storyResults.filter(r => r).length;
  const storyTotal = selection.storyEvents.length;
  log.info(`IG Post: 完了 — ${postType === 'feed' ? 'フィード' : 'リール'}: ${mainStatus} / ストーリーズ: ${storyOk}/${storyTotal}件`);
}

main().catch((err) => {
  log.error(`IG Post: 致命的エラー: ${err.message}`);
  console.error(err);
  process.exit(1);
});
