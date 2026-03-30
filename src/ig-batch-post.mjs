#!/usr/bin/env node
/**
 * ig-batch-post.mjs — 生成済みフィード画像・ストーリー動画を一括投稿
 *
 * ig-batch-generate.mjs で生成したコンテンツを一気にInstagramへ投稿する。
 * 事前にNetlifyデプロイが必要（Graph APIは公開URLからしか取得できない）。
 *
 * Usage:
 *   node src/ig-batch-post.mjs              # 本番投稿
 *   node src/ig-batch-post.mjs --dry-run    # ドライラン（投稿しない）
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { loadConfig } from './lib/config.js';
import { postFeedCarousel, postFeedSingle, postStoryVideo, verifyToken } from './lib/ig-graph-api.js';
import { getCaptureUrl } from './ig-screenshot.mjs';

const ROOT = new URL('../', import.meta.url).pathname;
const STATE_PATH = join(ROOT, 'data', 'state.json');
const PREVIEW_JSON = join(ROOT, '..', 'event-hub-prototype', 'public', 'ig-preview.json');
const PROTOTYPE_DIR = join(ROOT, '..', 'event-hub-prototype');

const DRY_RUN = process.argv.includes('--dry-run');
const DELAY_BETWEEN_POSTS_MS = 10000; // 投稿間隔 10秒

function loadState() {
  return JSON.parse(readFileSync(STATE_PATH, 'utf-8'));
}

function saveState(state) {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Netlify にデプロイ（画像を公開URLで利用可能にする）
 */
function deployToNetlify() {
  console.log('\n🚀 Netlifyデプロイ中...');
  try {
    execSync('npm run build', { cwd: PROTOTYPE_DIR, stdio: 'pipe', timeout: 120000 });
    const result = execSync('npx netlify deploy --prod --dir=dist --json', {
      cwd: PROTOTYPE_DIR, stdio: 'pipe', timeout: 120000,
    });
    const deployResult = JSON.parse(result.toString());
    console.log(`✅ デプロイ完了: ${deployResult.deploy_url || deployResult.url}`);
    return true;
  } catch (err) {
    console.error(`❌ デプロイ失敗: ${err.message}`);
    return false;
  }
}

async function main() {
  // プレビューJSON読み込み
  if (!existsSync(PREVIEW_JSON)) {
    console.error('❌ ig-preview.json が見つかりません。先に ig-batch-generate.mjs を実行してください。');
    process.exit(1);
  }
  const preview = JSON.parse(readFileSync(PREVIEW_JSON, 'utf-8'));

  console.log(`\n📱 IG一括投稿${DRY_RUN ? ' (DRY RUN)' : ''}`);
  console.log(`   フィード: ${preview.feed?.length || 0}件`);
  console.log(`   ストーリー: ${preview.stories?.length || 0}件`);

  // トークン検証
  if (!DRY_RUN) {
    try {
      const info = await verifyToken();
      console.log(`✅ アカウント確認: @${info.username} (投稿数: ${info.media_count})`);
    } catch (err) {
      console.error(`❌ トークン検証失敗: ${err.message}`);
      process.exit(1);
    }

    // デプロイ
    const deployed = deployToNetlify();
    if (!deployed) {
      console.error('❌ Netlifyデプロイ失敗。投稿を中止します。');
      process.exit(1);
    }
    // デプロイ直後にCDNキャッシュが反映されるまで少し待つ
    console.log('⏳ CDN反映待ち (15秒)...');
    await sleep(15000);
  }

  const state = loadState();
  if (!state.igPosted) state.igPosted = {};

  let feedSuccess = 0;
  let feedFail = 0;
  let storySuccess = 0;
  let storyFail = 0;

  // --- フィード投稿 ---
  console.log('\n========================================');
  console.log('📸 フィード投稿');
  console.log('========================================');

  for (let idx = 0; idx < (preview.feed?.length || 0); idx++) {
    const post = preview.feed[idx];

    // 既に投稿済みチェック
    if (state.igPosted[post.eventId]?.feed) {
      console.log(`\n⏭️  [${idx + 1}/${preview.feed.length}] ${post.title} — 投稿済み、スキップ`);
      continue;
    }

    console.log(`\n--- [${idx + 1}/${preview.feed.length}] ${post.title} ---`);
    console.log(`  ${post.area} | ${post.date} | ${post.images.length}枚`);

    // 画像URLを構築
    const imageUrls = post.images.map(p => {
      const filename = p.split('/').pop();
      return getCaptureUrl(filename);
    });

    if (DRY_RUN) {
      console.log(`  [DRY RUN] カルーセル ${imageUrls.length}枚`);
      console.log(`  URL: ${imageUrls[0]}`);
      console.log(`  キャプション: ${post.caption?.slice(0, 100)}...`);
      feedSuccess++;
      continue;
    }

    try {
      let result;
      if (imageUrls.length >= 2) {
        console.log(`  カルーセル投稿中 (${imageUrls.length}枚)...`);
        result = await postFeedCarousel(imageUrls, post.caption);
      } else {
        console.log(`  単一画像投稿中...`);
        result = await postFeedSingle(imageUrls[0], post.caption);
      }

      console.log(`  ✅ 投稿成功 (mediaId: ${result.mediaId})`);
      state.igPosted[post.eventId] = state.igPosted[post.eventId] || {};
      state.igPosted[post.eventId].feed = {
        postedAt: new Date().toISOString(),
        igMediaId: result.mediaId,
      };
      saveState(state);
      feedSuccess++;

      // 次の投稿まで待機
      if (idx < preview.feed.length - 1) {
        console.log(`  ⏳ 次の投稿まで ${DELAY_BETWEEN_POSTS_MS / 1000}秒待機...`);
        await sleep(DELAY_BETWEEN_POSTS_MS);
      }
    } catch (err) {
      console.error(`  ❌ 投稿失敗: ${err.message}`);
      feedFail++;
    }
  }

  // --- ストーリー投稿 ---
  if (preview.stories?.length > 0) {
    console.log('\n========================================');
    console.log('🎬 ストーリーズ動画投稿');
    console.log('========================================');

    for (let idx = 0; idx < preview.stories.length; idx++) {
      const story = preview.stories[idx];

      // 既に投稿済みチェック
      if (state.igPosted[story.eventId]?.story) {
        console.log(`\n⏭️  [${idx + 1}/${preview.stories.length}] ${story.title} — 投稿済み、スキップ`);
        continue;
      }

      console.log(`\n--- [${idx + 1}/${preview.stories.length}] ${story.title} ---`);

      const videoFilename = story.video.split('/').pop();
      const videoUrl = getCaptureUrl(videoFilename);

      if (DRY_RUN) {
        console.log(`  [DRY RUN] ストーリー動画投稿`);
        console.log(`  URL: ${videoUrl}`);
        storySuccess++;
        continue;
      }

      try {
        console.log(`  ストーリー動画投稿中...`);
        const result = await postStoryVideo(videoUrl);

        console.log(`  ✅ 投稿成功 (mediaId: ${result.mediaId})`);
        state.igPosted[story.eventId] = state.igPosted[story.eventId] || {};
        state.igPosted[story.eventId].story = {
          postedAt: new Date().toISOString(),
          igMediaId: result.mediaId,
          type: 'video',
        };
        saveState(state);
        storySuccess++;

        if (idx < preview.stories.length - 1) {
          console.log(`  ⏳ 次の投稿まで ${DELAY_BETWEEN_POSTS_MS / 1000}秒待機...`);
          await sleep(DELAY_BETWEEN_POSTS_MS);
        }
      } catch (err) {
        console.error(`  ❌ 投稿失敗: ${err.message}`);
        storyFail++;
      }
    }
  }

  // --- サマリー ---
  console.log('\n========================================');
  console.log('📊 投稿結果');
  console.log('========================================');
  console.log(`  フィード: ✅ ${feedSuccess}件成功 / ❌ ${feedFail}件失敗`);
  console.log(`  ストーリー: ✅ ${storySuccess}件成功 / ❌ ${storyFail}件失敗`);
  console.log('========================================');
}

main().catch(err => {
  console.error('❌ 致命的エラー:', err.message);
  process.exit(1);
});
