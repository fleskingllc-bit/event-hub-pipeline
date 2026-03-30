#!/usr/bin/env node
/**
 * ig-batch-generate.mjs — フィード画像 + ストーリー動画を一括生成
 *
 * Usage:
 *   node src/ig-batch-generate.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { captureCoverImage, captureRepostImage } from './ig-screenshot.mjs';
import { generateStoryVideo } from './ig-story-video.mjs';
import { buildFeedCaption } from './lib/ig-caption-builder.js';

const ROOT = new URL('../', import.meta.url).pathname;
const OUTPUT_DATA = join(ROOT, 'output', 'data.json');
const IMAGE_LINKS = join(ROOT, 'data', 'image-links.json');
const IMAGE_SOURCES = join(ROOT, 'data', 'image-sources.json');
const CAPTURE_DIR = join(ROOT, '..', 'event-hub-prototype', 'public', 'images', 'ig-captures');
const PREVIEW_JSON = join(ROOT, '..', 'event-hub-prototype', 'public', 'ig-preview.json');

// --- 対象イベント ---
const FEED_EVENT_IDS = [
  'evt_0c4939a0_033', // ほっこりプチマルシェ (3/26 TODAY)
  'evt_360154b1_005', // 桜咲く橋の上のアフタヌーンティー (3/27)
  'evt_7d6d59e5_015', // 春市場 (3/28)
  'evt_360154b1_007', // 湯飯祭 (3/28)
  'evt_0c4939a0_014', // クラフト鬼マルシェ (3/29)
  'evt_0c4939a0_003', // goody kids (3/29)
  'evt_0c4939a0_066', // はちとひとと10周年マルシェ (3/29)
  'evt_360154b1_000', // 弥栄湖なごみ広場桜まつり (3/29)
  'evt_0c4939a0_009', // ひだまりマルシェ (4/3)
];

const STORY_EVENT_IDS = [
  'evt_0c4939a0_014', // クラフト鬼マルシェ (9枚)
  'evt_0c4939a0_003', // goody kids (3枚)
  'evt_360154b1_005', // 桜咲く橋の上のアフタヌーンティー (2枚)
];

// --- データ読み込み ---
const { events, exhibitors: allExhibitors } = JSON.parse(readFileSync(OUTPUT_DATA, 'utf-8'));
const imageLinks = existsSync(IMAGE_LINKS) ? JSON.parse(readFileSync(IMAGE_LINKS, 'utf-8')) : {};
const imageSources = existsSync(IMAGE_SOURCES) ? JSON.parse(readFileSync(IMAGE_SOURCES, 'utf-8')) : {};

function findEvent(id) {
  const ev = events.find(e => e.id === id);
  if (!ev) throw new Error(`Event not found: ${id}`);
  return ev;
}

function getExhibitors(event) {
  if (!event.exhibitorIds || event.exhibitorIds.length === 0) return [];
  return event.exhibitorIds
    .map(eid => allExhibitors.find(ex => ex.id === eid))
    .filter(Boolean);
}

const PROTO_DIR = join(ROOT, '..', 'event-hub-prototype', 'public');

/**
 * 壊れた画像（プレースホルダーアイコン等）を除外する。
 * ローカルファイルの場合は2KB未満を除外。
 */
function filterBrokenImages(imgs) {
  return imgs.filter(url => {
    if (url.startsWith('/images/events/')) {
      const fullPath = join(PROTO_DIR, url);
      try {
        const stat = statSync(fullPath);
        if (stat.size < 2000) return false;
      } catch { return false; }
    }
    return true;
  });
}

// --- フィード画像生成 ---
async function generateFeedImages() {
  console.log('\n========================================');
  console.log('📸 フィード画像生成 (9イベント)');
  console.log('========================================\n');

  const previewData = [];

  for (const eventId of FEED_EVENT_IDS) {
    const event = findEvent(eventId);
    const rawImgs = imageLinks[eventId] || [];
    const eventImgs = filterBrokenImages(rawImgs);
    const sourceAccount = imageSources[eventId] || '';
    const exhibitors = getExhibitors(event);

    console.log(`\n--- ${event.title} (${eventId}) ---`);
    console.log(`  日付: ${event.date} | エリア: ${event.area} | 画像: ${eventImgs.length}枚 (${rawImgs.length - eventImgs.length}枚除外)`);

    // 1. カバー画像
    const coverPath = await captureCoverImage(eventId, event, {
      force: true,
      eventImages: eventImgs,
    });

    // 2. リポスト画像（最大9枚）
    const repostPaths = [];
    const repostLimit = Math.min(eventImgs.length, 9);
    for (let i = 0; i < repostLimit; i++) {
      const imgUrl = eventImgs[i].startsWith('http')
        ? eventImgs[i]
        : `https://machi-event-cho.netlify.app${eventImgs[i]}`;
      const path = await captureRepostImage(eventId, imgUrl, sourceAccount, i);
      repostPaths.push(path);
      process.stdout.write(`  リポスト ${i + 1}/${repostLimit}\r`);
    }
    if (repostLimit > 0) console.log(`  リポスト: ${repostLimit}枚完了`);

    // 3. キャプション生成
    const caption = buildFeedCaption(event, exhibitors, sourceAccount);

    // プレビューデータ
    const carouselImages = [
      `/images/ig-captures/${eventId}_cover.png`,
      ...Array.from({ length: repostLimit }, (_, i) =>
        `/images/ig-captures/${eventId}_repost_${i}.png`
      ),
    ];

    previewData.push({
      eventId,
      type: 'feed',
      title: event.title,
      date: event.date,
      area: event.area,
      location: event.location,
      sourceAccount,
      caption,
      images: carouselImages,
    });

    console.log(`  ✅ ${event.title} 完了 (cover + ${repostLimit} reposts)`);
  }

  return previewData;
}

// --- ストーリー動画生成 ---
async function generateStoryVideos() {
  console.log('\n========================================');
  console.log('🎬 ストーリー動画生成 (3イベント)');
  console.log('========================================\n');

  const storyData = [];

  for (const eventId of STORY_EVENT_IDS) {
    const event = findEvent(eventId);
    const rawImgs = imageLinks[eventId] || [];
    const cleanImgs = filterBrokenImages(rawImgs);
    const filteredLinks = { ...imageLinks, [eventId]: cleanImgs };
    console.log(`\n--- ${event.title} (${eventId}) --- 画像: ${cleanImgs.length}枚 (${rawImgs.length - cleanImgs.length}枚除外)`);

    try {
      const outputPath = await generateStoryVideo(eventId, event, filteredLinks, imageSources);
      console.log(`  ✅ 動画完了: ${outputPath}`);

      storyData.push({
        eventId,
        type: 'story',
        title: event.title,
        date: event.date,
        area: event.area,
        video: `/images/ig-captures/${eventId}_story.mp4`,
      });
    } catch (err) {
      console.error(`  ❌ 動画失敗: ${err.message}`);
    }
  }

  return storyData;
}

// --- メイン ---
async function main() {
  console.log('🚀 IG一括生成開始');
  mkdirSync(CAPTURE_DIR, { recursive: true });

  const feedData = await generateFeedImages();
  const storyData = await generateStoryVideos();

  // プレビューJSON出力
  const preview = {
    generatedAt: new Date().toISOString(),
    feed: feedData,
    stories: storyData,
  };
  writeFileSync(PREVIEW_JSON, JSON.stringify(preview, null, 2));
  console.log(`\n📋 プレビューJSON: ${PREVIEW_JSON}`);

  console.log('\n========================================');
  console.log('✅ 一括生成完了');
  console.log(`  フィード: ${feedData.length}件`);
  console.log(`  ストーリー: ${storyData.length}件`);
  console.log('========================================');
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
