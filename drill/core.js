/* =========================================================================
   処方監査ドリル  core.js
   画面に依存しない部分：マスタの検証、問題の生成、正誤判定、
   4択の誤答肢、FSRS-6（間隔反復）、出題セットの組み立て。
   ブラウザでは window.DrillCore、Node（テスト）では module.exports。
   ========================================================================= */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DrillCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- 定数 ---------------- */
  const FORM_LABEL = { powder: '散剤', liquid: '水剤', tablet: '錠剤', chew: 'チュアブル', cap: 'カプセル', sachet: '分包', supp: '坐剤' };
  const PROD_UNIT = { powder: 'g', liquid: 'mL', tablet: '錠', chew: '錠', cap: 'カプセル', sachet: '包', supp: '個' };
  const STRENGTH_UNIT = { powder: 'mg/g', liquid: 'mg/mL', tablet: 'mg/錠', chew: 'mg/錠', cap: 'mg/カプセル', sachet: 'mg/包', supp: 'mg/個' };
  const WEIGHT_FORMS = { powder: 1, liquid: 1 };   // 体重を使う問題は散剤・DS・水剤だけ
  const ADULT_AGE = 15;        // 剤形の対象年齢がこれ以上＝成人用（添付文書に小児の用法がない）
  const CAP_WMAX = 55;         // 上限（成人量など）を超える体重の問題で使う体重の上限（15歳の平均体重くらい）
  // 出題の比率（ホームの「出題の比率」で変えられる。0〜0.5）
  //  capCalc：体重→処方量・製剤量のうち、上限で頭打ちになる体重を出す割合
  //  capAudit：監査判定（上限がある薬）のうち、上限が関わる処方を出す割合
  //  mg：処方を成分量で書く割合（残りは製剤量）
  const RATE_DEFAULTS = Object.freeze({ capCalc: 0.25, capAudit: 0.1, mg: 0.2 });
  const RATES = { capCalc: RATE_DEFAULTS.capCalc, capAudit: RATE_DEFAULTS.capAudit, mg: RATE_DEFAULTS.mg };
  function setRates(r) {
    Object.keys(RATE_DEFAULTS).forEach(function (k) {
      const v = r && typeof r[k] === 'number' && isFinite(r[k]) ? r[k] : RATE_DEFAULTS[k];
      RATES[k] = Math.min(0.5, Math.max(0, v));
    });
    return Object.assign({}, RATES);
  }
  // パターンの比率（少なめ・普通・多め）
  const WEIGHT_STEPS = [{ v: 0.5, l: '少なめ' }, { v: 1, l: '普通' }, { v: 2, l: '多め' }];

  const PATTERNS = [
    { id: 'recall', label: '用量・含量',     short: '用量・含量' },
    { id: 'w2rx',   label: '体重→処方量',   short: '体重→成分量' },
    { id: 'w2prod', label: '体重→製剤量',   short: '体重→製剤量' },
    { id: 'rx2w',   label: '処方量→体重',   short: '処方量→体重' },
    { id: 'age2rx', label: '年齢→処方量',   short: '年齢→製剤量' },
    { id: 'conv',   label: '処方量↔製剤量', short: '成分量↔製剤量' },
    { id: 'cap',    label: '成人量の上限',   short: '上限' },
    { id: 'audit',  label: '監査判定',      short: '監査判定' }
  ];
  const AUDIT_CHOICES = [
    { value: 'low', label: '少ない' },
    { value: 'ok',  label: '適正' },
    { value: 'high', label: '多い' }
  ];

  /* ---------------- 小物 ---------------- */
  function str(v, max) {
    if (typeof v !== 'string') return '';
    // 制御文字を除き、長さを制限する（表示は textContent のみで行う）
    return v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 200);
  }
  function num(v) {
    const x = typeof v === 'string' ? Number(v) : v;
    return typeof x === 'number' && isFinite(x) ? x : NaN;
  }
  function roundTo(v, d) {
    const p = Math.pow(10, d);
    return Math.round(v * p + (v >= 0 ? 1e-9 : -1e-9)) / p;
  }
  function n2s(v) {             // マスタの数値（用量・含量）を見やすく
    return String(roundTo(v, 4));
  }
  // 単位ごとの表示桁数（処方箋や秤量の実務に合わせた丸め）
  function decimalsFor(unit, v) {
    const a = Math.abs(v);
    switch (unit) {
      case 'mg': return a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : 3;
      case 'g':  return a >= 0.1 ? 2 : 3;
      case 'mL': return a >= 1 ? 1 : 2;
      case 'kg': return 1;
      default:   return 2;     // 錠・カプセル・個・包
    }
  }
  function rnd(v, unit) { return roundTo(v, decimalsFor(unit, v)); }
  function fmt(v, unit) {
    if (!isFinite(v)) return '—';
    const d = decimalsFor(unit, v);
    let s = roundTo(v, d).toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  }
  // 許容誤差：1% か、表示桁の半分の大きい方
  function tolFor(v, unit) {
    const d = decimalsFor(unit, v);
    return Math.max(Math.abs(v) * 0.01, 0.5 * Math.pow(10, -d)) + 1e-9;
  }
  function parseInput(s) {
    if (typeof s !== 'string') return NaN;
    const t = s.trim();
    if (!/^\d*\.?\d*$/.test(t) || t === '' || t === '.') return NaN;
    return Number(t);
  }
  function shuffle(a, rng) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(a, rng) { return a[Math.floor(rng() * a.length)]; }
  function uniform(rng, lo, hi) { return lo + rng() * (hi - lo); }

  /* ---------------- マスタ ---------------- */
  // 共通マスタ（calcTool.drugMaster.v1 / drug-master.json）を検証して、
  // ドリルが使う項目だけの安全なオブジェクトにする。
  function sanitizeMaster(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.drugs)) return null;
    const drugs = [];
    const byId = Object.create(null);
    for (const d of raw.drugs.slice(0, 5000)) {
      if (!d || typeof d !== 'object') continue;
      const id = str(d.id, 80);
      const name = str(d.name, 120);
      if (!id || !name || byId[id]) continue;
      const forms = [];
      const fseen = Object.create(null);
      if (Array.isArray(d.forms)) {
        for (const f of d.forms.slice(0, 200)) {
          if (!f || typeof f !== 'object') continue;
          const n = str(f.n, 160);
          const t = typeof f.t === 'string' ? f.t : '';
          const s = num(f.s);
          if (!n || fseen[n] || !Object.prototype.hasOwnProperty.call(FORM_LABEL, t) || !(s > 0)) continue;
          fseen[n] = 1;
          // 剤形の対象年齢（歳）。ageMax は「未満」。例：キプレス細粒 1〜6、アレグラ錠30mg 7〜
          const am = num(f.ageMin), ax = num(f.ageMax);
          const ageMin = am >= 0 && am < 100 ? am : null;
          const ageMax = ax > 0 && ax <= 100 && (ageMin === null || ax > ageMin) ? ax : null;
          forms.push({ n: n, t: t, s: s, sr: f.sr === true, ageMin: ageMin, ageMax: ageMax });
        }
      }
      if (!forms.length) continue;
      // マスタは mg で保存。単位が μg の薬（uf=0.001）はドリル内では μg に直して扱う
      const ug = d.un === 'μg' || (num(d.uf) > 0 && num(d.uf) < 1);
      const k = ug ? 1 / (num(d.uf) > 0 ? num(d.uf) : 0.001) : 1;
      const u = ug ? 'μg' : 'mg';
      forms.forEach(function (f) { f.s = f.s * k; f.su = u + STRENGTH_UNIT[f.t].slice(2); });
      let dmin = num(d.dmin) * k, dmax = num(d.dmax) * k;
      if (!(dmin > 0)) dmin = NaN;
      if (!(dmax > 0)) dmax = NaN;
      if (isNaN(dmin) && !isNaN(dmax)) dmin = dmax;
      if (isNaN(dmax) && !isNaN(dmin)) dmax = dmin;
      if (dmin > dmax) { const t = dmin; dmin = dmax; dmax = t; }
      // 上限：maxDay＝1日量、maxDose＝1回量（成人量、または添付文書の小児の上限）
      const maxDay = num(d.maxDay) > 0 ? num(d.maxDay) * k : null;
      const maxDose = num(d.maxDose) > 0 ? num(d.maxDose) * k : null;
      // 体重あたりの最高量（通常量の上限より大きいときだけ。例：ゾニサミド 通常4〜8・最高12mg/kg/日）
      const dl = num(d.dlimit) * k;
      const wam = num(d.weightAgeMax);
      const drug = {
        id: id, name: name,
        brand: str(d.brand, 120), cat: str(d.cat, 40),
        dmin: isNaN(dmin) ? null : dmin, dmax: isNaN(dmax) ? null : dmax,
        dlimit: dl > 0 && !isNaN(dmax) && dl > dmax * 1.0001 ? dl : null,
        dbasis: d.dbasis === 'dose' ? 'dose' : 'day',
        maxDay: maxDay, maxDose: maxDose, maxNote: str(d.maxNote, 120),
        dnote: str(d.dnote, 400), potency: d.potency === true, u: u,
        // 体重あたり用量を使う年齢の上限（例：6 → 6歳未満は体重、6歳以上は年齢区分）
        weightAgeMax: wam > 0 && wam < 20 ? wam : null,
        forms: forms, bands: sanitizeBands(d.ageBands, k),
        // 年齢区分を当てはめない製剤（例：年齢表はシロップだけに書かれている）
        ageNot: strList(d.ageNotFor),
        // 体重あたり用量を当てはめない製剤（例：ジアゼパムの体重あたり量は坐剤だけ）
        weightNot: strList(d.weightNotFor)
      };
      drugs.push(drug);
      byId[id] = drug;
    }
    if (!drugs.length) return null;
    const adopted = Array.isArray(raw.adopted)
      ? raw.adopted.filter(function (x) { return typeof x === 'string'; }).map(function (x) { return str(x, 160); }).slice(0, 5000)
      : [];
    // 薬効グループ（剤形変更換算の設定）：出題グループを作るときのひな形に使う
    const groups = [];
    if (Array.isArray(raw.groups)) {
      raw.groups.slice(0, 200).forEach(function (g) {
        if (!g || typeof g !== 'object') return;
        const name = str(g.name, 40);
        const ids = strList(g.ids).filter(function (x) { return byId[x]; });
        if (name && ids.length) groups.push({ id: str(g.id, 80) || name, name: name, ids: ids });
      });
    }
    return { drugs: drugs, byId: byId, adopted: adopted, groups: groups, updatedAt: str(raw.updatedAt, 40) };
  }
  function strList(a) {
    return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string'; }).slice(0, 200).map(function (x) { return str(x, 160); }) : [];
  }

  // 年齢区分。a0〜a1歳（a1なしは「以上」）。
  //  決まった量：mg（1回の成分量）× times（1日回数）
  //  幅のある量：dayMin〜dayMax（1日の成分量）、times は分割回数（任意）
  function sanitizeBands(arr, k) {
    k = k || 1;
    if (!Array.isArray(arr)) return [];
    const out = [];
    arr.slice(0, 20).forEach(function (b) {
      if (!b || typeof b !== 'object') return;
      const a0 = num(b.a0);
      const a1 = (b.a1 === null || b.a1 === undefined || b.a1 === '') ? null : num(b.a1);
      if (!(a0 >= 0) || a0 > 100) return;
      if (a1 !== null && !(a1 > a0)) return;
      const mg = num(b.mg) * k, times = Math.round(num(b.times));
      const t = times >= 1 && times <= 8 ? times : null;
      const dmn = num(b.dayMin) * k, dmx = num(b.dayMax) * k;
      const label = str(b.label, 40);
      if (dmn > 0 && dmx >= dmn) out.push({ a0: a0, a1: a1, label: label, fixed: false, mg: null, times: t, dayMin: dmn, dayMax: dmx });
      else if (mg > 0 && t) out.push({ a0: a0, a1: a1, label: label, fixed: true, mg: mg, times: t, dayMin: mg * t, dayMax: mg * t });
    });
    out.sort(function (x, y) { return x.a0 - y.a0; });
    return out;
  }
  function hasAge(d) { return d.bands && d.bands.length > 0; }
  function ageForm(d, f) { return !!f && hasAge(d) && d.ageNot.indexOf(f.n) < 0; }
  function hasDose(d) { return d.dmin > 0 && d.dmax > 0; }
  // 剤形の対象年齢
  function adultForm(f) { return !!f && f.ageMin !== null && f.ageMin >= ADULT_AGE; }
  function formAgeOk(f, y) {
    return !f || ((f.ageMin === null || y >= f.ageMin - 1e-9) && (f.ageMax === null || y < f.ageMax - 1e-9));
  }
  // 上限（成人量など）。体重あたり用量と同じ基準（1日量の薬は1日量、1回量の薬は1回量）で比べる
  function capFor(d) { return d.dbasis === 'dose' ? d.maxDose : d.maxDay; }
  function capWeight(d) { const c = capFor(d); return c && hasDose(d) ? c / d.dmax : null; }
  // 上限の暗記・届く体重の問題を出す薬：小児（〜15歳の平均体重）で上限に届くもの
  function capRelevant(d) {
    const cw = capWeight(d);
    return !!cw && cw <= Math.min(CAP_WMAX, ageWeightBounds(d, null)[1]);
  }
  function findForm(d, n) {
    for (const f of d.forms) if (f.n === n) return f;
    return null;
  }
  function masterStats(m) {
    let forms = 0, dose = 0, age = 0;
    for (const d of m.drugs) { forms += d.forms.length; if (hasDose(d)) dose++; if (hasAge(d)) age++; }
    return { drugs: m.drugs.length, forms: forms, withDose: dose, withAge: age, adopted: m.adopted.length };
  }

  /* ---------------- 出題対象（アイテム）一覧 ---------------- */
  // アイテム = パターン × 成分（× 製剤）。FSRSの記録はこの単位。
  // drugSet：出題する成分の id（Set）。null なら全成分
  function buildPool(m, patterns, scope, drugSet) {
    const want = Object.create(null);
    (patterns || []).forEach(function (p) { want[p] = 1; });
    const ad = scope === 'adopted' && m.adopted.length ? new Set(m.adopted) : null;
    const pool = [];
    for (const d of m.drugs) {
      if (drugSet && !drugSet.has(d.id)) continue;
      const forms = d.forms.filter(function (f) { return !ad || ad.has(f.n); });
      if (!forms.length) continue;
      const wf = forms.filter(function (f) { return weightForm(d, f); });
      if (hasDose(d)) {
        if (want.recall) pool.push(item('recall', d.id, ''));      // 用量の暗記
        if (want.w2rx) pool.push(item('w2rx', d.id, ''));
        if (want.audit) pool.push(item('audit', d.id, ''));
        wf.forEach(function (f) {
          if (want.w2prod) pool.push(item('w2prod', d.id, f.n));
          if (want.rx2w) pool.push(item('rx2w', d.id, f.n));
        });
        if (want.cap && capRelevant(d)) {                          // 上限量と、上限に届く体重の暗記
          pool.push(item('cap', d.id, '', 'capRecall'));
          pool.push(item('cap', d.id, '', 'capWeight'));
        }
      }
      // 含量の暗記（散剤・水剤。成人用の製剤も含む）
      if (want.recall) forms.forEach(function (f) { if (WEIGHT_FORMS[f.t]) pool.push(item('recall', d.id, f.n)); });
      if (hasAge(d) && forms.some(function (f) { return ageForm(d, f); })) {   // 年齢区分の薬
        if (want.recall) pool.push(item('recall', d.id, '', 'recallAge'));
        if (want.audit) pool.push(item('audit', d.id, '', 'auditAge'));
        if (want.age2rx) forms.forEach(function (f) { if (ageBandsFor(d, f).length) pool.push(item('age2rx', d.id, f.n)); });
      }
      if (want.conv) forms.forEach(function (f) { pool.push(item('conv', d.id, f.n)); });
    }
    return pool;
  }
  function item(p, id, n, kind) {
    const k = kind || p;
    return { key: k + '|' + id + '|' + n, pattern: p, kind: k, drugId: id, formN: n };
  }

  /* ---------------- 問題生成 ---------------- */
  function perSuffix(d) { return d.dbasis === 'dose' ? '/回' : '/日'; }
  function perWord(d) { return d.dbasis === 'dose' ? '1回量' : '1日量'; }
  function mgLabel(d) { return d.u + (d.potency ? '(力価)' : ''); }
  function doseUnit(d) { return mgLabel(d) + '/kg' + perSuffix(d); }
  function doseText(d) {
    return (d.dmin === d.dmax ? n2s(d.dmin) : n2s(d.dmin) + '〜' + n2s(d.dmax)) + ' ' + doseUnit(d);
  }
  function strengthText(f) { return n2s(f.s) + ' ' + f.su; }

  // 学校保健統計（令和6年度・全国平均、男女の平均）。5歳未満は目安
  const STD_WEIGHT = [[0, 3.1], [1, 9.2], [2, 11.7], [3, 13.8], [4, 15.9], [5, 18.9], [6, 21.2], [7, 24.0],
    [8, 27.3], [9, 30.9], [10, 35.1], [11, 39.9], [12, 44.9], [14, 52.3]];
  function stdWeight(age) {
    for (let i = 1; i < STD_WEIGHT.length; i++) {
      const a = STD_WEIGHT[i - 1], b = STD_WEIGHT[i];
      if (age <= b[0]) return a[1] + (b[1] - a[1]) * (age - a[0]) / (b[0] - a[0]);
    }
    return STD_WEIGHT[STD_WEIGHT.length - 1][1];
  }
  function weightAgeNote(d) { return d.weightAgeMax ? '（' + d.weightAgeMax + '歳未満）' : ''; }
  // 年齢の条件から決まる体重の範囲：体重あたり用量が○歳未満に限られる薬、剤形の対象年齢
  function ageWeightBounds(d, f) {
    let lo = 3, hi = Infinity;
    if (d.weightAgeMax) hi = stdWeight(d.weightAgeMax);
    if (f && f.ageMin !== null) lo = Math.max(lo, stdWeight(f.ageMin));
    if (f && f.ageMax !== null) hi = Math.min(hi, stdWeight(f.ageMax));
    return [lo, hi];
  }
  // 通常の問題の体重：上限（成人量など）に届かない範囲
  function rawWeightRange(d, f) {
    const ab = ageWeightBounds(d, f);
    let hi = Math.min(d.dbasis === 'dose' ? 30 : 35, Math.floor(ab[1]));
    const cw = capWeight(d);
    if (cw) hi = Math.min(hi, cw);
    return [Math.ceil(ab[0] * 2 - 1e-9) / 2, hi];
  }
  function weightRange(d, f) {
    const r = rawWeightRange(d, f);
    if (r[1] < r[0] + 2) r[1] = r[0] + 2;
    return r;
  }
  // 体重あたり用量の問題に使える製剤：散剤・水剤で、成人用でなく、体重あたり用量の対象外でもないもの
  function weightForm(d, f) {
    if (!f || !WEIGHT_FORMS[f.t] || adultForm(f) || d.weightNot.indexOf(f.n) >= 0) return false;
    const r = rawWeightRange(d, f);
    return r[1] >= r[0] + 1;
  }
  function roundW(rng, w) { return rng() < 0.4 ? Math.round(w * 2) / 2 : roundTo(w, 1); }
  function pickWeight(rng, d, f) {
    const r = weightRange(d, f);
    const w = roundW(rng, uniform(rng, r[0], r[1]));
    return Math.min(Math.max(w, r[0]), roundTo(r[1], 1));
  }
  // 上限を超える体重：体重×dose が上限の factor 倍以上になる範囲（なければ null）
  function capRange(d, f, dose, factor) {
    const cap = capFor(d);
    if (!cap || !hasDose(d) || !(dose > 0)) return null;
    const ab = ageWeightBounds(d, f);
    const lo = Math.max(ab[0], cap * factor / dose);
    const hi = Math.min(CAP_WMAX, ab[1], lo * 1.5 + 2);    // 上限の少し上を中心に
    return hi - lo >= 1 ? [lo, hi] : null;
  }
  function pickCapWeight(rng, r) {
    const w = roundW(rng, uniform(rng, r[0], r[1]));
    return Math.min(Math.max(w, Math.ceil(r[0] * 10) / 10), Math.floor(r[1] * 10) / 10);
  }
  // 体重 W のときの通常量の幅（上限で頭打ち）
  function rangeAt(d, W) {
    const cap = capFor(d);
    const lo = W * d.dmin, hi = W * d.dmax;
    return { lo: cap ? Math.min(lo, cap) : lo, hi: cap ? Math.min(hi, cap) : hi, rawLo: lo, rawHi: hi, capped: !!cap && hi > cap * (1 + 1e-9) };
  }
  // 範囲の内側（端から10%）で用量を選ぶ
  function pickInnerDose(rng, d) {
    if (d.dmin === d.dmax) return d.dmin;
    const span = d.dmax - d.dmin;
    return uniform(rng, d.dmin + span * 0.1, d.dmax - span * 0.1);
  }
  // 出題範囲（採用品）に合わせて製剤を1つ選ぶ
  //  opt.weight：体重あたり用量に使える散剤・水剤だけ
  //  opt.lp：散剤・水剤だけ（年齢区分の監査で g・mL 表記を出すため）
  //  opt.age：年齢区分を当てはめる製剤だけ。opt.ageY（歳）があれば、その年齢が対象の製剤だけ
  function pickForm(d, m, scope, rng, opt) {
    opt = opt || {};
    const ad = scope === 'adopted' && m.adopted.length ? new Set(m.adopted) : null;
    const all = d.forms.filter(function (f) {
      if (opt.weight && !weightForm(d, f)) return false;
      if (opt.lp && !WEIGHT_FORMS[f.t]) return false;
      if (opt.age && !ageForm(d, f)) return false;
      if (typeof opt.ageY === 'number' && !formAgeOk(f, opt.ageY)) return false;
      return true;
    });
    const inScope = ad ? all.filter(function (f) { return ad.has(f.n); }) : all;
    if (inScope.length) return pick(inScope, rng);
    return all.length ? pick(all, rng) : null;
  }

  function generate(it, m, rng, scope) {
    const d = m.byId[it.drugId];
    if (!d) return null;
    const f = it.formN ? findForm(d, it.formN) : null;
    if (it.formN && !f) return null;
    switch (it.kind || it.pattern) {
      case 'recallAge': return hasAge(d) ? genRecallAge(it, d, m, rng, scope) : null;
      case 'auditAge':  return hasAge(d) ? genAuditAge(it, d, m, rng, scope) : null;
      case 'age2rx':    return hasAge(d) && f ? genAge2rx(it, d, f, rng) : null;
      case 'recall': return genRecall(it, d, f, m, rng, scope);
      case 'w2rx':   return hasDose(d) ? genW2rx(it, d, rng) : null;
      case 'w2prod': return hasDose(d) && f ? genW2prod(it, d, f, rng) : null;
      case 'rx2w':   return hasDose(d) && f ? genRx2w(it, d, f, rng) : null;
      case 'conv':   return f ? genConv(it, d, f, rng) : null;
      case 'audit':  return hasDose(d) ? genAudit(it, d, m, rng, scope) : null;
      case 'capRecall': return capRelevant(d) ? genCapRecall(it, d, rng) : null;
      case 'capWeight': return capRelevant(d) ? genCapWeight(it, d, rng) : null;
    }
    return null;
  }

  // 上限の表記
  function capText(d) {
    const a = [];
    if (d.maxDose) a.push('1回' + n2s(d.maxDose) + mgLabel(d));
    if (d.maxDay) a.push('1日' + n2s(d.maxDay) + mgLabel(d));
    return a.join('・');
  }
  function capUnit(d) { return mgLabel(d) + perSuffix(d); }
  function capWhy(d) { return d.maxNote ? '［' + d.maxNote + '］' : ''; }
  // 上限（成人量など）は許容差なし：少しでも超えていれば超え（計算の誤差だけ除く）
  function overCap(d, mg) { const c = capFor(d); return !!c && mg > c * (1 + 1e-9); }
  function limitText(d) { return d.dlimit ? '（最高 ' + n2s(d.dlimit) + ' ' + doseUnit(d) + '）' : ''; }
  function doseMemo(d) {
    return d.name + '　' + doseText(d) + weightAgeNote(d) + limitText(d) + (capText(d) ? '（上限 ' + capText(d) + '）' : '');
  }
  // 体重×用量が上限を超えたときの説明
  function capLine(d, raw) {
    const cap = capFor(d);
    return '→ 上限 ' + fmt(cap, 'mg') + capUnit(d) + capWhy(d) + 'を超えるので ' + fmt(cap, 'mg') + capUnit(d) +
      '（体重あたりで計算した量の' + Math.round(cap / raw * 100) + '%）';
  }

  // memo：解説で示す「覚えること」（問題中には出さない）
  function base(it, d, f) {
    const memo = [];
    if (hasDose(d)) memo.push(doseMemo(d));
    if (f) memo.push(f.n + '　' + strengthText(f));
    return {
      key: it.key, pattern: it.pattern, kind: it.kind || it.pattern, drugId: d.id, formN: f ? f.n : '',
      title: f ? f.n : d.name,
      sub: f ? d.name + '・' + FORM_LABEL[f.t] : (d.brand ? d.brand : ''),
      facts: [], ask: '', unit: '', fu: '',
      answer: null, distractors: [], explain: [], memo: memo, note: d.dnote || ''
    };
  }
  function boundInfo(d, rng) {
    if (d.dmin === d.dmax) return { which: 'one', dose: d.dmin, other: null };
    return rng() < 0.5 ? { which: 'min', dose: d.dmin, other: d.dmax } : { which: 'max', dose: d.dmax, other: d.dmin };
  }
  function boundAsk(b, word, d) {
    if (b.which === 'one') return word + '（' + perWord(d) + '）は？';
    return '通常量の' + (b.which === 'max' ? '上限' : '下限') + '（' + perWord(d) + '）は？';
  }
  // 体重 W・量 mg の位置づけ（判定の基準と同じ：端数の丸めで±5%以内は範囲内とみなす）
  function relText(d, W, mg) {
    const perKg = mg / W, cap = capFor(d);
    if (overCap(d, mg)) {
      const k = perKg <= d.dmax * 1.05 && perKg >= d.dmin * 0.95 ? '体重あたりは範囲内' : (perKg > d.dmax * 1.05 ? '体重あたりも上限の' + Math.round(perKg / d.dmax * 100) + '%' : '');
      return (k ? k + '・' : '') + '上限' + fmt(cap, 'mg') + capUnit(d) + 'の' + String(Math.round(mg / cap * 1000) / 10) + '%';
    }
    const r = rangeAt(d, W);
    if (r.capped && mg >= r.lo * 0.95) return '上限で頭打ちの量';
    if (perKg > d.dmax * 1.05) {
      const t = '上限の' + Math.round(perKg / d.dmax * 100) + '%';
      return d.dlimit && perKg <= d.dlimit * 1.05 ? t + '・最高量以内' : t;
    }
    if (perKg < d.dmin * 0.95) return '下限の' + Math.round(perKg / d.dmin * 100) + '%';
    return '範囲内';
  }

  // 用量・含量の暗記（計算なし）
  function genRecall(it, d, f, m, rng, scope) {
    if (!f) {                                   // 小児用量
      if (!hasDose(d)) return null;
      // 見せる製剤は、体重あたり用量を当てはめる製剤から（なければ成人用以外の製剤）
      const shown = pickForm(d, m, scope, rng, { weight: true }) ||
        d.forms.filter(function (x) { return !adultForm(x) && d.weightNot.indexOf(x.n) < 0; })[0] || null;
      const p = base(it, d, shown);
      p.formN = '';                              // 記録は成分単位
      p.sub = d.name + (d.brand ? '（' + d.brand + '）' : '');
      p.memo = [p.memo[0]];
      const b = boundInfo(d, rng);
      const who = d.weightAgeMax ? d.weightAgeMax + '歳未満の' : '';
      p.ask = b.which === 'one' ? who + '小児用量は？' : who + '小児用量の' + (b.which === 'max' ? '上限' : '下限') + 'は？';
      p.fu = 'mg'; p.unit = doseUnit(d);
      p.answer = { type: 'point', value: b.dose, tol: tolFor(b.dose, 'mg') };
      p.distractors = [b.other, d.dlimit, b.dose * 2, b.dose / 2, d.dbasis === 'day' ? b.dose / 3 : b.dose * 3, b.dose * 10, b.dose / 10];
      p.explain = [d.name + '：' + doseText(d) + weightAgeNote(d) + limitText(d)];
      if (capText(d)) p.explain.push('上限 ' + capText(d) + capWhy(d));
      if (d.weightNot.length) p.explain.push('体重あたり量の対象外：' + d.weightNot.join('、'));
      return p;
    }
    const p = base(it, d, f);                    // 含量
    p.memo = [p.memo[p.memo.length - 1]];
    p.ask = '含量は？';
    p.fu = 'mg'; p.unit = f.su;
    p.answer = { type: 'point', value: f.s, tol: tolFor(f.s, 'mg') };
    p.distractors = [f.s * 10, f.s / 10, f.s * 2, f.s / 2, f.s * 5, f.s / 5];
    p.explain = [f.n + '：' + strengthText(f)];
    return p;
  }

  // 体重を選ぶ。一部（RATES.capCalc）は上限で頭打ちになる体重（大きめの子）にする
  function pickWeightMaybeCap(rng, d, f, dose) {
    if (capFor(d) && rng() < RATES.capCalc) {
      const r = capRange(d, f, dose, 1.08);
      if (r) return pickCapWeight(rng, r);
    }
    return pickWeight(rng, d, f);
  }
  function rangeLine(d, W, div, u) {
    const r = rangeAt(d, W);
    const unit = (u || mgLabel(d)) + perSuffix(d), q = function (v) { return fmt(v / (div || 1), u || 'mg'); };
    if (!r.capped) return '通常量の幅：' + q(r.lo) + '〜' + q(r.hi) + unit;
    return '通常量の幅：' + q(r.rawLo) + '〜' + q(r.rawHi) + ' → 上限で頭打ち：' + (r.lo < r.hi ? q(r.lo) + '〜' : '') + q(r.hi) + unit;
  }

  // 体重 → 処方量（成分量）。上限（成人量など）を超える体重では上限が正解
  function genW2rx(it, d, rng) {
    const p = base(it, d, null);
    const b = boundInfo(d, rng);
    const W = pickWeightMaybeCap(rng, d, null, b.dose);
    const raw = W * b.dose, cap = capFor(d);
    const v = cap && raw > cap * (1 + 1e-9) ? cap : raw;
    p.facts = [{ k: '体重', v: fmt(W, 'kg') + ' kg' }];
    p.ask = boundAsk(b, '成分量', d);
    p.fu = 'mg'; p.unit = mgLabel(d) + perSuffix(d);
    p.answer = { type: 'point', value: v, tol: tolFor(v, 'mg') };
    p.distractors = [v !== raw ? raw : (b.other ? W * b.other : null), v * 10, v / 10,
      d.dbasis === 'day' ? v / 3 : v * 3, v * 2, v / 2];
    p.explain = [fmt(W, 'kg') + 'kg × ' + n2s(b.dose) + doseUnit(d) + ' = ' + fmt(raw, 'mg') + mgLabel(d) + perSuffix(d)];
    if (v !== raw) p.explain.push(capLine(d, raw));
    if (b.other) p.explain.push(rangeLine(d, W));
    return p;
  }

  // 体重 → 製剤量
  function genW2prod(it, d, f, rng) {
    const p = base(it, d, f);
    const b = boundInfo(d, rng);
    const W = pickWeightMaybeCap(rng, d, f, b.dose);
    const raw = W * b.dose, cap = capFor(d);
    const mg = cap && raw > cap * (1 + 1e-9) ? cap : raw;
    const u = PROD_UNIT[f.t];
    const v = mg / f.s;
    p.facts = [{ k: '体重', v: fmt(W, 'kg') + ' kg' }];
    p.ask = boundAsk(b, '製剤量', d);
    p.fu = u; p.unit = u + perSuffix(d);
    p.answer = { type: 'point', value: v, tol: tolFor(v, u) };
    p.distractors = [mg !== raw ? raw / f.s : (b.other ? W * b.other / f.s : null), v * 10, v / 10, v * 2, v / 2,
      d.dbasis === 'day' ? v / 3 : v * 3];
    p.explain = [fmt(W, 'kg') + 'kg × ' + n2s(b.dose) + doseUnit(d) + ' = ' + fmt(raw, 'mg') + mgLabel(d) + perSuffix(d)];
    if (mg !== raw) p.explain.push(capLine(d, raw));
    p.explain.push(fmt(mg, 'mg') + d.u + ' ÷ ' + strengthText(f) + ' = ' + fmt(v, u) + u + perSuffix(d));
    if (b.other) p.explain.push(rangeLine(d, W, f.s, u));
    return p;
  }

  // 処方箋の書き方：たいてい製剤量、まれに成分量。どちらかは明記されない。
  // 散剤の成分量は g で書かれることもあり、その場合は製剤量と見た目では区別できない。
  function rxNotation(d, f, mgRaw, rng, allowGram, perOverride) {
    const per = perOverride || perSuffix(d);
    if (!f || rng() < RATES.mg) {
      if (f && f.t === 'powder' && allowGram && d.u === 'mg' && rng() < 0.5) {
        const g = rnd(mgRaw / 1000, 'g');
        return { kind: 'mg', text: fmt(g, 'g') + ' g' + per, mg: g * 1000, amount: g, unit: 'g' };
      }
      const a = rnd(mgRaw, 'mg');
      return { kind: 'mg', text: fmt(a, 'mg') + ' ' + mgLabel(d) + per, mg: a, amount: a, unit: 'mg' };
    }
    const u = PROD_UNIT[f.t];
    const a = rnd(mgRaw / f.s, u);
    return { kind: 'prod', text: fmt(a, u) + ' ' + u + per, mg: a * f.s, amount: a, unit: u };
  }
  // 表示された量の読み方。散剤の g 表記は「製剤量」「成分量」の2通り（製剤量を先に）。
  function readings(rx, f, d) {
    // g 表記を成分量とも読むのは mg 単位の薬だけ（μg の薬の成分量を g で書くことはない）
    if (f && f.t === 'powder' && rx.unit === 'g' && (!d || d.u === 'mg')) {
      return [{ kind: 'prod', mg: rx.amount * f.s }, { kind: 'mg', mg: rx.amount * 1000 }];
    }
    return [{ kind: rx.kind, mg: rx.mg }];
  }
  function readingLine(d, f, rx, r, W) {
    const per = perSuffix(d);
    const head = r.kind === 'prod' ? '製剤量として：' + fmt(rx.amount, rx.unit) + rx.unit + ' × ' + strengthText(f) + ' = '
      : (rx.unit === 'g' ? '成分量として：' + fmt(rx.amount, 'g') + 'g = ' : '成分量（' + d.u + '表記）：');
    let s = head + fmt(r.mg, 'mg') + mgLabel(d) + per;
    if (W) s += '（' + fmt(r.mg / W, 'mg') + d.u + '/kg' + per + '・' + relText(d, W, r.mg) + '）';
    return s;
  }

  // 処方量 → 体重（体重が分からないので、g表記の成分量は出さない）
  function genRx2w(it, d, f, rng) {
    const p = base(it, d, f);
    const W = pickWeight(rng, d, f);
    const dose = pickInnerDose(rng, d);
    const rx = rxNotation(d, f, W * dose, rng, false);
    p.facts = [{ k: '処方', v: rx.text }];
    p.fu = 'kg'; p.unit = 'kg';
    const lo = rx.mg / d.dmax, hi = rx.mg / d.dmin;
    const rep = rx.mg / dose;
    if (d.dmin === d.dmax) {
      p.ask = '何kgの患者さんの量？';
      p.answer = { type: 'point', value: lo, tol: tolFor(lo, 'kg') };
    } else {
      p.ask = '何kgの患者さんの量？（幅の中なら正解）';
      p.answer = { type: 'range', lo: lo, hi: hi, rep: rep, tolLo: tolFor(lo, 'kg'), tolHi: tolFor(hi, 'kg') };
    }
    const c = d.dmin === d.dmax ? lo : rep;
    p.distractors = [c * 2, c / 2, c * 3, c / 3, c * 1.5, c / 1.5, c * 10];
    p.explain = [readingLine(d, f, rx, readings(rx, f, d)[0], 0)];
    if (d.dmin === d.dmax) {
      p.explain.push(fmt(rx.mg, 'mg') + ' ÷ ' + n2s(d.dmin) + ' = ' + fmt(lo, 'kg') + 'kg');
    } else {
      p.explain.push(fmt(rx.mg, 'mg') + ' ÷ ' + n2s(d.dmax) + ' = ' + fmt(lo, 'kg') + 'kg（上限用量なら）');
      p.explain.push(fmt(rx.mg, 'mg') + ' ÷ ' + n2s(d.dmin) + ' = ' + fmt(hi, 'kg') + 'kg（下限用量なら）');
      p.explain.push('→ ' + fmt(lo, 'kg') + '〜' + fmt(hi, 'kg') + 'kg 相当');
    }
    return p;
  }

  // 処方量（成分量）↔ 製剤量
  function genConv(it, d, f, rng) {
    const p = base(it, d, f);
    const u = PROD_UNIT[f.t];
    let prod;
    if (WEIGHT_FORMS[f.t]) {
      if (hasDose(d) && weightForm(d, f)) prod = rnd(pickWeight(rng, d, f) * pickInnerDose(rng, d) / f.s, u);
      else if (f.t === 'powder') prod = Math.round(uniform(rng, 0.2, 2.0) * 20) / 20;
      else prod = Math.round(uniform(rng, 1, 15) * 2) / 2;
      if (!(prod > 0)) prod = f.t === 'powder' ? 0.5 : 5;
    } else if (f.t === 'tablet' && !f.sr) {
      prod = pick([0.5, 1, 1, 1.5, 2, 2, 3, 4], rng);
    } else {
      prod = pick([1, 1, 2, 2, 3, 4], rng);
    }
    const mg = prod * f.s;
    if (rng() < 0.5) {      // 成分量 → 製剤量
      p.facts = [{ k: '成分量', v: fmt(mg, 'mg') + ' ' + mgLabel(d) }];
      p.ask = '製剤量は？';
      p.fu = u; p.unit = u;
      p.answer = { type: 'point', value: prod, tol: tolFor(prod, u) };
      p.distractors = WEIGHT_FORMS[f.t]
        ? [prod * 10, prod / 10, prod * 2, prod / 2, prod * 5, prod / 5]
        : [prod * 2, prod / 2, prod + (f.t === 'tablet' ? 0.5 : 1), prod - (f.t === 'tablet' ? 0.5 : 1), prod * 4];
      p.explain = [fmt(mg, 'mg') + d.u + ' ÷ ' + strengthText(f) + ' = ' + fmt(prod, u) + u];
    } else {                // 製剤量 → 成分量
      p.facts = [{ k: '製剤量', v: fmt(prod, u) + ' ' + u }];
      p.ask = '成分量は？';
      p.fu = 'mg'; p.unit = mgLabel(d);
      p.answer = { type: 'point', value: mg, tol: tolFor(mg, 'mg') };
      p.distractors = [mg * 10, mg / 10, mg * 2, mg / 2, mg * 5, mg / 5];
      p.explain = [fmt(prod, u) + u + ' × ' + strengthText(f) + ' = ' + fmt(mg, 'mg') + mgLabel(d)];
    }
    return p;
  }

  // 監査判定（少ない／適正／多い）
  // 判定のルール：どちらかの読み方で通常量に入れば「適正」。
  // どちらの読み方でも入らなければ、製剤量として読んで少ない／多いを判定（疑義照会）。
  // 体重 W の患者に mg（1日量または1回量）の判定。
  //  多い：上限（成人量など）を少しでも超える（許容差なし）
  //  適正：通常量（上限で頭打ち）の±5%以内。ただし上限は超えない
  //  少ない：下限の75%未満／多い：通常量の上限の130%超（最高量のある薬は最高量の110%超）
  //  その間は現場で判断が分かれるため出題しない（gray）
  function classifyW(d, W, mg) {
    const cap = capFor(d), r = rangeAt(d, W);
    if (overCap(d, mg)) return 'high';
    if (mg >= r.lo * 0.95 && mg <= (cap ? Math.min(r.hi * 1.05, cap) : r.hi * 1.05)) return 'ok';
    if (mg < r.lo * 0.75) return 'low';
    const hard = d.dlimit ? (cap ? Math.min(W * d.dlimit, cap) : W * d.dlimit) : 0;
    if (mg > Math.max(r.hi * 1.3, hard * 1.1)) return 'high';
    return 'gray';
  }
  // 体重あたりは範囲内で、上限（成人量など）だけを超えている
  function capOnlyHigh(d, W, mg) {
    const perKg = mg / W;
    return overCap(d, mg) && perKg >= d.dmin * 0.95 && perKg <= d.dmax * 1.05;
  }
  function genAudit(it, d, m, rng, scope) {
    const f = pickForm(d, m, scope, rng, { weight: true });
    const cap = capFor(d);
    let g = null;
    for (let t = 0; t < 120 && !g; t++) {
      let target = pick(['low', 'ok', 'high'], rng), mode = 'normal', W, mgRaw;
      if (cap && rng() < RATES.capAudit) {
        if (rng() < 0.65) {
          // 体重あたりは通常量の範囲内だが、大きい子なので上限（成人量など）を超える → 多い（少しでも超えれば多い）
          const dose = d.dmin === d.dmax ? d.dmin : uniform(rng, d.dmin + (d.dmax - d.dmin) * 0.3, d.dmax);
          const r = capRange(d, f, dose, 1.01);
          if (!r) continue;
          target = 'high'; mode = 'capHigh'; W = pickCapWeight(rng, r); mgRaw = W * dose;
        } else {
          // 大きい子に上限どおりの量（成人量）→ 適正（頭打ち）
          const r = capRange(d, f, d.dmax, 1.05);
          if (!r) continue;
          target = 'ok'; mode = 'capOk'; W = pickCapWeight(rng, r);
          mgRaw = rng() < 0.6 ? cap : Math.max(W * d.dmin, cap * uniform(rng, 0.85, 1.0));
        }
      } else {
        W = pickWeight(rng, d, f);
        let dose;
        if (target === 'ok') dose = d.dmin === d.dmax ? d.dmin * uniform(rng, 0.98, 1.02) : pickInnerDose(rng, d);
        else if (target === 'low') dose = d.dmin * uniform(rng, 0.2, 0.7);
        else {
          const hb = d.dlimit ? Math.max(d.dmax * 1.4, d.dlimit * 1.15) : d.dmax * 1.4;
          dose = rng() < 0.2 ? pickInnerDose(rng, d) * 10 : hb * uniform(rng, 1, 1.8);
        }
        mgRaw = W * dose;
      }
      const rx = rxNotation(d, f, mgRaw, rng, true);
      const rs = readings(rx, f, d).map(function (r) { return { kind: r.kind, mg: r.mg, cls: classifyW(d, W, r.mg) }; });
      if (rs.some(function (r) { return r.cls === 'gray'; })) continue;
      const ans = rs.some(function (r) { return r.cls === 'ok'; }) ? 'ok' : rs[0].cls;
      if (ans !== target) continue;
      if (mode === 'capHigh' && !capOnlyHigh(d, W, rs[0].mg)) continue;
      g = { W: W, rx: rx, rs: rs, ans: ans, mode: mode };
    }
    if (!g) {             // まれな失敗時：mg表記で適正量
      const W = pickWeight(rng, d, f);
      const rx = rxNotation(d, null, W * pickInnerDose(rng, d), rng, false);
      g = { W: W, rx: rx, rs: [{ kind: 'mg', mg: rx.mg, cls: 'ok' }], ans: 'ok', mode: 'normal' };
    }
    const p = base(it, d, f);
    p.facts = [{ k: '体重', v: fmt(g.W, 'kg') + ' kg' }, { k: '処方', v: g.rx.text }];
    p.ask = 'この処方量は？';
    p.answer = { type: 'choice', value: g.ans };
    const ra = rangeAt(d, g.W);
    let line = '通常量：' + fmt(g.W, 'kg') + 'kg × ' + (d.dmin === d.dmax ? n2s(d.dmin) : n2s(d.dmin) + '〜' + n2s(d.dmax)) +
      ' = ' + (d.dmin === d.dmax ? fmt(ra.rawLo, 'mg') : fmt(ra.rawLo, 'mg') + '〜' + fmt(ra.rawHi, 'mg')) + mgLabel(d) + perSuffix(d);
    if (ra.capped) line += ' → 上限 ' + fmt(cap, 'mg') + capUnit(d) + 'で頭打ち';
    p.explain = [line];
    if (cap && (ra.capped || g.rs.some(function (r) { return overCap(d, r.mg); }))) p.explain.push('上限：' + capText(d) + capWhy(d) + '（少しでも超えたら多い）');
    g.rs.forEach(function (r) { p.explain.push(readingLine(d, f, g.rx, r, g.W)); });
    const label = AUDIT_CHOICES.filter(function (c) { return c.value === g.ans; })[0].label;
    let why = '';
    if (g.rs.length > 1) {
      if (g.ans === 'ok') why = g.rs[0].cls === 'ok' ? '（製剤量で書かれた処方）' : '（成分量で書かれた処方と判断）';
      else why = '（どちらで読んでも合わない → 製剤量として判定・疑義照会）';
    } else if (g.ans !== 'ok') why = '（疑義照会）';
    p.explain.push('→ ' + label + why);
    if (g.ans === 'high' && capOnlyHigh(d, g.W, g.rs[0].mg)) p.explain.push('※ 体重あたりでは正しくても、大きい子では上限（成人量など）を超える典型パターン');
    else if (g.ans === 'high' && g.rs[0].mg / g.W > d.dmax * 5) p.explain.push('※ 桁違い（10倍量）の典型パターン');
    if (g.ans === 'ok' && ra.capped) p.explain.push('※ 体重あたりで計算すると上限を超える子。上限（成人量など）までの量なら適正');
    return p;
  }

  /* ---------------- 上限（成人量など）の暗記 ---------------- */
  // 上限量そのもの
  function genCapRecall(it, d, rng) {
    const p = base(it, d, null);
    p.chip = '上限量';
    p.sub = d.name + (d.brand ? '（' + d.brand + '）' : '');
    p.memo = [doseMemo(d)];
    const both = d.maxDose && d.maxDay;
    const which = both ? (rng() < 0.5 ? 'dose' : 'day') : (d.maxDose && !d.maxDay ? 'dose' : 'day');
    const v = which === 'dose' ? d.maxDose : d.maxDay;
    const other = which === 'dose' ? d.maxDay : d.maxDose;
    p.ask = '上限（' + (which === 'dose' ? '1回量' : '1日量') + '）は？';
    p.fu = 'mg'; p.unit = mgLabel(d) + (which === 'dose' ? '/回' : '/日');
    p.answer = { type: 'point', value: v, tol: tolFor(v, 'mg') };
    p.distractors = [other || null, v * 1.5, v / 2, v * 2, v / 1.5, which === 'day' ? v / 3 : v * 3, v * 10];
    p.explain = [d.name + '：上限 ' + capText(d) + capWhy(d)];
    p.explain.push('体重あたり ' + doseText(d) + ' で計算した量が、これを超えたら上限で止める（超えていれば疑義照会）');
    return p;
  }
  // 上限に届く体重（体重あたり量で計算した量が上限を超えはじめる体重）
  function genCapWeight(it, d, rng) {
    const p = base(it, d, null);
    p.chip = '上限の体重';
    p.sub = d.name + (d.brand ? '（' + d.brand + '）' : '');
    p.memo = [doseMemo(d)];
    const cap = capFor(d), cw = cap / d.dmax;
    p.ask = (d.dmin === d.dmax ? '通常量' : '通常量の上限') + 'で計算すると、何kgで上限（' + (d.dbasis === 'dose' ? '1回量' : '1日量') + '）に届く？';
    p.fu = 'kg'; p.unit = 'kg';
    p.answer = { type: 'point', value: cw, tol: Math.max(tolFor(cw, 'kg'), 0.25) };
    p.distractors = [d.dmin !== d.dmax ? cap / d.dmin : null, cw * 2, cw / 2, d.dbasis === 'day' ? cw * 3 : cw / 3, cw * 1.5, cw / 1.5];
    p.explain = [fmt(cap, 'mg') + capUnit(d) + ' ÷ ' + n2s(d.dmax) + ' ' + doseUnit(d) + ' = ' + fmt(cw, 'kg') + 'kg',
      '→ ' + fmt(cw, 'kg') + 'kgを超える子は、体重あたりで計算した量が上限 ' + capText(d) + capWhy(d) + 'を超えないか確認'];
    if (d.dmin !== d.dmax) p.explain.push('下限（' + n2s(d.dmin) + '）なら ' + fmt(cap / d.dmin, 'kg') + 'kgで届く');
    return p;
  }

  /* ---------------- 年齢区分の問題 ---------------- */
  function formAgeText(f) {
    if (!f || (f.ageMin === null && f.ageMax === null)) return '';
    if (adultForm(f)) return '（成人用）';
    if (f.ageMax === null) return '（' + ageLabel(f.ageMin) + '以上）';
    return '（' + (f.ageMin ? ageLabel(f.ageMin) + '以上' : '') + ageLabel(f.ageMax) + '未満）';
  }
  function ageLabel(y) {
    if (y < 1) return Math.round(y * 12) + 'ヵ月';
    const yy = Math.floor(y + 1e-9), mm = Math.round((y - yy) * 12);
    return yy + '歳' + (mm ? mm + 'ヵ月' : '');
  }
  function bandLabel(b) {
    if (b.label) return b.label;            // 添付文書の表記をそのまま使う
    if (b.a0 === 0) return b.a1 === null ? '全年齢' : ageLabel(b.a1) + '未満';
    return ageLabel(b.a0) + '以上' + (b.a1 === null ? '' : ageLabel(b.a1) + '未満');
  }
  function bandDose(d, b) {
    if (b.fixed) return '1回' + n2s(b.mg) + mgLabel(d) + '×' + b.times + '回（' + n2s(b.dayMin) + mgLabel(d) + '/日）';
    return n2s(b.dayMin) + '〜' + n2s(b.dayMax) + mgLabel(d) + '/日' + (b.times ? '（分' + b.times + '）' : '');
  }
  function ageMemo(d) {
    let t = d.name + '　' + d.bands.map(function (b) { return bandLabel(b) + ' ' + bandDose(d, b); }).join('／');
    if (d.ageNot.length) {
      const ok = d.forms.filter(function (f) { return ageForm(d, f); }).map(function (f) { return f.n; });
      if (ok.length) t += '（年齢表の対象：' + ok.join('、') + '）';
    }
    const fa = d.forms.filter(function (f) { return ageForm(d, f) && formAgeText(f); }).map(function (f) { return f.n + formAgeText(f); });
    if (fa.length) t += '［剤形の対象年齢：' + fa.join('、') + '］';
    return t;
  }
  function ageText(mo) {
    if (mo < 12) return mo + 'ヵ月';
    const y = Math.floor(mo / 12), r = mo % 12;
    return y + '歳' + (r ? r + 'ヵ月' : '');
  }
  // 区分と剤形の対象年齢の重なり（重ならなければ null）
  function clipBand(b, f) {
    if (!f) return b;
    const a0 = Math.max(b.a0, f.ageMin === null ? 0 : f.ageMin);
    const e1 = b.a1 === null ? Infinity : b.a1, f1 = f.ageMax === null ? Infinity : f.ageMax;
    const a1 = Math.min(e1, f1);
    if (!(a1 > a0 + 1e-9)) return null;
    return { a0: a0, a1: a1 === Infinity ? null : a1 };
  }
  // 区分の中から年齢（月齢）を選ぶ。2割は区分の下限ちょうど（境目の取り違えを練習）
  function pickAgeMonths(b, rng, f) {
    b = clipBand(b, f) || b;
    const m0 = Math.max(1, Math.ceil(b.a0 * 12 - 1e-9));
    const m1 = Math.max(m0, b.a1 === null ? m0 + 36 : Math.ceil(b.a1 * 12 - 1e-9) - 1);
    if (rng() < 0.2) return m0;
    let mo = m0 + Math.floor(rng() * (m1 - m0 + 1));
    if (rng() < 0.5 && mo >= 12) { const y = Math.floor(mo / 12) * 12; if (y >= m0) mo = y; }
    return mo;
  }
  function neighborBands(d, b) {
    const i = d.bands.indexOf(b);
    return { lower: i > 0 ? d.bands[i - 1] : null, upper: i < d.bands.length - 1 ? d.bands[i + 1] : null };
  }
  // 剤形の対象年齢と重なる区分だけ使う（例：アレグラ錠30mgは7歳以上、キプレス細粒は1〜6歳未満）。
  // 錠・カプセル・包・坐剤は、1回量が1個単位になる区分だけ使う（分割錠での小児投与は出さない）
  function ageBandsFor(d, f) {
    if (!ageForm(d, f)) return [];
    const inAge = d.bands.filter(function (b) { return !!clipBand(b, f); });
    if (WEIGHT_FORMS[f.t]) return inAge;
    return inAge.filter(function (b) {
      if (!b.fixed) return false;
      const per = b.mg / f.s, day = b.dayMin / f.s;
      const ok = function (v) { return Math.abs(v - Math.round(v)) < 1e-6 && v >= 1 && v <= 8; };
      return ok(per) && ok(day);
    });
  }

  // 年齢 → 処方量（製剤量の1日量）
  function genAge2rx(it, d, f, rng) {
    const bands = ageBandsFor(d, f);
    if (!bands.length) return null;
    const b = pick(bands, rng);
    const mo = pickAgeMonths(b, rng, f);
    const u = PROD_UNIT[f.t];
    const p = base(it, d, f);
    p.chip = '年齢→処方量';
    p.memo = [ageMemo(d), f.n + '　' + strengthText(f) + formAgeText(f)];
    p.facts = [{ k: '年齢', v: ageText(mo) }];
    let mgDay, which = 'one';
    if (b.fixed) { mgDay = b.dayMin; p.ask = '製剤量（1日量）は？'; }
    else {
      which = rng() < 0.5 ? 'min' : 'max';
      mgDay = which === 'min' ? b.dayMin : b.dayMax;
      p.ask = '通常量の' + (which === 'max' ? '上限' : '下限') + '（1日量・製剤量）は？';
    }
    const v = mgDay / f.s;
    p.fu = u; p.unit = u + '/日';
    p.answer = { type: 'point', value: v, tol: tolFor(v, u) };
    const nb = neighborBands(d, b);
    const nv = function (x) { return x ? (which === 'max' ? x.dayMax : x.dayMin) / f.s : null; };
    p.distractors = [nv(nb.upper) || nv(nb.lower), nv(nb.lower), b.fixed ? b.mg / f.s : null,
      !b.fixed ? (which === 'max' ? b.dayMin : b.dayMax) / f.s : null, v * 2, v / 2, v * 10, v / 10];
    p.explain = [ageText(mo) + ' → ' + bandLabel(b) + '：' + bandDose(d, b),
      fmt(mgDay, 'mg') + d.u + ' ÷ ' + strengthText(f) + ' = ' + fmt(v, u) + u + '/日'];
    if (!b.fixed) p.explain.push('通常量の幅：' + fmt(b.dayMin / f.s, u) + '〜' + fmt(b.dayMax / f.s, u) + u + '/日');
    return p;
  }

  // 年齢 → 用量の暗記（成分量）。見せる製剤はその年齢が対象のもの
  function genRecallAge(it, d, m, rng, scope) {
    const b = pick(d.bands, rng);
    const mo = pickAgeMonths(b, rng);
    const shown = pickForm(d, m, scope, rng, { age: true, ageY: mo / 12 });
    const p = base(it, d, shown);
    p.formN = '';
    p.chip = '年齢別用量';
    p.sub = d.name + (d.brand ? '（' + d.brand + '）' : '');
    p.memo = [ageMemo(d)];
    p.facts = [{ k: '年齢', v: ageText(mo) }];
    const nb = neighborBands(d, b);
    let v;
    if (b.fixed && rng() < 0.5) {
      v = b.mg; p.ask = '1回量は？'; p.unit = mgLabel(d) + '/回';
      p.distractors = [nb.upper && nb.upper.fixed ? nb.upper.mg : null, nb.lower && nb.lower.fixed ? nb.lower.mg : null,
        b.dayMin !== b.mg ? b.dayMin : null, v * 2, v / 2, v * 4];
    } else if (b.fixed) {
      v = b.dayMin; p.ask = '1日量は？'; p.unit = mgLabel(d) + '/日';
      p.distractors = [nb.upper ? nb.upper.dayMin : null, nb.lower ? nb.lower.dayMin : null,
        b.mg !== v ? b.mg : null, v * 2, v / 2, v * 4];
    } else {
      const max = rng() < 0.5;
      v = max ? b.dayMax : b.dayMin;
      p.ask = '1日量の' + (max ? '上限' : '下限') + 'は？'; p.unit = mgLabel(d) + '/日';
      p.distractors = [max ? b.dayMin : b.dayMax, nb.upper ? (max ? nb.upper.dayMax : nb.upper.dayMin) : null,
        nb.lower ? (max ? nb.lower.dayMax : nb.lower.dayMin) : null, v * 2, v / 2];
    }
    p.fu = 'mg';
    p.answer = { type: 'point', value: v, tol: tolFor(v, 'mg') };
    p.explain = [ageText(mo) + ' → ' + bandLabel(b) + '：' + bandDose(d, b)];
    return p;
  }

  // 年齢区分の監査判定。決まった量の薬は±5%を外れたら少ない／多い、
  // 幅のある薬は体重の監査と同じく境目のあいまいな量は出さない。
  function classifyBand(b, mg) {
    if (b.fixed) {
      if (mg >= b.dayMin * 0.95 && mg <= b.dayMax * 1.05) return 'ok';
      return mg < b.dayMin ? 'low' : 'high';
    }
    if (mg >= b.dayMin * 0.95 && mg <= b.dayMax * 1.05) return 'ok';
    if (mg < b.dayMin * 0.75) return 'low';
    if (mg > b.dayMax * 1.3) return 'high';
    return 'gray';
  }
  function bandRel(b, mg) {
    const c = classifyBand(b, mg);
    if (c === 'ok') return '通常量どおり';
    if (mg < b.dayMin) return (b.fixed ? '通常量' : '下限') + 'の' + Math.round(mg / b.dayMin * 100) + '%';
    return (b.fixed ? '通常量' : '上限') + 'の' + Math.round(mg / b.dayMax * 100) + '%';
  }
  function genAuditAge(it, d, m, rng, scope) {
    let g = null, f = null;
    for (let t = 0; t < 80 && !g; t++) {
      const target = pick(['low', 'ok', 'high'], rng);
      const b = pick(d.bands, rng);
      const mo = pickAgeMonths(b, rng);
      // その年齢が対象の散剤・水剤（なければ成分量の表記で出す）
      f = pickForm(d, m, scope, rng, { lp: true, age: true, ageY: mo / 12 });
      const nb = neighborBands(d, b);
      let mg;
      if (target === 'ok') mg = b.fixed ? b.dayMin : uniform(rng, b.dayMin + (b.dayMax - b.dayMin) * 0.1, b.dayMax - (b.dayMax - b.dayMin) * 0.1);
      else if (target === 'low') mg = (nb.lower && rng() < 0.5) ? (nb.lower.dayMin + nb.lower.dayMax) / 2 : b.dayMin * uniform(rng, 0.2, 0.7);
      else mg = (nb.upper && rng() < 0.5) ? (nb.upper.dayMin + nb.upper.dayMax) / 2 : (rng() < 0.2 ? b.dayMax * 10 : b.dayMax * uniform(rng, 1.4, 2.5));
      const rx = rxNotation(d, f, mg, rng, true, '/日');
      const rs = readings(rx, f, d).map(function (r) { return { kind: r.kind, mg: r.mg, cls: classifyBand(b, r.mg) }; });
      if (rs.some(function (r) { return r.cls === 'gray'; })) continue;
      const ans = rs.some(function (r) { return r.cls === 'ok'; }) ? 'ok' : rs[0].cls;
      if (ans !== target) continue;
      g = { b: b, mo: mo, rx: rx, rs: rs, ans: ans };
    }
    if (!g) {
      const b = pick(d.bands, rng);
      f = null;
      const rx = rxNotation(d, null, b.dayMin, rng, false, '/日');
      g = { b: b, mo: pickAgeMonths(b, rng), rx: rx, rs: [{ kind: 'mg', mg: rx.mg, cls: classifyBand(b, rx.mg) }], ans: classifyBand(b, rx.mg) };
    }
    const p = base(it, d, f);
    p.chip = '監査（年齢）';
    p.memo = [ageMemo(d)].concat(f ? [f.n + '　' + strengthText(f)] : []);
    p.facts = [{ k: '年齢', v: ageText(g.mo) }, { k: '処方', v: g.rx.text }];
    p.ask = 'この処方量は？';
    p.answer = { type: 'choice', value: g.ans };
    p.explain = [ageText(g.mo) + ' → ' + bandLabel(g.b) + '：' + bandDose(d, g.b)];
    g.rs.forEach(function (r) {
      const head = r.kind === 'prod' ? '製剤量として：' + fmt(g.rx.amount, g.rx.unit) + g.rx.unit + ' × ' + strengthText(f) + ' = '
        : (g.rx.unit === 'g' ? '成分量として：' + fmt(g.rx.amount, 'g') + 'g = ' : '成分量（' + d.u + '表記）：');
      p.explain.push(head + fmt(r.mg, 'mg') + mgLabel(d) + '/日（' + bandRel(g.b, r.mg) + '）');
    });
    const label = AUDIT_CHOICES.filter(function (c) { return c.value === g.ans; })[0].label;
    let why = '';
    if (g.rs.length > 1) {
      if (g.ans === 'ok') why = g.rs[0].cls === 'ok' ? '（製剤量で書かれた処方）' : '（成分量で書かれた処方と判断）';
      else why = '（どちらで読んでも合わない → 製剤量として判定・疑義照会）';
    } else if (g.ans !== 'ok') why = '（疑義照会）';
    p.explain.push('→ ' + label + why);
    const nb = neighborBands(d, g.b);
    [nb.lower, nb.upper].forEach(function (x) {
      if (x && g.ans !== 'ok' && g.rs.some(function (r) { return Math.abs(r.mg - (x.dayMin + x.dayMax) / 2) < 1e-6 * r.mg + 1e-9 || (x.fixed && Math.abs(r.mg - x.dayMin) < 1e-6); })) {
        p.explain.push('※ 隣の区分（' + bandLabel(x) + '）の量。年齢区分の取り違え');
      }
    });
    if (g.ans === 'high' && g.rs[0].mg > g.b.dayMax * 5) p.explain.push('※ 桁違い（10倍量）の典型パターン');
    return p;
  }

  /* ---------------- 判定 ---------------- */
  function judge(p, input) {
    const a = p.answer;
    if (a.type === 'choice') return input === a.value;
    const x = typeof input === 'number' ? input : parseInput(String(input));
    if (!isFinite(x)) return false;
    if (a.type === 'point') return Math.abs(x - a.value) <= a.tol;
    return x >= a.lo - a.tolLo && x <= a.hi + a.tolHi;
  }
  function answerText(p) {
    const a = p.answer;
    if (a.type === 'choice') return AUDIT_CHOICES.filter(function (c) { return c.value === a.value; })[0].label;
    if (a.type === 'point') return fmt(a.value, p.fu) + ' ' + p.unit;
    return fmt(a.lo, p.fu) + '〜' + fmt(a.hi, p.fu) + ' ' + p.unit;
  }

  // 4択：よくある間違い（桁ずれ・上下限の取り違え・1回量と1日量の混同）を優先して誤答肢にする
  function makeChoices(p, rng) {
    if (p.answer.type === 'choice') return AUDIT_CHOICES.map(function (c) { return { label: c.label, value: c.value }; });
    const correct = p.answer.type === 'point' ? p.answer.value : p.answer.rep;
    const out = [{ label: fmt(correct, p.fu), value: Number(fmt(correct, p.fu)), correct: true }];
    const used = new Set([out[0].label]);
    function tryAdd(v) {
      if (out.length >= 4 || !(v > 0) || !isFinite(v)) return;
      const lab = fmt(v, p.fu);
      const val = Number(lab);
      if (!(val > 0) || used.has(lab) || judge(p, val)) return;
      used.add(lab);
      out.push({ label: lab, value: val, correct: false });
    }
    const specific = p.distractors.filter(function (v) { return v !== null; });
    const first = specific.slice(0, 1);                // 最優先（上下限の取り違え等）
    const rest = shuffle(specific.slice(1), rng);
    first.concat(rest).forEach(tryAdd);
    [1.5, 1 / 1.5, 1.25, 0.8, 3, 1 / 3, 4, 0.25].forEach(function (k) { tryAdd(correct * k); });
    let k = 1.1;
    while (out.length < 4 && k < 20) { tryAdd(correct * k); tryAdd(correct / k); k += 0.35; }
    return shuffle(out, rng);
  }

  /* ---------------- FSRS-6（py-fsrs の既定パラメータ） ---------------- */
  const W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666,
    0.796, 1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
  const DECAY = -W[20];
  const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
  const DAY = 86400000;
  const S_MIN = 0.001;

  function retrievability(c, now) {
    if (!c || !(c.s > 0)) return 0;
    const t = Math.max(0, (now - c.last) / DAY);
    return Math.pow(1 + FACTOR * t / c.s, DECAY);
  }
  function clampD(x) { return Math.min(10, Math.max(1, x)); }
  function initD(g) { return W[4] - Math.exp(W[5] * (g - 1)) + 1; }
  function nextD(x, g) {
    const delta = -W[6] * (g - 3);
    const x2 = x + (10 - x) * delta / 9;
    return clampD(W[7] * initD(4) + (1 - W[7]) * x2);
  }
  function shortS(s, g) {
    let inc = Math.exp(W[17] * (g - 3 + W[18])) * Math.pow(s, -W[19]);
    if (g >= 2) inc = Math.max(inc, 1);
    return Math.max(S_MIN, s * inc);
  }
  function recallS(x, s, r, g) {
    const hp = g === 2 ? W[15] : 1, eb = g === 4 ? W[16] : 1;
    return s * (1 + Math.exp(W[8]) * (11 - x) * Math.pow(s, -W[9]) * (Math.exp((1 - r) * W[10]) - 1) * hp * eb);
  }
  function forgetS(x, s, r) {
    const lt = W[11] * Math.pow(x, -W[12]) * (Math.pow(s + 1, W[13]) - 1) * Math.exp((1 - r) * W[14]);
    const st = s / Math.exp(W[17] * W[18]);
    return Math.min(lt, st);
  }
  // g: 1=Again 2=Hard 3=Good 4=Easy
  function review(c, g, now) {
    if (!c || !(c.s > 0)) {
      return { s: Math.max(S_MIN, W[g - 1]), d: clampD(initD(g)), last: now, reps: 1, lapses: g === 1 ? 1 : 0 };
    }
    const t = (now - c.last) / DAY;
    let s;
    if (t < 1) s = shortS(c.s, g);
    else {
      const r = retrievability(c, now);
      s = g === 1 ? forgetS(c.d, c.s, r) : recallS(c.d, c.s, r, g);
    }
    return { s: Math.max(S_MIN, s), d: nextD(c.d, g), last: now, reps: (c.reps || 0) + 1, lapses: (c.lapses || 0) + (g === 1 ? 1 : 0) };
  }
  // 正誤と回答時間から自動で評価する（ボタン操作は増やさない）
  function rate(correct, ms, hinted, kind) {
    if (!correct) return 1;
    if (hinted) return 2;
    const th = kind === 'key' ? [6000, 15000] : [3000, 8000];   // 'tap'（選択）と 'recall'（暗記）は短め
    if (ms <= th[0]) return 4;
    if (ms >= th[1]) return 2;
    return 3;
  }
  function nextIntervalDays(c) {
    if (!c || !(c.s > 0)) return 0;
    return c.s;   // FSRSでは安定度S＝想起率が90%に下がるまでの日数
  }

  /* ---------------- 出題セットの組み立て ---------------- */
  // パターンごとの比率（weights：{パターン: 0.5|1|2}、未指定は1）で問題数を割り振り、
  // 各パターンの中では、想起率が低い（忘れかけ）順に出し、新しいアイテムも少しずつ混ぜる。
  // 最後に、同じ成分・同じパターンが続かないよう並べ替える（交互練習）。
  function buildSet(pool, cards, n, now, rng, weights) {
    if (!pool.length || !(n > 0)) return [];
    const DESIRED = 0.9;
    const byPat = Object.create(null);
    pool.forEach(function (it) { (byPat[it.pattern] = byPat[it.pattern] || []).push(it); });
    const pats = shuffle(Object.keys(byPat), rng);
    const w = function (p) { const v = weights && Number(weights[p]); return v > 0 ? v : 1; };
    // パターンの中の優先順：忘れかけ（想起率<0.9）→ 新しい問題（1セットの約4割まで）→ 定着中 → 残りの新しい問題
    const quota = allocate(n, pats, w, rng);
    const parts = Object.create(null);
    let totalDue = 0, totalFresh = 0;
    pats.forEach(function (p) {
      const seen = [];
      let fresh = [];
      byPat[p].forEach(function (it) {
        const c = cards[it.key];
        if (c && c.s > 0) seen.push({ it: it, r: retrievability(c, now) });
        else fresh.push(it);
      });
      seen.sort(function (a, b) { return a.r - b.r; });
      fresh = stratify(fresh, rng);
      const due = seen.filter(function (x) { return x.r < DESIRED; }).map(function (x) { return x.it; });
      const notDue = seen.filter(function (x) { return x.r >= DESIRED; }).map(function (x) { return x.it; });
      parts[p] = { due: due, fresh: fresh, notDue: notDue, nw: 0 };
      totalDue += due.length; totalFresh += fresh.length;
    });
    // 新しい問題の枠（全体で約4割、忘れかけが多いときは2問）をパターンに配る
    const newMax = Math.max(2, Math.round(n * 0.4));
    let budget = Math.min(totalFresh, totalDue >= n ? Math.min(2, newMax) : newMax);
    while (budget > 0) {
      let best = null, bs = -1;
      pats.forEach(function (p) {
        const t = parts[p];
        if (t.nw >= t.fresh.length || t.nw >= quota[p]) return;
        const sc = quota[p] / (t.nw + 1);
        if (sc > bs) { bs = sc; best = p; }
      });
      if (!best) break;
      parts[best].nw++; budget--;
    }
    const order = Object.create(null);
    pats.forEach(function (p) {
      const t = parts[p], q = quota[p] || 0, k = Math.max(0, q - t.nw);
      order[p] = t.due.slice(0, k).concat(t.fresh.slice(0, t.nw), t.due.slice(k), t.notDue, t.fresh.slice(t.nw));
    });
    const out = [], taken = Object.create(null);
    pats.forEach(function (p) { taken[p] = 0; });
    pats.forEach(function (p) {
      while (taken[p] < quota[p] && taken[p] < order[p].length) out.push(order[p][taken[p]++]);
    });
    // 足りないパターンの分は、残りのあるパターンに比率どおり回す
    while (out.length < n) {
      let best = null, bs = -1;
      pats.forEach(function (p) {
        if (taken[p] >= order[p].length) return;
        const sc = w(p) / (taken[p] + 1);
        if (sc > bs) { bs = sc; best = p; }
      });
      if (!best) break;
      out.push(order[best][taken[best]++]);
    }
    // それでも足りなければ（対象が少ない）同じアイテムを数値を変えて再出題
    let i = 0;
    const src = out.length ? out.slice() : pool.slice();
    while (out.length < n) { out.push(src[i % src.length]); i++; }
    return interleave(shuffle(out, rng));
  }
  // n 問をパターンの比率で割り振る（端数は大きい順）
  function allocate(n, pats, w, rng) {
    const total = pats.reduce(function (a, p) { return a + w(p); }, 0);
    const q = Object.create(null), rem = [];
    let used = 0;
    pats.forEach(function (p) {
      const x = n * w(p) / total;
      q[p] = Math.floor(x); used += q[p];
      rem.push({ p: p, f: x - q[p] + rng() * 1e-6 });
    });
    rem.sort(function (a, b) { return b.f - a.f; });
    for (let k = 0; used < n && k < rem.length; k++, used++) q[rem[k].p]++;
    return q;
  }
  // 出題対象の覚え具合：定着率＝想起率の平均（まだ出していない問題は0）
  function poolStats(pool, cards, now) {
    let sum = 0, seen = 0;
    pool.forEach(function (it) {
      const c = cards[it.key];
      if (c && c.s > 0) { seen++; sum += retrievability(c, now); }
    });
    return { n: pool.length, seen: seen, mastery: pool.length ? sum / pool.length : 0 };
  }
  // 出題の種類（パターン）ごとに均等になるよう、種類を順番に回して並べる。
  // 製剤数の多い「処方量↔製剤量」ばかりにならないようにするため。
  function stratify(items, rng) {
    const groups = Object.create(null);
    items.forEach(function (it) { (groups[it.kind || it.pattern] = groups[it.kind || it.pattern] || []).push(it); });
    const keys = shuffle(Object.keys(groups), rng);
    keys.forEach(function (k) { shuffle(groups[k], rng); });
    const out = [];
    let left = items.length;
    while (left > 0) {
      shuffle(keys, rng);
      keys.forEach(function (k) { if (groups[k].length) { out.push(groups[k].pop()); left--; } });
    }
    return out;
  }
  function interleave(a) {
    for (let i = 1; i < a.length; i++) {
      const prev = a[i - 1];
      if (a[i].drugId !== prev.drugId && a[i].pattern !== prev.pattern) continue;
      for (let j = i + 1; j < a.length; j++) {
        if (a[j].drugId !== prev.drugId && a[j].pattern !== prev.pattern) {
          const t = a[i]; a[i] = a[j]; a[j] = t; break;
        }
      }
    }
    return a;
  }

  /* 配布マスタ（../drug-master.json）の自動更新 ― 剤形変更換算・水剤MIX・処方監査ドリル共通
     ファイルの rev が端末のマスタ（baseRev）より新しければ取り込む。
     ・端末で編集した成分（editedIds）と削除した成分（deletedIds）は端末の内容を残す
     ・端末で追加した成分（ファイルにない id）も残す
     ・採用品は端末の設定を優先。薬効グループは端末で編集していなければファイルに合わせる */
  // マスタの項目の版。古い版のアプリが新しい項目（上限・対象年齢など）を落として取り込んだ端末でも、同じ rev のまま取り込み直せるようにする
  var MASTER_SCHEMA = 3;
  // 配布マスタ（rev）を取り込むか：新しい rev、または同じ rev でも項目の版（schema）が古い
  function needsMerge(local, rev) {
    const base = Number(local && local.baseRev) || 0;
    return rev > base || (rev > 0 && rev === base && (Number(local && local.schema) || 0) < MASTER_SCHEMA);
  }
  function mergeDistributedMaster(local, file){
    var rev = Number(file && file.rev) || 0;
    var fdrugs = (file && Array.isArray(file.drugs)) ? file.drugs.filter(function(d){ return d && typeof d === 'object' && d.id != null && Array.isArray(d.forms); }) : [];
    var fgroups = (file && Array.isArray(file.groups)) ? file.groups : [];
    var now = new Date().toISOString();
    if(!local || !Array.isArray(local.drugs) || !local.drugs.length){
      return { version:1, updatedAt:now, drugs:fdrugs, groups:fgroups,
               adopted: (file && Array.isArray(file.adopted)) ? file.adopted : [],
               baseRev:rev, editedIds:[], deletedIds:[], groupsEdited:false, schema:MASTER_SCHEMA };
    }
    var edited = Array.isArray(local.editedIds) ? local.editedIds.map(String) : [];
    var deleted = Array.isArray(local.deletedIds) ? local.deletedIds.map(String) : [];
    var byId = {}, inFile = {};
    local.drugs.forEach(function(d){ if(d && d.id != null) byId[String(d.id)] = d; });
    var drugs = [];
    fdrugs.forEach(function(fd){
      var id = String(fd.id); inFile[id] = 1;
      if(deleted.indexOf(id) >= 0) return;
      drugs.push((edited.indexOf(id) >= 0 && byId[id]) ? byId[id] : fd);
    });
    local.drugs.forEach(function(ld){ if(ld && ld.id != null && !inFile[String(ld.id)]) drugs.push(ld); });
    var lg = Array.isArray(local.groups) ? local.groups : [];
    var base = local.groupsEdited ? lg : fgroups, extra = local.groupsEdited ? fgroups : lg;
    var groups = base.slice();
    extra.forEach(function(g){ if(g && !groups.some(function(x){ return x && x.id === g.id; })) groups.push(g); });
    var adopted = (Array.isArray(local.adopted) && local.adopted.length) ? local.adopted
                : ((file && Array.isArray(file.adopted)) ? file.adopted : []);
    var out = {};
    Object.keys(local).forEach(function(k){ out[k] = local[k]; });
    out.version = 1; out.updatedAt = now; out.drugs = drugs; out.groups = groups; out.adopted = adopted;
    out.baseRev = rev; out.editedIds = edited; out.deletedIds = deleted; out.schema = MASTER_SCHEMA;
    return out;
  }

  /* ---------------- 共通マスタが無いときのサンプル ---------------- */
  const SAMPLE_MASTER = {
    version: 1, updatedAt: 'sample',
    drugs: [
      { id: 'carbo', name: 'カルボシステイン', brand: 'ムコダイン', dmin: 30, dmax: 30, dbasis: 'day', maxDay: 1500, maxNote: '成人1回500mg 1日3回（1日1500mg）',
        dnote: '小児 1回10mg/kg 1日3回（成人1500mg/日 分3）',
        forms: [{ n: 'ムコダインDS50%', t: 'powder', s: 500 }, { n: 'ムコダインシロップ5%', t: 'liquid', s: 50 },
          { n: 'ムコダイン錠250mg', t: 'tablet', s: 250 }, { n: 'ムコダイン錠500mg', t: 'tablet', s: 500 }] },
      { id: 'ambroxol', name: 'アンブロキソール', brand: 'ムコソルバン', dmin: 0.9, dmax: 0.9, dbasis: 'day', maxDay: 45, maxNote: '成人1回15mg 1日3回（1日45mg）',
        dnote: '小児 0.9mg/kg/日 分3（成人45mg/日 分3）',
        forms: [{ n: '小児用ムコソルバンDS1.5%', t: 'powder', s: 15 }, { n: '小児用ムコソルバンシロップ0.3%', t: 'liquid', s: 3 },
          { n: 'ムコソルバン錠15mg', t: 'tablet', s: 15, ageMin: 15 }] },
      { id: 'tipepidine', name: 'チペピジン', brand: 'アスベリン', dbasis: 'day',
        dnote: '1歳未満5〜20mg/日、1〜3歳10〜25mg/日、3〜6歳15〜40mg/日 分3',
        ageBands: [{ a0: 0, a1: 1, dayMin: 5, dayMax: 20, times: 3 }, { a0: 1, a1: 3, dayMin: 10, dayMax: 25, times: 3 },
          { a0: 3, a1: 6, dayMin: 15, dayMax: 40, times: 3 }],
        forms: [{ n: 'アスベリン散10%', t: 'powder', s: 100 }, { n: 'アスベリンシロップ0.5%', t: 'liquid', s: 5 },
          { n: 'アスベリン錠10mg', t: 'tablet', s: 10 }] },
      { id: 'levocetirizine', name: 'レボセチリジン', brand: 'ザイザル', dbasis: 'day',
        dnote: '6ヵ月以上1歳未満1回1.25mg 1日1回、1〜7歳未満1回1.25mg 1日2回、7〜15歳未満1回2.5mg 1日2回',
        ageBands: [{ a0: 0.5, a1: 1, mg: 1.25, times: 1 }, { a0: 1, a1: 7, mg: 1.25, times: 2 },
          { a0: 7, a1: 15, mg: 2.5, times: 2 }, { a0: 15, a1: null, mg: 5, times: 1 }],
        forms: [{ n: 'ザイザルシロップ0.05%', t: 'liquid', s: 0.5, ageMin: 0.5 }, { n: 'ザイザル錠5mg', t: 'tablet', s: 5, ageMin: 7 }] },
      { id: 'fexofenadine', name: 'フェキソフェナジン', brand: 'アレグラ', dbasis: 'day',
        dnote: '6ヵ月以上2歳未満1回15mg、2歳以上12歳未満1回30mg、12歳以上1回60mg（いずれも1日2回）',
        ageBands: [{ a0: 0.5, a1: 2, mg: 15, times: 2 }, { a0: 2, a1: 7, mg: 30, times: 2 },
          { a0: 7, a1: 12, mg: 30, times: 2 }, { a0: 12, a1: null, mg: 60, times: 2 }],
        forms: [{ n: 'アレグラドライシロップ5%', t: 'powder', s: 50, ageMin: 0.5 }, { n: 'アレグラ錠30mg', t: 'tablet', s: 30, ageMin: 7 }, { n: 'アレグラ錠60mg', t: 'tablet', s: 60, ageMin: 12 }] },
      { id: 'montelukast', name: 'モンテルカスト', brand: 'キプレス／シングレア', dbasis: 'day',
        dnote: '1〜6歳未満4mg 分1、6〜15歳未満5mg 分1、15歳以上10mg 分1（就寝前）',
        ageBands: [{ a0: 1, a1: 6, mg: 4, times: 1 }, { a0: 6, a1: 15, mg: 5, times: 1 }, { a0: 15, a1: null, mg: 10, times: 1 }],
        forms: [{ n: 'キプレス細粒4mg', t: 'sachet', s: 4, ageMin: 1, ageMax: 6 }, { n: 'キプレスチュアブル錠5mg', t: 'chew', s: 5, ageMin: 6, ageMax: 15 }, { n: 'キプレス錠10mg', t: 'tablet', s: 10, ageMin: 15 }] },
      { id: 'acetaminophen', name: 'アセトアミノフェン', brand: 'カロナール', dmin: 10, dmax: 15, dbasis: 'dose', maxDay: 1500,
        dnote: '小児 1回10〜15mg/kg、4〜6時間以上あける。1日60mg/kg以内かつ1500mg以内',
        forms: [{ n: 'カロナール細粒20%', t: 'powder', s: 200 }, { n: 'カロナールシロップ2%', t: 'liquid', s: 20 },
          { n: 'カロナール錠200mg', t: 'tablet', s: 200 }, { n: 'アンヒバ坐剤小児用100mg', t: 'supp', s: 100 }] },
      { id: 'clarithromycin', name: 'クラリスロマイシン', brand: 'クラリス', potency: true, dmin: 10, dmax: 15, dbasis: 'day', maxDay: 400, maxNote: '成人1回200mg 1日2回（1日400mg）',
        dnote: '小児 10〜15mg(力価)/kg/日 分2〜3（成人400mg/日 分2）',
        forms: [{ n: 'クラリスドライシロップ10%小児用', t: 'powder', s: 100 }, { n: 'クラリス錠50mg小児用', t: 'tablet', s: 50 }] },
      { id: 'amoxicillin', name: 'アモキシシリン', brand: 'サワシリン／ワイドシリン', potency: true, dmin: 20, dmax: 40, dbasis: 'day', maxDay: 1000, maxNote: '成人1回250mg 1日3〜4回（1日750〜1000mg）',
        dnote: '小児 20〜40mg(力価)/kg/日 分3〜4（中耳炎等では高用量を用いることがある）',
        forms: [{ n: 'ワイドシリン細粒20%', t: 'powder', s: 200 }, { n: 'サワシリン細粒10%', t: 'powder', s: 100 },
          { n: 'サワシリンカプセル250', t: 'cap', s: 250 }] },
      { id: 'cefditoren', name: 'セフジトレンピボキシル', brand: 'メイアクトMS', potency: true, dmin: 9, dmax: 9, dlimit: 18, dbasis: 'day', maxDay: 300, maxNote: '成人1回100mg 1日3回（重症は1回200mg）',
        dnote: '小児 9mg(力価)/kg/日 分3（重症時18mg/kg/日まで）',
        forms: [{ n: 'メイアクトMS小児用細粒10%', t: 'powder', s: 100 }, { n: 'メイアクトMS錠100mg', t: 'tablet', s: 100, ageMin: 15 }] },
      { id: 'cefcapene', name: 'セフカペンピボキシル', brand: 'フロモックス', potency: true, dmin: 9, dmax: 9, dbasis: 'day', maxDay: 300, maxNote: '成人1回100mg 1日3回（重症は1回150mg）',
        dnote: '小児 9mg(力価)/kg/日 分3（成人300mg/日 分3）',
        forms: [{ n: 'フロモックス小児用細粒100mg', t: 'powder', s: 100 }, { n: 'フロモックス錠100mg', t: 'tablet', s: 100, ageMin: 15 }] }
    ],
    adopted: []
  };

  return {
    FORM_LABEL: FORM_LABEL, PROD_UNIT: PROD_UNIT, PATTERNS: PATTERNS, AUDIT_CHOICES: AUDIT_CHOICES,
    sanitizeMaster: sanitizeMaster, masterStats: masterStats, hasDose: hasDose,
    buildPool: buildPool, generate: generate, judge: judge, answerText: answerText, makeChoices: makeChoices,
    parseInput: parseInput, fmt: fmt, tolFor: tolFor,
    retrievability: retrievability, review: review, rate: rate, nextIntervalDays: nextIntervalDays,
    buildSet: buildSet, poolStats: poolStats, setRates: setRates, RATE_DEFAULTS: RATE_DEFAULTS, WEIGHT_STEPS: WEIGHT_STEPS,
    hasAge: hasAge, mergeDistributedMaster: mergeDistributedMaster, needsMerge: needsMerge, stdWeight: stdWeight, interleave: interleave, shuffle: shuffle,
    weightForm: weightForm, capFor: capFor, capWeight: capWeight, capRelevant: capRelevant, classifyW: classifyW, ageBandsFor: ageBandsFor, formAgeOk: formAgeOk,
    FSRS_PARAMS: W, SAMPLE_MASTER: SAMPLE_MASTER
  };
});
