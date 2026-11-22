/* =========================================================================
   リフィル・日数計算  core.js
   画面に依存しない計算部分：日付の整数化、祝日、休業日、リフィル処方箋の
   次回調剤予定日・調剤できる期間・来局日の判定、日数計算（2通りの数え方）。
   ブラウザでは window.RefillCore、Node（テスト）では module.exports。

   日付はすべて「1970-01-01 からの通算日数（整数）」で扱う。
   時刻やタイムゾーン、夏時間の影響を受けないようにするため。
   ========================================================================= */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RefillCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 制度の数値（根拠は画面の「根拠と注意」） ---------------- */
  const RULE = Object.freeze({
    FIRST_VALID_DAYS: 4,   // 1回目：交付の日を含めて4日以内（療担規則 第20条第3号ロ）
    WINDOW_DAYS: 7,        // 2回目以降：次回調剤予定日の前後7日以内（疑義解釈その1 問7）
    MAX_USES: 3            // 総使用回数の上限
  });

  const MIN_YEAR = 1900, MAX_YEAR = 2099;
  const HOLIDAY_MIN_YEAR = 2007, HOLIDAY_MAX_YEAR = 2099;   // 祝日を表示できる範囲（現行の祝日法の振替休日ルール以降）
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  /* ---------------- 日付の基本 ---------------- */
  function dn(y, m, d) { return Math.floor(Date.UTC(y, m - 1, d) / 86400000); }
  function parts(n) {
    const t = new Date(n * 86400000);
    return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate(), w: t.getUTCDay() };
  }
  function weekday(n) { return ((n % 7) + 7 + 4) % 7; }   // 1970-01-01 は木曜（4）
  function pad(v) { return (v < 10 ? '0' : '') + v; }
  function toISO(n) { const p = parts(n); return p.y + '-' + pad(p.m) + '-' + pad(p.d); }

  // "YYYY-MM-DD" を通算日数にする。存在しない日付・範囲外は null
  function parseISO(s) {
    if (typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (y < MIN_YEAR || y > MAX_YEAR || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const n = dn(y, mo, d);
    const p = parts(n);
    if (p.y !== y || p.m !== mo || p.d !== d) return null;   // 2月30日などを除く
    return n;
  }
  function inRange(n) { return typeof n === 'number' && isFinite(n) && n >= dn(MIN_YEAR, 1, 1) && n <= dn(MAX_YEAR, 12, 31); }

  // 日数の入力（全角数字も可）。min〜max の整数でなければ null
  function parseDays(s, min, max) {
    if (s === null || s === undefined) return null;
    let t = String(s).trim().replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); });
    t = t.replace(/日分?$/, '');
    if (!/^\d{1,5}$/.test(t)) return null;
    const v = parseInt(t, 10);
    if (v < min || v > max) return null;
    return v;
  }

  function todayLocal(now) {
    const t = now instanceof Date ? now : new Date();
    return dn(t.getFullYear(), t.getMonth() + 1, t.getDate());
  }

  /* ---------------- 和暦 ---------------- */
  const REIWA = dn(2019, 5, 1), HEISEI = dn(1989, 1, 8);
  function wareki(n) {
    const p = parts(n);
    let era, y;
    if (n >= REIWA) { era = '令和'; y = p.y - 2018; }
    else if (n >= HEISEI) { era = '平成'; y = p.y - 1988; }
    else return '';
    return era + (y === 1 ? '元' : y) + '年';
  }

  // 表示用：2026年12月20日（日）
  function fmtLong(n) { const p = parts(n); return p.y + '年' + p.m + '月' + p.d + '日（' + WEEK[p.w] + '）'; }
  // 表示用：12/20（日）
  function fmtShort(n) { const p = parts(n); return p.m + '/' + p.d + '（' + WEEK[p.w] + '）'; }

  /* ---------------- 祝日（国民の祝日に関する法律） ----------------
     2007年以降の規定で計算する。春分・秋分は毎年2月の官報で正式に決まるため、
     ここでは国立天文台の暦計算に基づく近似式（1980〜2099年）を使う。
     2026年・2027年は内閣府の公表と一致することを試験で確認している。 */
  function nthMonday(y, m, nth) {
    const first = dn(y, m, 1);
    const off = (1 - weekday(first) + 7) % 7;
    return first + off + (nth - 1) * 7;
  }
  function equinoxDay(y, base) {
    return Math.floor(base + 0.242194 * (y - 1980) - Math.floor((y - 1980) / 4));
  }
  function shunbun(y) { return dn(y, 3, equinoxDay(y, 20.8431)); }
  function shubun(y) { return dn(y, 9, equinoxDay(y, 23.2488)); }

  // その年の「国民の祝日」（振替休日・国民の休日を除く）
  function nationalHolidays(y) {
    const h = new Map();
    function add(n, name) { h.set(n, name); }
    add(dn(y, 1, 1), '元日');
    add(nthMonday(y, 1, 2), '成人の日');
    add(dn(y, 2, 11), '建国記念の日');
    if (y >= 2020) add(dn(y, 2, 23), '天皇誕生日');
    else if (y <= 2018) add(dn(y, 12, 23), '天皇誕生日');
    add(shunbun(y), '春分の日');
    add(dn(y, 4, 29), '昭和の日');
    add(dn(y, 5, 3), '憲法記念日');
    add(dn(y, 5, 4), 'みどりの日');
    add(dn(y, 5, 5), 'こどもの日');
    if (y === 2019) { add(dn(2019, 5, 1), '天皇の即位の日'); add(dn(2019, 10, 22), '即位礼正殿の儀の行われる日'); }
    // 東京オリンピック・パラリンピックに伴う移動（2020年・2021年）
    if (y === 2020) { add(dn(2020, 7, 23), '海の日'); add(dn(2020, 7, 24), 'スポーツの日'); add(dn(2020, 8, 10), '山の日'); }
    else if (y === 2021) { add(dn(2021, 7, 22), '海の日'); add(dn(2021, 7, 23), 'スポーツの日'); add(dn(2021, 8, 8), '山の日'); }
    else {
      add(nthMonday(y, 7, 3), '海の日');
      if (y >= 2016) add(dn(y, 8, 11), '山の日');
      add(nthMonday(y, 10, 2), y >= 2020 ? 'スポーツの日' : '体育の日');
    }
    add(nthMonday(y, 9, 3), '敬老の日');
    add(shubun(y), '秋分の日');
    add(dn(y, 11, 3), '文化の日');
    add(dn(y, 11, 23), '勤労感謝の日');
    return h;
  }

  const holidayCache = new Map();
  function holidaysOfYear(y) {
    if (holidayCache.has(y)) return holidayCache.get(y);
    const base = nationalHolidays(y);
    const all = new Map(base);
    // 振替休日：祝日が日曜日のとき、その後で最も近い「国民の祝日」でない日（祝日法 第3条第2項）
    base.forEach(function (name, n) {
      if (weekday(n) === 0) {
        let d = n + 1;
        while (base.has(d)) d++;
        if (!all.has(d)) all.set(d, '振替休日');
      }
    });
    // 国民の休日：前日と翌日がどちらも「国民の祝日」である日（同 第3条第3項）
    base.forEach(function (name, n) {
      const d = n + 1;
      if (!base.has(d) && base.has(d + 1) && !all.has(d)) all.set(d, '休日');
    });
    holidayCache.set(y, all);
    return all;
  }
  function holidaySupported(n) { const y = parts(n).y; return y >= HOLIDAY_MIN_YEAR && y <= HOLIDAY_MAX_YEAR; }
  function holidayName(n) {
    if (!holidaySupported(n)) return null;
    return holidaysOfYear(parts(n).y).get(n) || null;
  }

  /* ---------------- 休業日 ----------------
     settings = { weekdays:[日..土 の7つの真偽], holidays:祝日休み, yearEnd:年末年始（12/29〜1/3）休み } */
  function normalizeClosed(s) {
    const w = [false, false, false, false, false, false, false];
    if (s && Array.isArray(s.weekdays)) for (let i = 0; i < 7; i++) w[i] = s.weekdays[i] === true;
    return { weekdays: w, holidays: !!(s && s.holidays), yearEnd: !!(s && s.yearEnd) };
  }
  function isYearEnd(n) { const p = parts(n); return (p.m === 12 && p.d >= 29) || (p.m === 1 && p.d <= 3); }
  // 休業日なら理由（文字列）、営業日なら null
  function closedReason(n, settings) {
    const s = normalizeClosed(settings);
    const reasons = [];
    if (s.weekdays[weekday(n)]) reasons.push(WEEK[weekday(n)] + '曜定休');
    if (s.holidays) { const h = holidayName(n); if (h) reasons.push(h); }
    if (s.yearEnd && isYearEnd(n)) reasons.push('年末年始');
    return reasons.length ? reasons.join('・') : null;
  }
  function anyClosedSetting(settings) {
    const s = normalizeClosed(settings);
    return s.holidays || s.yearEnd || s.weekdays.some(Boolean);
  }
  // from〜to（両端を含む）の営業日
  function openDays(from, to, settings) {
    const out = [];
    for (let n = from; n <= to; n++) if (!closedReason(n, settings)) out.push(n);
    return out;
  }

  /* ---------------- リフィル処方箋 ---------------- */
  // 1回目：処方箋の使用期間（交付の日を含めて4日以内。使用期間の記載があればその日まで）
  function firstDeadline(issue, statedLimit) {
    if (inRange(statedLimit)) return { last: statedLimit, stated: true };
    return { last: issue + RULE.FIRST_VALID_DAYS - 1, stated: false };
  }
  // 次回調剤予定日：前回の調剤日を起点とし、投薬期間を経過する日（＝前回調剤日＋投薬日数）
  function nextScheduled(prevDispense, days) { return prevDispense + days; }
  // 調剤できる期間：次回調剤予定日の前後7日（予定日を含めて15日間）
  function refillWindow(scheduled) {
    return { from: scheduled - RULE.WINDOW_DAYS, to: scheduled + RULE.WINDOW_DAYS, scheduled: scheduled };
  }
  // 来局日の判定
  function judgeVisit(visit, scheduled) {
    const w = refillWindow(scheduled);
    if (visit < w.from) return { status: 'early', window: w, wait: w.from - visit, offset: visit - scheduled };
    if (visit > w.to) return { status: 'late', window: w, over: visit - w.to, offset: visit - scheduled };
    return { status: 'ok', window: w, offset: visit - scheduled, left: w.to - visit };
  }
  // 1回目の判定
  function judgeFirst(dispense, issue, statedLimit) {
    const dl = firstDeadline(issue, statedLimit);
    if (dispense < issue) return { status: 'before', deadline: dl };
    if (dispense > dl.last) return { status: 'late', deadline: dl, over: dispense - dl.last };
    return { status: 'ok', deadline: dl, left: dl.last - dispense };
  }
  /* 全体の予定：今回（current 回目）を date に調剤し、以後は毎回「予定日どおり」に
     調剤したと仮定して、残りの回の予定日・期間と、最後の分の投薬期間が経過する日を出す。
     earliest/latest は、前の回を期間の最初の日／最後の日に調剤した場合の幅。 */
  function plan(date, days, current, uses) {
    const rows = [{ k: current, date: date, kind: 'this' }];
    let sched = date, early = date, late = date;
    for (let k = current + 1; k <= uses; k++) {
      sched = sched + days;
      early = early + days - RULE.WINDOW_DAYS;
      late = late + days + RULE.WINDOW_DAYS;
      rows.push({ k: k, kind: 'next', scheduled: sched, window: refillWindow(sched), earliest: early, latest: late });
    }
    // 最後の回の分の投薬期間が経過する日（受診の目安）
    const endSched = sched + days;
    return { rows: rows, end: { scheduled: endSched, earliest: early + days, latest: late + days } };
  }

  /* ---------------- 日数計算 ---------------- */
  // 2つの日付の間：差（初日を含めない）と、両端を含めた日数
  function between(a, b) {
    const diff = b - a;
    return { diff: diff, abs: Math.abs(diff), inclusive: Math.abs(diff) + 1, reversed: diff < 0 };
  }
  // N日後：翌日を1日目として N日目（＝基準日＋N）／当日を1日目として N日目（＝基準日＋N−1）
  function after(base, k) { return { plain: base + k, countToday: base + k - 1 }; }
  // N日前：基準日−N／当日を1日目として遡って N日目（＝基準日−N＋1）
  function before(base, k) { return { plain: base - k, countToday: base - k + 1 }; }
  function weeksDays(k) { return { w: Math.floor(k / 7), d: k % 7 }; }

  return {
    RULE: RULE, WEEK: WEEK, MIN_YEAR: MIN_YEAR, MAX_YEAR: MAX_YEAR,
    HOLIDAY_MIN_YEAR: HOLIDAY_MIN_YEAR, HOLIDAY_MAX_YEAR: HOLIDAY_MAX_YEAR,
    dn: dn, parts: parts, weekday: weekday, toISO: toISO, parseISO: parseISO, parseDays: parseDays, inRange: inRange,
    todayLocal: todayLocal, wareki: wareki, fmtLong: fmtLong, fmtShort: fmtShort,
    holidayName: holidayName, holidaysOfYear: holidaysOfYear, holidaySupported: holidaySupported, shunbun: shunbun, shubun: shubun,
    normalizeClosed: normalizeClosed, closedReason: closedReason, anyClosedSetting: anyClosedSetting, openDays: openDays, isYearEnd: isYearEnd,
    firstDeadline: firstDeadline, nextScheduled: nextScheduled, refillWindow: refillWindow, judgeVisit: judgeVisit, judgeFirst: judgeFirst, plan: plan,
    between: between, after: after, before: before, weeksDays: weeksDays
  };
});
