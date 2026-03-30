/**
 * ig-event-selector.js — IG投稿イベント選定アルゴリズム
 *
 * スコアリングで投稿対象を選定:
 *   - メイン1件 → フィード（カルーセル）またはリール
 *   - ストーリーズ3件 → メインとは別のイベント
 *
 * スコア要素:
 *   - 日付近接度（今日/明日 +100、3日以内 +80、1週間以内 +60）
 *   - 出展者数（×5, 上限30）
 *   - IG付き出展者数（×3、メンション可能）
 *   - 週末イベント（+10）
 *   - 未投稿（+20）
 *   - 片方のみ投稿済み（+15）
 *   - 画像あり（+15）
 */

/**
 * イベントのスコアを計算
 */
function scoreEvent(event, eventExhibitors, igPosted, imageLinks, today) {
  let score = 0;

  // 日付近接度
  if (event.date) {
    const eventDate = new Date(event.date);
    const daysUntil = Math.floor((eventDate - today) / (24 * 60 * 60 * 1000));

    if (daysUntil >= 0 && daysUntil <= 1) score += 100;
    else if (daysUntil >= 2 && daysUntil <= 3) score += 80;
    else if (daysUntil >= 4 && daysUntil <= 7) score += 60;
    else if (daysUntil >= 8 && daysUntil <= 14) score += 40;
    else if (daysUntil > 14) score += 20;
    else return -1; // 過去のイベントは除外
  }

  // 出展者数（×5, 上限30）
  score += Math.min(eventExhibitors.length * 5, 30);

  // IG付き出展者数（×3）
  const igExhibitors = eventExhibitors.filter((ex) => ex.instagram);
  score += igExhibitors.length * 3;

  // 週末イベント
  if (event.date) {
    const dow = new Date(event.date).getDay();
    if (dow === 0 || dow === 6) score += 10;
  }

  // 投稿履歴
  const posted = igPosted[event.id];
  if (!posted) {
    score += 20; // 完全未投稿
  } else if (!posted.story || !posted.feed) {
    score += 15; // 片方のみ
  } else {
    score -= 50; // 両方投稿済み → 大幅減点
  }

  // 画像あり
  const images = imageLinks[event.id];
  if (images && images.length > 0) {
    score += 15;
  }

  return score;
}

/**
 * 投稿対象イベントを選定
 * @returns {{ mainEvent, mainExhibitors, mainScore, storyEvents: [{event, exhibitors, score}] }}
 */
export function selectEventsForPosting(events, exhibitors, igPosted = {}, imageLinks = {}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 出展者マップ
  const exhibitorMap = new Map();
  for (const ex of exhibitors) {
    exhibitorMap.set(ex.id, ex);
  }

  // 承認済み＆未来のイベントをフィルタ
  const candidates = events.filter((e) => {
    if (e.status && e.status !== 'approved') return false;
    if (!e.date) return false;
    const eventDate = new Date(e.date);
    return eventDate >= today;
  });

  // 各イベントにスコアを付与
  const scored = candidates.map((event) => {
    let exIds = [];
    try {
      exIds = JSON.parse(event.exhibitorIds || '[]');
    } catch {
      exIds = [];
    }
    const eventExhibitors = exIds.map((id) => exhibitorMap.get(id)).filter(Boolean);
    const score = scoreEvent(event, eventExhibitors, igPosted, imageLinks, today);

    return { event, exhibitors: eventExhibitors, score };
  });

  // スコア降順でソート（同点は日付昇順）
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.event.date) - new Date(b.event.date);
  });

  // 除外: スコアが負のもの
  const valid = scored.filter((s) => s.score > 0);

  if (valid.length === 0) {
    return { mainEvent: null, storyEvents: [] };
  }

  // メイン: 画像ありを優先（カルーセル/リール映え）
  const mainCandidate = valid.find((s) => {
    const images = imageLinks[s.event.id];
    return images && images.length > 0;
  }) || valid[0];

  // ストーリーズ: メインとは別のイベントから最大3件
  const storyCandidates = valid
    .filter((s) => s.event.id !== mainCandidate.event.id)
    .slice(0, 3);

  return {
    mainEvent: mainCandidate.event,
    mainExhibitors: mainCandidate.exhibitors,
    mainScore: mainCandidate.score,
    storyEvents: storyCandidates.map((s) => ({
      event: s.event,
      exhibitors: s.exhibitors,
      score: s.score,
    })),
  };
}
