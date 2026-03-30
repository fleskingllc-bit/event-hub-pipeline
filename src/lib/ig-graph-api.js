/**
 * ig-graph-api.js — Instagram Graph API クライアント
 *
 * フィード（単一画像/カルーセル）・ストーリーズ投稿に対応。
 * レート制限: 25 API calls/日, 50投稿/日 → 2投稿/日は余裕
 */
import { getSecret } from './secrets.js';

const GRAPH_API = 'https://graph.instagram.com/v21.0';
const CONTAINER_POLL_INTERVAL_MS = 5000;
const CONTAINER_POLL_TIMEOUT_MS = 60000;
const VIDEO_POLL_TIMEOUT_MS = 120000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

function getCredentials() {
  const accessToken = getSecret('metaPageAccessToken');
  const igUserId = getSecret('igBusinessAccountId');
  if (!accessToken || !igUserId) {
    throw new Error('Meta API credentials not configured. Run: npm run ig:token-setup');
  }
  return { accessToken, igUserId };
}

async function graphPost(path, params) {
  const url = `${GRAPH_API}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (data.error) {
    throw new Error(`Graph API POST ${path}: ${data.error.message} (code: ${data.error.code})`);
  }
  return data;
}

async function graphGet(path, params = {}) {
  const url = new URL(`${GRAPH_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`Graph API GET ${path}: ${data.error.message} (code: ${data.error.code})`);
  }
  return data;
}

/**
 * コンテナのステータスがFINISHEDになるまでポーリング
 */
async function waitForContainer(containerId, accessToken) {
  const start = Date.now();
  while (Date.now() - start < CONTAINER_POLL_TIMEOUT_MS) {
    const status = await graphGet(`/${containerId}`, {
      fields: 'status_code',
      access_token: accessToken,
    });
    if (status.status_code === 'FINISHED') return true;
    if (status.status_code === 'ERROR') {
      throw new Error(`Container ${containerId} failed with ERROR status`);
    }
    await new Promise((r) => setTimeout(r, CONTAINER_POLL_INTERVAL_MS));
  }
  throw new Error(`Container ${containerId} timed out after ${CONTAINER_POLL_TIMEOUT_MS}ms`);
}

/**
 * リトライラッパー（指数バックオフ）
 */
async function withRetry(fn, label = 'operation') {
  let lastError;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Token expired → don't retry
      if (err.message.includes('code: 190')) throw err;
      if (attempt < MAX_RETRIES - 1) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        console.warn(`⚠️ ${label} attempt ${attempt + 1} failed, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastError;
}

/**
 * 単一画像フィード投稿
 */
export async function postFeedSingle(imageUrl, caption) {
  const { accessToken, igUserId } = getCredentials();

  return withRetry(async () => {
    // 1. コンテナ作成
    const container = await graphPost(`/${igUserId}/media`, {
      image_url: imageUrl,
      caption,
      access_token: accessToken,
    });

    // 2. ステータス待ち
    await waitForContainer(container.id, accessToken);

    // 3. 公開
    const result = await graphPost(`/${igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: accessToken,
    });

    return { mediaId: result.id, type: 'feed_single' };
  }, 'postFeedSingle');
}

/**
 * カルーセル（複数画像）フィード投稿
 * @param {string[]} imageUrls - 画像URL配列（2〜10枚）
 * @param {string} caption - キャプション
 */
export async function postFeedCarousel(imageUrls, caption) {
  const { accessToken, igUserId } = getCredentials();

  if (imageUrls.length < 2 || imageUrls.length > 10) {
    throw new Error(`Carousel requires 2-10 images, got ${imageUrls.length}`);
  }

  return withRetry(async () => {
    // 1. 各画像のコンテナ作成
    const childIds = [];
    for (const url of imageUrls) {
      const child = await graphPost(`/${igUserId}/media`, {
        image_url: url,
        is_carousel_item: true,
        access_token: accessToken,
      });
      childIds.push(child.id);
      // コンテナ作成間の小さな待機
      await new Promise((r) => setTimeout(r, 500));
    }

    // 全子コンテナの完了を待つ
    for (const childId of childIds) {
      await waitForContainer(childId, accessToken);
    }

    // 2. カルーセルコンテナ作成
    const carousel = await graphPost(`/${igUserId}/media`, {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption,
      access_token: accessToken,
    });

    // 3. カルーセルコンテナの完了を待つ
    await waitForContainer(carousel.id, accessToken);

    // 4. 公開
    const result = await graphPost(`/${igUserId}/media_publish`, {
      creation_id: carousel.id,
      access_token: accessToken,
    });

    return { mediaId: result.id, type: 'feed_carousel', imageCount: imageUrls.length };
  }, 'postFeedCarousel');
}

/**
 * ストーリーズ投稿
 */
export async function postStory(imageUrl) {
  const { accessToken, igUserId } = getCredentials();

  return withRetry(async () => {
    // 1. ストーリーズコンテナ作成
    const container = await graphPost(`/${igUserId}/media`, {
      image_url: imageUrl,
      media_type: 'STORIES',
      access_token: accessToken,
    });

    // 2. ステータス待ち
    await waitForContainer(container.id, accessToken);

    // 3. 公開
    const result = await graphPost(`/${igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: accessToken,
    });

    return { mediaId: result.id, type: 'story' };
  }, 'postStory');
}

/**
 * ストーリーズ動画投稿
 * @param {string} videoUrl - 動画URL（公開アクセス可能であること）
 */
export async function postStoryVideo(videoUrl) {
  const { accessToken, igUserId } = getCredentials();

  return withRetry(async () => {
    // 1. 動画コンテナ作成（media_type=VIDEO + STORIES）
    const container = await graphPost(`/${igUserId}/media`, {
      video_url: videoUrl,
      media_type: 'STORIES',
      access_token: accessToken,
    });

    // 2. ステータス待ち（動画は処理に時間がかかるため長めのタイムアウト）
    const start = Date.now();
    while (Date.now() - start < VIDEO_POLL_TIMEOUT_MS) {
      const status = await graphGet(`/${container.id}`, {
        fields: 'status_code',
        access_token: accessToken,
      });
      if (status.status_code === 'FINISHED') break;
      if (status.status_code === 'ERROR') {
        throw new Error(`Video container ${container.id} failed with ERROR status`);
      }
      await new Promise((r) => setTimeout(r, CONTAINER_POLL_INTERVAL_MS));
    }

    // 3. 公開
    const result = await graphPost(`/${igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: accessToken,
    });

    return { mediaId: result.id, type: 'story_video' };
  }, 'postStoryVideo');
}

/**
 * リール動画投稿
 * @param {string} videoUrl - 動画URL（公開アクセス可能であること）
 * @param {string} caption - キャプション
 */
export async function postReel(videoUrl, caption) {
  const { accessToken, igUserId } = getCredentials();

  return withRetry(async () => {
    // 1. リールコンテナ作成
    const container = await graphPost(`/${igUserId}/media`, {
      video_url: videoUrl,
      media_type: 'REELS',
      caption,
      share_to_feed: true,
      access_token: accessToken,
    });

    // 2. ステータス待ち（動画は処理に時間がかかるため長めのタイムアウト）
    const start = Date.now();
    while (Date.now() - start < VIDEO_POLL_TIMEOUT_MS) {
      const status = await graphGet(`/${container.id}`, {
        fields: 'status_code',
        access_token: accessToken,
      });
      if (status.status_code === 'FINISHED') break;
      if (status.status_code === 'ERROR') {
        throw new Error(`Reel container ${container.id} failed with ERROR status`);
      }
      await new Promise((r) => setTimeout(r, CONTAINER_POLL_INTERVAL_MS));
    }

    // 3. 公開
    const result = await graphPost(`/${igUserId}/media_publish`, {
      creation_id: container.id,
      access_token: accessToken,
    });

    return { mediaId: result.id, type: 'reel' };
  }, 'postReel');
}

/**
 * トークンの有効性チェック
 */
export async function verifyToken() {
  const { accessToken, igUserId } = getCredentials();
  const info = await graphGet(`/${igUserId}`, {
    fields: 'username,name,media_count',
    access_token: accessToken,
  });
  return info;
}
