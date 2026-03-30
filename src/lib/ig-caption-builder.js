/**
 * ig-caption-builder.js — Instagram投稿キャプション生成
 *
 * フィード用（カルーセル含む）とストーリーズ用のテンプレートを提供。
 */

const DAY_NAMES = ['日', '月', '火', '水', '木', '金', '土'];

// エリア→ハッシュタグマッピング
const AREA_TAGS = {
  '光市': '#光市イベント #光市',
  '周南市': '#周南イベント #周南市',
  '下松市': '#下松イベント #下松市',
  '岩国市': '#岩国イベント #岩国市',
  '山口市': '#山口市イベント #山口市',
  '防府市': '#防府イベント #防府市',
  '下関市': '#下関イベント #下関市',
  '宇部市': '#宇部イベント #宇部市',
  '萩市': '#萩イベント #萩市',
  '柳井市': '#柳井イベント #柳井市',
};

const BASE_TAGS = '#まちのイベント帖 #山口マルシェ #マルシェ #山口県 #山口イベント';

const SERVICE_INTRO = `——
🗺 まちのイベント帖 @machi_ymg
山口県のマルシェやイベントをマップで探せる無料サービスです。
プロフィールのリンクから最新イベントをチェック！`;

/**
 * 出展者のInstagramハンドルからメンション文字列を生成
 */
function buildMentions(exhibitors) {
  if (!exhibitors || exhibitors.length === 0) return '';
  return exhibitors
    .filter((ex) => ex.instagram)
    .map((ex) => {
      const handle = ex.instagram.replace(/^@/, '').trim();
      return handle ? `@${handle}` : '';
    })
    .filter(Boolean)
    .join(' ');
}

/**
 * 日付をフォーマット: 3/26（水）
 */
function formatDate(dateStr) {
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const dow = DAY_NAMES[d.getDay()];
  return `${month}/${day}（${dow}）`;
}

/**
 * フィードキャプション生成
 * @param {object} event
 * @param {object[]} exhibitors
 * @param {string} [sourceAccount] - 画像引用元のIGアカウント名（@なし）
 */
export function buildFeedCaption(event, exhibitors = [], sourceAccount = '') {
  const mentions = buildMentions(exhibitors);
  const areaTags = AREA_TAGS[event.area] || '';
  const dateLine = event.date ? formatDate(event.date) : '';
  const timeLine = event.time || '';
  const locationLine = event.location || '';

  // 説明文（長すぎる場合は切り詰め）
  let description = event.description || '';
  if (description.length > 300) {
    description = description.slice(0, 297) + '...';
  }

  const parts = [
    event.title,
    '',
  ];

  if (dateLine) parts.push(`📅 ${dateLine}`);
  if (timeLine) parts.push(`⏰ ${timeLine}`);
  if (locationLine) parts.push(`📍 ${locationLine}`);
  if (event.address) parts.push(`🏠 ${event.address}`);

  if (description) {
    parts.push('');
    parts.push(description);
  }

  // 画像引用元クレジット
  if (sourceAccount) {
    const handle = sourceAccount.replace(/^@/, '');
    parts.push('');
    parts.push(`📸 @${handle} さんの投稿より`);
  }

  // 出展者メンション
  if (mentions) {
    parts.push('');
    parts.push(`出展者: ${mentions}`);
  }

  // CTA + 自己メンション
  parts.push('');
  parts.push('🔗 イベントマップ → @machi_ymg プロフィールのリンクから');

  // サービス紹介
  parts.push('');
  parts.push(SERVICE_INTRO);

  // ハッシュタグ
  parts.push('');
  parts.push(`${BASE_TAGS} ${areaTags}`.trim());

  return parts.join('\n');
}

/**
 * ストーリーズキャプション生成（画像上に表示される短いテキスト）
 * ※Graph APIではストーリーズにキャプションは付けられないが、ログ/デバッグ用
 */
export function buildStoryCaption(event, exhibitors = []) {
  const mentions = buildMentions(exhibitors);
  const dateLine = event.date ? formatDate(event.date) : '';
  const locationLine = event.location || '';

  const parts = [
    event.title,
    `${dateLine}｜${locationLine}`,
  ];

  if (mentions) parts.push(mentions);
  parts.push('');
  parts.push('@machi_ymg');

  return parts.join('\n');
}
