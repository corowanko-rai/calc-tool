/* =========================================================================
   リフィル・日数計算  app.js（画面）
   画面への文字の書き込みはすべて textContent / DOM API で行う（innerHTMLは使わない）。
   入力した日付は保存しない。保存するのは休業日の設定と、開いていたタブだけ。
   ========================================================================= */
(function () {
  'use strict';
  const C = window.RefillCore;
  const STORE_KEY = 'calcTool.refill.v1';
  const DAY_CHIPS = [14, 28, 30, 56, 60, 84, 90];
  const SHIFT_CHIPS = [7, 14, 28, 30, 56, 60, 84, 90];
  const MAX_RX_DAYS = 365;      // 1回分の投薬日数として受け付ける上限
  const MAX_SHIFT = 36500;      // 日数計算で受け付ける上限

  const $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function add(parent) { for (let i = 1; i < arguments.length; i++) if (arguments[i]) parent.appendChild(arguments[i]); return parent; }

  /* ---------------- 保存（休業日とタブだけ） ---------------- */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* 保存できなくても計算は動く */ } }
  function load() {
    let s = null;
    try { s = JSON.parse(lsGet(STORE_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = {};
    return { tab: s.tab === 'days' ? 'days' : 'refill', closed: C.normalizeClosed(s.closed) };
  }
  const saved = load();
  const state = {
    tab: saved.tab,
    closed: saved.closed,
    uses: 3,
    turn: 1,
    src: 'written',
    mode: 'after'
  };
  function save() { lsSet(STORE_KEY, JSON.stringify({ tab: state.tab, closed: state.closed })); }

  /* ---------------- 入力の読み取り ---------------- */
  function today() { return C.todayLocal(new Date()); }
  function readDate(id) {
    const inp = $(id);
    const raw = inp.value;
    const n = raw ? C.parseISO(raw) : null;
    inp.classList.toggle('bad', !!raw && n === null);
    return n;
  }
  function readDays(id, min, max) {
    const inp = $(id);
    const raw = inp.value.trim();
    const v = raw ? C.parseDays(raw, min, max) : null;
    inp.classList.toggle('bad', !!raw && v === null);
    return v;
  }

  /* ---------------- 表示部品 ---------------- */
  function hasClosed() { return C.anyClosedSetting(state.closed); }
  function badges(n, wrap) {
    const h = C.holidayName(n);
    const cr = hasClosed() ? C.closedReason(n, state.closed) : null;
    if (cr) wrap.appendChild(el('span', 'badge closed', '休業 ' + cr));
    else if (h) wrap.appendChild(el('span', 'badge hol', h));
  }
  function dateText(n) {
    if (!C.inRange(n)) return '範囲外（1900〜2099年）';
    return C.fmtLong(n);
  }
  function subText(n) {
    if (!C.inRange(n)) return '';
    return C.wareki(n);
  }
  function kv(k, v, small) {
    const row = el('div', 'kv');
    row.appendChild(el('div', 'k', k));
    const val = el('div', 'v');
    if (typeof v === 'string') val.textContent = v; else val.appendChild(v);
    if (small) val.appendChild(el('small', null, small));
    row.appendChild(val);
    return row;
  }
  function dateNode(n) {
    const s = el('span', null, dateText(n));
    if (C.inRange(n)) badges(n, s);
    return s;
  }
  function bigBox(k, n, s) {
    const b = el('div', 'big');
    b.appendChild(el('div', 'k', k));
    const v = el('div', 'v', dateText(n));
    b.appendChild(v);
    const line = el('div', 's', [subText(n), s].filter(Boolean).join(' ／ '));
    if (C.inRange(n)) badges(n, line);
    b.appendChild(line);
    return b;
  }
  function verdict(kind, title, detail) {
    const v = el('div', 'verdict ' + kind);
    v.setAttribute('role', 'status');
    v.appendChild(el('div', 't', title));
    if (detail) v.appendChild(el('div', 'd', detail));
    return v;
  }
  function placeholder(text) {
    const c = el('div', 'card');
    c.appendChild(el('div', 'hint', text));
    return c;
  }
  function range(a, b) { return C.fmtShort(a) + ' 〜 ' + C.fmtShort(b); }
  function offsetText(off, sched) {
    if (off === 0) return '予定日 ' + C.fmtShort(sched) + ' の当日';
    return '予定日 ' + C.fmtShort(sched) + ' の' + Math.abs(off) + '日' + (off < 0 ? '前' : '後');
  }

  // 期間のカレンダー（週ごと、日曜はじまり）
  function calendar(from, to, marks) {
    const wrap = el('div');
    const grid = el('div', 'cal');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', '調剤できる期間のカレンダー');
    C.WEEK.forEach(function (w, i) { grid.appendChild(el('div', 'h' + (i === 0 ? ' sun' : i === 6 ? ' sat' : ''), w)); });
    const start = from - C.weekday(from);
    const end = to + (6 - C.weekday(to));
    const lo = Math.min(start, marks.visit !== undefined ? marks.visit - C.weekday(marks.visit) : start);
    const hi = Math.max(end, marks.visit !== undefined ? marks.visit + (6 - C.weekday(marks.visit)) : end);
    // 来局日が期間から大きく離れているときは、カレンダーを広げない（期間の周りだけ）
    const s0 = (hi - lo) <= 42 ? lo : start, s1 = (hi - lo) <= 42 ? hi : end;
    let prevMonth = -1;
    for (let n = s0; n <= s1; n++) {
      const p = C.parts(n);
      const inWin = n >= from && n <= to;
      const hol = C.holidayName(n);
      const cr = hasClosed() ? C.closedReason(n, state.closed) : null;
      let cls = 'c';
      if (inWin) cls += ' in';
      if (p.w === 0) cls += ' sun'; else if (p.w === 6) cls += ' sat';
      if (hol) cls += ' hol';
      if (inWin && cr) cls += ' closed';
      if (n === marks.sched) cls += ' sched';
      if (n === marks.visit) cls += ' visit' + (marks.visitBad ? ' bad' : '');
      const c = el('div', cls);
      c.setAttribute('role', 'gridcell');
      const label = [C.fmtLong(n)];
      if (n === marks.sched) label.push('次回調剤予定日');
      if (n === marks.visit) label.push('来局日');
      if (hol) label.push(hol);
      if (cr) label.push('休業日');
      label.push(inWin ? '期間内' : '期間外');
      c.setAttribute('aria-label', label.join('、'));
      if (p.m !== prevMonth || p.d === 1) { c.appendChild(el('span', 'm', p.m + '月')); prevMonth = p.m; }
      c.appendChild(document.createTextNode(String(p.d)));
      let tag = '';
      if (n === marks.sched) tag = '予定';
      else if (n === marks.visit) tag = '来局';
      else if (inWin && cr) tag = '休';
      else if (hol) tag = '祝';
      if (n === marks.sched && n === marks.visit) tag = '予定・来局';
      if (tag) c.appendChild(el('span', 'l', tag));
      grid.appendChild(c);
    }
    wrap.appendChild(grid);
    const lg = el('div', 'legend');
    function item(cls, text) { const s = el('span'); s.appendChild(el('i', cls)); s.appendChild(document.createTextNode(text)); return s; }
    add(lg, item('lg-in', '調剤できる期間'), item('lg-s', '次回調剤予定日'));
    if (marks.visit !== undefined) lg.appendChild(item('lg-v', '来局日'));
    if (hasClosed()) lg.appendChild(item('lg-c', '休業日'));
    wrap.appendChild(lg);
    return wrap;
  }

  // 期間内の休業日のまとめ
  function closedSummary(from, to) {
    const frag = document.createDocumentFragment();
    if (!hasClosed()) return frag;
    const open = C.openDays(from, to, state.closed);
    if (open.length === 0) {
      frag.appendChild(el('div', 'note warn', '期間内に営業日がありません。休業日の設定を確かめてください。'));
      return frag;
    }
    frag.appendChild(kv('来局できる日', open.length + '日（休業日を除く）', '最初 ' + C.fmtShort(open[0]) + ' ／ 最後 ' + C.fmtShort(open[open.length - 1])));
    const closedList = [];
    for (let n = from; n <= to; n++) { const r = C.closedReason(n, state.closed); if (r) closedList.push(C.fmtShort(n) + ' ' + r); }
    if (C.closedReason(to, state.closed)) {
      frag.appendChild(el('div', 'note warn', '期間の最後の日（' + C.fmtShort(to) + '）は休業日です。この薬局で受け付けられる最後の日は ' + C.fmtShort(open[open.length - 1]) + ' です。'));
    }
    if (closedList.length) frag.appendChild(el('div', 'hint', '期間内の休業日：' + closedList.join('、')));
    return frag;
  }

  // 全体の予定の表
  function planTable(date, days, current, uses) {
    const p = C.plan(date, days, current, uses);
    const card = el('div', 'card');
    card.appendChild(el('span', 'section-label', '全体の予定（総使用回数 ' + uses + '回）'));
    const t = el('table', 'plan');
    const head = el('tr');
    add(head, el('th', null, '回'), el('th', null, '次回調剤予定日'), el('th', null, '調剤できる期間'));
    const thead = el('thead'); thead.appendChild(head); t.appendChild(thead);
    const tb = el('tbody');
    p.rows.forEach(function (r, i) {
      const tr = el('tr');
      tr.appendChild(el('td', 'k', r.k + '回目'));
      if (r.kind === 'this') {
        const td = el('td', null, C.fmtShort(r.date));
        td.appendChild(el('small', null, current === 1 ? '今回の調剤日' : '今回の調剤日（来局日）'));
        tr.appendChild(td);
        tr.appendChild(el('td', null, '—'));
      } else {
        const td = el('td', null, C.fmtShort(r.scheduled));
        if (i >= 2) td.appendChild(el('small', null, '前の回を予定日どおりに調剤した場合'));
        tr.appendChild(td);
        const tw = el('td', null, range(r.window.from, r.window.to));
        if (i >= 2) tw.appendChild(el('small', null, '前の回の調剤日により、調剤できる日は ' + range(r.earliest, r.latest) + ' の間で変わります'));
        tr.appendChild(tw);
      }
      tb.appendChild(tr);
    });
    const tr = el('tr', 'end');
    tr.appendChild(el('td', 'k', '終了'));
    const td = el('td', null, C.fmtShort(p.end.scheduled));
    td.appendChild(el('small', null, '最後の分の投薬期間が経過する日（受診の目安）'));
    tr.appendChild(td);
    const te = el('td');
    if (p.end.earliest !== p.end.latest) te.appendChild(el('small', null, '前の回の調剤日により ' + range(p.end.earliest, p.end.latest) + ' の間で変わります'));
    else te.textContent = '—';
    tr.appendChild(te);
    tb.appendChild(tr);
    t.appendChild(tb);
    card.appendChild(t);
    return card;
  }

  // 次回調剤予定日のカード（今回の調剤日 date に days 日分を出したとき）
  function nextCard(date, days, title) {
    const sched = C.nextScheduled(date, days);
    const w = C.refillWindow(sched);
    const card = el('div', 'card out-card');
    if (title) card.appendChild(el('span', 'section-label', title));
    card.appendChild(bigBox('次回調剤予定日（処方箋に記載する日）', sched, C.fmtShort(date) + ' ＋ ' + days + '日'));
    card.appendChild(kv('調剤できる期間', range(w.from, w.to), '予定日の前後7日（予定日を含めて15日間）'));
    card.appendChild(closedSummary(w.from, w.to));
    card.appendChild(calendar(w.from, w.to, { sched: sched }));
    return card;
  }

  /* ---------------- リフィル：1回目 ---------------- */
  function renderFirst(out) {
    const date = readDate('f1Date');
    const days = readDays('f1Days', 1, MAX_RX_DAYS);
    const issue = readDate('f1IssueDate');
    const limit = readDate('f1Limit');
    if (date === null || days === null) {
      out.appendChild(placeholder('調剤日と投薬日数（1回分）を入れると、処方箋に記載する次回調剤予定日と、2回目に調剤できる期間を表示します。'));
      if (date !== null && issue !== null) out.appendChild(firstCheckCard(date, issue, limit));
      return;
    }
    if (issue !== null) out.appendChild(firstCheckCard(date, issue, limit));
    out.appendChild(nextCard(date, days, '2回目'));
    out.appendChild(planTable(date, days, 1, state.uses));
  }
  function firstCheckCard(date, issue, limit) {
    const card = el('div', 'card');
    card.appendChild(el('span', 'section-label', '処方箋の使用期間（1回目）'));
    const j = C.judgeFirst(date, issue, limit);
    const lastTxt = C.fmtShort(j.deadline.last) + (j.deadline.stated ? '（使用期間の記載）' : '（交付日を含めて4日目）');
    if (j.status === 'ok') {
      card.appendChild(verdict('ok', '使用期間内です', '期限は ' + lastTxt + ' まで' + (j.left > 0 ? '（あと' + j.left + '日）' : '（調剤日が最後の日）') + '。'));
    } else if (j.status === 'late') {
      card.appendChild(verdict('late', '使用期間を過ぎています', '期限は ' + lastTxt + ' まででした（' + j.over + '日超過）。この処方箋では調剤できません。'));
    } else {
      card.appendChild(verdict('early', '調剤日が交付日より前です', '日付を確かめてください。'));
    }
    if (!j.deadline.stated) card.appendChild(el('div', 'hint', '4日には休日も含めて数えます。'));
    return card;
  }

  /* ---------------- リフィル：2回目以降 ---------------- */
  function renderLater(out) {
    const last = state.turn === state.uses;
    let sched = null, basis = '';
    if (state.src === 'written') {
      sched = readDate('lSched');
    } else {
      const prev = readDate('lPrev');
      const pd = readDays('lPrevDays', 1, MAX_RX_DAYS);
      if (prev !== null && pd !== null) { sched = C.nextScheduled(prev, pd); basis = '前回 ' + C.fmtShort(prev) + ' ＋ ' + pd + '日'; }
    }
    const visit = readDate('lVisit');
    const days = readDays('lDays', 1, MAX_RX_DAYS);

    if (sched === null || visit === null) {
      out.appendChild(placeholder(state.src === 'written'
        ? '処方箋に記載された次回調剤予定日と来局日を入れると、調剤できるかを判定します。'
        : '前回調剤日・前回の投薬日数・来局日を入れると、調剤できるかを判定します。'));
      return;
    }
    const j = C.judgeVisit(visit, sched);
    const w = j.window;
    const card = el('div', 'card');
    card.appendChild(el('span', 'section-label', state.turn + '回目の受付'));
    if (j.status === 'ok') {
      card.appendChild(verdict('ok', '調剤できます',
        offsetText(j.offset, sched) + '。期間は ' + C.fmtShort(w.to) + ' まで' + (j.left > 0 ? '（あと' + j.left + '日）' : '（来局日が期間の最後の日）') + '。'));
    } else if (j.status === 'early') {
      let d = '調剤できるのは ' + C.fmtShort(w.from) + ' から（あと' + j.wait + '日）。期間より前の来局は、再来局をお願いします。';
      if (hasClosed()) {
        const open = C.openDays(w.from, w.to, state.closed);
        if (open.length && open[0] !== w.from) d += 'この薬局で受け付けられる最初の日は ' + C.fmtShort(open[0]) + ' です。';
      }
      card.appendChild(verdict('early', 'まだ調剤できません', d));
    } else {
      card.appendChild(verdict('late', '期間を過ぎています',
        '期間は ' + C.fmtShort(w.to) + ' まででした（' + j.over + '日超過）。このリフィル処方箋では調剤できません。受診を勧め、必要に応じて処方医に情報提供します。'));
    }
    card.appendChild(kv(state.src === 'written' ? '記載の予定日' : '次回調剤予定日', dateNode(sched), basis || null));
    card.appendChild(kv('調剤できる期間', range(w.from, w.to), '予定日の前後7日（予定日を含めて15日間）'));
    card.appendChild(closedSummary(w.from, w.to));
    card.appendChild(calendar(w.from, w.to, { sched: sched, visit: visit, visitBad: j.status !== 'ok' }));
    if (Math.abs(visit - sched) > 60) card.appendChild(el('div', 'note warn', '来局日と予定日が' + Math.abs(visit - sched) + '日離れています。入力した日付を確かめてください。'));
    out.appendChild(card);

    if (j.status !== 'ok') return;
    if (days === null) {
      out.appendChild(placeholder(last
        ? '今回の投薬日数を入れると、この分の投薬期間が経過する日（受診の目安）を表示します。'
        : '今回の投薬日数を入れると、処方箋に記載する次回調剤予定日を表示します。'));
      return;
    }
    if (!last) {
      out.appendChild(nextCard(visit, days, (state.turn + 1) + '回目'));
      out.appendChild(planTable(visit, days, state.turn, state.uses));
    } else {
      const c = el('div', 'card out-card');
      c.appendChild(el('span', 'section-label', '最終回（' + state.uses + '回目）'));
      c.appendChild(bigBox('この分の投薬期間が経過する日（受診の目安）', C.nextScheduled(visit, days), C.fmtShort(visit) + ' ＋ ' + days + '日'));
      c.appendChild(el('div', 'note', '最後の調剤です。次回調剤予定日は書きません。調剤後は、処方箋を調剤済処方箋として保管します。'));
      out.appendChild(c);
    }
  }

  function renderRefill() {
    const out = $('refillOut');
    out.replaceChildren();
    $('firstCard').hidden = state.turn !== 1;
    $('laterCard').hidden = state.turn === 1;
    const last = state.turn === state.uses;
    $('laterLabel').textContent = state.turn + '回目の調剤' + (last ? '（最終回）' : '');
    $('lDaysHint').textContent = last
      ? 'この分の投薬期間が経過する日（受診の目安）の計算に使います。'
      : '次の予定日と、最後の分の投薬期間が経過する日の計算に使います。';
    $('srcWritten').hidden = state.src !== 'written';
    $('srcCalc').hidden = state.src !== 'calc';
    if (state.turn === 1) renderFirst(out); else renderLater(out);
  }

  /* ---------------- 日数計算 ---------------- */
  function pairBox(main, k, n, s) {
    const p = el('div', 'p' + (main ? ' main' : ''));
    p.appendChild(el('div', 'k', k));
    p.appendChild(el('div', 'v', dateText(n)));
    const line = el('div', 's', [subText(n), s].filter(Boolean).join(' ／ '));
    if (C.inRange(n)) badges(n, line);
    p.appendChild(line);
    return p;
  }
  function renderDays() {
    const out = $('daysOut');
    out.replaceChildren();
    $('modeBetween').hidden = state.mode !== 'between';
    $('modeShift').hidden = state.mode === 'between';
    if (state.mode === 'between') {
      const a = readDate('dFrom'), b = readDate('dTo');
      if (a === null || b === null) { out.appendChild(placeholder('開始日と終了日を入れると、間の日数を2通りの数え方で表示します。')); return; }
      const r = C.between(a, b);
      const card = el('div', 'card out-card');
      const pair = el('div', 'pair');
      const p1 = el('div', 'p main');
      add(p1, el('div', 'k', '両端を含める（開始日を1日目）'), el('div', 'v', r.inclusive + '日'), el('div', 's', '「〇日分」として数えるとき。例：4/1〜4/30 は30日分'));
      const p2 = el('div', 'p');
      add(p2, el('div', 'k', '差（開始日を含めない）'), el('div', 'v', r.abs + '日'), el('div', 's', '終了日は開始日の' + r.abs + '日' + (r.reversed ? '前' : '後')));
      add(pair, p1, p2);
      card.appendChild(pair);
      if (r.reversed) card.appendChild(el('div', 'note warn', '終了日が開始日より前です。日数は前後を入れ替えて数えています。'));
      const wd = C.weeksDays(r.abs);
      card.appendChild(kv('差を週で', wd.w + '週' + (wd.d ? 'と' + wd.d + '日' : 'ちょうど')));
      card.appendChild(kv('開始日', dateNode(a)));
      card.appendChild(kv('終了日', dateNode(b)));
      if (hasClosed()) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        card.appendChild(kv('来局できる日', C.openDays(lo, hi, state.closed).length + '日', '両端を含め、休業日を除いた日数'));
      }
      out.appendChild(card);
      return;
    }
    const base = readDate('dBase');
    const k = readDays('dN', 1, MAX_SHIFT);
    if (base === null || k === null) { out.appendChild(placeholder('基準日と日数を入れると、日付を2通りの数え方で表示します。')); return; }
    const card = el('div', 'card out-card');
    const pair = el('div', 'pair');
    let ruler;
    if (state.mode === 'after') {
      const r = C.after(base, k);
      add(pair,
        pairBox(true, k + '日後（翌日を1日目）', r.plain, '基準日＋' + k + '日。リフィルの次回調剤予定日と同じ数え方'),
        pairBox(false, '当日を1日目として ' + k + '日目', r.countToday, '例：当日から飲み始めた ' + k + '日分の最後の日'));
      ruler = '基準日 ' + C.fmtShort(base) + ' を0日目 → ' + (C.inRange(r.plain) ? C.fmtShort(r.plain) : '…') + ' が' + k + '日目';
    } else {
      const r = C.before(base, k);
      add(pair,
        pairBox(true, k + '日前', r.plain, '基準日−' + k + '日'),
        pairBox(false, '当日を1日目として遡って ' + k + '日目', r.countToday, '例：当日までの ' + k + '日間の最初の日'));
      ruler = (C.inRange(r.plain) ? C.fmtShort(r.plain) : '…') + ' から ' + k + '日後が 基準日 ' + C.fmtShort(base);
    }
    card.appendChild(pair);
    card.appendChild(el('div', 'ruler', ruler));
    card.appendChild(kv('基準日', dateNode(base)));
    out.appendChild(card);
  }

  /* ---------------- 根拠と注意の図 ----------------
     1回目の調剤日・投薬日数が入っていればその日付で、なければ「今日に28日分」の例で描く。
     SVG も createElementNS で組み立てる（innerHTML は使わない）。 */
  const SVGNS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, text) {
    const e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  function md(n) { const p = C.parts(n); return p.m + '/' + p.d; }
  function svgRoot(h, label) {
    const r = sv('svg', { viewBox: '0 0 340 ' + h, role: 'img', 'aria-label': label });
    r.appendChild(sv('title', null, label));
    return r;
  }
  function txt(x, y, cls, t, anchor) {
    return sv('text', { x: x, y: y, class: cls, 'text-anchor': anchor || 'middle', 'dominant-baseline': 'central' }, t);
  }
  function bracket(x1, x2, y, up) {
    const d = up ? 4 : -4;   // up: 端が下向き（上に括弧）
    return sv('path', { class: 'br', d: 'M' + x1 + ' ' + (y + d) + ' L' + x1 + ' ' + y + ' L' + x2 + ' ' + y + ' L' + x2 + ' ' + (y + d) });
  }

  // 図1：日付の数え方（調剤日＝0日目 … N日目＝次回調剤予定日）
  function figCount(date, N) {
    const svg = svgRoot(246, md(date) + 'に' + N + '日分を調剤したときの日付の数え方。' + md(date + N) + 'が次回調剤予定日');
    svg.appendChild(txt(20, 16, 'fs', '調剤日を0日目、翌日を1日目と数える', 'start'));
    const slots = N <= 7 ? Array.from({ length: N + 1 }, function (_, i) { return i; }) : [0, 1, 2, 3, null, N - 2, N - 1, N];
    const W = 34, S = slots.length;
    const gap = S > 1 ? (300 - S * W) / (S - 1) : 0;
    const xOf = {};
    slots.forEach(function (k, i) {
      const x = 20 + i * (W + gap);
      if (k === null) { svg.appendChild(txt(x + W / 2, 45, 'fn', '…')); return; }
      xOf[k] = x;
      const cls = k === 0 ? 'cell-d' : k === N ? 'cell-s' : 'cell';
      svg.appendChild(sv('rect', { x: x, y: 30, width: W, height: 30, rx: 4, class: cls }));
      svg.appendChild(txt(x + W / 2, 45, 'fn' + (k === N ? ' w' : ''), String(k)));
    });
    const shown = [];
    [0, 1, N - 1, N].forEach(function (k) { if (k >= 0 && k <= N && shown.indexOf(k) < 0 && xOf[k] !== undefined) shown.push(k); });
    shown.forEach(function (k) {
      svg.appendChild(txt(xOf[k] + W / 2, 76, 'fs', md(date + k)));
      if (k === 0) svg.appendChild(txt(xOf[k] + W / 2, 92, 'fs', '調剤日'));
      if (k === N) svg.appendChild(txt(xOf[k] + W / 2, 92, 'fs', '予定日'));
    });
    // 1日目〜N日目
    const a1 = xOf[1], a2 = xOf[N] + W;
    svg.appendChild(bracket(a1, a2, 110, false));
    svg.appendChild(txt((a1 + a2) / 2, 124, 'fs', N > 1 ? '1日目〜' + N + '日目＝' + N + '日分' : '1日目＝1日分'));
    // 当日から飲んだ場合
    const b1 = xOf[0], b2 = xOf[N - 1] + W;
    svg.appendChild(bracket(b1, b2, 146, false));
    svg.appendChild(txt((b1 + b2) / 2, 160, 'fs', '当日から飲めば' + md(date + N - 1) + 'に飲み切る'));
    svg.appendChild(sv('rect', { x: 20, y: 178, width: 300, height: 56, rx: 8, class: 'fbox' }));
    svg.appendChild(txt(170, 196, 'fb', '次回調剤予定日＝調剤日＋投薬日数'));
    svg.appendChild(txt(170, 218, 'fc', md(date) + ' ＋ ' + N + '日 ＝ ' + md(date + N)));
    return svg;
  }

  // 図2：調剤できる期間（予定日の前後7日）と、総使用回数ぶんの流れ
  function figWindow(date, N, uses) {
    const sched = date + N, from = sched - C.RULE.WINDOW_DAYS, to = sched + C.RULE.WINDOW_DAYS;
    const svg = svgRoot(296, '2回目に調剤できる期間は' + md(from) + 'から' + md(to) + 'まで。' + uses + '回の流れ');
    svg.appendChild(txt(20, 14, 'ft', '2回目に調剤できる期間', 'start'));
    svg.appendChild(txt(172, 38, 'fs', '前後7日＝15日間（予定日を含む）'));
    svg.appendChild(bracket(52, 292, 50, true));
    svg.appendChild(sv('rect', { x: 20, y: 58, width: 26, height: 28, rx: 4, class: 'out' }));
    svg.appendChild(txt(33, 72, 'fn', '×'));
    for (let i = 0; i < 15; i++) {
      svg.appendChild(sv('rect', { x: 52 + i * 16, y: 58, width: 16, height: 28, class: i === 7 ? 'cell-s' : 'win' }));
    }
    svg.appendChild(sv('rect', { x: 298, y: 58, width: 22, height: 28, rx: 4, class: 'out' }));
    svg.appendChild(txt(309, 72, 'fn', '×'));
    [[60, from, '前7日'], [172, sched, '予定日'], [284, to, '後7日']].forEach(function (a) {
      svg.appendChild(txt(a[0], 100, 'fs', md(a[1])));
      svg.appendChild(txt(a[0], 116, 'fs', a[2]));
    });
    svg.appendChild(txt(20, 140, 'fs', '× 早ければ再来局、過ぎたら調剤不可', 'start'));

    svg.appendChild(txt(20, 172, 'ft', uses + '回の流れ（毎回' + N + '日分、予定日どおり）', 'start'));
    const x0 = 36, x1 = 304, seg = (x1 - x0) / uses;
    const pts = [];
    for (let k = 0; k <= uses; k++) pts.push(x0 + k * seg);
    svg.appendChild(sv('line', { x1: x0, y1: 214, x2: x1, y2: 214, class: 'ln' }));
    const half = Math.min(seg * C.RULE.WINDOW_DAYS / N, seg * 0.45);
    for (let k = 1; k < uses; k++) svg.appendChild(sv('rect', { x: pts[k] - half, y: 206, width: half * 2, height: 16, rx: 3, class: 'win' }));
    pts.forEach(function (x, k) {
      const last = k === uses;
      svg.appendChild(sv('circle', { cx: x, cy: 214, r: 5, class: (k === 0 || last) ? 'pt-g' : 'pt-s' }));
      svg.appendChild(txt(x, 194, 'fs', last ? '終了' : (k + 1) + '回目'));
      svg.appendChild(txt(x, 238, 'fs', md(date + k * N)));
      svg.appendChild(txt(x, 254, 'fs', k === 0 ? '調剤日' : last ? '受診目安' : '±7日'));
      if (!last) svg.appendChild(txt(x + seg / 2, 194, 'fs', '+' + N + '日'));
    });
    svg.appendChild(txt(20, 280, 'fs', uses === 3 ? '2回目がずれると、3回目以降も同じだけずれる' : '2回目の調剤日がずれると、終了日も同じだけずれる', 'start'));
    return svg;
  }

  function renderFigures() {
    if (!$('basisBox').open) return;
    const d = $('f1Date').value ? C.parseISO($('f1Date').value) : null;
    const n = C.parseDays($('f1Days').value, 1, MAX_RX_DAYS);
    const useInput = d !== null && n !== null;
    const date = useInput ? d : today();
    const N = useInput ? n : 28;
    const cap = useInput
      ? '1回目に入力した日付で描いています（調剤日 ' + C.fmtShort(date) + '・' + N + '日分）。'
      : '例：今日 ' + C.fmtShort(date) + ' に28日分を調剤した場合。1回目の調剤日と投薬日数を入れると、その日付で描きます。';
    [['figCount', figCount(date, N)], ['figWindow', figWindow(date, N, state.uses)]].forEach(function (f) {
      const host = $(f[0]);
      host.replaceChildren(f[1], el('div', 'cap', cap));
    });
  }

  /* ---------------- 出典の抜粋（ハイライト付き） ----------------
     sources.js の原文抜粋を、ダイアログに表示する。強調部分は <mark>。 */
  function sourceUrl(src) {
    let u = src.url;
    if (!/^https:\/\//.test(u)) return null;          // 想定外のURLは出さない
    if (src.textFragments && src.textFragments.length) {
      u += '#:~:' + src.textFragments.map(function (f) { return 'text=' + encodeURIComponent(f); }).join('&');
    } else if (src.page) {
      u += '#page=' + src.page;
    }
    return u;
  }
  function openSource(key, focusId) {
    const S = window.RefillSources && window.RefillSources[key];
    if (!S) return;
    const dlg = $('srcDialog');
    $('svTitle').textContent = S.title;
    $('svOrg').textContent = S.org;
    const body = $('svBody');
    body.replaceChildren();
    body.appendChild(el('div', 'sv-where', '該当箇所：' + S.where + '（黄色は、このツールで付けた強調です）'));
    let focusEl = null;
    S.excerpts.forEach(function (ex) {
      const box = el('div', 'sv-ex');
      box.id = 'sv-' + ex.id;
      box.appendChild(el('div', 'lb', ex.label));
      if (ex.q) box.appendChild(el('div', 'q', ex.q));
      const tx = el('div', 'tx');
      ex.body.forEach(function (part) { tx.appendChild(part.hl ? el('mark', null, part.t) : document.createTextNode(part.t)); });
      box.appendChild(tx);
      if (ex.id === focusId) { box.classList.add('focus'); focusEl = box; }
      body.appendChild(box);
    });
    if (S.note) body.appendChild(el('div', 'sv-note', S.note));
    const url = sourceUrl(S);
    if (url) {
      const a = el('a', 'sv-link', S.linkLabel || '原文を開く');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      body.appendChild(a);
    }
    if (S.linkNote) body.appendChild(el('div', 'sv-note', S.linkNote));
    body.appendChild(el('div', 'sv-legal', key === 'kyoto'
      ? '出典を示した引用です。質問は要約しています。'
      : '出典：' + S.credit + '（' + S.url + '）。原文から一部を抜き出し、強調を加えています（法令・通知は著作権法第13条により著作権の対象外。厚生労働省ホームページの利用規約に従って掲載）。'));
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); }
    else dlg.setAttribute('open', '');
    dlg.scrollTop = 0;
    if (focusEl) {
      // 表示が確定してから、該当部分までスクロール
      window.requestAnimationFrame(function () { focusEl.scrollIntoView({ block: 'start' }); });
    }
  }
  function closeSource() {
    const dlg = $('srcDialog');
    if (typeof dlg.close === 'function') dlg.close(); else dlg.removeAttribute('open');
  }

  /* ---------------- 部品の組み立て ---------------- */
  function seg(host, items, get, set) {
    host.replaceChildren();
    items.forEach(function (it) {
      const b = el('button', null, it.label);
      b.type = 'button';
      b.dataset.v = String(it.v);
      b.addEventListener('click', function () { if (!b.disabled) { set(it.v); refreshSegs(); renderAll(); } });
      host.appendChild(b);
    });
    host._get = get;
  }
  function refreshSeg(host) {
    const cur = String(host._get());
    Array.prototype.forEach.call(host.children, function (b) { b.setAttribute('aria-pressed', b.dataset.v === cur ? 'true' : 'false'); });
  }
  function refreshSegs() {
    ['usesSeg', 'turnSeg', 'srcSeg', 'modeSeg'].forEach(function (id) { refreshSeg($(id)); });
    const t3 = $('turnSeg').querySelector('[data-v="3"]');
    t3.disabled = state.uses < 3;
  }
  function refreshChips() {
    document.querySelectorAll('[data-days-for]').forEach(function (box) {
      const v = $(box.dataset.daysFor).value.trim();
      Array.prototype.forEach.call(box.children, function (b) { b.setAttribute('aria-pressed', b.dataset.v === v ? 'true' : 'false'); });
    });
  }
  function renderAll() {
    refreshChips();
    if (state.tab === 'refill') renderRefill(); else renderDays();
    renderFigures();
  }

  seg($('usesSeg'), [{ v: 2, label: '2回' }, { v: 3, label: '3回' }], function () { return state.uses; },
    function (v) { state.uses = v; if (state.turn > v) state.turn = v; });
  seg($('turnSeg'), [{ v: 1, label: '1回目' }, { v: 2, label: '2回目' }, { v: 3, label: '3回目' }], function () { return state.turn; },
    function (v) { state.turn = v; });
  seg($('srcSeg'), [{ v: 'written', label: '処方箋の記載' }, { v: 'calc', label: '前回調剤日から' }], function () { return state.src; },
    function (v) { state.src = v; });
  seg($('modeSeg'), [{ v: 'between', label: '2つの日付の間' }, { v: 'after', label: '〇日後' }, { v: 'before', label: '〇日前' }], function () { return state.mode; },
    function (v) { state.mode = v; });

  // 日数のチップ
  document.querySelectorAll('[data-days-for]').forEach(function (box) {
    const target = $(box.dataset.daysFor);
    const list = box.dataset.daysFor === 'dN' ? SHIFT_CHIPS : DAY_CHIPS;
    list.forEach(function (v) {
      const b = el('button', 'chip', String(v));
      b.type = 'button';
      b.dataset.v = String(v);
      b.setAttribute('aria-label', v + '日');
      b.addEventListener('click', function () { target.value = String(v); renderAll(); });
      box.appendChild(b);
    });
  });
  // 「今日」ボタン
  document.querySelectorAll('[data-today]').forEach(function (b) {
    b.addEventListener('click', function () { $(b.dataset.today).value = C.toISO(today()); renderAll(); });
  });
  // 入力
  document.querySelectorAll('input[type="date"], input[type="text"]').forEach(function (inp) {
    inp.addEventListener('input', renderAll);
    inp.addEventListener('change', renderAll);
  });
  $('f1Issue').addEventListener('toggle', renderAll);
  $('basisBox').addEventListener('toggle', renderFigures);
  // 出典ボタン
  document.querySelectorAll('.src-btn').forEach(function (b) {
    b.addEventListener('click', function () { openSource(b.dataset.src, b.dataset.focus); });
  });
  $('svClose').addEventListener('click', closeSource);
  $('srcDialog').addEventListener('click', function (e) { if (e.target === $('srcDialog')) closeSource(); });

  // タブ
  function setTab(t) {
    state.tab = t;
    $('tabRefill').setAttribute('aria-selected', t === 'refill' ? 'true' : 'false');
    $('tabDays').setAttribute('aria-selected', t === 'days' ? 'true' : 'false');
    $('paneRefill').hidden = t !== 'refill';
    $('paneDays').hidden = t !== 'days';
    save();
    renderAll();
  }
  $('tabRefill').addEventListener('click', function () { setTab('refill'); });
  $('tabDays').addEventListener('click', function () { setTab('days'); });
  [$('tabRefill'), $('tabDays')].forEach(function (b) {
    b.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const next = state.tab === 'refill' ? 'days' : 'refill';
        setTab(next);
        $(next === 'refill' ? 'tabRefill' : 'tabDays').focus();
      }
    });
  });

  // 休業日の設定
  function closedStateText() {
    const s = state.closed, parts = [];
    s.weekdays.forEach(function (on, i) { if (on) parts.push(C.WEEK[i]); });
    const list = [];
    if (parts.length) list.push(parts.join('・') + '曜');
    if (s.holidays) list.push('祝日');
    if (s.yearEnd) list.push('年末年始');
    return list.length ? list.join('／') : '未設定';
  }
  function refreshClosedUI() {
    Array.prototype.forEach.call($('wkChips').children, function (b, i) { b.setAttribute('aria-pressed', state.closed.weekdays[i] ? 'true' : 'false'); });
    $('clHol').checked = state.closed.holidays;
    $('clYearEnd').checked = state.closed.yearEnd;
    $('closedState').textContent = closedStateText();
  }
  C.WEEK.forEach(function (w, i) {
    const b = el('button', 'chip', w);
    b.type = 'button';
    b.setAttribute('aria-label', w + '曜日を定休にする');
    b.addEventListener('click', function () {
      state.closed.weekdays[i] = !state.closed.weekdays[i];
      save(); refreshClosedUI(); renderAll();
    });
    $('wkChips').appendChild(b);
  });
  $('clHol').addEventListener('change', function () { state.closed.holidays = $('clHol').checked; save(); refreshClosedUI(); renderAll(); });
  $('clYearEnd').addEventListener('change', function () { state.closed.yearEnd = $('clYearEnd').checked; save(); refreshClosedUI(); renderAll(); });

  /* ---------------- 初期値 ---------------- */
  const t0 = C.toISO(today());
  ['f1Date', 'lVisit', 'dFrom', 'dBase'].forEach(function (id) { $(id).value = t0; });
  refreshClosedUI();
  refreshSegs();
  setTab(state.tab);

  /* ---------------- Service Worker（オフライン起動） ---------------- */
  if ('serviceWorker' in navigator && window.isSecureContext && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      let url = 'sw.js';
      try {
        // Trusted Types：登録できるスクリプトURLを sw.js だけに限定
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
          const policy = window.trustedTypes.createPolicy('refill-sw', {
            createScriptURL: function (u) { if (u === 'sw.js') return u; throw new TypeError('blocked: ' + u); }
          });
          url = policy.createScriptURL('sw.js');
        }
      } catch (e) { /* ポリシー作成に失敗しても文字列で登録を試みる */ }
      navigator.serviceWorker.register(url, { scope: './' }).catch(function () { /* 失敗してもアプリは動く */ });
    });
  }
})();
