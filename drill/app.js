/* =========================================================================
   処方監査ドリル  app.js（画面）
   画面への文字の書き込みはすべて textContent / DOM API で行う（innerHTMLは使わない）。
   問題中は用量・含量などのヒントを出さない。解説はセット終了後にまとめて出す。
   ========================================================================= */
(function () {
  'use strict';
  const C = window.DrillCore;
  const MASTER_KEY = 'calcTool.drugMaster.v1';   // 剤形変更換算・水剤MIXと共通
  const STORE_KEY = 'calcTool.drill.v1';         // このアプリの学習記録
  const PENALTY_MS = 5000;    // 誤答1問あたりの加算
  const NEXT_OK_MS = 450;     // 正解：◯を見せてから次へ
  const NEXT_NG_MS = 1500;    // 不正解：正解の値を見せてから次へ（タップで早送り）

  const $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined && text !== null) e.textContent = text;
    return e;
  }
  const PAT = {};
  C.PATTERNS.forEach(function (p) { PAT[p.id] = p; });

  /* ---------------- 保存 ---------------- */
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  const DEFAULT_PATTERNS = C.PATTERNS.map(function (p) { return p.id; });
  // v1.6 までにあったパターン。これ以外（新しく増えたパターン）は、更新後に一度だけ自動でオンにする
  const OLD_PATTERNS = ['recall', 'w2rx', 'w2prod', 'rx2w', 'age2rx', 'conv', 'audit'];
  function loadStore() {
    let s = null;
    try { s = JSON.parse(lsGet(STORE_KEY) || 'null'); } catch (e) { s = null; }
    if (!s || typeof s !== 'object') s = {};
    const st = s.settings && typeof s.settings === 'object' ? s.settings : {};
    let pats = Array.isArray(st.patterns) ? st.patterns.filter(function (p) { return PAT[p]; }) : [];
    const known = Array.isArray(st.known) ? st.known : OLD_PATTERNS;
    if (pats.length) DEFAULT_PATTERNS.forEach(function (p) { if (known.indexOf(p) < 0 && pats.indexOf(p) < 0) pats.push(p); });
    const groups = Array.isArray(s.groups) ? s.groups.filter(function (g) { return g && typeof g === 'object'; }).slice(0, 50).map(function (g) {
      return { id: txt(g.id, 40) || newId(), name: txt(g.name, 30) || 'グループ', ids: ids(g.ids) };
    }) : [];
    const gids = groups.map(function (g) { return g.id; });
    return {
      v: 4,
      settings: {
        known: DEFAULT_PATTERNS.slice(),
        patterns: pats.length ? pats : DEFAULT_PATTERNS.slice(),
        mode: st.mode === 'choice' ? 'choice' : 'key',
        n: [5, 10, 20].indexOf(st.n) >= 0 ? st.n : 10,
        scope: st.scope === 'all' ? 'all' : 'adopted',
        weights: loadWeights(st.weights),
        rates: loadRates(st.rates),
        useGroups: st.useGroups === true,
        active: ids(st.active).filter(function (x) { return gids.indexOf(x) >= 0; }),
        exclude: ids(st.exclude),
        goal: GOALS.indexOf(st.goal) >= 0 ? st.goal : 0.9
      },
      groups: groups,
      cards: obj(s.cards),
      best: obj(s.best),
      hist: Array.isArray(s.hist) ? s.hist.slice(-100) : []
    };
  }
  function obj(x) { return x && typeof x === 'object' && !Array.isArray(x) ? x : {}; }
  // 端末に保存する文字列は長さを制限し、制御文字を除く（表示は textContent のみ）
  function txt(v, max) { return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : ''; }
  function ids(a) {
    const out = [];
    if (Array.isArray(a)) a.slice(0, 2000).forEach(function (x) { const t = txt(x, 80); if (t && out.indexOf(t) < 0) out.push(t); });
    return out;
  }
  function newId() { return 'g' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
  const GOALS = [0.8, 0.85, 0.9, 0.95];
  function loadWeights(w) {
    const out = {};
    C.PATTERNS.forEach(function (p) {
      const v = w && w[p.id];
      out[p.id] = C.WEIGHT_STEPS.some(function (x) { return x.v === v; }) ? v : 1;
    });
    return out;
  }
  function loadRates(r) {
    const out = {};
    Object.keys(C.RATE_DEFAULTS).forEach(function (k) {
      const v = r && typeof r[k] === 'number' && isFinite(r[k]) ? Math.round(r[k] * 100) / 100 : C.RATE_DEFAULTS[k];
      out[k] = Math.min(0.5, Math.max(0, v));
    });
    return out;
  }
  let store = loadStore();
  function save() { lsSet(STORE_KEY, JSON.stringify(store)); }

  /* ---------------- 共通マスタ ---------------- */
  let master = null, masterSource = '', pendingMaster = null;
  function loadLocalRaw() {
    try {
      const raw = lsGet(MASTER_KEY);
      const o = raw ? JSON.parse(raw) : null;
      return o && Array.isArray(o.drugs) && o.drugs.length ? o : null;
    } catch (e) { return null; }
  }
  function loadLocalMaster() { const raw = loadLocalRaw(); return raw ? C.sanitizeMaster(raw) : null; }
  function fetchMasterFile() {
    if (typeof fetch !== 'function' || location.protocol.indexOf('http') !== 0) return Promise.resolve(null);
    return fetch('../drug-master.json?t=' + Date.now(), { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) throw new Error('no file'); return r.json(); })
      .then(function (j) { return j && Array.isArray(j.drugs) && j.drugs.length ? j : null; })
      .catch(function () { return null; });
  }
  function setMaster(m, src) {
    if (sess) { pendingMaster = { m: m, src: src }; return; }   // 出題中は差し替えない
    master = m; masterSource = src;
  }
  function applyPending() {
    if (pendingMaster && !sess) { master = pendingMaster.m; masterSource = pendingMaster.src; pendingMaster = null; }
  }
  // 端末の共通マスタを使い、配布マスタ（../drug-master.json）に新しい版があれば取り込む。
  // 端末で編集・追加した成分と採用品の設定は残す（剤形変更換算・水剤MIXと同じ規則）。
  function initMaster(manual) {
    const raw = loadLocalRaw();
    const local = raw ? C.sanitizeMaster(raw) : null;
    if (local) setMaster(local, 'local');
    else if (!master) setMaster(C.sanitizeMaster(C.SAMPLE_MASTER), 'sample');
    renderHome();
    fetchMasterFile().then(function (j) {
      if (!j) { if (manual) toast(local ? '配布マスタが見つからないため、端末のマスタを使います' : '共通マスタが見つかりませんでした'); return; }
      const rev = Number(j.rev) || 0;
      if (raw && !C.needsMerge(raw, rev)) { if (manual) toast('共通マスタは最新です'); return; }
      const merged = C.mergeDistributedMaster(raw, j);
      const m = C.sanitizeMaster(merged);
      if (!m) return;
      lsSet(MASTER_KEY, JSON.stringify(merged));
      setMaster(m, 'local');
      renderHome();
      toast(raw ? '共通マスタを最新版に更新しました' : '共通マスタを取り込みました');
    });
  }
  // 剤形変更換算で編集・保存されたら（別タブ）、その場で反映
  window.addEventListener('storage', function (e) {
    if (e.key === MASTER_KEY) {
      const m = loadLocalMaster();
      if (m) { setMaster(m, 'local'); if (!sess) renderHome(); }
    }
  });

  /* ---------------- トースト ---------------- */
  let toastTimer = 0;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2000);
  }

  /* ---------------- ホーム ---------------- */
  function cfgKey() {
    const s = store.settings;
    const a = allowedDrugs();
    // 出題する薬を絞っているときは、その組み合わせごとに自己ベストを分ける
    return s.patterns.slice().sort().join('+') + '|' + s.mode + '|' + s.n + '|' + s.scope + (a ? '|d' + hash(Array.from(a).sort().join(',')) : '');
  }
  function hash(t) {
    let h = 5381;
    for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
    return h.toString(36);
  }
  // 出題する成分（null＝すべて）。グループを使うときは出題中のグループの成分、そこから「出題しない薬」を除く
  function allowedDrugs() {
    const s = store.settings;
    const ex = new Set(s.exclude);
    let set;
    if (s.useGroups) {
      set = new Set();
      store.groups.forEach(function (g) { if (s.active.indexOf(g.id) >= 0) g.ids.forEach(function (x) { set.add(x); }); });
    } else {
      if (!ex.size || !master) return null;
      set = new Set(master.drugs.map(function (d) { return d.id; }));
    }
    ex.forEach(function (x) { set.delete(x); });
    return set;
  }
  function currentPool() {
    return master ? C.buildPool(master, store.settings.patterns, store.settings.scope, allowedDrugs()) : [];
  }
  // グループの覚え具合（今の出題パターン・出題範囲で）
  function groupStats(g) {
    const ex = new Set(store.settings.exclude);
    const set = new Set(g.ids.filter(function (x) { return !ex.has(x) && master.byId[x]; }));
    return C.poolStats(C.buildPool(master, store.settings.patterns, store.settings.scope, set), store.cards, Date.now());
  }
  function pct(x) { return Math.round(x * 100) + '%'; }
  function segment(host, items, cur, onPick) {
    host.replaceChildren();
    items.forEach(function (it) {
      const b = el('button', it.v === cur ? 'on' : '', it.l);
      b.type = 'button';
      b.addEventListener('click', function () { onPick(it.v); });
      host.appendChild(b);
    });
  }
  function fmtSec(ms) { return (ms / 1000).toFixed(1); }
  function itemName(key) {
    const parts = key.split('|');
    const d = master && master.byId[parts[1]];
    let name = parts[2] || (d ? d.name : parts[1]);
    const KIND = { recallAge: '年齢別用量', auditAge: '監査（年齢）', capRecall: '上限量', capWeight: '上限の体重' };
    let pat = KIND[parts[0]] || (PAT[parts[0]] ? PAT[parts[0]].short : parts[0]);
    if (parts[0] === 'recall') pat = parts[2] ? '含量' : '用量';
    return pat + '　' + name;
  }

  function renderHome() {
    if (!master) return;
    const s = store.settings;
    const banner = $('banner');
    if (masterSource === 'sample') {
      banner.hidden = false;
      banner.textContent = '共通マスタが見つからないため、サンプル8成分で動いています。同じ端末で剤形変更換算を一度開くと、共通マスタ（採用品の設定を含む）が使われます。';
    } else banner.hidden = true;

    const pc = $('patChips');
    pc.replaceChildren();
    C.PATTERNS.forEach(function (p) {
      const on = s.patterns.indexOf(p.id) >= 0;
      const b = el('button', 'chip p-' + p.id + (on ? ' on' : ''), p.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.addEventListener('click', function () {
        const i = s.patterns.indexOf(p.id);
        if (i >= 0) {
          if (s.patterns.length === 1) { toast('1つ以上選んでください'); return; }
          s.patterns.splice(i, 1);
        } else s.patterns.push(p.id);
        save(); renderHome();
      });
      pc.appendChild(b);
    });
    segment($('modeSeg'), [{ v: 'key', l: 'テンキー' }, { v: 'choice', l: '4択' }], s.mode, function (v) { s.mode = v; save(); renderHome(); });
    segment($('nSeg'), [{ v: 5, l: '5問' }, { v: 10, l: '10問' }, { v: 20, l: '20問' }], s.n, function (v) { s.n = v; save(); renderHome(); });
    segment($('scopeSeg'), [{ v: 'adopted', l: '採用品' }, { v: 'all', l: '全製剤' }], s.scope, function (v) { s.scope = v; save(); renderHome(); });

    const notes = [];
    if (s.patterns.indexOf('recall') >= 0) notes.push('「用量・含量」は製剤名を見て小児用量（mg/kg・年齢別の量）や含量を答える暗記問題です。');
    if (s.patterns.indexOf('audit') >= 0) notes.push('監査判定には年齢区分の薬（年齢を見て判断）も含まれます。');
    if (s.patterns.indexOf('audit') >= 0) notes.push('監査判定は回答方式にかかわらず3択です。体重の大きい子で上限（成人量など）を超える処方もまぎれています（少しでも超えたら「多い」）。');
    if (s.patterns.indexOf('cap') >= 0) notes.push('「成人量の上限」は上限量と、体重あたりで計算した量が上限に届く体重を覚える問題です。');
    if (s.scope === 'adopted' && !master.adopted.length) notes.push('採用品が未設定のため、全製剤から出題します（設定は剤形変更換算の「採用品」）。');
    $('hintNote').textContent = notes.join(' ');
    renderDrugCard();
    renderRatios();

    const pool = currentPool();
    const now = Date.now();
    let due = 0, fresh = 0, learned = 0;
    pool.forEach(function (it) {
      const c = store.cards[it.key];
      if (!c) fresh++;
      else if (C.retrievability(c, now) < 0.9) due++;
      else learned++;
    });
    $('startMeta').textContent = s.n + '問・' + (s.mode === 'key' ? 'テンキー' : '4択') + '・出題対象 ' + pool.length + '項目';
    $('srsSummary').replaceChildren(srsBox('due', due, '復習どき'), srsBox('', fresh, '未出題'), srsBox('', learned, '定着中'));
    $('startBtn').disabled = !pool.length;

    const bb = $('bestBox');
    bb.replaceChildren();
    const best = store.best[cfgKey()];
    if (best) {
      bb.appendChild(el('span', 'bv', fmtSec(best.ms) + '秒'));
      bb.appendChild(el('span', 'bl', 'この設定の自己ベスト（' + best.ok + '/' + best.n + '・' + dstr(best.t) + '）'));
    } else bb.appendChild(el('span', 'empty', 'この設定の記録はまだありません'));
    const hb = $('histBox');
    hb.replaceChildren();
    const recent = store.hist.slice(-5).reverse();
    if (recent.length) {
      const h = el('div', 'hist');
      recent.forEach(function (r) {
        const row = el('div');
        row.appendChild(el('span', '', dstr(r.t) + '　' + r.n + '問 ' + r.ok + '/' + r.n));
        row.appendChild(el('span', '', fmtSec(r.ms) + '秒'));
        h.appendChild(row);
      });
      hb.appendChild(h);
    }
    const wb = $('weakBox');
    wb.replaceChildren();
    // 苦手：間違えたことのある問題を正答率の低い順（同じなら前回不正解・回答数の多い順）
    const weak = pool.filter(function (it) { const c = store.cards[it.key]; return c && c.lapses > 0; })
      .map(function (it) { const c = store.cards[it.key]; return { it: it, c: c, a: C.accuracy(c), last: c.lc === 0 || (c.lc === undefined && c.lapses >= c.reps) }; })
      .sort(function (a, b) { return a.a - b.a || (b.last - a.last) || (b.c.reps - a.c.reps); }).slice(0, 5);
    if (weak.length) {
      const w = el('div', 'weak');
      weak.forEach(function (x) {
        const row = el('div');
        row.appendChild(el('span', 'wn', itemName(x.it.key)));
        row.appendChild(el('span', 'wr', '正答 ' + Math.round(x.a * 100) + '%（' + (x.c.reps - x.c.lapses) + '/' + x.c.reps + '）'));
        w.appendChild(row);
      });
      wb.appendChild(w);
    } else wb.appendChild(el('span', 'empty', 'まだありません'));

    const st = C.masterStats(master);
    const src = masterSource === 'local' ? 'この端末の共通マスタ' : 'サンプル';
    $('masterInfo').textContent = src + '：' + st.drugs + '成分・' + st.forms + '製剤（体重あたり用量あり ' + st.withDose +
      '成分・年齢区分あり ' + st.withAge + '成分）・採用品 ' + (st.adopted ? st.adopted + '製剤' : '未設定') +
      (master.updatedAt && master.updatedAt !== 'sample' ? '・更新 ' + master.updatedAt.slice(0, 10) : '') +
      '。体重を使う問題は体重あたり用量、年齢を使う問題は年齢区分、上限の問題は上限量（成人量など）が登録された成分から出題します。';
  }
  function srsBox(cls, n, label) {
    const b = el('div', 's' + (cls ? ' ' + cls : ''));
    b.appendChild(el('b', '', String(n)));
    b.appendChild(el('span', '', label));
    return b;
  }
  function dstr(t) {
    const d = new Date(t);
    return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  /* ---------------- 出題する薬（すべて／グループ）と出題しない薬 ---------------- */
  function renderDrugCard() {
    const s = store.settings;
    segment($('useGroupSeg'), [{ v: false, l: 'すべての薬' }, { v: true, l: 'グループで出題' }], s.useGroups, function (v) {
      s.useGroups = v; save(); renderHome();
    });
    const box = $('groupBox');
    box.replaceChildren();
    box.hidden = !s.useGroups;
    if (s.useGroups) {
      const stats = {};
      store.groups.forEach(function (g) { stats[g.id] = groupStats(g); });
      // 出題中のグループがすべて目安を超えたら、次のグループを提案
      const act = store.groups.filter(function (g) { return s.active.indexOf(g.id) >= 0; });
      const next = store.groups.filter(function (g) { return s.active.indexOf(g.id) < 0; })[0];
      const actN = act.filter(function (g) { return stats[g.id].n > 0; });   // 出題する問題がないグループは数えない
      if (actN.length && actN.every(function (g) { return stats[g.id].mastery >= s.goal; })) {
        const sg = el('div', 'suggest');
        if (next) {
          sg.appendChild(el('div', '', '出題中のグループの定着率が目安（' + pct(s.goal) + '）を超えました。次は「' + next.name + '」を加えますか？'));
          const b = el('button', 'btn small', '「' + next.name + '」を加える');
          b.type = 'button';
          b.addEventListener('click', function () { s.active.push(next.id); save(); renderHome(); toast('「' + next.name + '」を出題に加えました'); });
          sg.appendChild(b);
        } else sg.appendChild(el('div', '', 'すべてのグループの定着率が目安（' + pct(s.goal) + '）を超えています。'));
        box.appendChild(sg);
      }
      if (!store.groups.length) box.appendChild(el('div', 'empty', 'グループはまだありません。下のボタンで作ります。'));
      store.groups.forEach(function (g, i) {
        const st = stats[g.id];
        const row = el('div', 'grp' + (s.active.indexOf(g.id) >= 0 ? ' on' : ''));
        const lab = el('label', 'grp-on');
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = s.active.indexOf(g.id) >= 0;
        cb.setAttribute('aria-label', g.name + 'を出題する');
        cb.addEventListener('change', function () {
          const k = s.active.indexOf(g.id);
          if (cb.checked && k < 0) s.active.push(g.id);
          if (!cb.checked && k >= 0) s.active.splice(k, 1);
          save(); renderHome();
        });
        lab.appendChild(cb);
        lab.appendChild(el('span', 'grp-nm', g.name));
        row.appendChild(lab);
        const info = el('div', 'grp-info');
        const cnt = g.ids.filter(function (x) { return master.byId[x]; }).length;
        info.appendChild(el('span', '', cnt + '成分・' + st.n + '項目'));
        if (cnt && !st.n) info.appendChild(el('span', 'hint flat warn', '（出題する問題なし）'));
        const bar = el('span', 'bar');
        const fill = el('i');
        fill.style.width = Math.round(st.mastery * 100) + '%';
        if (st.mastery >= s.goal) fill.className = 'ok';
        bar.appendChild(fill);
        info.appendChild(bar);
        info.appendChild(el('span', 'grp-pct', '定着 ' + pct(st.mastery)));
        row.appendChild(info);
        const tools = el('div', 'grp-tools');
        if (i > 0) {
          const up = el('button', 'link-btn quiet', '↑上へ');
          up.type = 'button';
          up.setAttribute('aria-label', g.name + 'を1つ上へ');
          up.addEventListener('click', function () { store.groups.splice(i, 1); store.groups.splice(i - 1, 0, g); save(); renderHome(); });
          tools.appendChild(up);
        }
        const ed = el('button', 'link-btn', '編集');
        ed.type = 'button';
        ed.addEventListener('click', function () { openGroupEditor(g); });
        tools.appendChild(ed);
        row.appendChild(tools);
        box.appendChild(row);
      });
      const br = el('div', 'btn-row');
      const add = el('button', 'btn ghost small', '＋ グループを作る');
      add.type = 'button';
      add.addEventListener('click', function () { openGroupEditor(null); });
      br.appendChild(add);
      if (master.groups.length && !store.groups.length) {
        const fromEff = el('button', 'btn ghost small', '薬効グループからまとめて作る');
        fromEff.type = 'button';
        fromEff.addEventListener('click', function () {
          master.groups.forEach(function (eg) { store.groups.push({ id: newId(), name: eg.name.slice(0, 30), ids: eg.ids.slice() }); });
          if (store.groups.length) s.active = [store.groups[0].id];
          save(); renderHome(); toast(store.groups.length + 'グループを作りました。1つ目を出題にしています');
        });
        br.appendChild(fromEff);
      }
      box.appendChild(br);
      const gr = el('div', 'row');
      gr.appendChild(el('div', 'lb', '進む目安'));
      const gseg = el('div', 'seg');
      box.appendChild(gr);
      gr.appendChild(gseg);
      segment(gseg, GOALS.map(function (v) { return { v: v, l: pct(v) }; }), s.goal, function (v) { s.goal = v; save(); renderHome(); });
      box.appendChild(el('div', 'hint', '定着率＝そのグループの問題のうち「前回正解し、いま覚えている確率（間隔反復の想起率）が90%以上」の問題の割合です。まだ出していない問題・前回間違えた問題は定着していないと数えます。今の出題パターン・出題範囲で計算します。'));
      if (!act.length && store.groups.length) box.appendChild(el('div', 'hint warn', '出題するグループにチェックを入れてください。'));
    }
    const exn = s.exclude.filter(function (x) { return master.byId[x]; }).length;
    $('excludeInfo').textContent = exn ? '出題しない薬：' + exn + '成分' : '出題しない薬：なし';
  }

  /* ---------------- 出題の比率 ---------------- */
  const RATE_ITEMS = [
    { k: 'capAudit', l: '上限が関わる処方（監査判定）', h: '上限がある薬の監査判定のうち、上限を超える処方・上限どおりの処方を出す割合' },
    { k: 'capCalc', l: '上限を超える体重（体重→処方量・製剤量）', h: '正解が上限（成人量など）で止まる大きい子を出す割合' },
    { k: 'mg', l: '処方を成分量で書く割合', h: '残りは製剤量で書きます。実際の処方箋は大半が製剤量です。散剤・水剤がない薬は成分量で書きます' }
  ];
  function renderRatios() {
    const s = store.settings;
    const host = $('weightRows');
    host.replaceChildren();
    C.PATTERNS.forEach(function (p) {
      const row = el('div', 'row wrow' + (s.patterns.indexOf(p.id) < 0 ? ' off' : ''));
      row.appendChild(el('div', 'lb', p.label));
      const seg = el('div', 'seg');
      row.appendChild(seg);
      segment(seg, C.WEIGHT_STEPS, s.weights[p.id], function (v) { s.weights[p.id] = v; save(); renderRatios(); });
      host.appendChild(row);
    });
    const rh = $('rateRows');
    rh.replaceChildren();
    RATE_ITEMS.forEach(function (it) {
      const wrap = el('div', 'rate');
      const id = 'rate-' + it.k;
      const lab = el('label', 'rate-l', it.l);
      lab.htmlFor = id;
      const out = el('output', 'rate-v', Math.round(s.rates[it.k] * 100) + '%');
      out.htmlFor = id;
      const top = el('div', 'rate-top');
      top.appendChild(lab); top.appendChild(out);
      wrap.appendChild(top);
      const r = el('input');
      r.type = 'range'; r.id = id; r.min = '0'; r.max = '50'; r.step = '5';
      r.value = String(Math.round(s.rates[it.k] * 100));
      r.addEventListener('input', function () { out.textContent = r.value + '%'; });
      r.addEventListener('change', function () { s.rates[it.k] = Number(r.value) / 100; save(); });
      wrap.appendChild(r);
      wrap.appendChild(el('div', 'hint', it.h + '（初期値 ' + Math.round(C.RATE_DEFAULTS[it.k] * 100) + '%）'));
      rh.appendChild(wrap);
    });
  }
  function resetRatios() {
    const s = store.settings;
    s.weights = loadWeights(null);
    s.rates = loadRates(null);
    save(); renderRatios(); toast('出題の比率を初期値に戻しました');
  }

  /* ---------------- 薬を選ぶ画面（グループの編集・出題しない薬） ---------------- */
  let pick = null;   // { mode:'group'|'exclude', group, sel:Set, filter, q }
  function drugTags(d) {
    const t = [];
    if (C.hasDose(d)) t.push('体重');
    if (C.hasAge(d)) t.push('年齢');
    if (C.capRelevant(d)) t.push('上限');
    return t.join('・');
  }
  function openGroupEditor(g) {
    pick = { mode: 'group', group: g, sel: new Set(g ? g.ids : []), filter: '', q: '' };
    $('pickTitle').textContent = g ? 'グループを編集' : 'グループを作る';
    $('pickNameBox').hidden = false;
    $('pickName').value = g ? g.name : 'グループ' + String.fromCharCode(65 + Math.min(25, store.groups.length));
    $('pickDel').hidden = !g;
    $('pickLead').textContent = 'このグループで出題する薬にチェックを入れます。';
    openPick();
  }
  function openExclude() {
    const ex = new Set(store.settings.exclude);
    pick = { mode: 'exclude', group: null, sel: new Set(master.drugs.filter(function (d) { return !ex.has(d.id); }).map(function (d) { return d.id; })), filter: '', q: '' };
    $('pickTitle').textContent = '出題する薬を選ぶ';
    $('pickNameBox').hidden = true;
    $('pickDel').hidden = true;
    $('pickLead').textContent = 'チェックを外した薬は出題しません（グループで出題するときも外れます）。';
    openPick();
  }
  function openPick() {
    $('pickSearch').value = '';
    show('pick');
    renderPick();
  }
  function pickVisible() {
    const q = pick.q.trim().toLowerCase();
    const eff = pick.filter ? master.groups.filter(function (g) { return g.id === pick.filter; })[0] : null;
    return master.drugs.filter(function (d) {
      if (eff && eff.ids.indexOf(d.id) < 0) return false;
      if (pick.filter === '__sel' && !pick.sel.has(d.id)) return false;
      if (!q) return true;
      return (d.name + ' ' + d.brand + ' ' + d.forms.map(function (f) { return f.n; }).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
  }
  function renderPick() {
    const fc = $('pickFilter');
    fc.replaceChildren();
    const chips = [{ id: '', name: 'すべて' }, { id: '__sel', name: 'チェックした薬' }].concat(master.groups);
    chips.forEach(function (g) {
      const b = el('button', 'chip' + (pick.filter === g.id ? ' on p-w2rx' : ''), g.name);
      b.type = 'button';
      b.setAttribute('aria-pressed', pick.filter === g.id ? 'true' : 'false');
      b.addEventListener('click', function () { pick.filter = g.id; renderPick(); });
      fc.appendChild(b);
    });
    const list = $('pickList');
    list.replaceChildren();
    const vis = pickVisible();
    vis.forEach(function (d) {
      const row = el('label', 'drow');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = pick.sel.has(d.id);
      cb.addEventListener('change', function () {
        if (cb.checked) pick.sel.add(d.id); else pick.sel.delete(d.id);
        $('pickCount').textContent = countText();
      });
      row.appendChild(cb);
      const nm = el('span', 'dname', d.name);
      if (d.brand) nm.appendChild(el('small', '', d.brand));
      row.appendChild(nm);
      const tg = drugTags(d);
      if (tg) row.appendChild(el('span', 'dtag', tg));
      list.appendChild(row);
    });
    if (!vis.length) list.appendChild(el('div', 'empty', '該当する薬がありません'));
    $('pickCount').textContent = countText();
  }
  function countText() {
    return (pick.mode === 'group' ? '選んだ薬 ' : '出題する薬 ') + Array.from(pick.sel).filter(function (x) { return master.byId[x]; }).length + '成分／全' + master.drugs.length + '成分';
  }
  function pickAll(on) {
    pickVisible().forEach(function (d) { if (on) pick.sel.add(d.id); else pick.sel.delete(d.id); });
    renderPick();
  }
  function savePick() {
    const s = store.settings;
    if (pick.mode === 'group') {
      const name = txt($('pickName').value, 30);
      if (!name) { toast('グループ名を入れてください'); return; }
      const list = Array.from(pick.sel).filter(function (x) { return master.byId[x]; });
      if (!list.length) { toast('薬を1つ以上選んでください'); return; }
      if (pick.group) { pick.group.name = name; pick.group.ids = list; }
      else {
        const g = { id: newId(), name: name, ids: list };
        store.groups.push(g);
        if (!s.active.length) s.active.push(g.id);
      }
      s.useGroups = true;
    } else {
      s.exclude = master.drugs.filter(function (d) { return !pick.sel.has(d.id); }).map(function (d) { return d.id; });
    }
    save(); pick = null; show('home'); renderHome(); toast('保存しました');
  }
  function deleteGroup() {
    if (!pick || !pick.group) return;
    if (!window.confirm('「' + pick.group.name + '」を削除しますか？（学習記録は消えません）')) return;
    const id = pick.group.id;
    store.groups = store.groups.filter(function (g) { return g.id !== id; });
    store.settings.active = store.settings.active.filter(function (x) { return x !== id; });
    save(); pick = null; show('home'); renderHome(); toast('削除しました');
  }

  /* ---------------- 出題セッション ----------------
     phase 'main'   : タイムアタック本番
     phase 'review' : 本番で間違えた薬を数値を変えてもう一度（記録タイムには含めない） */
  let sess = null;
  let rafId = 0, autoTimer = 0;

  function show(id) {
    ['home', 'quiz', 'result', 'pick'].forEach(function (s) { $(s).hidden = s !== id; });
    window.scrollTo(0, 0);
  }

  function start() {
    const pool = currentPool();
    if (!pool.length) { toast('この条件では出題できる薬がありません'); return; }
    C.setRates(store.settings.rates);
    const items = C.buildSet(pool, store.cards, store.settings.n, Date.now(), Math.random, store.settings.weights);
    sess = {
      phase: 'main', items: items, i: 0, n: items.length, cfg: cfgKey(),
      results: [], reviewItems: [], reviewResults: [], solveMs: 0, penalty: 0, p: null
    };
    $('quiz').classList.remove('review');
    show('quiz');
    nextQuestion();
    tick();
  }

  function curList() { return sess.phase === 'main' ? sess.items : sess.reviewItems; }

  function nextQuestion() {
    clearTimeout(autoTimer);
    const list = curList();
    if (sess.i >= list.length) {
      if (sess.phase === 'main' && sess.reviewItems.length) { beginReview(); return; }
      finish();
      return;
    }
    const p = C.generate(list[sess.i], master, Math.random, store.settings.scope);
    if (!p) { list.splice(sess.i, 1); if (sess.phase === 'main') sess.n = list.length; nextQuestion(); return; }
    sess.p = p;
    sess.input = '';
    sess.locked = false;
    sess.choices = (store.settings.mode === 'choice' || p.answer.type === 'choice') ? C.makeChoices(p, Math.random) : null;
    renderQuestion();
    sess.qStart = performance.now();
  }

  function beginReview() {
    sess.phase = 'review';
    sess.i = 0;
    $('quiz').classList.add('review');
    toast('間違えた薬をもう一度（タイムには含めません）');
    nextQuestion();
  }

  function renderQuestion() {
    const p = sess.p;
    const list = curList();
    $('phase').textContent = sess.phase === 'review' ? '復習 ' : '';
    $('qNo').textContent = String(sess.i + 1);
    $('qN').textContent = String(list.length);
    $('pFill').style.width = (sess.i / list.length * 100) + '%';
    const pc = $('qPat');
    pc.className = 'pchip p-' + p.pattern;
    pc.textContent = p.chip || (p.pattern === 'recall' ? (p.formN ? '含量' : '用量') : PAT[p.pattern].label);
    $('qSub').textContent = p.sub;
    $('qTitle').textContent = p.title;
    const facts = $('qFacts');
    facts.replaceChildren();
    p.facts.forEach(function (f) {
      facts.appendChild(el('dt', '', f.k));
      facts.appendChild(el('dd', '', f.v));
    });
    facts.hidden = !p.facts.length;
    $('qAsk').textContent = p.ask;

    $('fb').hidden = true;
    $('ansArea').hidden = false;
    const keyMode = !sess.choices;
    $('disp').hidden = !keyMode;
    $('keypad').hidden = !keyMode;
    $('choices').hidden = keyMode;
    if (keyMode) { $('dispUnit').textContent = p.unit; renderInput(); buildKeypad(); }
    else buildChoices();
  }

  /* --- テンキー（アプリ内の数字ボタン） --- */
  const KEYS = [
    ['7'], ['8'], ['9'], ['bs', '⌫', 'k-fn'],
    ['4'], ['5'], ['6'], ['c', 'C', 'k-fn'],
    ['1'], ['2'], ['3'], ['ok', '決定', 'k-ok'],
    ['0', '0', 'k-zero'], ['.', '.']
  ];
  let keypadBuilt = false;
  function buildKeypad() {
    if (keypadBuilt) return;
    const kp = $('keypad');
    KEYS.forEach(function (k) {
      const b = el('button', k[2] || '', k[1] || k[0]);
      b.type = 'button';
      b.dataset.k = k[0];
      if (k[0] === 'bs') b.setAttribute('aria-label', '1文字消す');
      if (k[0] === 'c') b.setAttribute('aria-label', 'クリア');
      kp.appendChild(b);
    });
    // タップの遅延をなくすため pointerdown で受ける
    kp.addEventListener('pointerdown', function (e) {
      const b = e.target.closest('button');
      if (!b) return;
      e.preventDefault();
      press(b.dataset.k);
    });
    keypadBuilt = true;
  }
  function press(k) {
    if (!sess || sess.locked) return;
    if (k === 'ok') { submit(); return; }
    if (k === 'bs') sess.input = sess.input.slice(0, -1);
    else if (k === 'c') sess.input = '';
    else if (k === '.') { if (sess.input.indexOf('.') < 0 && sess.input.length < 7) sess.input = (sess.input || '0') + '.'; }
    else if (/^\d$/.test(k) && sess.input.length < 7) sess.input = (sess.input === '0' ? '' : sess.input) + k;
    renderInput();
  }
  function renderInput() {
    const v = $('dispVal');
    v.textContent = sess.input || '0';
    v.classList.toggle('ph', !sess.input);
  }

  /* --- 選択肢 --- */
  function buildChoices() {
    const p = sess.p;
    const host = $('choices');
    host.replaceChildren();
    host.classList.toggle('three', sess.choices.length === 3);
    sess.choices.forEach(function (c, i) {
      const b = el('button');
      b.type = 'button';
      b.appendChild(document.createTextNode(c.label));
      if (p.answer.type !== 'choice') b.appendChild(el('small', '', p.unit));
      b.appendChild(el('span', 'kb', String(i + 1)));
      b.addEventListener('pointerdown', function (e) { e.preventDefault(); submit(c.value, c.label); });
      host.appendChild(b);
    });
  }

  /* --- 回答 --- */
  function submit(choiceValue, choiceLabel) {
    if (!sess || sess.locked) return;
    const p = sess.p;
    let value, shown;
    if (sess.choices) { value = choiceValue; shown = choiceLabel + (p.answer.type === 'choice' ? '' : ' ' + p.unit); }
    else {
      const x = C.parseInput(sess.input);
      if (!isFinite(x)) { const d = $('disp'); d.classList.remove('shake'); void d.offsetWidth; d.classList.add('shake'); return; }
      value = x; shown = sess.input + ' ' + p.unit;
    }
    sess.locked = true;
    const ms = Math.max(0, performance.now() - sess.qStart);
    const correct = C.judge(p, value);
    const kind = (p.pattern === 'recall' || p.kind === 'capRecall') ? 'recall' : (sess.choices ? 'tap' : 'key');
    const g = C.rate(correct, ms, false, kind);
    store.cards[p.key] = C.review(store.cards[p.key], g, Date.now());
    store.cards[p.key].lc = correct ? 1 : 0;   // 前回の正誤（定着率に使う）
    save();

    const rec = { p: p, shown: shown, correct: correct, ms: ms };
    if (sess.phase === 'main') {
      sess.solveMs += ms;
      if (!correct) {
        sess.penalty += PENALTY_MS;
        const it = sess.items[sess.i];
        if (!sess.reviewItems.some(function (x) { return x.key === it.key; })) sess.reviewItems.push(it);
      }
      sess.results.push(rec);
    } else sess.reviewResults.push(rec);
    flash(p, correct);
  }

  // 直後は ◯✕ と正解の値だけ。計算式・用量は終了後にまとめて。
  function flash(p, correct) {
    const fb = $('fb');
    fb.classList.toggle('ng', !correct);
    $('fbHead').textContent = correct ? '◯' : '✕';
    const a = $('fbAns');
    a.replaceChildren();
    if (!correct) {
      a.appendChild(document.createTextNode('正解 '));
      a.appendChild(el('b', '', C.answerText(p)));
    }
    $('ansArea').hidden = true;
    fb.hidden = false;
    sess.fbAt = performance.now();
    if (!correct && navigator.vibrate) { try { navigator.vibrate(80); } catch (e) { /* 無視 */ } }
    autoTimer = setTimeout(advance, correct ? NEXT_OK_MS : NEXT_NG_MS);
  }
  function advance(e) {
    if (!sess || $('fb').hidden) return;
    // 回答タップの指がそのまま触れて読み飛ばすのを防ぐ
    if (e && e.type === 'click' && performance.now() - (sess.fbAt || 0) < 250) return;
    clearTimeout(autoTimer);
    sess.i++;
    nextQuestion();
  }

  function tick() {
    cancelAnimationFrame(rafId);
    const loop = function () {
      if (!sess) return;
      const running = (sess.locked || sess.phase !== 'main') ? 0 : performance.now() - sess.qStart;
      $('timer').textContent = fmtSec(sess.solveMs + sess.penalty + running);
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
  }

  function quit() {
    if (!sess) return;
    if (sess.phase === 'review') { finish(); return; }   // 復習中の ✕ は結果へ
    if (sess.results.length && !window.confirm('中断してホームに戻りますか？（ここまでの学習記録は保存済みです）')) return;
    cancelAnimationFrame(rafId);
    clearTimeout(autoTimer);
    sess = null;
    applyPending();
    show('home');
    renderHome();
  }

  /* ---------------- 結果（解説はここでまとめて） ---------------- */
  function finish() {
    const s = sess;
    cancelAnimationFrame(rafId);
    clearTimeout(autoTimer);
    const ok = s.results.filter(function (r) { return r.correct; }).length;
    const total = s.solveMs + s.penalty;
    const rec = { t: Date.now(), n: s.results.length, ok: ok, ms: total, cfg: s.cfg };
    let isBest = false, prev = store.best[s.cfg];
    if (s.results.length) {
      store.hist.push(rec);
      if (store.hist.length > 100) store.hist = store.hist.slice(-100);
      isBest = !prev || total < prev.ms;
      if (isBest) store.best[s.cfg] = { ms: total, ok: ok, n: s.results.length, t: rec.t };
      save();
    }

    $('rScore').replaceChildren(document.createTextNode(fmtSec(total)), el('small', '', '秒'));
    $('rSub').textContent = '正答 ' + ok + '/' + s.results.length +
      '　解答 ' + fmtSec(s.solveMs) + '秒' + (s.penalty ? ' ＋ 誤答 ' + fmtSec(s.penalty) + '秒' : '') +
      '　平均 ' + fmtSec(s.solveMs / Math.max(1, s.results.length)) + '秒/問';
    const bf = $('rBest');
    bf.className = 'best-flag' + (isBest ? ' new' : '');
    bf.textContent = isBest ? (prev ? '自己ベスト更新！（前回 ' + fmtSec(prev.ms) + '秒）' : '初記録') : (prev ? '自己ベスト ' + fmtSec(prev.ms) + '秒' : '');

    const list = $('rList');
    list.replaceChildren();
    s.results.forEach(function (r) { list.appendChild(reviewRow(r)); });
    const rv = $('rReview');
    rv.replaceChildren();
    $('rReviewCard').hidden = !s.reviewResults.length;
    s.reviewResults.forEach(function (r) { rv.appendChild(reviewRow(r)); });
    sess = null;
    applyPending();
    $('quiz').classList.remove('review');
    show('result');
  }

  function reviewRow(r) {
    const p = r.p;
    const box = el('div', 'rv ' + (r.correct ? 'ok' : 'ng'));
    const h = el('div', 'rv-h');
    h.appendChild(el('span', 'mk', r.correct ? '◯' : '✕'));
    h.appendChild(el('span', 'pchip p-' + p.pattern, p.chip || (p.pattern === 'recall' ? (p.formN ? '含量' : '用量') : PAT[p.pattern].short)));
    h.appendChild(el('span', 'nm', p.title));
    h.appendChild(el('span', 'tm', fmtSec(r.ms) + 's'));
    box.appendChild(h);
    const a = el('div', 'rv-a');
    const q = p.facts.map(function (f) { return f.k + ' ' + f.v; }).join('／');
    a.appendChild(document.createTextNode((q ? q + '　' : '') + p.ask + ' → '));
    a.appendChild(el('b', '', C.answerText(p)));
    if (!r.correct) a.appendChild(document.createTextNode('（あなた：' + r.shown + '）'));
    box.appendChild(a);

    // 解説：間違えた問題は開いた状態、正解した問題はタップで開く
    const det = el('details', 'rv-d');
    det.open = !r.correct;
    det.appendChild(el('summary', '', '解説'));
    const x = el('ul', 'rv-x');
    p.explain.forEach(function (line) { x.appendChild(el('li', '', line)); });
    det.appendChild(x);
    if (p.memo.length) {
      const mm = el('div', 'rv-m');
      mm.appendChild(el('span', 'rv-ml', '覚える'));
      p.memo.forEach(function (t) { mm.appendChild(el('div', '', t)); });
      det.appendChild(mm);
    }
    if (!r.correct && p.note) det.appendChild(el('div', 'rv-n', '添付文書の記載：' + p.note));
    box.appendChild(det);
    return box;
  }

  /* ---------------- 物理キーボード ---------------- */
  document.addEventListener('keydown', function (e) {
    if (!sess || $('quiz').hidden) return;
    if (e.key === 'Escape') { quit(); return; }
    if (!$('fb').hidden) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); }
      return;
    }
    if (sess.choices) {
      const i = Number(e.key) - 1;
      if (i >= 0 && i < sess.choices.length) { e.preventDefault(); submit(sess.choices[i].value, sess.choices[i].label); }
      return;
    }
    if (/^[0-9]$/.test(e.key) || e.key === '.') { e.preventDefault(); press(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); press('bs'); }
    else if (e.key === 'Delete') { e.preventDefault(); press('c'); }
    else if (e.key === 'Enter') { e.preventDefault(); press('ok'); }
  });

  /* ---------------- イベント ---------------- */
  $('startBtn').addEventListener('click', start);
  $('quitBtn').addEventListener('click', quit);
  $('fb').addEventListener('click', advance);
  $('againBtn').addEventListener('click', start);
  $('homeBtn').addEventListener('click', function () { show('home'); renderHome(); });
  $('reloadBtn').addEventListener('click', function () { initMaster(true); });
  $('drugsBtn').addEventListener('click', openExclude);
  $('ratioReset').addEventListener('click', resetRatios);
  $('pickSearch').addEventListener('input', function () { pick.q = this.value; renderPick(); });
  $('pickAllOn').addEventListener('click', function () { pickAll(true); });
  $('pickAllOff').addEventListener('click', function () { pickAll(false); });
  $('pickSave').addEventListener('click', savePick);
  $('pickCancel').addEventListener('click', function () { pick = null; show('home'); renderHome(); });
  $('pickBack').addEventListener('click', function () { pick = null; show('home'); renderHome(); });
  $('pickDel').addEventListener('click', deleteGroup);
  $('resetBtn').addEventListener('click', function () {
    if (!window.confirm('学習記録（間隔反復の状態・自己ベスト・履歴）をすべて消去しますか？ 設定は残ります。')) return;
    store.cards = {}; store.best = {}; store.hist = [];
    save(); renderHome(); toast('記録を消去しました');
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') save();
  });

  initMaster(false);

  /* ---------------- Service Worker（オフライン起動） ---------------- */
  if ('serviceWorker' in navigator && window.isSecureContext && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      let url = 'sw.js';
      try {
        // Trusted Types：登録できるスクリプトURLを sw.js だけに限定
        if (window.trustedTypes && window.trustedTypes.createPolicy) {
          const policy = window.trustedTypes.createPolicy('drill-sw', {
            createScriptURL: function (u) { if (u === 'sw.js') return u; throw new TypeError('blocked: ' + u); }
          });
          url = policy.createScriptURL('sw.js');
        }
      } catch (e) { /* ポリシー作成に失敗しても文字列で登録を試みる */ }
      navigator.serviceWorker.register(url, { scope: './' }).catch(function () { /* 失敗してもアプリは動く */ });
    });
  }
})();
