/**
 * Prompt templates for Gemini AI processing
 */

export const EVENT_DETECTION_PROMPT = (caption) => `
あなたはSNS投稿のイベント判定AIです。
以下のInstagram投稿がマルシェ・イベント・フェスティバルの告知かどうかを判定してください。

## 投稿テキスト
${caption}

## 判定基準
- マルシェ、イベント、フェスティバル、祭り、ワークショップ、展示会、即売会、フリマなどの告知
- 過去のイベントの「レポート」ではなく、これから開催される「告知」であること
- 個人の日常投稿は除外

## 出力（JSON）
{
  "is_event": true/false,
  "confidence": "high"/"medium"/"low",
  "event_type": "告知"/"レポート"/"その他",
  "reason": "判定理由"
}
`;

export const EVENT_EXTRACTION_PROMPT = (text, source) => `
あなたはイベント情報構造化AIです。
以下の${source}から取得したテキストからイベント情報を抽出してください。

## テキスト
${text}

## 抽出するフィールド
必ず以下のJSON形式で出力してください。情報がない場合は空文字""にしてください。

{
  "title": "イベント名",
  "date": "YYYY-MM-DD形式（範囲の場合は開始日）",
  "dateEnd": "YYYY-MM-DD形式（範囲の場合の終了日、単日なら空文字）",
  "dayOfWeek": "月/火/水/木/金/土/日",
  "time": "HH:MM-HH:MM形式（例: 10:00-16:00）",
  "location": "会場名",
  "address": "住所（山口県を含む完全な住所）",
  "area": "最も近い市区名（周南市/下松市/光市/山口市/防府市/下関市/岩国市/萩市/長門市/宇部市/美祢市/柳井市のいずれか）",
  "description": "イベント概要（200文字以内）",
  "fee": "料金情報",
  "exhibitors": [
    {
      "name": "店舗名・屋号（必ず固有名詞。「お菓子」「パン」等のカテゴリ名は不可）",
      "category": "カテゴリ（コーヒー/パン/焼き菓子/雑貨/アクセサリー/飲食/物販/ワークショップ等）",
      "instagram": "@アカウント名（あれば）",
      "description": "出展内容の説明（何を売る・提供するか）",
      "menu": [
        { "name": "商品名", "price": "¥000" }
      ]
    }
  ]
}

## 注意
- 年が明記されていない場合、2026年と推定してください
- 住所は山口県を含むフル住所で
- exhibitorsは投稿内に出展者情報がある場合のみ。なければ空配列[]
- exhibitors.nameは必ず店舗名・屋号・個人名（固有名詞）を入れること。「お菓子」「子供服」「ワークショップ」等のカテゴリ名や一般名詞は不可。名前が不明な出展者はスキップ
- exhibitors.menuは具体的なメニュー名と価格がわかる場合のみ。不明なら空配列[]
`;

export const DEDUP_PROMPT = (event1, event2) => `
あなたは重複イベント判定AIです。
以下の2つのイベント情報が同一イベントかどうか判定してください。

## イベント1
${JSON.stringify(event1, null, 2)}

## イベント2
${JSON.stringify(event2, null, 2)}

## 出力（JSON）
{
  "is_duplicate": true/false,
  "confidence": "high"/"medium"/"low",
  "reason": "判定理由",
  "merged": { /* is_duplicate=trueの場合、両方の情報を統合したベスト版 */ }
}
`;

export const SITE_EXTRACTION_PROMPT = (rawData, source) => `
あなたはイベント情報構造化AIです。
以下は「${source}」から取得したイベント情報の生データです。構造化してください。

## 生データ
タイトル: ${rawData.title || ''}
カテゴリ: ${rawData.category || ''}
日付: ${rawData.dateRaw || ''}
会場: ${rawData.locationName || ''}
住所: ${rawData.address || ''}
料金: ${rawData.fee || ''}
説明: ${rawData.description || ''}

## 出力（JSON）
{
  "title": "イベント名",
  "date": "YYYY-MM-DD形式（開始日）",
  "dateEnd": "YYYY-MM-DD形式（終了日、単日なら空文字）",
  "dayOfWeek": "月/火/水/木/金/土/日",
  "time": "HH:MM-HH:MM形式",
  "location": "会場名",
  "address": "山口県を含む完全な住所",
  "area": "最も近い市区名（周南市/下松市/光市/山口市/防府市/下関市/岩国市/萩市/長門市/宇部市/美祢市/柳井市のいずれか）",
  "description": "イベント概要（200文字以内）",
  "fee": "料金情報"
}

## 注意
- 年が明記されていない場合、2026年と推定
- 日付範囲の場合はdateに開始日、dateEndに終了日
- 時間情報がない場合は空文字
`;
