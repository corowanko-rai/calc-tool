/* 水剤MIX調製計算  app.js（index.html から分離。Content-Security-Policy で外部・インラインのスクリプトを禁止するため）
   先頭：Service Worker 登録（本体でエラーが起きても登録されるよう先に置く）／続いて本体 */
// Service Worker登録（オフライン起動とPWA化のため）
// file:// で開いた場合は登録できないので、その場合は静かに無視する。
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('sw.js').then(function (reg) {

      // 新しいバージョンが見つかったら、有効化された時点で自動リロードする。
      // これをしないと、更新をアップロードしても古い画面が表示され続けることがある。
      reg.addEventListener('updatefound', function () {
        var newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', function () {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            // 既存のSWがいる状態で新版がインストールされた＝更新あり
            window.location.reload();
          }
        });
      });

      // 起動のたびに更新をチェックする
      reg.update().catch(function () {});

    }).catch(function () {
      /* 登録できなくてもアプリ自体は通常どおり動作する */
    });

    // 制御SWが切り替わったときも一度だけリロード（多重リロード防止付き）
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    });
  });
}

(function(){
  const STORAGE_KEY = 'mixCalcSettings_v2';
  const DEFAULT_SUGGESTIONS = ['アスベリン','ムコダイン','ムコソルバン','カロナール','ホクナリン','メジコン','ペリアクチン','アレジオン','ザイザル','クラリチン'];

  // ---------- 薬剤鑑査マスタ ----------
  // 薬剤名（候補リストの表記と一致させる）ごとに用量ルールを定義。
  // type: 'weight' … mg/kg/day等の体重換算ルール（製剤濃度と基準量から適正体重を逆算し、実体重と比較）
  // type: 'age'    … 年齢区分ごとに1回量・1日回数が決まっているルール
  // これは出荷時デフォルト。実際に参照するのはdrugAuditRules（下でlocalStorageの内容とマージ）。
  const DEFAULT_DRUG_AUDIT_RULES = {
    'ムコダイン': {
      type: 'weight',
      genericName: 'カルボシステイン',
      concentration: 50,      // mg/ml（製剤濃度）
      dosePerKgPerDay: 30,    // mg/kg/day（基準用量）
      toleranceKg: 5          // 適正体重との許容ズレ幅（±kg）
    },
    'ザイザル': {
      type: 'age',
      genericName: 'レボセチリジン',
      bands: [
        { minAge: 0.5, maxAge: 1,  label: '6ヵ月以上1歳未満', perDoseMl: 2.5, timesPerDay: 1 },
        { minAge: 1,   maxAge: 7,  label: '1歳以上7歳未満',   perDoseMl: 2.5, timesPerDay: 2 },
        { minAge: 7,   maxAge: 15, label: '7歳以上15歳未満',  perDoseMl: 5,   timesPerDay: 2 }
      ]
    }
  };

  // mlPerKgPerDayはgetterではなく関数として計算する（localStorageのJSON化でgetterは失われるため）
  function mlPerKgPerDayOf(rule){
    return rule.dosePerKgPerDay / rule.concentration;
  }

  // 体重換算の許容：処方の体重あたり量が添付文書の範囲を ±TOL_PCT% を超えて外れたら注意。
  // 剤形変更換算の用量チェック（下限×0.9〜上限×1.1）と同じ基準。
  // 0.1mL・0.1g 単位の計量で注意が出ないよう、体重換算の幅には最低 ±0.5kg を持たせる。
  const TOL_PCT_DEFAULT = 10;
  const TOL_MIN_KG = 0.5;
  function doseRangeOf(rule){
    if(rule.doseMin > 0) return { min: rule.doseMin, max: (rule.doseMax > 0 ? rule.doseMax : rule.doseMin) };
    return { min: rule.dosePerKgPerDay, max: rule.dosePerKgPerDay };   // 旧形式（単一値）
  }
  function weightWindow(amountMl, conc, dMin, dMax, pct, dHard){
    const mg = amountMl * conc, p = pct / 100;
    const lo = mg / dMax, hi = mg / dMin;                       // 範囲どおりなら何kg相当か
    const top = (dHard > dMax) ? dHard : dMax;                  // 最高量（例：重症時）があればそこまで許容
    return {
      lo, hi,
      allowLo: Math.min(mg / (top * (1 + p)), lo - TOL_MIN_KG),
      allowHi: Math.max(mg / (dMin * (1 - p)), hi + TOL_MIN_KG)
    };
  }
  // 上限（成人量など）と製剤の対象年齢（共通マスタの maxDay・maxDose・maxNote、forms[].ageMin・ageMax）
  function capInfoOf(d){
    const maxDay = (d.maxDay > 0) ? d.maxDay : null, maxDose = (d.maxDose > 0) ? d.maxDose : null;
    if(!maxDay && !maxDose) return null;
    return { maxDay, maxDose, note: (typeof d.maxNote === 'string') ? d.maxNote.slice(0, 120) : '' };
  }
  function formAgeOf(f){
    const a0 = (typeof f.ageMin === 'number' && f.ageMin >= 0) ? f.ageMin : null;
    const a1 = (typeof f.ageMax === 'number' && f.ageMax > 0 && (a0 === null || f.ageMax > a0)) ? f.ageMax : null;
    return (a0 === null && a1 === null) ? null : { min: a0, max: a1 };
  }
  function ageText(y){ return y < 1 ? `${Math.round(y * 12)}ヵ月` : `${formatNum(y)}歳`; }
  function formAgeText(fa){
    if(!fa) return '';
    if(fa.min !== null && fa.min >= 15) return '成人用（添付文書に小児の用法なし）';
    if(fa.max === null) return `${ageText(fa.min)}以上`;
    return (fa.min ? `${ageText(fa.min)}以上` : '') + `${ageText(fa.max)}未満`;
  }
  function capText(cap, k, u){
    const a = [];
    if(cap.maxDose) a.push(`1回${formatNum(cap.maxDose * k)}${u}`);
    if(cap.maxDay) a.push(`1日${formatNum(cap.maxDay * k)}${u}`);
    return a.join('・') + (cap.note ? `［${cap.note}］` : '');
  }
  function kgRangeText(lo, hi){
    return Math.abs(hi - lo) < 0.05 ? `${formatNum(lo)}kg` : `${formatNum(lo)}〜${formatNum(hi)}kg`;
  }
  function doseRangeText(dMin, dMax, k, u){
    return dMin === dMax ? `${formatNum(dMin * k)}${u}` : `${formatNum(dMin * k)}〜${formatNum(dMax * k)}${u}`;
  }

  const RULES_STORAGE_KEY = 'mixCalcDrugRules_v1';

  function loadCustomRules(){
    try{
      const raw = localStorage.getItem(RULES_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }
  function persistRules(){
    try{
      localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(drugAuditRules));
    }catch(e){ /* ignore */ }
  }

  // 実際に参照する鑑査ルール本体。保存済みがあればそれを使い、なければデフォルトから複製。
  let drugAuditRules = loadCustomRules() || JSON.parse(JSON.stringify(DEFAULT_DRUG_AUDIT_RULES));

  function loadSaved(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return {};
      return JSON.parse(raw) || {};
    }catch(e){ return {}; }
  }
  function persist(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        round: state.round,
        suggestions: NAME_SUGGESTIONS
      }));
    }catch(e){ /* ignore */ }
  }

  const saved = loadSaved();

  const state = {
    div: 3,
    days: 7,
    round: (typeof saved.round === 'number') ? saved.round : 0.5,
    drugs: [
      {name:'', perDay: null},
      {name:'', perDay: null}
    ]
  };

  // 患者情報（年齢・体重）。Rpタブを切り替えても共有される、患者単位の値。
  const patient = {
    age: null,       // 歳（内部は常にこの単位で保持）
    weight: null,    // kg
    ageUnit: 'year'  // 表示単位: 'year' | 'month'（入力欄の見た目だけを切り替える）
  };

  function freshRpState(){
    return {
      div: 3,
      days: 7,
      round: state.round, // 丸め幅は施設の運用に近いので前のRpの設定を引き継ぐ
      drugs: [
        {name:'', perDay: null},
        {name:'', perDay: null}
      ]
    };
  }

  function cloneRpState(s){
    return {
      div: s.div,
      days: s.days,
      round: s.round,
      drugs: s.drugs.map(d=>({name:d.name, perDay:d.perDay}))
    };
  }

  function rpHasContent(s){
    return s.drugs.some(d => d.perDay != null && !isNaN(d.perDay) && d.perDay > 0);
  }

  // Rp（処方）リスト。各要素は独立した調製内容のスナップショット。
  let rpList = [ cloneRpState(state) ];
  let activeRpIndex = 0;

  /* ===================================================================
     入力中の内容（全Rp・年齢・体重）を端末に保存し、閉じても再読込しても復元する。
     「クリア」を押したときだけ消える。
     =================================================================== */
  const SESSION_KEY = 'mixCalcSession_v1';
  let sessionReady = false;   // 復元が終わるまでは保存しない（初期値で上書きしないため）

  function saveSession(){
    if(!sessionReady) return;
    try{
      rpList[activeRpIndex] = cloneRpState(state);
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        v: 1,
        savedAt: new Date().toISOString(),
        rpList: rpList,
        activeRpIndex: activeRpIndex,
        patient: {age: patient.age, weight: patient.weight, ageUnit: patient.ageUnit}
      }));
    }catch(e){ /* 保存できなくても計算は続けられる */ }
  }

  function validRp(r){
    if(!r || !Array.isArray(r.drugs)) return null;
    const n = (v, d)=> (typeof v === 'number' && isFinite(v) && v > 0) ? v : d;
    const drugs = r.drugs.map(d=>({
      name: (d && typeof d.name === 'string') ? d.name : '',
      perDay: (d && typeof d.perDay === 'number' && isFinite(d.perDay)) ? d.perDay : null
    }));
    while(drugs.length < 2) drugs.push({name:'', perDay:null});
    return {div: n(r.div, 3), days: n(r.days, 7), round: n(r.round, state.round), drugs: drugs};
  }

  (function restoreSession(){
    let o = null;
    try{ o = JSON.parse(localStorage.getItem(SESSION_KEY)); }catch(e){}
    if(o && Array.isArray(o.rpList) && o.rpList.length){
      const list = o.rpList.map(validRp).filter(Boolean);
      if(list.length){
        rpList = list;
        activeRpIndex = Math.min(Math.max(0, o.activeRpIndex|0), list.length - 1);
        const a = cloneRpState(rpList[activeRpIndex]);
        state.div = a.div; state.days = a.days; state.round = a.round; state.drugs = a.drugs;
      }
      if(o.patient){
        const num = v => (typeof v === 'number' && isFinite(v)) ? v : null;
        patient.age = num(o.patient.age);
        patient.weight = num(o.patient.weight);
        patient.ageUnit = (o.patient.ageUnit === 'month') ? 'month' : 'year';
      }
    }
  })();

  // 閉じる・別アプリに切り替える直前にも念のため保存
  window.addEventListener('pagehide', saveSession);
  document.addEventListener('visibilitychange', ()=>{
    if(document.visibilityState === 'hidden') saveSession();
  });

  let NAME_SUGGESTIONS = (Array.isArray(saved.suggestions) && saved.suggestions.length > 0)
    ? saved.suggestions.slice()
    : DEFAULT_SUGGESTIONS.slice();

  /* ===================================================================
     共通薬剤マスタ（剤形変更換算アプリと共有）
     localStorage はオリジン単位で共有されるため、同じドメインに置いた
     /dfconv/ と /mix/ は同じキーのデータを参照できる。
     マスタの編集は剤形変更換算アプリ側で行い、こちらは読むだけ。
     =================================================================== */
  const SHARED_MASTER_KEY = 'calcTool.drugMaster.v1';
  let sharedMaster = null;

  function loadSharedMaster(){
    try{
      const raw = localStorage.getItem(SHARED_MASTER_KEY);
      if(raw){
        const o = JSON.parse(raw);
        if(o && Array.isArray(o.drugs) && o.drugs.length) return o;
      }
    }catch(e){}
    return null;
  }

  // 共通マスタ → このアプリの鑑査ルール・候補薬剤名に変換（水剤の剤形のみ対象）
  function applySharedMaster(m){
    if(!m || !Array.isArray(m.drugs) || !m.drugs.length) return false;
    sharedMaster = m;
    const rules = {}, names = [];
    const adopted = Array.isArray(m.adopted) ? m.adopted : [];
    m.drugs.forEach(d=>{
      (d.forms||[]).forEach(f=>{
        if(f.t !== 'liquid') return;             // 水剤のみ
        // 採用品が設定されていれば、候補はその製剤だけに絞る（鑑査ルールは全製剤ぶん作る）
        if(names.indexOf(f.n) < 0 && (!adopted.length || adopted.indexOf(f.n) >= 0)) names.push(f.n);
        const ageNot = Array.isArray(d.ageNotFor) ? d.ageNotFor : [];
        // 体重あたり量を当てはめない製剤（例：ヘマンジオルは乳児血管腫の別の用量）
        const wNot = Array.isArray(d.weightNotFor) && d.weightNotFor.indexOf(f.n) >= 0;
        const fa = formAgeOf(f), cap = capInfoOf(d);
        // ○歳未満は体重あたり、それ以上は年齢区分（例：プロカテロール 6歳未満 1回1.25μg/kg）
        let weightBelow = null;
        if(d.weightAgeMax > 0 && d.dmin > 0 && !wNot){
          const ug = (d.uf > 0 && d.uf < 1);
          const k = ug ? 1 / d.uf : 1, u = ug ? 'μg' : 'mg';
          const dmax = (d.dmax > 0) ? d.dmax : d.dmin;
          weightBelow = {
            ageMax: d.weightAgeMax,
            basis: d.dbasis === 'dose' ? 'dose' : 'day',
            mlPerKgMin: d.dmin / f.s, mlPerKgMax: dmax / f.s,
            doseMin: d.dmin, doseMax: dmax, conc: f.s,
            tolPct: (d.tolerancePct > 0) ? d.tolerancePct : TOL_PCT_DEFAULT,
            cap, unitK: k, unit: u,
            doseText: (d.dmin === dmax ? formatNum(d.dmin * k) : formatNum(d.dmin * k) + '〜' + formatNum(dmax * k)) + u + '/kg' +
                      (d.dbasis === 'dose' ? '/回' : '/日') + '（' +
                      (d.dmin === dmax ? formatNum(d.dmin / f.s) : formatNum(d.dmin / f.s) + '〜' + formatNum(dmax / f.s)) + 'ml/kg' +
                      (d.dbasis === 'dose' ? '/回' : '/日') + '）'
          };
        }
        if(Array.isArray(d.ageBands) && d.ageBands.length && ageNot.indexOf(f.n) < 0){
          rules[f.n] = {
            weightBelow: weightBelow,
            type: 'age',
            genericName: d.name,
            formAge: fa,
            bands: d.ageBands.filter(b=>b && isFinite(b.a0)).map(b=>{
              const base = {
                minAge: b.a0,
                maxAge: (b.a1 === null || b.a1 === undefined) ? 999 : b.a1,
                label: b.label || ''
              };
              if(b.dayMin > 0 && b.dayMax >= b.dayMin){
                // 1日量の幅（アスベリン型）：1日の成分量の下限〜上限、分割回数は任意
                base.range = true;
                base.minPerDayMl = Math.round((b.dayMin / f.s) * 100) / 100;
                base.maxPerDayMl = Math.round((b.dayMax / f.s) * 100) / 100;
                base.timesPerDay = (b.times > 0) ? b.times : null;
              } else {
                base.perDoseMl = Math.round((b.mg / f.s) * 100) / 100;
                base.timesPerDay = b.times;
              }
              return base;
            })
          };
        } else if(d.dmin !== undefined && d.dbasis !== 'dose' && !wNot){
          rules[f.n] = {
            type: 'weight',
            genericName: d.name,
            formAge: fa,
            maxDay: (cap && cap.maxDay) ? cap.maxDay : null,
            maxNote: cap ? cap.note : '',
            dlimit: (d.dlimit > 0) ? d.dlimit : null,
            concentration: f.s,
            doseMin: d.dmin,
            doseMax: (d.dmax !== undefined) ? d.dmax : d.dmin,
            dosePerKgPerDay: (d.dmin + ((d.dmax !== undefined) ? d.dmax : d.dmin)) / 2,   // 表示用（旧形式との互換）
            unitK: (d.uf > 0 && d.uf < 1) ? 1 / d.uf : 1,
            unit: (d.uf > 0 && d.uf < 1) ? 'μg' : 'mg',
            tolPct: (d.tolerancePct > 0) ? d.tolerancePct : TOL_PCT_DEFAULT
          };
        }
        // 頓用基準（mg/kg/回）の薬剤は1日量ベースの鑑査になじまないため
        // 候補名だけ載せ、鑑査ルールは作らない
      });
    });
    drugAuditRules = rules;
    NAME_SUGGESTIONS = names;
    return true;
  }

  applySharedMaster(loadSharedMaster());

  /* ===== 候補チップ：よく使う順＋入力での絞り込み ===== */
  const RECENT_KEY = 'mixCalcRecentNames_v1';
  let recentNames = [];
  try{ const r = JSON.parse(localStorage.getItem(RECENT_KEY)); if(Array.isArray(r)) recentNames = r; }catch(e){}

  function noteRecent(n){
    if(!n) return;
    recentNames = [n].concat(recentNames.filter(x=>x!==n)).slice(0,12);
    try{ localStorage.setItem(RECENT_KEY, JSON.stringify(recentNames)); }catch(e){}
  }
  function normName(s){
    return (s||'').toLowerCase()
      .replace(/[\u30a1-\u30f6]/g, c=>String.fromCharCode(c.charCodeAt(0)-0x60))
      .replace(/[\s・ー－―‐]/g, '');
  }
  const CHIP_LIMIT = 8;

  function chipsFor(drug, showAll){
    const base = NAME_SUGGESTIONS;
    const q = normName(drug.name);
    let list, filtered = false;
    if(q && base.indexOf(drug.name) < 0){
      list = base.filter(n=>normName(n).indexOf(q) >= 0);
      filtered = true;
    }else if(showAll){
      list = base.slice();
    }else{
      list = recentNames.filter(n=>base.indexOf(n) >= 0).slice(0, CHIP_LIMIT);
      if(!list.length) list = base.slice(0, CHIP_LIMIT);
      if(drug.name && base.indexOf(drug.name) >= 0 && list.indexOf(drug.name) < 0) list.unshift(drug.name);
    }
    return {list: list.slice(0, 80), filtered: filtered,
            more: !showAll && !filtered && list.length < base.length};
  }

  function renderChips(card, drug){
    const host = card.querySelector('.name-chips');
    if(!host) return;
    const showAll = host.dataset.all === '1';
    const r = chipsFor(drug, showAll);
    let h = r.list.map(n=>
      `<span class="name-chip${drug.name===n?' active':''}" data-name="${escapeHtml(n)}">${escapeHtml(n)}</span>`
    ).join('');
    if(!r.list.length) h = '<span class="name-chips-empty">候補に該当なし（そのまま手入力できます）</span>';
    if(r.more)  h += `<span class="name-chip more" data-more="1">すべて ${NAME_SUGGESTIONS.length}件</span>`;
    if(showAll) h += '<span class="name-chip more" data-more="0">閉じる</span>';
    host.innerHTML = h;

    const nameInput = card.querySelector('.drug-name-input');
    const nameWrap  = card.querySelector('.name-field-wrap');
    host.querySelectorAll('.name-chip[data-name]').forEach(chip=>{
      chip.addEventListener('click', ()=>{
        const name = chip.dataset.name;
        drug.name = (drug.name === name) ? '' : name;
        if(drug.name) noteRecent(drug.name);
        nameInput.value = drug.name;
        nameWrap.classList.toggle('has-value', !!drug.name);
        host.dataset.all = '';
        renderChips(card, drug);
        syncActiveRpSnapshot();
        updateDrugCardDisplays();
      });
    });
    host.querySelectorAll('.name-chip[data-more]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        host.dataset.all = btn.dataset.more === '1' ? '1' : '';
        renderChips(card, drug);
      });
    });
  }

  // ---------- チップ共通ハンドラ ----------
  function setupChipGroup(containerId, customInputId, onSelect, initVal){
    const container = document.getElementById(containerId);
    const customInput = document.getElementById(customInputId);
    const chips = Array.from(container.querySelectorAll('.chip'));

    customInput.addEventListener('focus', ()=>{
      requestAnimationFrame(()=>customInput.select());
    });

    function selectValue(val, fromCustom){
      chips.forEach(c=>{
        const cv = parseFloat(c.dataset.val);
        c.classList.toggle('active', !fromCustom && cv === val);
      });
      if(fromCustom){
        chips.forEach(c=>c.classList.remove('active'));
      } else {
        customInput.value = '';
      }
      onSelect(val);
    }

    chips.forEach(chip=>{
      chip.addEventListener('click', ()=>{
        const val = parseFloat(chip.dataset.val);
        selectValue(val, false);
      });
    });

    customInput.addEventListener('input', ()=>{
      const val = parseFloat(customInput.value);
      if(!isNaN(val) && val > 0){
        selectValue(val, true);
      }
    });

    return {selectValue};
  }

  const divGroup = setupChipGroup('divChips','divCustom', (v)=>{ state.div = v; render(); });
  const dayGroup = setupChipGroup('dayChips','dayCustom', (v)=>{ state.days = v; render(); });
  const roundGroup = setupChipGroup('roundChips','roundCustom', (v)=>{ state.round = v; persist(); render(); });

  // チップ群のUIを値に合わせて更新（プリセット外の値ならカスタム欄に表示）
  function syncChipUI(containerId, customInputId, val){
    const container = document.getElementById(containerId);
    const customInput = document.getElementById(customInputId);
    const chips = Array.from(container.querySelectorAll('.chip'));
    const matched = chips.find(c => parseFloat(c.dataset.val) === val);
    if(matched){
      chips.forEach(c=>c.classList.toggle('active', c===matched));
      customInput.value = '';
    } else {
      chips.forEach(c=>c.classList.remove('active'));
      customInput.value = val;
    }
  }

  // 保存されていた丸め幅・分割・日数を反映
  syncChipUI('roundChips','roundCustom', state.round);
  syncChipUI('divChips','divCustom', state.div);
  syncChipUI('dayChips','dayCustom', state.days);

  // ---------- 患者情報（年齢・体重） ----------
  const patientAgeInput = document.getElementById('patientAge');
  const patientWeightInput = document.getElementById('patientWeight');
  const ageUnitToggle = document.getElementById('ageUnitToggle');

  attachSelectOnFocus(patientAgeInput);
  attachSelectOnFocus(patientWeightInput);

  // 復元した年齢・体重を入力欄に表示
  function syncPatientUI(){
    ageUnitToggle.querySelectorAll('.age-unit-btn').forEach(b=>{
      b.classList.toggle('active', b.dataset.unit === patient.ageUnit);
    });
    patientAgeInput.value = (patient.age != null)
      ? formatNum(patient.ageUnit === 'month' ? patient.age * 12 : patient.age) : '';
    patientWeightInput.value = (patient.weight != null) ? formatNum(patient.weight) : '';
  }
  syncPatientUI();

  // 年齢入力欄は表示単位（歳／ヶ月）に応じて値を解釈する。内部(patient.age)は常に「歳」で保持。
  patientAgeInput.addEventListener('input', (e)=>{
    const v = parseFloat(e.target.value);
    if(isNaN(v)){
      patient.age = null;
    } else {
      patient.age = (patient.ageUnit === 'month') ? (v / 12) : v;
    }
    saveSession();
    updateDrugCardDisplays(); // 薬剤カード内のタイムライン（該当区分マーカー）にも反映
    renderResult();
  });
  patientWeightInput.addEventListener('input', (e)=>{
    const v = parseFloat(e.target.value);
    patient.weight = isNaN(v) ? null : v;
    saveSession();
    updateDrugCardDisplays(); // 体重換算表示にも反映
    renderResult();
  });

  // 歳／ヶ月の表示切り替え。数値の意味は変えず、入力欄に出す表示だけを変換する。
  ageUnitToggle.querySelectorAll('.age-unit-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const unit = btn.dataset.unit;
      if(unit === patient.ageUnit) return;
      patient.ageUnit = unit;
      ageUnitToggle.querySelectorAll('.age-unit-btn').forEach(b=>{
        b.classList.toggle('active', b.dataset.unit === unit);
      });
      // 入力欄の表示値を新しい単位に合わせて更新
      if(patient.age != null && !isNaN(patient.age)){
        const displayVal = (unit === 'month') ? (patient.age * 12) : patient.age;
        patientAgeInput.value = formatNum(displayVal);
      }
      saveSession();
      updateDrugCardDisplays();
      renderResult();
    });
  });

  // タップで即・数値上書きできるよう全選択
  function attachSelectOnFocus(input){
    input.addEventListener('focus', ()=>{
      // わずかに遅延させてOS側のフォーカス処理と競合しないようにする
      requestAnimationFrame(()=>input.select());
    });
  }

  // 現在のstateを、開いているRpのスナップショットへ反映し、Rpタブの表示（完了ドット等）を更新
  function syncActiveRpSnapshot(){
    rpList[activeRpIndex] = cloneRpState(state);
    if(typeof renderRpTabs === 'function'){ renderRpTabs(); }
    saveSession();
  }

  // ---------- 薬剤カード描画 ----------
  const drugListEl = document.getElementById('drugList');
  const addDrugBtn = document.getElementById('addDrugBtn');

  // 薬剤カード内に表示する「用量根拠」の短い行を生成（体重・年齢が入力されている場合のみ）
  // 詳しい鑑査OK/NG判定は結果パネル側のauditDrugで行うため、ここは参考情報の表示のみ。
  function buildDoseRefLines(name, perDayMl){
    const rule = drugAuditRules[name];
    if(!rule) return null;

    // 判定ロジックは結果パネル側のauditDrugと共通化（二重実装を避ける）
    const auditResult = auditDrug(name, perDayMl);
    const isWarn = auditResult ? !auditResult.ok : false;

    if(rule.type === 'weight'){
      const r = doseRangeOf(rule), k = rule.unitK || 1, u = rule.unit || 'mg';
      const refLine = `添文：${doseRangeText(r.min, r.max, k, u)}/kg/day（製剤${formatNum(rule.concentration * k)}${u}/ml＝${doseRangeText(r.min / rule.concentration, r.max / rule.concentration, 1, '')}ml/kg/day）` +
        (rule.maxDay > 0 ? `・上限1日${formatNum(rule.maxDay * k)}${u}（${formatNum(rule.maxDay / rule.concentration)}ml）` : '');
      if(perDayMl == null || isNaN(perDayMl) || perDayMl <= 0){
        return { refLine, calcLine: null, isWarn: false };
      }
      const w = weightWindow(perDayMl, rule.concentration, r.min, r.max, rule.tolPct || TOL_PCT_DEFAULT);
      return { refLine, calcLine: `体重換算 ${kgRangeText(w.lo, w.hi)}相当`, isWarn };
    }

    if(rule.type === 'age'){
      if(patient.age == null || isNaN(patient.age)){
        return {
          refLine: '添文：年齢により1回量・回数が異なります（下記タイムライン参照）',
          calcLine: null,
          isWarn: false,
          timeline: { bands: rule.bands, currentAge: null }
        };
      }
      if(rule.weightBelow && patient.age < rule.weightBelow.ageMax){
        const wb = rule.weightBelow;
        const c = weightBelowCalc(wb, perDayMl);
        const per = wb.basis === 'dose' ? '1回' : '1日';
        return {
          refLine: `添文：${formatNum(wb.ageMax)}歳未満は体重あたり ${wb.doseText}`,
          calcLine: c ? `体重換算 ${formatNum(c.lo)}${Math.abs(c.hi - c.lo) < 0.05 ? '' : '〜' + formatNum(c.hi)}kg相当（${per}${formatNum(c.amount)}ml）` : null,
          isWarn,
          timeline: { bands: rule.bands, currentAge: patient.age }
        };
      }
      const band = rule.bands.find(b => patient.age >= b.minAge && patient.age < b.maxAge);
      const calcLine = band
        ? `該当区分：${band.label}（${bandDoseText(band)}）`
        : `年齢${formatNum(patient.age)}歳は適応区分外`;
      return {
        refLine: '添文：年齢により1回量・回数が異なります（下記タイムライン参照）',
        calcLine,
        isWarn,
        timeline: { bands: rule.bands, currentAge: patient.age }
      };
    }

    return null;
  }

  // 区分の規定用量の文言（1回量型 / 1日量の幅型）
  function bandDoseText(b){
    if(b.range){
      return `1日${formatNum(b.minPerDayMl)}〜${formatNum(b.maxPerDayMl)}ml` + (b.timesPerDay ? `（分${b.timesPerDay}）` : '');
    }
    return `1回${formatNum(b.perDoseMl)}mlを1日${b.timesPerDay}回`;
  }

  // 年齢区分ベースの薬剤について、期間ごとの用量をタイムラインとして描画するHTMLを生成。
  // 添付文書の年齢区分ラベル（label）はそのまま正確な文言で表示する（略記・言い換えはしない）。
  // 横並びだと正式文言が収まりきらず画面幅からはみ出すため、区分ごとに1行の縦積みで表示する。
  function buildTimelineHtml(timeline){
    if(!timeline || !timeline.bands || timeline.bands.length === 0) return '';
    const bands = timeline.bands;

    const bandsHtml = bands.map(b=>{
      const isCurrent = timeline.currentAge != null && timeline.currentAge >= b.minAge && timeline.currentAge < b.maxAge;
      const doseHtml = b.range
        ? `${bandDoseText(b)}`
        : `1回${formatNum(b.perDoseMl)}mlを1日${b.timesPerDay}回<span class="tb-perday">（${formatNum(b.perDoseMl * b.timesPerDay)}ml/day）</span>`;
      return `<div class="timeline-band${isCurrent ? ' current' : ''}">
        <span class="tb-age">${escapeHtml(b.label)}</span>
        <span class="tb-dose">${doseHtml}</span>
      </div>`;
    }).join('');

    return `<div class="dose-timeline">
      <div class="timeline-track">${bandsHtml}</div>
    </div>`;
  }

  function renderDrugCards(){
    // フォーカス位置を保存（再描画でフォーカスが飛ばないように）
    const activeEl = document.activeElement;
    let restoreInfo = null;
    if(activeEl && activeEl.classList && activeEl.classList.contains('perday-input')){
      const allInputs = Array.from(drugListEl.querySelectorAll('.perday-input'));
      const idxOfActive = allInputs.indexOf(activeEl);
      if(idxOfActive !== -1){
        restoreInfo = {
          type:'perday',
          idx: idxOfActive,
          selStart: activeEl.selectionStart,
          selEnd: activeEl.selectionEnd
        };
      }
    }

    drugListEl.innerHTML = '';
    state.drugs.forEach((drug, idx)=>{
      const card = document.createElement('div');
      const isEmpty = drug.perDay == null || isNaN(drug.perDay) || drug.perDay === 0;
      card.className = 'drug-card' + (isEmpty ? ' is-empty' : '');
      card.dataset.idx = idx;

      card.innerHTML = `
        <div class="drug-head">
          <span class="drug-index">${idx+1}</span>
          <div class="name-field-wrap${drug.name ? ' has-value' : ''}">
            <input class="drug-name-input" type="text" placeholder="薬剤名を入力（任意）" value="${escapeHtml(drug.name)}">
            <button class="clear-name-btn" type="button" title="薬剤名をクリア">✕</button>
          </div>
          <span class="empty-tag" style="${isEmpty ? '' : 'display:none;'}">未入力（対象外）</span>
        </div>
        ${state.drugs.length > 1 ? '<button class="remove-btn" type="button" title="このカードを削除">✕</button>' : ''}
        <div class="name-chips"></div>
        <div class="dose-row">
          <div class="dose-field">
            <label>1日量</label>
            <input type="number" inputmode="decimal" class="perday-input" min="0" step="0.1" value="${drug.perDay != null ? drug.perDay : ''}" placeholder="0">
            <span class="unit-suffix">ml</span>
          </div>
          <span class="arrow">→ ×${state.days}日 →</span>
          <span class="total-badge"></span>
        </div>
        <div class="dose-ref-slot"></div>
      `;

      // イベント: 薬剤名
      const nameInput = card.querySelector('.drug-name-input');
      const nameWrap = card.querySelector('.name-field-wrap');
      nameInput.addEventListener('input', (e)=>{
        drug.name = e.target.value;
        nameWrap.classList.toggle('has-value', !!drug.name);
        renderChips(card, drug);                 // 入力で候補を絞り込む
        syncActiveRpSnapshot();
        updateDrugCardDisplays(); // 薬剤名変更で用量根拠(添文)が変わるため
      });

      // イベント: 薬剤名クリア（カードはそのまま残し、名前欄だけ空にする）
      const clearNameBtn = card.querySelector('.clear-name-btn');
      clearNameBtn.addEventListener('click', ()=>{
        drug.name = '';
        nameInput.value = '';
        nameWrap.classList.remove('has-value');
        renderChips(card, drug);
        syncActiveRpSnapshot();
        updateDrugCardDisplays();
        nameInput.focus();
      });

      renderChips(card, drug);   // 候補チップ（よく使う順・入力で絞り込み）

      // イベント: 1日量
      // DOM要素（inputそのもの）は再生成せず、合計表示などのテキストだけをその場で更新する。
      // モバイルの数値キーボードで小数点以下を入力中にinnerHTMLで作り直すと、
      // 入力途中の値（例: "2.5"の".5"部分）が反映されないことがあるため。
      const perdayInput = card.querySelector('.perday-input');
      attachSelectOnFocus(perdayInput);
      perdayInput.addEventListener('input', (e)=>{
        const v = parseFloat(e.target.value);
        drug.perDay = isNaN(v) ? null : v;
        updateDrugCardDisplays();
        renderResult();
        syncActiveRpSnapshot();
      });

      // イベント: 削除
      const removeBtn = card.querySelector('.remove-btn');
      if(removeBtn){
        removeBtn.addEventListener('click', ()=>{
          state.drugs.splice(idx,1);
          renderDrugCards();
          renderResult();
          syncActiveRpSnapshot();
        });
      }

      drugListEl.appendChild(card);
    });

    updateDrugCardDisplays();

    // フォーカスを復元
    if(restoreInfo && restoreInfo.type === 'perday'){
      const allInputs = Array.from(drugListEl.querySelectorAll('.perday-input'));
      const target = allInputs[restoreInfo.idx];
      if(target){
        target.focus();
        try{ target.setSelectionRange(restoreInfo.selStart, restoreInfo.selEnd); }catch(e){/* number入力型は非対応の場合あり */}
      }
    }
  }

  // 各薬剤カードの「1日量×日数分」「未入力タグ」「用量根拠（添文）」表示だけを更新する。
  // input要素そのものは触らないため、入力中の値やカーソル位置、IME状態を壊さない。
  // ここは各薬剤単独の量を表示する（累積量は結果パネル側の調製手順でのみ表示する）。
  function updateDrugCardDisplays(){
    const cards = Array.from(drugListEl.querySelectorAll('.drug-card'));
    cards.forEach((card, idx)=>{
      const drug = state.drugs[idx];
      if(!drug) return;
      const isEmpty = drug.perDay == null || isNaN(drug.perDay) || drug.perDay === 0;
      card.classList.toggle('is-empty', isEmpty);

      const emptyTag = card.querySelector('.empty-tag');
      if(emptyTag) emptyTag.style.display = isEmpty ? '' : 'none';

      const nameWrap = card.querySelector('.name-field-wrap');
      if(nameWrap) nameWrap.classList.toggle('has-value', !!drug.name);

      const totalForDrug = (!isEmpty) ? (drug.perDay * state.days) : null;
      const totalLabel = isEmpty ? '—' : formatNum(totalForDrug);

      const badge = card.querySelector('.total-badge');
      if(badge) badge.textContent = `${totalLabel} ml`;

      const doseRef = buildDoseRefLines(drug.name, drug.perDay);
      const slot = card.querySelector('.dose-ref-slot');
      if(slot){
        if(doseRef){
          const timelineHtml = doseRef.timeline ? buildTimelineHtml(doseRef.timeline) : '';
          const calcLineHtml = doseRef.calcLine
            ? `<span class="calc-line${doseRef.isWarn ? ' warn' : ''}">${doseRef.isWarn ? '⚠ ' : ''}${escapeHtml(doseRef.calcLine)}</span>`
            : '';
          slot.innerHTML = `
            <div class="dose-ref">
              <span class="ref-line">${escapeHtml(doseRef.refLine)}</span>
              ${calcLineHtml}
              ${timelineHtml}
            </div>`;
        } else {
          slot.innerHTML = '';
        }
      }
    });
  }

  addDrugBtn.addEventListener('click', ()=>{
    state.drugs.push({name:'', perDay:null});
    renderDrugCards();
    renderResult();
    syncActiveRpSnapshot();
    // 新しく追加したカードの1日量入力にフォーカス
    const cards = drugListEl.querySelectorAll('.perday-input');
    const last = cards[cards.length-1];
    if(last) last.focus();
  });

  // ---------- 候補薬剤リストの編集 ----------
  const manageToggle = document.getElementById('manageToggle');
  const managePanel = document.getElementById('managePanel');
  const manageList = document.getElementById('manageList');
  const manageAddInput = document.getElementById('manageAddInput');
  const manageAddBtn = document.getElementById('manageAddBtn');

  manageToggle.addEventListener('click', ()=>{
    const willOpen = !managePanel.classList.contains('open');
    managePanel.classList.toggle('open', willOpen);
    manageToggle.textContent = willOpen ? '候補リストを閉じる' : '候補リストを編集';
    if(willOpen){
      renderManageList();
      manageAddInput.focus();
    }
  });

  function renderManageList(){
    if(NAME_SUGGESTIONS.length === 0){
      manageList.innerHTML = '<div class="manage-empty-note">候補はまだありません。下から追加してください。</div>';
      return;
    }
    manageList.innerHTML = NAME_SUGGESTIONS.map((name, i)=>`
      <div class="manage-item">
        <span>${escapeHtml(name)}</span>
        <button type="button" data-idx="${i}" title="候補から削除">✕</button>
      </div>
    `).join('');
    manageList.querySelectorAll('button').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const i = parseInt(btn.dataset.idx, 10);
        const name = NAME_SUGGESTIONS[i];
        const hasRule = !!drugAuditRules[name];

        if(hasRule){
          const removeRuleToo = confirm(`「${name}」には用量鑑査ルールが登録されています。鑑査ルールも一緒に削除しますか？\n\n「OK」＝候補と鑑査ルールを両方削除\n「キャンセル」＝削除を取りやめる`);
          if(!removeRuleToo) return; // 鑑査ルールが紐づく場合、候補削除だけを行う操作は認めない（整合性維持のため）
          delete drugAuditRules[name];
          persistRules();
          renderRuleList();
        }

        NAME_SUGGESTIONS.splice(i,1);
        persist();
        renderManageList();
        renderDrugCards();
        renderResult();
      });
    });
  }

  function addSuggestion(){
    const val = manageAddInput.value.trim();
    if(!val) return;
    if(NAME_SUGGESTIONS.includes(val)){
      manageAddInput.value = '';
      manageAddInput.focus();
      return;
    }
    NAME_SUGGESTIONS.push(val);
    persist();
    manageAddInput.value = '';
    renderManageList();
    renderDrugCards();
    renderResult();
    manageAddInput.focus();
  }

  manageAddBtn.addEventListener('click', addSuggestion);
  manageAddInput.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){
      e.preventDefault();
      addSuggestion();
    }
  });

  function escapeHtml(str){
    return (str||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  }

  function formatNum(n){
    // 小数第2位までで、末尾の不要な0を除去
    const rounded = Math.round(n * 100) / 100;
    return rounded.toString();
  }

  // ---------- 用量鑑査ルールの管理UI ----------
  const ruleManageToggle = document.getElementById('ruleManageToggle');
  const ruleManagePanel = document.getElementById('ruleManagePanel');
  const ruleListEl = document.getElementById('ruleList');
  const ruleAddNewBtn = document.getElementById('ruleAddNewBtn');
  const ruleFormSlot = document.getElementById('ruleFormSlot');

  let ruleFormEditingName = null; // 編集中の薬剤名（nullなら新規追加モード）
  let ruleFormDraft = null;       // フォームの一時データ

  ruleManageToggle.addEventListener('click', ()=>{
    const willOpen = !ruleManagePanel.classList.contains('open');
    ruleManagePanel.classList.toggle('open', willOpen);
    ruleManageToggle.textContent = willOpen ? '閉じる' : '編集';
    if(willOpen){
      renderRuleList();
    } else {
      closeRuleForm();
    }
  });

  function renderRuleList(){
    const names = Object.keys(drugAuditRules);
    if(names.length === 0){
      ruleListEl.innerHTML = '<div class="manage-empty-note">登録済みの鑑査ルールはありません。下のボタンから追加できます。</div>';
      return;
    }
    ruleListEl.innerHTML = names.map(name=>{
      const rule = drugAuditRules[name];
      const typeLabel = rule.type === 'weight' ? '体重換算' : '年齢区分';
      let summary = '';
      if(rule.type === 'weight'){
        const d = doseRangeOf(rule);
        summary = `${doseRangeText(d.min, d.max, rule.unitK || 1, rule.unit || 'mg')}/kg/day（製剤${rule.concentration}mg/ml）／範囲外${rule.tolPct || TOL_PCT_DEFAULT}%で注意`;
        if(rule.maxDay > 0) summary += `／上限1日${formatNum(rule.maxDay * (rule.unitK || 1))}${escapeHtml(rule.unit || 'mg')}`;
      } else if(rule.type === 'age'){
        summary = rule.bands.map(b=>`${escapeHtml(b.label)}：${bandDoseText(b)}`).join('<br>');
      }
      if(rule.formAge) summary += `<br>製剤の対象年齢：${escapeHtml(formAgeText(rule.formAge))}`;
      return `<div class="rule-card" data-name="${escapeHtml(name)}">
        <div class="rule-card-head">
          <span class="rule-card-name">${escapeHtml(name)}${rule.genericName ? `（${escapeHtml(rule.genericName)}）` : ''}</span>
          <span class="rule-card-type">${typeLabel}</span>
        </div>
        <div class="rule-card-summary">${summary}</div>
        <div class="rule-card-actions" style="margin-top:8px;">
          <button type="button" class="rule-edit-btn">編集</button>
          <button type="button" class="rule-delete-btn">削除</button>
        </div>
      </div>`;
    }).join('');

    ruleListEl.querySelectorAll('.rule-card').forEach(card=>{
      const name = card.dataset.name;
      card.querySelector('.rule-edit-btn').addEventListener('click', ()=>{
        openRuleForm(name);
      });
      card.querySelector('.rule-delete-btn').addEventListener('click', ()=>{
        if(!confirm(`「${name}」の鑑査ルールを削除しますか？（調製計算そのものには影響しません）`)) return;
        delete drugAuditRules[name];
        persistRules();
        renderRuleList();
        updateDrugCardDisplays();
        renderResult();
      });
    });
  }

  ruleAddNewBtn.addEventListener('click', ()=>{
    openRuleForm(null);
  });

  function closeRuleForm(){
    ruleFormEditingName = null;
    ruleFormDraft = null;
    ruleFormSlot.innerHTML = '';
  }

  function openRuleForm(name){
    ruleFormEditingName = name;
    if(name){
      // 編集：既存ルールをディープコピーして下書きにする
      ruleFormDraft = JSON.parse(JSON.stringify(drugAuditRules[name]));
      ruleFormDraft._name = name;
    } else {
      // 新規：年齢区分タイプを初期値にする
      ruleFormDraft = {
        _name: '',
        type: 'age',
        genericName: '',
        bands: [
          { minAge: 0, maxAge: 1, label: '', perDoseMl: null, timesPerDay: null }
        ]
      };
    }
    renderRuleForm();
    if(typeof ruleFormSlot.scrollIntoView === 'function'){
      ruleFormSlot.scrollIntoView({block:'nearest'});
    }
  }

  function renderRuleForm(){
    const d = ruleFormDraft;
    const isWeight = d.type === 'weight';
    const isAge = d.type === 'age';

    let bandsHtml = '';
    if(isAge){
      bandsHtml = d.bands.map((b, i)=>`
        <div class="rule-band-item" data-idx="${i}">
          <div class="rule-band-item-head">
            <span>区分${i+1}</span>
            ${d.bands.length > 1 ? '<button type="button" class="rule-band-remove-btn" title="この区分を削除">✕</button>' : ''}
          </div>
          <div class="rule-form-row">
            <label>区分の文言（添付文書の正確な表現で）</label>
            <input type="text" class="rb-label" value="${escapeHtml(b.label)}" placeholder="例：1歳以上7歳未満">
          </div>
          <div class="rule-form-2col">
            <div class="rule-form-row">
              <label>下限年齢（歳）</label>
              <input type="number" inputmode="decimal" class="rb-min" step="0.01" value="${b.minAge != null ? b.minAge : ''}" placeholder="例：1">
            </div>
            <div class="rule-form-row">
              <label>上限年齢（歳・未満）</label>
              <input type="number" inputmode="decimal" class="rb-max" step="0.01" value="${b.maxAge != null ? b.maxAge : ''}" placeholder="例：7">
            </div>
          </div>
          <div class="rule-form-2col">
            <div class="rule-form-row">
              <label>1回量（ml）</label>
              <input type="number" inputmode="decimal" class="rb-dose" step="0.1" value="${b.perDoseMl != null ? b.perDoseMl : ''}" placeholder="例：2.5">
            </div>
            <div class="rule-form-row">
              <label>1日回数</label>
              <input type="number" inputmode="numeric" class="rb-times" step="1" value="${b.timesPerDay != null ? b.timesPerDay : ''}" placeholder="例：2">
            </div>
          </div>
        </div>
      `).join('');
    }

    ruleFormSlot.innerHTML = `
      <div class="rule-form">
        <div class="rule-form-title">${ruleFormEditingName ? `「${escapeHtml(ruleFormEditingName)}」を編集` : '新しい薬剤の鑑査ルールを追加'}</div>
        <div id="ruleFormError"></div>
        <div class="rule-form-row">
          <label>薬剤名（候補リストの表記と一致させてください）</label>
          <input type="text" id="rfName" value="${escapeHtml(d._name)}" placeholder="例：ムコダイン">
        </div>
        <div class="rule-form-row">
          <label>一般名（任意）</label>
          <input type="text" id="rfGenericName" value="${escapeHtml(d.genericName || '')}" placeholder="例：カルボシステイン">
        </div>
        <div class="rule-form-row">
          <label>鑑査タイプ</label>
          <div class="rule-type-toggle">
            <button type="button" class="rule-type-btn${isWeight ? ' active' : ''}" data-type="weight">体重換算（mg/kg/day）</button>
            <button type="button" class="rule-type-btn${isAge ? ' active' : ''}" data-type="age">年齢区分</button>
          </div>
        </div>
        <div id="rfTypeFields"></div>
        <div class="rule-form-actions">
          <button type="button" class="rule-form-save-btn" id="rfSaveBtn">保存</button>
          <button type="button" class="rule-form-cancel-btn" id="rfCancelBtn">キャンセル</button>
        </div>
      </div>
    `;

    const typeFieldsEl = document.getElementById('rfTypeFields');
    if(isWeight){
      typeFieldsEl.innerHTML = `
        <div class="rule-form-2col">
          <div class="rule-form-row">
            <label>製剤濃度（mg/ml）</label>
            <input type="number" inputmode="decimal" id="rfConcentration" step="0.1" value="${d.concentration != null ? d.concentration : ''}" placeholder="例：50">
          </div>
          <div class="rule-form-row">
            <label>基準用量（mg/kg/day）</label>
            <input type="number" inputmode="decimal" id="rfDosePerKg" step="0.1" value="${d.dosePerKgPerDay != null ? d.dosePerKgPerDay : ''}" placeholder="例：30">
          </div>
        </div>
        <div class="rule-form-row">
          <label>許容差（体重換算との差、±kg）</label>
          <input type="number" inputmode="decimal" id="rfTolerance" step="0.5" value="${d.toleranceKg != null ? d.toleranceKg : 5}" placeholder="例：5">
        </div>
      `;
    } else if(isAge){
      typeFieldsEl.innerHTML = `${bandsHtml}<button type="button" class="rule-band-add-btn" id="rfAddBandBtn">＋ 区分を追加</button>`;

      typeFieldsEl.querySelectorAll('.rule-band-item').forEach(item=>{
        const idx = parseInt(item.dataset.idx, 10);
        item.querySelector('.rb-label').addEventListener('input', e=>{ d.bands[idx].label = e.target.value; });
        item.querySelector('.rb-min').addEventListener('input', e=>{ d.bands[idx].minAge = parseFloat(e.target.value); });
        item.querySelector('.rb-max').addEventListener('input', e=>{ d.bands[idx].maxAge = parseFloat(e.target.value); });
        item.querySelector('.rb-dose').addEventListener('input', e=>{ d.bands[idx].perDoseMl = parseFloat(e.target.value); });
        item.querySelector('.rb-times').addEventListener('input', e=>{ d.bands[idx].timesPerDay = parseInt(e.target.value, 10); });
        const removeBtn = item.querySelector('.rule-band-remove-btn');
        if(removeBtn){
          removeBtn.addEventListener('click', ()=>{
            d.bands.splice(idx, 1);
            renderRuleForm();
          });
        }
      });

      const addBandBtn = document.getElementById('rfAddBandBtn');
      if(addBandBtn){
        addBandBtn.addEventListener('click', ()=>{
          const lastBand = d.bands[d.bands.length-1];
          d.bands.push({
            minAge: lastBand ? lastBand.maxAge : 0,
            maxAge: null,
            label: '',
            perDoseMl: null,
            timesPerDay: null
          });
          renderRuleForm();
        });
      }
    }

    // 共通フィールドのイベント
    document.getElementById('rfName').addEventListener('input', e=>{ d._name = e.target.value; });
    document.getElementById('rfGenericName').addEventListener('input', e=>{ d.genericName = e.target.value; });

    if(isWeight){
      document.getElementById('rfConcentration').addEventListener('input', e=>{ d.concentration = parseFloat(e.target.value); });
      document.getElementById('rfDosePerKg').addEventListener('input', e=>{ d.dosePerKgPerDay = parseFloat(e.target.value); });
      document.getElementById('rfTolerance').addEventListener('input', e=>{ d.toleranceKg = parseFloat(e.target.value); });
    }

    ruleFormSlot.querySelectorAll('.rule-type-btn').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const newType = btn.dataset.type;
        if(newType === d.type) return;
        d.type = newType;
        if(newType === 'weight'){
          d.concentration = d.concentration || null;
          d.dosePerKgPerDay = d.dosePerKgPerDay || null;
          d.toleranceKg = d.toleranceKg || 5;
          delete d.bands;
        } else {
          d.bands = d.bands && d.bands.length ? d.bands : [{ minAge: 0, maxAge: 1, label: '', perDoseMl: null, timesPerDay: null }];
          delete d.concentration;
          delete d.dosePerKgPerDay;
          delete d.toleranceKg;
        }
        renderRuleForm();
      });
    });

    document.getElementById('rfSaveBtn').addEventListener('click', saveRuleForm);
    document.getElementById('rfCancelBtn').addEventListener('click', closeRuleForm);
  }

  function showRuleFormError(msg){
    document.getElementById('ruleFormError').innerHTML = `<div class="rule-form-error">${escapeHtml(msg)}</div>`;
  }

  // 鑑査ルールの薬剤名と候補薬剤リストを同期する。
  // oldName（リネーム前の名前。新規追加ならnull）とnewName（保存後の名前）を受け取る。
  function syncSuggestionWithRuleName(oldName, newName){
    let changed = false;
    if(oldName && oldName !== newName){
      // リネーム：候補リスト内の旧名を新名に置き換える（候補になければ何もしない）
      const idx = NAME_SUGGESTIONS.indexOf(oldName);
      if(idx !== -1){
        if(NAME_SUGGESTIONS.includes(newName)){
          // 新名が既に候補にある場合は重複するので旧名だけ削除
          NAME_SUGGESTIONS.splice(idx, 1);
        } else {
          NAME_SUGGESTIONS[idx] = newName;
        }
        changed = true;
      } else if(!NAME_SUGGESTIONS.includes(newName)){
        // 旧名が候補になかった場合は新名を追加
        NAME_SUGGESTIONS.push(newName);
        changed = true;
      }
    } else if(!oldName){
      // 新規追加：候補になければ自動で追加
      if(!NAME_SUGGESTIONS.includes(newName)){
        NAME_SUGGESTIONS.push(newName);
        changed = true;
      }
    }
    if(changed){
      persist();
      renderManageList();
      renderDrugCards(); // 薬剤カード内の候補チップ一覧（name-chip）を再構築して反映
    }
  }

  function saveRuleForm(){
    const d = ruleFormDraft;
    const name = (d._name || '').trim();

    if(!name){
      showRuleFormError('薬剤名を入力してください。');
      return;
    }
    if(name !== ruleFormEditingName && drugAuditRules[name]){
      showRuleFormError(`「${name}」は既に登録されています。別の名前にするか、既存ルールを編集してください。`);
      return;
    }

    if(d.type === 'weight'){
      if(!(d.concentration > 0) || !(d.dosePerKgPerDay > 0)){
        showRuleFormError('製剤濃度と基準用量は0より大きい数値で入力してください。');
        return;
      }
      const newRule = {
        type: 'weight',
        genericName: d.genericName || '',
        concentration: d.concentration,
        dosePerKgPerDay: d.dosePerKgPerDay,
        toleranceKg: (d.toleranceKg > 0) ? d.toleranceKg : 5
      };
      if(ruleFormEditingName && ruleFormEditingName !== name){
        delete drugAuditRules[ruleFormEditingName];
      }
      drugAuditRules[name] = newRule;
    } else {
      if(!d.bands || d.bands.length === 0){
        showRuleFormError('年齢区分を少なくとも1つ追加してください。');
        return;
      }
      for(let i=0; i<d.bands.length; i++){
        const b = d.bands[i];
        if(!b.label || !b.label.trim()){
          showRuleFormError(`区分${i+1}：文言を入力してください。`);
          return;
        }
        if(!(b.minAge >= 0) || !(b.maxAge > b.minAge)){
          showRuleFormError(`区分${i+1}：年齢範囲が不正です（上限は下限より大きくしてください）。`);
          return;
        }
        if(!(b.perDoseMl > 0) || !(b.timesPerDay > 0)){
          showRuleFormError(`区分${i+1}：1回量・1日回数は0より大きい数値で入力してください。`);
          return;
        }
      }
      const newRule = {
        type: 'age',
        genericName: d.genericName || '',
        bands: d.bands.map(b=>({
          minAge: b.minAge, maxAge: b.maxAge, label: b.label.trim(),
          perDoseMl: b.perDoseMl, timesPerDay: b.timesPerDay
        }))
      };
      if(ruleFormEditingName && ruleFormEditingName !== name){
        delete drugAuditRules[ruleFormEditingName];
      }
      drugAuditRules[name] = newRule;
    }

    // 候補薬剤リストとの整合性を取る：
    // - リネームなら旧名を新名に置き換え
    // - 新規（旧名なし）で候補にまだなければ追加
    syncSuggestionWithRuleName(ruleFormEditingName, name);

    persistRules();
    closeRuleForm();
    renderRuleList();
    updateDrugCardDisplays();
    renderResult();
  }

  // ---------- 用量鑑査 ----------
  // drugTotals（{name, perDay, total}の配列）と患者情報（年齢・体重）から、
  // マスタに登録された薬剤について鑑査結果を返す。マスタ未登録の薬剤はスキップ（対象外）。
  function auditDrug(name, perDayMl){
    const rule = drugAuditRules[name];
    if(!rule) return null;
    return withFormAge(rule, name, auditDrugDose(rule, name, perDayMl));
  }
  // 製剤の対象年齢（例：ストラテラ内用液は6歳以上、ムコソルバン内用液0.75%は成人用）
  function withFormAge(rule, name, res){
    const fa = rule.formAge;
    if(!fa || patient.age == null || isNaN(patient.age)) return res;
    const out = (fa.min !== null && patient.age < fa.min - 1e-9) || (fa.max !== null && patient.age >= fa.max - 1e-9);
    if(!out) return res;
    const msg = `この製剤の対象年齢（${formAgeText(fa)}）に当てはまりません（${formatNum(patient.age)}歳）。製剤の選択をご確認ください。`;
    const line = `製剤の対象年齢：${formAgeText(fa)}`;
    if(!res) return { name, ok: false, lines: [line], warnText: msg };
    return { name, ok: false, lines: [line].concat(res.lines), warnText: msg + (res.warnText ? ' ' + res.warnText : '') };
  }
  function auditDrugDose(rule, name, perDayMl){
    if(rule.type === 'weight'){
      if(patient.weight == null || isNaN(patient.weight)) return null; // 体重未入力なら鑑査しない
      const r = doseRangeOf(rule), k = rule.unitK || 1, u = rule.unit || 'mg';
      const pct = rule.tolPct || TOL_PCT_DEFAULT, W = patient.weight;
      // 処方量(ml/day)を基準用量(ml/kg/day)の範囲で割ると「何kg相当の量か」が出る
      const w = weightWindow(perDayMl, rule.concentration, r.min, r.max, pct, rule.dlimit);
      const mg = perDayMl * rule.concentration;
      const perKg = mg / W;
      const cap = (rule.maxDay > 0) ? rule.maxDay : null;
      // 上限（成人量など）：体重あたりで計算すると上限を超える大きい子は、上限までの量でよい
      let low = W > w.allowHi;
      if(low && cap && W * r.min > cap) low = mg < cap * (1 - pct / 100);
      const overCap = !!cap && mg > cap * (1 + 1e-9);   // 上限は許容差なし
      const highKg = W < w.allowLo;
      const lines = [
        `添付文書基準：${doseRangeText(r.min, r.max, k, u)}/kg/day（製剤${formatNum(rule.concentration * k)}${u}/ml）` +
          (rule.dlimit > r.max ? `・最高${formatNum(rule.dlimit * k)}${u}/kg/day` : ''),
        `処方量：${formatNum(perDayMl)}ml/day → 体重換算 ${kgRangeText(w.lo, w.hi)}相当（許容 ${formatNum(w.allowLo)}〜${formatNum(w.allowHi)}kg）`,
        `実体重：${formatNum(W)}kg → 体重あたり ${formatNum(perKg * k)}${u}/kg/day`
      ];
      if(cap){
        lines.push(`上限：1日${formatNum(cap * k)}${u}${rule.maxNote ? `［${rule.maxNote}］` : ''} → 処方は1日${formatNum(mg * k)}${u}`);
        if(!overCap && W * r.max > cap) lines.push('体重あたりで計算すると上限を超える体重です。上限までの量なら適正です');
      }
      lines.push(`判定：範囲から${pct}%超、または上限超えで注意（根拠は「用量鑑査ルール」の判定基準と根拠）`);
      const warns = [];
      if(highKg || low) warns.push(`体重あたりの量が添付文書の範囲から${pct}%を超えて${highKg ? '多く' : '少なく'}なっています。`);
      if(overCap) warns.push(`1日量が上限（1日${formatNum(cap * k)}${u}）を超えています（上限の${formatNum(Math.round(mg / cap * 1000) / 10)}%）。体重あたりでは範囲内でも、大きい子では成人量などの上限を超えることがあります。`);
      return {
        name,
        ok: !(low || highKg || overCap),
        lines,
        warnText: warns.length ? warns.join('') + '処方量をご確認ください。' : null
      };
    }

    if(rule.type === 'age'){
      if(patient.age == null || isNaN(patient.age)) return null; // 年齢未入力なら鑑査しない
      if(rule.weightBelow && patient.age < rule.weightBelow.ageMax){
        return auditWeightBelow(name, rule.weightBelow, perDayMl);
      }
      const band = rule.bands.find(b => patient.age >= b.minAge && patient.age < b.maxAge);
      if(!band){
        return {
          name,
          ok: false,
          lines: [`年齢：${formatNum(patient.age)}歳（適応年齢区分外）`],
          warnText: '登録されている年齢区分（' + rule.bands.map(b=>b.label).join('／') + '）に該当しません。適応をご確認ください。'
        };
      }
      if(band.range){
        // 1日量の幅（アスベリン型）：1日量が範囲内か、分割回数が規定どおりかを見る
        const EPS = 0.005;   // 表示の丸め（0.01ml）分の誤差は許容
        const inRange = perDayMl >= band.minPerDayMl - EPS && perDayMl <= band.maxPerDayMl + EPS;
        const timesOk = !band.timesPerDay || state.div === band.timesPerDay;
        let warn = null;
        if(!inRange) warn = perDayMl < band.minPerDayMl ? '1日量が規定の下限を下回っています。処方内容をご確認ください。'
                                                         : '1日量が規定の上限を超えています。処方内容をご確認ください。';
        else if(!timesOk) warn = `規定の分割回数（分${band.timesPerDay}）と異なります。処方内容をご確認ください。`;
        return {
          name,
          ok: !warn,
          lines: [
            `年齢区分：${band.label}`,
            `規定用量：${bandDoseText(band)}`,
            `処方内容：1日${formatNum(perDayMl)}ml（分${state.div}）`
          ],
          warnText: warn
        };
      }
      // 実際の1回量を推定：分割数で1日量を割る
      const actualPerDose = state.div > 0 ? perDayMl / state.div : null;
      const doseMatches = actualPerDose != null && Math.abs(actualPerDose - band.perDoseMl) < 1e-6;
      const timesMatches = state.div === band.timesPerDay;
      const isWarn = !doseMatches || !timesMatches;
      return {
        name,
        ok: !isWarn,
        lines: [
          `年齢区分：${band.label}`,
          `規定用量：1回${formatNum(band.perDoseMl)}mlを1日${band.timesPerDay}回`,
          `処方内容：1回${actualPerDose!=null?formatNum(actualPerDose):'—'}mlを1日${state.div}回（分${state.div}）`
        ],
        warnText: isWarn ? '規定の1回量・回数と一致していません。処方内容をご確認ください。' : null
      };
    }

    return null;
  }

  // ○歳未満は体重あたりで決まる薬（年齢区分はそれ以上の年齢だけ）の鑑査
  function weightBelowCalc(wb, perDayMl){
    if(!(perDayMl > 0)) return null;
    const amount = wb.basis === 'dose' ? (state.div > 0 ? perDayMl / state.div : null) : perDayMl;
    if(amount == null) return null;
    const lo = amount / wb.mlPerKgMax, hi = amount / wb.mlPerKgMin;
    return { amount, lo, hi };
  }
  function auditWeightBelow(name, wb, perDayMl){
    const head = `${formatNum(wb.ageMax)}歳未満の基準：${wb.doseText}`;
    const c = weightBelowCalc(wb, perDayMl);
    if(patient.weight == null || isNaN(patient.weight) || !c){
      return { name, ok: true, lines: [head, '体重を入力すると体重換算で確認します'], warnText: null };
    }
    const per = wb.basis === 'dose' ? '1回' : '1日';
    const range = Math.abs(c.hi - c.lo) < 0.05 ? `${formatNum(c.lo)}kg` : `${formatNum(c.lo)}〜${formatNum(c.hi)}kg`;
    const w = weightWindow(c.amount, wb.conc, wb.doseMin, wb.doseMax, wb.tolPct);
    const low = patient.weight > w.allowHi, high = patient.weight < w.allowLo;
    const capMg = wb.cap ? (wb.basis === 'dose' ? wb.cap.maxDose : wb.cap.maxDay) : null;
    const mg = c.amount * wb.conc, k = wb.unitK || 1, u = wb.unit || 'mg';
    const overCap = !!capMg && mg > capMg * (1 + 1e-9);
    const lines = [
      head,
      `処方量：${per}${formatNum(c.amount)}ml → 体重換算 ${range}相当（許容 ${formatNum(w.allowLo)}〜${formatNum(w.allowHi)}kg）`,
      `実体重：${formatNum(patient.weight)}kg`
    ];
    if(capMg) lines.push(`上限：${capText(wb.cap, k, u)}`);
    const warns = [];
    if(low || high) warns.push(`体重あたりの量が添付文書の基準から${wb.tolPct}%を超えて${high ? '多く' : '少なく'}なっています。`);
    if(overCap) warns.push(`${per}量が上限（${per}${formatNum(capMg * k)}${u}）を超えています。`);
    return {
      name,
      ok: !(low || high || overCap),
      lines,
      warnText: warns.length ? warns.join('') + '処方量をご確認ください。' : null
    };
  }

  // ---------- 計算 & 結果描画 ----------
  const resultArea = document.getElementById('resultArea');

  // ---------- 投薬瓶への分割 ----------
  // 水剤瓶の規格（ml）。総量がこれを超える場合は複数本に分ける。
  const BOTTLE_SIZES = [30, 60, 100, 150, 200];
  const MAX_BOTTLE_ML = 200;

  // 日数をn本に分ける。各本の日数差が最小になる整数配分を返す（例：15日→[8,7]、14日→[5,5,4]）
  function splitDaysEvenly(days, n){
    const base = Math.floor(days / n);
    const rem = days % n;
    const arr = [];
    for(let i = 0; i < n; i++){
      arr.push(base + (i < rem ? 1 : 0));
    }
    return arr;
  }

  // 各本が瓶の最大容量に収まる「最少本数」を決める。
  // 1回量は変えずに日数で分けるので、各本の総量＝1回量×分割数×その本の日数。
  function decideBottleSplit(perDoseMl, div, days){
    for(let n = 1; n <= days; n++){
      const dayParts = splitDaysEvenly(days, n);
      if(dayParts.some(d => d <= 0)) continue; // 日数より多くは分けられない
      const volumes = dayParts.map(d => Math.round(perDoseMl * div * d * 1000) / 1000);
      if(volumes.every(v => v <= MAX_BOTTLE_ML + 1e-9)){
        return { count: n, dayParts, volumes };
      }
    }
    // 1日分ですら瓶に収まらない場合（極端な処方）は分割不能として返す
    return null;
  }

  // その量が入る最小の瓶を選ぶ
  function pickBottleSize(volume){
    return BOTTLE_SIZES.find(b => volume <= b + 1e-9) || null;
  }

  function renderResult(){
    const validDrugs = state.drugs.filter(d => d.perDay != null && !isNaN(d.perDay) && d.perDay > 0);

    if(validDrugs.length === 0){
      resultArea.innerHTML = `<div class="error-panel">薬剤の1日量を入力してください。（空欄の薬剤は自動的に計算対象から除外されます）</div>`;
      return;
    }
    if(state.div <= 0 || state.days <= 0){
      resultArea.innerHTML = `<div class="error-panel">分割数・日数は1以上を入力してください。</div>`;
      return;
    }

    const drugTotals = state.drugs.map(d=>{
      const perDay = (d.perDay != null && !isNaN(d.perDay)) ? d.perDay : 0;
      return {
        name: d.name || '（無名）',
        perDay: perDay,
        total: perDay * state.days
      };
    }).filter(d => d.total > 0);

    const sumDrugs = drugTotals.reduce((s,d)=>s+d.total, 0);
    const totalDoses = state.div * state.days; // 総服用回数
    const perDayTotal = drugTotals.reduce((s,d)=>s+d.perDay, 0); // 1日量合計

    // 1回あたりの理論値（丸め前）
    const rawPerDose = perDayTotal / state.div;

    // round刻みで切り上げ
    const roundUnit = state.round;
    const roundedPerDose = Math.ceil((rawPerDose - 1e-9) / roundUnit) * roundUnit;
    const roundedPerDoseFixed = Math.round(roundedPerDose * 1000) / 1000;

    // 最終総量 = 1回量 × 総服用回数
    const finalTotal = Math.round(roundedPerDoseFixed * totalDoses * 1000) / 1000;

    // 賦形に必要な水の量
    const waterVolume = Math.round((finalTotal - sumDrugs) * 1000) / 1000;
    const needsWater = waterVolume > 1e-9; // 浮動小数点誤差を考慮し、実質0は「不要」扱い

    // 投薬瓶への分割（総量が瓶の最大容量を超える場合は複数本に分ける）
    const bottleSplit = decideBottleSplit(roundedPerDoseFixed, state.div, state.days);
    const bottleCount = bottleSplit ? bottleSplit.count : 1;

    let html = '';

    html += `<div class="result-panel">
      <div class="result-title"><span>調製手順</span><span>${drugTotals.length}剤MIX / 分${state.div} / ${state.days}日分</span></div>`;

    if(bottleCount > 1 && bottleSplit){
      // ===== 複数本に分けて調製する場合 =====
      html += `<div class="bottle-notice">総量${formatNum(finalTotal)}mlのため <b>${bottleCount}本</b>に分けて調製します（1本あたり最大${MAX_BOTTLE_ML}ml）</div>`;

      bottleSplit.dayParts.forEach((partDays, bi)=>{
        const partTotal = bottleSplit.volumes[bi];
        const partDrugs = drugTotals.map(d=>({
          name: d.name,
          perDay: d.perDay,
          total: Math.round(d.perDay * partDays * 1000) / 1000
        }));
        const partSumDrugs = partDrugs.reduce((s,d)=>s+d.total, 0);
        const partWater = Math.round((partTotal - partSumDrugs) * 1000) / 1000;
        const partNeedsWater = partWater > 1e-9;
        const bottle = pickBottleSize(partTotal);

        html += `<div class="bottle-block">
          <div class="bottle-head">
            <span class="bottle-no">${bi+1}本目</span>
            <span class="bottle-days">${partDays}日分</span>
            <span class="bottle-size">${bottle ? bottle + 'ml瓶' : '規格外'}</span>
          </div>`;

        let cum = 0;
        partDrugs.forEach((d,i)=>{
          cum += d.total;
          const subLabel = (i === 0) ? '' : `（薬剤量 ${formatNum(d.total)}ml）`;
          html += `<div class="result-line">
            <span class="label">${i+1}. ${escapeHtml(d.name)}（${formatNum(d.perDay)}ml/日）を入れる</span>
            <span class="value">${formatNum(cum)} ml${subLabel ? `<span class="value-sub">${subLabel}</span>` : ''}</span>
          </div>`;
        });

        html += `<div class="result-line">
          <span class="label">水で賦形して総量</span>
          <span class="value${partNeedsWater ? '' : ' value-plain'}">${formatNum(partTotal)} ml</span>
        </div>`;

        html += `<div class="result-line">
          <span class="label">└ 加える水の量</span>
          <span class="value${partWater < 0 ? '' : (partNeedsWater ? '' : ' value-plain')}">${partWater < 0 ? '⚠ 負値' : (partNeedsWater ? `${formatNum(partWater)} ml` : '不要（0ml）')}</span>
        </div>`;

        html += `</div>`;
      });

      html += `<div class="result-line bottle-grand-total">
        <span class="label">全${bottleCount}本の合計</span>
        <span class="value">${formatNum(finalTotal)} ml</span>
      </div>`;

    } else {
      // ===== 1本で調製する場合（従来どおり） =====
      let cumulativeInResult = 0;
      drugTotals.forEach((d,i)=>{
        cumulativeInResult += d.total;
        const subLabel = (i === 0) ? '' : `（薬剤量 ${formatNum(d.total)}ml）`;
        html += `<div class="result-line">
          <span class="label">${i+1}. ${escapeHtml(d.name)}（${formatNum(d.perDay)}ml/日）を入れる</span>
          <span class="value">${formatNum(cumulativeInResult)} ml${subLabel ? `<span class="value-sub">${subLabel}</span>` : ''}</span>
        </div>`;
      });

      html += `<div class="result-line">
        <span class="label">水で賦形して総量</span>
        <span class="value${needsWater ? '' : ' value-plain'}">${formatNum(finalTotal)} ml</span>
      </div>`;

      html += `<div class="result-line">
        <span class="label">└ 加える水の量</span>
        <span class="value${waterVolume < 0 ? '' : (needsWater ? '' : ' value-plain')}">${waterVolume < 0 ? '⚠ 負値' : (needsWater ? `${formatNum(waterVolume)} ml` : '不要（0ml）')}</span>
      </div>`;

      const singleBottle = pickBottleSize(finalTotal);
      if(singleBottle){
        html += `<div class="result-line">
          <span class="label">投薬瓶</span>
          <span class="value value-plain">${singleBottle} ml瓶</span>
        </div>`;
      }
    }

    html += `<div class="result-hero">
      <span class="h-label">1回服用量</span>
      <span class="h-value">${formatNum(roundedPerDoseFixed)}<span> ml</span></span>
    </div>`;
    html += `<div class="result-sub">総服用回数 ${totalDoses}回（分${state.div} × ${state.days}日）</div>`;

    html += `<div class="calc-note">
1日量合計 <b>${formatNum(perDayTotal)}ml</b> ÷ 分${state.div} = <b>${formatNum(rawPerDose)}ml</b>
→ ${roundUnit}ml刻みで切上げ → <b>${formatNum(roundedPerDoseFixed)}ml</b>
${formatNum(roundedPerDoseFixed)}ml × ${totalDoses}回 = <b>${formatNum(finalTotal)}ml</b>（総量）
</div>`;

    // ---------- 鑑査パネル ----------
    // 年齢・体重が両方未入力なら、鑑査セクション自体を表示しない（調製優先の運用に合わせる）
    const hasPatientInfo = (patient.age != null && !isNaN(patient.age)) || (patient.weight != null && !isNaN(patient.weight));
    if(hasPatientInfo){
      const auditResults = drugTotals
        .map(d => auditDrug(d.name, d.perDay))
        .filter(r => r !== null);

      html += `<div class="audit-panel">
        <div class="audit-title">用量鑑査（年齢${patient.age!=null?formatNum(patient.age)+'歳':'—'}／体重${patient.weight!=null?formatNum(patient.weight)+'kg':'—'}）</div>`;

      if(auditResults.length === 0){
        html += `<div class="audit-empty">登録済みの用量ルールに該当する薬剤がありません（対象：${Object.keys(drugAuditRules).join('、')}）。</div>`;
      } else {
        auditResults.forEach(r=>{
          html += `<div class="audit-item ${r.ok ? 'ok' : 'warn'}">
            <span class="audit-drug-name">${r.ok ? '✓' : '⚠'} ${escapeHtml(r.name)}</span>
            <span class="audit-detail">${r.lines.map(escapeHtml).join('<br>')}</span>
            ${r.warnText ? `<div style="margin-top:5px;font-weight:700;">${escapeHtml(r.warnText)}</div>` : ''}
          </div>`;
        });
      }
      html += `</div>`;
    }

    html += `</div>`;

    if(waterVolume < 0){
      html += `<div class="error-panel" style="margin-top:10px;">薬剤の総量（${formatNum(sumDrugs)}ml）が最終総量（${formatNum(finalTotal)}ml）を超えています。刻み幅や薬剤量を確認してください。</div>`;
    }

    resultArea.innerHTML = html;
  }

  // ---------- 定型処方プリセット ----------
  const PRESET_KEY = 'mixCalcPresets_v1';

  function loadPresets(){
    try{
      const raw = localStorage.getItem(PRESET_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    }catch(e){ return []; }
  }
  function savePresets(list){
    try{
      localStorage.setItem(PRESET_KEY, JSON.stringify(list));
    }catch(e){ /* ignore */ }
  }

  let presets = loadPresets();

  const presetChipsEl = document.getElementById('presetChips');
  const presetEmptyNote = document.getElementById('presetEmptyNote');
  const presetNameInput = document.getElementById('presetNameInput');
  const savePresetBtn = document.getElementById('savePresetBtn');
  const presetToast = document.getElementById('presetToast');
  const presetToastTop = document.getElementById('presetToastTop');

  function showToast(el, text, duration){
    if(!el) return;
    el.textContent = text;
    el.classList.add('show');
    setTimeout(()=>el.classList.remove('show'), duration || 1800);
  }

  function renderPresetChips(){
    presetEmptyNote.style.display = presets.length === 0 ? 'block' : 'none';
    presetChipsEl.innerHTML = presets.map((p, i)=>{
      const drugCount = p.drugs.filter(d=>d.perDay>0).length;
      return `<span class="preset-chip" data-idx="${i}">${escapeHtml(p.name)}<span class="preset-meta">分${p.div}・${p.days}日・${drugCount}剤</span></span>`;
    }).join('');

    // タップ = 適用、長押し = 削除
    presetChipsEl.querySelectorAll('.preset-chip').forEach(chip=>{
      let pressTimer = null;
      let longPressed = false;

      const startPress = ()=>{
        longPressed = false;
        pressTimer = setTimeout(()=>{
          longPressed = true;
          const idx = parseInt(chip.dataset.idx, 10);
          if(confirm(`「${presets[idx].name}」を削除しますか？`)){
            presets.splice(idx,1);
            savePresets(presets);
            renderPresetChips();
          }
        }, 600);
      };
      const cancelPress = ()=>{
        if(pressTimer){ clearTimeout(pressTimer); pressTimer = null; }
      };

      chip.addEventListener('touchstart', startPress, {passive:true});
      chip.addEventListener('touchend', cancelPress);
      chip.addEventListener('touchmove', cancelPress);
      chip.addEventListener('mousedown', startPress);
      chip.addEventListener('mouseup', cancelPress);
      chip.addEventListener('mouseleave', cancelPress);

      chip.addEventListener('click', ()=>{
        if(longPressed) return; // 長押し削除の直後のクリックは無視
        const idx = parseInt(chip.dataset.idx, 10);
        applyPreset(presets[idx]);
      });
    });
  }

  function applyPreset(preset){
    state.div = preset.div;
    state.days = preset.days;
    state.round = preset.round;
    state.drugs = preset.drugs.map(d=>({name:d.name, perDay:d.perDay}));
    // 最低2枠は維持（空欄でも追加ボタンを押す手間を省く）
    while(state.drugs.length < 2){ state.drugs.push({name:'', perDay:null}); }

    syncChipUI('divChips','divCustom', state.div);
    syncChipUI('dayChips','dayCustom', state.days);
    syncChipUI('roundChips','roundCustom', state.round);
    persist();
    render();

    showToast(presetToastTop, `「${preset.name}」を適用しました`);
  }

  function saveCurrentAsPreset(){
    const name = presetNameInput.value.trim();
    if(!name){
      presetNameInput.focus();
      return;
    }
    const validDrugs = state.drugs.filter(d => d.perDay != null && !isNaN(d.perDay) && d.perDay > 0);
    if(validDrugs.length === 0){
      showToast(presetToast, '薬剤の1日量を入力してから保存してください', 2200);
      return;
    }
    const newPreset = {
      name,
      div: state.div,
      days: state.days,
      round: state.round,
      drugs: validDrugs.map(d=>({name:d.name, perDay:d.perDay}))
    };
    // 同名があれば上書き
    const existingIdx = presets.findIndex(p=>p.name === name);
    if(existingIdx !== -1){
      presets[existingIdx] = newPreset;
    } else {
      presets.push(newPreset);
    }
    savePresets(presets);
    presetNameInput.value = '';
    renderPresetChips();

    showToast(presetToast, `「${name}」を保存しました`);
  }

  savePresetBtn.addEventListener('click', saveCurrentAsPreset);
  presetNameInput.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){
      e.preventDefault();
      saveCurrentAsPreset();
    }
  });

  renderPresetChips();

  function render(){
    // 現在のstateを、開いているRpのスナップショットへ同期
    rpList[activeRpIndex] = cloneRpState(state);
    renderRpTabs();
    renderDrugCards();
    renderResult();
    saveSession();
  }

  // ---------- Rp（処方）タブ ----------
  const rpTabsEl = document.getElementById('rpTabs');
  const rpAddBtn = document.getElementById('rpAddBtn');
  const rpClearBtn = document.getElementById('rpClearBtn');

  function renderRpTabs(){
    rpTabsEl.innerHTML = rpList.map((rp, i)=>{
      const hasContent = rpHasContent(rp);
      const isActive = i === activeRpIndex;
      const closeBtn = rpList.length > 1
        ? `<button class="rp-tab-close" data-idx="${i}" title="このRpを削除">✕</button>`
        : '';
      return `<span class="rp-tab${isActive?' active':''}${hasContent?' has-content':''}" data-idx="${i}">
        <span class="rp-done-dot"></span>Rp${i+1}${closeBtn}
      </span>`;
    }).join('');

    rpTabsEl.querySelectorAll('.rp-tab').forEach(tab=>{
      tab.addEventListener('click', (e)=>{
        // ✕ボタンのクリックはタブ切り替えと分離
        if(e.target.classList.contains('rp-tab-close')) return;
        const idx = parseInt(tab.dataset.idx, 10);
        switchToRp(idx);
      });
    });
    rpTabsEl.querySelectorAll('.rp-tab-close').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        removeRp(idx);
      });
    });
  }

  function switchToRp(idx){
    if(idx === activeRpIndex) return;
    // 今のRpの内容を保存してから切り替え
    rpList[activeRpIndex] = cloneRpState(state);

    const target = cloneRpState(rpList[idx]);
    state.div = target.div;
    state.days = target.days;
    state.round = target.round;
    state.drugs = target.drugs;
    activeRpIndex = idx;

    syncChipUI('divChips','divCustom', state.div);
    syncChipUI('dayChips','dayCustom', state.days);
    syncChipUI('roundChips','roundCustom', state.round);
    render();

    const firstInput = drugListEl.querySelector('.perday-input');
    if(firstInput) firstInput.focus();
  }

  function removeRp(idx){
    if(rpList.length <= 1) return;
    const label = `Rp${idx+1}`;
    if(!confirm(`${label}の入力内容を削除しますか？`)) return;

    rpList.splice(idx, 1);
    if(activeRpIndex === idx){
      // 削除したRpが開いていた場合、隣（なければ最後）に移動
      const newIdx = Math.min(idx, rpList.length - 1);
      activeRpIndex = 0; // switchToRpの「今開いてるRpを保存」処理を避けるため一旦0扱いしてから正しい値へ
      const target = cloneRpState(rpList[newIdx]);
      state.div = target.div;
      state.days = target.days;
      state.round = target.round;
      state.drugs = target.drugs;
      activeRpIndex = newIdx;
      syncChipUI('divChips','divCustom', state.div);
      syncChipUI('dayChips','dayCustom', state.days);
      syncChipUI('roundChips','roundCustom', state.round);
    } else if(activeRpIndex > idx){
      activeRpIndex -= 1;
    }
    render();
  }

  rpAddBtn.addEventListener('click', ()=>{
    // 今のRpを保存してから、新しい空のRpを追加して切り替え
    rpList[activeRpIndex] = cloneRpState(state);
    const newRp = freshRpState();
    rpList.push(newRp);
    activeRpIndex = rpList.length - 1;

    state.div = newRp.div;
    state.days = newRp.days;
    state.round = newRp.round;
    state.drugs = newRp.drugs;

    syncChipUI('divChips','divCustom', state.div);
    syncChipUI('dayChips','dayCustom', state.days);
    syncChipUI('roundChips','roundCustom', state.round);
    render();

    const firstInput = drugListEl.querySelector('.perday-input');
    if(firstInput) firstInput.focus();
  });

  rpClearBtn.addEventListener('click', ()=>{
    rpList[activeRpIndex] = cloneRpState(state);
    const anyContent = rpList.some(rpHasContent) || rpList.some(r=>r.drugs.some(d=>d.name))
                    || patient.age != null || patient.weight != null || rpList.length > 1;
    const msg = (rpList.length > 1)
      ? `すべてのRp（Rp1〜Rp${rpList.length}）と年齢・体重をクリアしますか？`
      : '入力内容と年齢・体重をクリアしますか？';
    if(anyContent && !confirm(msg)) return;

    const cleared = freshRpState();
    state.div = cleared.div;
    state.days = cleared.days;
    state.round = cleared.round;
    state.drugs = cleared.drugs;
    rpList = [ cloneRpState(state) ];
    activeRpIndex = 0;
    patient.age = null;
    patient.weight = null;
    syncPatientUI();

    syncChipUI('divChips','divCustom', state.div);
    syncChipUI('dayChips','dayCustom', state.days);
    syncChipUI('roundChips','roundCustom', state.round);
    render();

    const firstInput = drugListEl.querySelector('.perday-input');
    if(firstInput) firstInput.focus();
  });

  sessionReady = true;   // ここから保存を有効化（復元済みの内容で初回描画）
  render();

  // 初回ロード時、1つ目の薬剤の1日量入力に自動フォーカス（入力を即座に始められるように）
  const firstInput = drugListEl.querySelector('.perday-input');
  if(firstInput) firstInput.focus();

  /* ---------- 共通薬剤マスタ（読み取り専用ビュー） ---------- */
  const masterToggle = document.getElementById('masterToggle');
  const masterPanel  = document.getElementById('masterPanel');
  const masterInfo   = document.getElementById('masterInfo');
  const masterListEl = document.getElementById('masterList');
  const masterReload = document.getElementById('masterReload');

  function ruleSummary(r){
    if(!r) return '鑑査ルールなし';
    const fa = r.formAge ? `・対象 ${formAgeText(r.formAge)}` : '';
    if(r.type === 'weight'){
      const d = doseRangeOf(r), k = r.unitK || 1, u = r.unit || 'mg';
      return `${doseRangeText(d.min, d.max, k, u)}/kg/日（${doseRangeText(d.min / r.concentration, d.max / r.concentration, 1, '')}ml/kg/日）・範囲外${r.tolPct || TOL_PCT_DEFAULT}%で注意` +
        (r.maxDay > 0 ? `・上限1日${formatNum(r.maxDay * k)}${u}` : '') + fa;
    }
    return `年齢区分 ${r.bands.length}件` + fa;
  }

  function renderMasterView(){
    if(!masterListEl) return;
    if(!sharedMaster){
      masterInfo.textContent = '共通マスタがまだ読み込まれていません。「最新を読み込む」を押すか、剤形変更換算アプリを一度開いてください。';
      masterListEl.innerHTML = '';
      return;
    }
    const n = NAME_SUGGESTIONS.length;
    const withRule = NAME_SUGGESTIONS.filter(x=>drugAuditRules[x]).length;
    masterInfo.textContent =
      `成分 ${sharedMaster.drugs.length}件 ／ 水剤 ${n}製剤（うち鑑査ルールあり ${withRule}製剤）` +
      (sharedMaster.updatedAt ? `　最終更新 ${String(sharedMaster.updatedAt).slice(0,10)}` : '');
    masterListEl.innerHTML = NAME_SUGGESTIONS.map(name=>{
      const r = drugAuditRules[name];
      return `<div class="master-row">
        <div class="mn">${escapeHtml(name)}<span>${escapeHtml(r ? r.genericName : '')}</span></div>
        <div class="mv">${escapeHtml(ruleSummary(r))}</div>
      </div>`;
    }).join('');
  }

  function reloadSharedMaster(showToast){
    const m = loadSharedMaster();
    if(m){
      applySharedMaster(m);
      renderMasterView();
      render();
      if(showToast) alert('共通マスタを読み込みました。');
      return true;
    }
    return false;
  }

  if(masterToggle){
    masterToggle.addEventListener('click', ()=>{
      const willOpen = !masterPanel.classList.contains('open');
      masterPanel.classList.toggle('open', willOpen);
      masterToggle.textContent = willOpen ? '閉じる' : '内容を見る';
      if(willOpen) renderMasterView();
    });
  }
  if(masterReload){
    masterReload.addEventListener('click', ()=>{
      // 端末のマスタを読み直し、配布マスタに新しい版があれば取り込む
      reloadSharedMaster(false);
      fetchSharedMasterFile(true);
    });
  }

  // 入口ページと同じ場所に置いた drug-master.json を取り込む。
  // 端末にマスタが無ければそのまま、あれば rev が新しいときだけ、端末の編集を残して取り込む
  /* 配布マスタ（../drug-master.json）の自動更新 ― 剤形変更換算・水剤MIX・処方監査ドリル共通
     ファイルの rev が端末のマスタ（baseRev）より新しければ取り込む。
     ・端末で編集した成分（editedIds）と削除した成分（deletedIds）は端末の内容を残す
     ・端末で追加した成分（ファイルにない id）も残す
     ・採用品は端末の設定を優先。薬効グループは端末で編集していなければファイルに合わせる */
  // マスタの項目の版。古い版のアプリが新しい項目（上限・対象年齢など）を落として取り込んだ端末でも、同じ rev のまま取り込み直せるようにする
  var MASTER_SCHEMA = 3;
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
  function fetchSharedMasterFile(manual){
    if(typeof fetch !== 'function') return;
    fetch('../drug-master.json?t=' + Date.now(), {cache:'no-store'})
      .then(r=>{ if(!r.ok) throw new Error('no file'); return r.json(); })
      .then(j=>{
        if(!j || !Array.isArray(j.drugs) || !j.drugs.length) throw new Error('bad');
        const local = loadSharedMaster();
        const rev = Number(j.rev) || 0;
        const base = local ? (Number(local.baseRev) || 0) : 0;
        const stale = rev > base || (rev > 0 && rev === base && (Number(local && local.schema) || 0) < MASTER_SCHEMA);
        if(local && !stale){
          if(manual) alert('共通マスタは最新です。');
          return;
        }
        const obj = mergeDistributedMaster(local, j);
        try{ localStorage.setItem(SHARED_MASTER_KEY, JSON.stringify(obj)); }catch(e){}
        applySharedMaster(obj);
        renderMasterView();
        render();
        if(manual) alert('共通マスタを最新版に更新しました。');
      })
      .catch(()=>{ if(manual) alert('drug-master.json が見つかりませんでした。'); });
  }

  // 起動時：配布マスタを確認（初回は取り込み、以後は新しい版があれば更新）
  if(location.protocol.indexOf('http') === 0){
    fetchSharedMasterFile(false);
  }
  renderMasterView();

  // ---------- 設定のバックアップ・復元 ----------
  const BACKUP_FORMAT = 'mixCalcBackup';
  const BACKUP_VERSION = 1;

  const backupToggle = document.getElementById('backupToggle');
  const backupPanel = document.getElementById('backupPanel');
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const importFileInput = document.getElementById('importFileInput');
  const backupToast = document.getElementById('backupToast');
  const defaultsRow = document.getElementById('defaultsRow');

  backupToggle.addEventListener('click', ()=>{
    const willOpen = !backupPanel.classList.contains('open');
    backupPanel.classList.toggle('open', willOpen);
    backupToggle.textContent = willOpen ? '閉じる' : '開く';
  });

  function showBackupToast(msg, isError){
    backupToast.textContent = msg;
    backupToast.classList.toggle('error', !!isError);
    backupToast.classList.add('show');
    setTimeout(()=>backupToast.classList.remove('show'), 3000);
  }

  // 現在の全設定を1つのオブジェクトにまとめる
  function collectSettings(){
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      round: state.round,
      suggestions: NAME_SUGGESTIONS,
      drugAuditRules: drugAuditRules,
      presets: presets
    };
  }

  // 設定オブジェクトをアプリに反映する。
  // mode: 'replace'（全置き換え） | 'merge'（既存を残しつつ追加）
  function applySettings(data, mode){
    if(!data || typeof data !== 'object') return false;

    if(mode === 'replace'){
      if(typeof data.round === 'number' && data.round > 0){
        state.round = data.round;
      }
      if(Array.isArray(data.suggestions)){
        NAME_SUGGESTIONS = data.suggestions.slice();
      }
      if(data.drugAuditRules && typeof data.drugAuditRules === 'object'){
        drugAuditRules = JSON.parse(JSON.stringify(data.drugAuditRules));
      }
      if(Array.isArray(data.presets)){
        presets = JSON.parse(JSON.stringify(data.presets));
      }
    } else {
      // マージ：既存にないものだけ追加する（今使っている設定を壊さない）
      if(Array.isArray(data.suggestions)){
        data.suggestions.forEach(n=>{
          if(!NAME_SUGGESTIONS.includes(n)) NAME_SUGGESTIONS.push(n);
        });
      }
      if(data.drugAuditRules && typeof data.drugAuditRules === 'object'){
        Object.keys(data.drugAuditRules).forEach(name=>{
          if(!drugAuditRules[name]){
            drugAuditRules[name] = JSON.parse(JSON.stringify(data.drugAuditRules[name]));
          }
        });
      }
      if(Array.isArray(data.presets)){
        data.presets.forEach(p=>{
          if(!presets.some(existing => existing.name === p.name)){
            presets.push(JSON.parse(JSON.stringify(p)));
          }
        });
      }
    }

    // 保存して画面に反映
    persist();
    persistRules();
    savePresets(presets);
    syncChipUI('roundChips','roundCustom', state.round);
    renderManageList();
    renderRuleList();
    renderPresetChips();
    render();
    return true;
  }

  // 書き出し
  exportBtn.addEventListener('click', ()=>{
    try{
      const data = collectSettings();
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0,10).replace(/-/g,'');
      a.href = url;
      a.download = `水剤MIX調製計算_設定_${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(()=>URL.revokeObjectURL(url), 1000);
      showBackupToast('設定を書き出しました。');
    }catch(e){
      showBackupToast('書き出しに失敗しました。', true);
    }
  });

  // 復元
  importBtn.addEventListener('click', ()=>{
    importFileInput.click();
  });

  importFileInput.addEventListener('change', (e)=>{
    const file = e.target.files && e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = ()=>{
      let data = null;
      try{
        data = JSON.parse(reader.result);
      }catch(err){
        showBackupToast('ファイルを読み込めませんでした（JSON形式ではありません）。', true);
        importFileInput.value = '';
        return;
      }
      if(!data || data.format !== BACKUP_FORMAT){
        showBackupToast('このアプリのバックアップファイルではないようです。', true);
        importFileInput.value = '';
        return;
      }
      const replace = confirm(
        '復元方法を選んでください。\n\n' +
        '「OK」＝すべて置き換える（今の設定は破棄されます）\n' +
        '「キャンセル」＝追加のみ（今の設定は残し、ファイル側にしかないものを足します）'
      );
      applySettings(data, replace ? 'replace' : 'merge');
      showBackupToast(replace ? '設定を復元しました（置き換え）。' : '設定を追加しました（マージ）。');
      importFileInput.value = '';
    };
    reader.readAsText(file);
  });

  // ---------- リポジトリ同梱の初期設定（defaults.json）----------
  // アプリと同じ場所に defaults.json があれば読み込む。
  // ・localStorageが空（初回利用）の場合のみ自動で初期値として採用する
  // ・既に使い込んでいる端末の設定は勝手に上書きしない
  // ・ファイルが無い場合は何もしない（ローカルファイル単体での利用でも壊れない）
  let fetchedDefaults = null;

  function isFirstRun(){
    return !localStorage.getItem(STORAGE_KEY)
        && !localStorage.getItem(RULES_STORAGE_KEY)
        && !localStorage.getItem(PRESET_KEY);
  }

  function renderDefaultsRow(){
    if(!fetchedDefaults){
      defaultsRow.innerHTML = '';
      return;
    }
    const count = {
      presets: Array.isArray(fetchedDefaults.presets) ? fetchedDefaults.presets.length : 0,
      rules: fetchedDefaults.drugAuditRules ? Object.keys(fetchedDefaults.drugAuditRules).length : 0,
      names: Array.isArray(fetchedDefaults.suggestions) ? fetchedDefaults.suggestions.length : 0
    };
    defaultsRow.innerHTML = `
      <div class="defaults-info">
        共有の初期設定（defaults.json）が見つかりました。<br>
        定型処方${count.presets}件／鑑査ルール${count.rules}件／候補薬剤${count.names}件
      </div>
      <button class="backup-btn" id="applyDefaultsBtn" type="button" style="margin-top:8px;">共有の初期設定を取り込む</button>
    `;
    const btn = document.getElementById('applyDefaultsBtn');
    if(btn){
      btn.addEventListener('click', ()=>{
        const replace = confirm(
          '共有の初期設定を取り込みます。\n\n' +
          '「OK」＝すべて置き換える（この端末の設定は破棄されます）\n' +
          '「キャンセル」＝追加のみ（この端末の設定は残します）'
        );
        applySettings(fetchedDefaults, replace ? 'replace' : 'merge');
        showBackupToast(replace ? '共有の初期設定を取り込みました（置き換え）。' : '共有の初期設定を追加しました（マージ）。');
      });
    }
  }

  (function loadDefaultsJson(){
    // file:// で開いた場合はfetchが失敗することがあるが、その場合は静かに無視する
    fetch('defaults.json', {cache:'no-store'})
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if(!data || data.format !== BACKUP_FORMAT) return;
        fetchedDefaults = data;
        if(isFirstRun()){
          // 初回利用時のみ自動適用（既存設定がある端末では何もしない）
          applySettings(data, 'replace');
        }
        renderDefaultsRow();
      })
      .catch(()=>{ /* defaults.jsonが無い運用でも正常動作させる */ });
  })();
})();
