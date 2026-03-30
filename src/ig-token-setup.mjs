#!/usr/bin/env node
/**
 * ig-token-setup.mjs — Instagram Graph API トークンセットアップ（初回のみ）
 *
 * 手順:
 *   1. Meta for Developers → Graph API Explorer で短期ユーザートークンを取得
 *      必要なパーミッション: instagram_content_publish, pages_read_engagement, pages_show_list
 *   2. このスクリプトに短期トークンを渡すと:
 *      - 短期 → 長期ユーザートークン
 *      - 長期ユーザー → ページアクセストークン
 *      - IG Business Account ID を取得
 *      - secrets.json に保存
 *
 * Usage:
 *   node src/ig-token-setup.mjs <SHORT_LIVED_TOKEN>
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = new URL('../', import.meta.url).pathname;
const SECRETS_PATH = join(ROOT, 'secrets.json');
const GRAPH_API = 'https://graph.facebook.com/v21.0';

async function graphGet(path, params = {}) {
  const url = new URL(`${GRAPH_API}${path}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) {
    throw new Error(`Graph API Error: ${data.error.message}`);
  }
  return data;
}

async function main() {
  const shortToken = process.argv[2];
  if (!shortToken) {
    console.error('Usage: node src/ig-token-setup.mjs <SHORT_LIVED_TOKEN>');
    console.error('\n手順:');
    console.error('1. https://developers.facebook.com/tools/explorer/ にアクセス');
    console.error('2. アプリを選択 → パーミッション追加:');
    console.error('   - instagram_content_publish');
    console.error('   - pages_read_engagement');
    console.error('   - pages_show_list');
    console.error('3. "Generate Access Token" で短期トークンを取得');
    console.error('4. このスクリプトにトークンを渡す');
    process.exit(1);
  }

  // Load secrets
  let secrets = {};
  try {
    secrets = JSON.parse(readFileSync(SECRETS_PATH, 'utf-8'));
  } catch { /* empty */ }

  // Load app credentials from secrets (needed for token exchange)
  const appId = secrets.metaAppId || process.env.META_APP_ID;
  const appSecret = secrets.metaAppSecret || process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    console.error('❌ secrets.json に metaAppId / metaAppSecret が必要です');
    console.error('  Meta for Developers → アプリ設定 → Basic で確認');
    process.exit(1);
  }

  console.log('🔄 Step 1: 短期→長期ユーザートークン交換...');
  const longLived = await graphGet('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  console.log(`✅ 長期トークン取得 (有効期限: ${longLived.expires_in ? Math.floor(longLived.expires_in / 86400) + '日' : '無期限'})`);

  console.log('\n🔄 Step 2: ページ一覧を取得...');
  const pages = await graphGet('/me/accounts', {
    access_token: longLived.access_token,
  });

  if (!pages.data || pages.data.length === 0) {
    console.error('❌ 管理ページが見つかりません。Facebookページを確認してください。');
    process.exit(1);
  }

  console.log(`📄 ${pages.data.length}件のページ:`);
  for (const page of pages.data) {
    console.log(`   - ${page.name} (ID: ${page.id})`);
  }

  // Use first page (or find the one linked to IG)
  let selectedPage = pages.data[0];
  const pageAccessToken = selectedPage.access_token;

  console.log(`\n🔄 Step 3: IG Business Account IDを取得 (ページ: ${selectedPage.name})...`);
  const igAccount = await graphGet(`/${selectedPage.id}`, {
    fields: 'instagram_business_account',
    access_token: pageAccessToken,
  });

  if (!igAccount.instagram_business_account) {
    console.error('❌ Instagram Business Accountが見つかりません');
    console.error('ヒント: FacebookページにInstagramビジネスアカウントがリンクされていますか？');
    process.exit(1);
  }

  const igUserId = igAccount.instagram_business_account.id;

  // Verify IG account
  const igInfo = await graphGet(`/${igUserId}`, {
    fields: 'username,name',
    access_token: pageAccessToken,
  });
  console.log(`✅ IG Business Account: @${igInfo.username} (ID: ${igUserId})`);

  // Save to secrets.json
  secrets.metaPageAccessToken = pageAccessToken;
  secrets.igBusinessAccountId = igUserId;
  writeFileSync(SECRETS_PATH, JSON.stringify(secrets, null, 2) + '\n');

  console.log('\n✅ secrets.json を更新しました:');
  console.log(`   metaPageAccessToken: ${pageAccessToken.slice(0, 20)}...`);
  console.log(`   igBusinessAccountId: ${igUserId}`);
  console.log('\n🎉 セットアップ完了！');
  console.log('ページアクセストークンは無期限です（アプリの再認可まで有効）');
}

main().catch((err) => {
  console.error(`❌ エラー: ${err.message}`);
  process.exit(1);
});
