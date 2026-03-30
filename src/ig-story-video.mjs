#!/usr/bin/env node
/**
 * ig-story-video.mjs — Remotionでストーリーズ動画（MP4）を生成
 *
 * Usage:
 *   node src/ig-story-video.mjs <eventId>
 *   node src/ig-story-video.mjs evt_0c4939a0_033
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { loadConfig } from './lib/config.js';
import { log } from './lib/logger.js';
import { upscaleHeroIfNeeded } from './upscale-hero.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const OUTPUT_DATA_PATH = join(ROOT, 'output', 'data.json');
const IMAGE_LINKS_PATH = join(ROOT, 'data', 'image-links.json');
const IMAGE_SOURCES_PATH = join(ROOT, 'data', 'image-sources.json');
const CAPTURE_DIR = join(ROOT, '..', 'event-hub-prototype', 'public', 'images', 'ig-captures');
const REMOTION_ENTRY = join(ROOT, 'src', 'remotion', 'index.ts');

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}（${DAY_NAMES[d.getDay()]}）`;
}

/**
 * イベント内容からキャッチコピーを生成
 * 「山口県で〇〇なイベント！」形式
 */
function generateCatchphrase(event) {
  const text = `${event.title || ''} ${event.description || ''}`;
  const a = event.area || '';

  if (/マーケット|マルシェ|蚤の市|フリマ/.test(text)) return `山口県${a}でおしゃれなマーケット！`;
  if (/ハンドメイド|手作り|クラフト/.test(text)) return `山口県${a}でハンドメイドな市！`;
  if (/音楽|ライブ|コンサート|演奏/.test(text)) return `山口県${a}で熱い音楽ライブ！`;
  if (/グルメ|フード|食|美味/.test(text)) return `山口県${a}で絶品グルメイベント！`;
  if (/春|桜|花|ガーデン/.test(text)) return `山口県${a}で春を感じるイベント！`;
  if (/夏|祭り|花火|盆踊り/.test(text)) return `山口県${a}で熱い夏祭り！`;
  if (/秋|紅葉|収穫/.test(text)) return `山口県${a}で秋を楽しむイベント！`;
  if (/冬|クリスマス|イルミ/.test(text)) return `山口県${a}で冬の特別イベント！`;
  if (/ワークショップ|体験|教室/.test(text)) return `山口県${a}でわくわく体験イベント！`;
  if (/アート|展示|ギャラリー/.test(text)) return `山口県${a}で感性が磨かれるアートイベント！`;
  if (/キッズ|子ども|親子|ファミリー/.test(text)) return `山口県${a}で楽しい親子イベント！`;
  if (/ピクニック|アウトドア|キャンプ/.test(text)) return `山口県${a}でアウトドアイベント！`;
  if (/ヨガ|健康|ウォーキング|スポーツ/.test(text)) return `山口県${a}でスポーツイベント！`;
  return `山口県${a}で注目のイベント！`;
}

function loadEventData() {
  if (!existsSync(OUTPUT_DATA_PATH)) {
    throw new Error('output/data.json が見つかりません。パイプラインを先に実行してください。');
  }
  return JSON.parse(readFileSync(OUTPUT_DATA_PATH, 'utf-8'));
}

function loadImageLinks() {
  if (!existsSync(IMAGE_LINKS_PATH)) return {};
  return JSON.parse(readFileSync(IMAGE_LINKS_PATH, 'utf-8'));
}

function loadImageSources() {
  if (!existsSync(IMAGE_SOURCES_PATH)) return {};
  try { return JSON.parse(readFileSync(IMAGE_SOURCES_PATH, 'utf-8')); } catch { return {}; }
}

/**
 * イベントデータ → StoryVideoProps に変換
 */
function buildProps(event, imageLinks, imageSources) {
  const config = loadConfig();
  const baseUrl = config.igPosting?.netlifyBaseUrl || 'https://machi-event-cho.netlify.app';

  // ローカルファイルがあればdata URIで渡す（Netlify未デプロイでも高解像度反映）
  const heroLocalPath = join(ROOT, '..', 'event-hub-prototype', 'public', 'images', 'heroes', `${event.id}.webp`);
  let heroUrl;
  if (existsSync(heroLocalPath)) {
    const heroData = readFileSync(heroLocalPath).toString('base64');
    heroUrl = `data:image/webp;base64,${heroData}`;
  } else {
    heroUrl = `${baseUrl}/images/heroes/${event.id}.webp`;
  }

  // イベント写真URL（最大4枚、壊れた画像を除外）
  const PROTO_DIR = join(ROOT, '..', 'event-hub-prototype', 'public');
  const rawImages = (imageLinks[event.id] || []).filter(url => {
    if (url.startsWith('/images/events/')) {
      try {
        if (statSync(join(PROTO_DIR, url)).size < 2000) return false;
      } catch { return false; }
    }
    return true;
  });
  const eventImages = rawImages.slice(0, 4).map(p =>
    p.startsWith('http') ? p : `${baseUrl}${p}`
  );

  // 日付行
  let dateLine = '';
  if (event.date) {
    dateLine = formatDate(event.date);
    if (event.time) dateLine += ` ${event.time}`;
  }

  // tagline: description短縮
  let tagline = (event.description || '').replace(/\n/g, ' ').trim();
  if (tagline.length > 50) tagline = tagline.slice(0, 48) + '…';

  const sourceAccount = imageSources[event.id] || '';

  return {
    heroUrl,
    eventImages,
    title: event.title || '',
    tagline,
    dateLine,
    area: event.area || '',
    location: event.location || '',
    sourceAccount,
  };
}

/**
 * Remotion でMP4をレンダリング
 */
export function renderStoryVideo(eventId, props) {
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const outputPath = join(CAPTURE_DIR, `${eventId}_story.mp4`);

  // propsをファイル経由で渡す（data URI含むとコマンドラインが大きすぎるため）
  const propsFile = join(ROOT, `tmp_props_${eventId}.json`);
  writeFileSync(propsFile, JSON.stringify(props));

  const cmd = [
    'npx', 'remotion', 'render',
    REMOTION_ENTRY,
    'StoryVideo',
    outputPath,
    `--props=${propsFile}`,
  ].join(' ');

  log.info(`IG Story Video: レンダリング開始 → ${eventId}`);
  log.info(`IG Story Video: 出力先 → ${outputPath}`);

  try {
    execSync(cmd, {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 180000, // 3分タイムアウト
      env: { ...process.env, PATH: process.env.PATH },
    });
    log.info(`IG Story Video: レンダリング完了 → ${outputPath}`);
    return outputPath;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    log.error(`IG Story Video: レンダリング失敗: ${err.message}`);
    if (stderr) log.error(`stderr: ${stderr}`);
    throw err;
  } finally {
    try { unlinkSync(propsFile); } catch {}
  }
}

/**
 * イベントIDからストーリー動画を生成
 * 低解像度ヒーロー画像は自動的にGeminiで高解像度化してから動画生成
 */
export async function generateStoryVideo(eventId, event, imageLinks, imageSources) {
  // ヒーロー画像が低解像度なら自動で高解像度化
  await upscaleHeroIfNeeded(eventId);

  const props = buildProps(event, imageLinks, imageSources);
  return renderStoryVideo(eventId, props);
}

/**
 * React fiber経由でLeafletマップインスタンスを操作するヘルパー
 */
function getLeafletMapScript() {
  return `
    function findLeafletMap() {
      const container = document.querySelector('.leaflet-container');
      if (!container) return null;
      const fiberKey = Object.keys(container).find(k => k.startsWith('__reactFiber'));
      if (!fiberKey) return null;
      let fiber = container[fiberKey];
      let depth = 0;
      while (fiber && depth < 30) {
        if (fiber.memoizedState) {
          let hook = fiber.memoizedState;
          while (hook) {
            if (hook.memoizedState && hook.memoizedState.current &&
                typeof hook.memoizedState.current === 'object' &&
                typeof hook.memoizedState.current.setView === 'function') {
              return hook.memoizedState.current;
            }
            hook = hook.next;
          }
        }
        fiber = fiber.return;
        depth++;
      }
      return null;
    }
  `;
}

/**
 * Playwrightで地図を3段階ズームキャプチャ（z9, z11, z13）
 * Google Maps風の無限ズーム効果用
 */
async function captureMapZoomLevels(event) {
  const config = loadConfig();
  const baseUrl = config.igPosting?.netlifyBaseUrl || 'https://machi-event-cho.netlify.app';
  const lat = event.lat || 34.05;
  const lng = event.lng || 131.80;
  const zoomLevels = [7, 9, 11, 13, 15];

  log.info('IG Reel Video: 地図ズームレベル別キャプチャ開始...');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 430, height: 932 },
      deviceScaleFactor: 2,
    });
    await page.goto(baseUrl + '/', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);

    // UIオーバーレイを非表示（クリーンな地図のみ）
    await page.evaluate(() => {
      document.querySelectorAll('.leaflet-control-zoom').forEach(el => el.style.display = 'none');
    });

    const mapEl = page.locator('.leaflet-container').first();
    const dataUris = [];

    for (const zoom of zoomLevels) {
      await page.evaluate(({ lat, lng, zoom, script }) => {
        eval(script);
        const map = findLeafletMap();
        if (map) map.setView([lat, lng], zoom, { animate: false });
      }, { lat, lng, zoom, script: getLeafletMapScript() });

      // タイルロード待ち
      await page.waitForTimeout(2000);

      const buffer = await mapEl.screenshot({ type: 'jpeg', quality: 90 });
      dataUris.push(`data:image/jpeg;base64,${buffer.toString('base64')}`);
      log.info(`IG Reel Video: z${zoom} キャプチャ完了`);
    }

    return dataUris;
  } finally {
    await browser.close();
  }
}

/**
 * 衛星写真で会場俯瞰画像をキャプチャ（Esri World Imagery）
 */
async function captureVenuePhoto(event) {
  const lat = event.lat || 34.05;
  const lng = event.lng || 131.80;

  log.info('IG Reel Video: 会場俯瞰写真キャプチャ開始...');
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 540, height: 960 },
      deviceScaleFactor: 2,
    });

    // Leaflet + Esri衛星タイルのスタンドアロンページ
    const html = `<!DOCTYPE html>
<html><head>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>body{margin:0}#map{width:100vw;height:100vh}</style>
</head><body>
<div id="map"></div>
<script>
  const map = L.map('map', { zoomControl: false, attributionControl: false })
    .setView([${lat}, ${lng}], 18);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 19
  }).addTo(map);
<\/script>
</body></html>`;

    await page.setContent(html, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(3000); // 衛星タイルのロード待ち

    const buffer = await page.screenshot({ type: 'jpeg', quality: 90 });
    log.info('IG Reel Video: 会場俯瞰写真キャプチャ完了');
    return `data:image/jpeg;base64,${buffer.toString('base64')}`;
  } finally {
    await browser.close();
  }
}

/**
 * Remotion でリール動画（MP4）をレンダリング
 */
export function renderReelVideo(eventId, props) {
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const outputPath = join(CAPTURE_DIR, `${eventId}_reel.mp4`);

  const reelProps = { ...props, mapDuration: 135 };
  const propsFile = join(ROOT, `tmp_props_reel_${eventId}.json`);
  writeFileSync(propsFile, JSON.stringify(reelProps));

  const cmd = [
    'npx', 'remotion', 'render',
    REMOTION_ENTRY,
    'ReelVideo',
    outputPath,
    `--props=${propsFile}`,
  ].join(' ');

  log.info(`IG Reel Video: レンダリング開始 → ${eventId}`);
  log.info(`IG Reel Video: 出力先 → ${outputPath}`);

  try {
    execSync(cmd, {
      cwd: ROOT,
      stdio: 'pipe',
      timeout: 300000, // 5分タイムアウト（リールは長い）
      env: { ...process.env, PATH: process.env.PATH },
    });
    log.info(`IG Reel Video: レンダリング完了 → ${outputPath}`);
    return outputPath;
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : '';
    log.error(`IG Reel Video: レンダリング失敗: ${err.message}`);
    if (stderr) log.error(`stderr: ${stderr}`);
    throw err;
  } finally {
    try { unlinkSync(propsFile); } catch {}
  }
}

/**
 * イベントIDからリール動画を生成
 * 1. サイトスクリーンショット取得（Playwright）
 * 2. Remotionでレンダリング（地図ズーム + ストーリー動画）
 */
export async function generateReelVideo(eventId, event, imageLinks, imageSources) {
  await upscaleHeroIfNeeded(eventId);

  // 地図を3段階ズームでキャプチャ [z9, z11, z13]
  const mapZoomLevels = await captureMapZoomLevels(event);

  const props = buildProps(event, imageLinks, imageSources);
  props.mapZoomLevels = mapZoomLevels;
  props.catchphrase = generateCatchphrase(event);
  return renderReelVideo(eventId, props);
}

// Direct execution
const scriptName = process.argv[1] || '';
if (scriptName.endsWith('ig-story-video.mjs')) {
  const isReel = process.argv.includes('--reel');
  const eventId = process.argv.filter(a => !a.startsWith('--'))[2];
  if (!eventId) {
    console.error('Usage: node src/ig-story-video.mjs [--reel] <eventId>');
    process.exit(1);
  }

  const { events } = loadEventData();
  const event = events.find(e => e.id === eventId);
  if (!event) {
    console.error(`Event not found: ${eventId}`);
    process.exit(1);
  }

  const imageLinks = loadImageLinks();
  const imageSources = loadImageSources();

  try {
    if (isReel) {
      const outputPath = await generateReelVideo(eventId, event, imageLinks, imageSources);
      console.log(`\n🎬 リール動画完了: ${outputPath}`);
    } else {
      const outputPath = await generateStoryVideo(eventId, event, imageLinks, imageSources);
      console.log(`\n🎬 ストーリー動画完了: ${outputPath}`);
    }
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }
}
