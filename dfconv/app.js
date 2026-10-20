/* 剤形変更 換算  app.js（index.html から分離。Content-Security-Policy で外部・インラインのスクリプトを禁止するため） */
'use strict';

/* ========================================================================
   薬剤マスタ
   t : powder(散剤・細粒・DS) / liquid(水剤) / tablet(錠) / chew(チュアブル)
       cap(カプセル) / sachet(分包品) / supp(坐剤)
   s : 1単位あたりの成分量(mg)  powder=1g中 / liquid=1mL中 / 他=1個中
   ======================================================================== */
const DEFAULT_DRUGS = [
 {"id":"carbo","name":"カルボシステイン","brand":"ムコダイン","k":"かるぼしすていん むこだいん","r":"carbocisteine mucodyne","dmin":30,"dmax":30,"dbasis":"day","maxDay":1500,"maxNote":"成人1回500mg 1日3回（1日1500mg）","dnote":"小児 1回10mg/kg 1日3回（成人1500mg/日 分3）","forms":[{"n":"ムコダインDS50%","t":"powder","s":500},{"n":"ムコダインシロップ5%","t":"liquid","s":50},{"n":"ムコダイン錠250mg","t":"tablet","s":250},{"n":"ムコダイン錠500mg","t":"tablet","s":500}]},
 {"id":"ambroxol","name":"アンブロキソール","brand":"ムコソルバン","k":"あんぶろきそーる むこそるばん","r":"ambroxol mucosolvan","dmin":0.9,"dmax":0.9,"dbasis":"day","maxDay":45,"maxNote":"成人1回15mg 1日3回（1日45mg）","dnote":"小児 0.9mg/kg/日 分3（成人45mg/日 分3）","forms":[{"n":"小児用ムコソルバンDS1.5%","t":"powder","s":15},{"n":"小児用ムコソルバンシロップ0.3%","t":"liquid","s":3},{"n":"ムコソルバン内用液0.75%","t":"liquid","s":7.5,"note":"成人用の規格","ageMin":15},{"n":"ムコソルバン錠15mg","t":"tablet","s":15,"ageMin":15},{"n":"ムコソルバンL錠45mg","t":"tablet","s":45,"sr":true,"ageMin":15}]},
 {"id":"tipepidine","name":"チペピジン","brand":"アスベリン","k":"ちぺぴじん あすべりん","r":"tipepidine asverin","dbasis":"day","dnote":"1歳未満5〜20mg/日、1〜3歳10〜25mg/日、3〜6歳15〜40mg/日 分3","ageBands":[{"a0":0,"a1":1,"label":"1歳未満","dayMin":5,"dayMax":20,"times":3},{"a0":1,"a1":3,"label":"1歳以上3歳未満","dayMin":10,"dayMax":25,"times":3},{"a0":3,"a1":6,"label":"3歳以上6歳未満","dayMin":15,"dayMax":40,"times":3}],"forms":[{"n":"アスベリン散10%","t":"powder","s":100},{"n":"アスベリンDS2%","t":"powder","s":20},{"n":"アスベリンシロップ0.5%","t":"liquid","s":5},{"n":"アスベリン錠10mg","t":"tablet","s":10},{"n":"アスベリン錠20mg","t":"tablet","s":20}]},
 {"id":"acetaminophen","name":"アセトアミノフェン","brand":"カロナール","k":"あせとあみのふぇん かろなーる あんひば","r":"acetaminophen calonal anhiba","dmin":10,"dmax":15,"dbasis":"dose","maxDay":1500,"maxNote":"小児は成人の用量を超えない（急性上気道炎の成人は1日最大1500mg）","dnote":"小児 1回10〜15mg/kg、4〜6時間以上あける。1日60mg/kg以内かつ1500mg以内","forms":[{"n":"カロナール細粒20%","t":"powder","s":200},{"n":"カロナール細粒50%","t":"powder","s":500},{"n":"カロナールシロップ2%","t":"liquid","s":20},{"n":"カロナール錠200mg","t":"tablet","s":200},{"n":"カロナール錠300mg","t":"tablet","s":300},{"n":"カロナール錠500mg","t":"tablet","s":500},{"n":"アンヒバ坐剤小児用50mg","t":"supp","s":50},{"n":"アンヒバ坐剤小児用100mg","t":"supp","s":100},{"n":"アンヒバ坐剤小児用200mg","t":"supp","s":200}]},
 {"id":"clarithromycin","name":"クラリスロマイシン","brand":"クラリス","k":"くらりすろまいしん くらりす","r":"clarithromycin clarith","potency":true,"dmin":10,"dmax":15,"dbasis":"day","maxDay":400,"maxNote":"成人1回200mg 1日2回（1日400mg）","dnote":"小児 10〜15mg(力価)/kg/日 分2〜3（成人400mg/日 分2）","forms":[{"n":"クラリスドライシロップ10%小児用","t":"powder","s":100},{"n":"クラリス錠50mg小児用","t":"tablet","s":50},{"n":"クラリス錠200","t":"tablet","s":200,"ageMin":15}]},
 {"id":"amoxicillin","name":"アモキシシリン","brand":"サワシリン／ワイドシリン","k":"あもきししりん さわしりん わいどしりん","r":"amoxicillin sawacillin widecillin","potency":true,"dmin":20,"dmax":40,"dbasis":"day","maxDay":1000,"maxNote":"成人1回250mg 1日3〜4回（1日750〜1000mg）","dnote":"小児 20〜40mg(力価)/kg/日 分3〜4（中耳炎等では高用量を用いることがある）","forms":[{"n":"ワイドシリン細粒20%","t":"powder","s":200},{"n":"ワイドシリン細粒10%","t":"powder","s":100},{"n":"サワシリン細粒10%","t":"powder","s":100},{"n":"サワシリン錠250","t":"tablet","s":250},{"n":"サワシリンカプセル125","t":"cap","s":125},{"n":"サワシリンカプセル250","t":"cap","s":250}]},
 {"id":"cefditoren","name":"セフジトレンピボキシル","brand":"メイアクトMS","k":"せふじとれんぴぼきしる めいあくと","r":"cefditoren meiact","potency":true,"dmin":9,"dmax":9,"dlimit":18,"dbasis":"day","maxDay":300,"maxNote":"成人1回100mg 1日3回（重症は1回200mg）","dnote":"小児 9mg(力価)/kg/日 分3（重症時18mg/kg/日まで）","forms":[{"n":"メイアクトMS小児用細粒10%","t":"powder","s":100},{"n":"メイアクトMS錠100mg","t":"tablet","s":100,"ageMin":15}]},
 {"id":"cefcapene","name":"セフカペンピボキシル","brand":"フロモックス","k":"せふかぺんぴぼきしる ふろもっくす","r":"cefcapene flomox","potency":true,"dmin":9,"dmax":9,"dbasis":"day","maxDay":300,"maxNote":"成人1回100mg 1日3回（重症は1回150mg）","dnote":"小児 9mg(力価)/kg/日 分3（成人300mg/日 分3）","forms":[{"n":"フロモックス小児用細粒100mg","t":"powder","s":100},{"n":"フロモックス錠75mg","t":"tablet","s":75,"ageMin":15},{"n":"フロモックス錠100mg","t":"tablet","s":100,"ageMin":15}]},
 {"id":"fexofenadine","name":"フェキソフェナジン","brand":"アレグラ","k":"ふぇきそふぇなじん あれぐら","r":"fexofenadine allegra","dbasis":"day","dnote":"6ヵ月以上2歳未満1回15mg、2歳以上12歳未満1回30mg、12歳以上1回60mg（いずれも1日2回）","ageBands":[{"a0":0.5,"a1":2,"label":"6ヵ月以上2歳未満","mg":15,"times":2},{"a0":2,"a1":7,"label":"2歳以上7歳未満","mg":30,"times":2},{"a0":7,"a1":12,"label":"7歳以上12歳未満","mg":30,"times":2},{"a0":12,"a1":null,"label":"12歳以上","mg":60,"times":2}],"forms":[{"n":"アレグラドライシロップ5%","t":"powder","s":50,"ageMin":0.5},{"n":"アレグラ錠30mg","t":"tablet","s":30,"ageMin":7},{"n":"アレグラ錠60mg","t":"tablet","s":60,"ageMin":12}]},
 {"id":"levocetirizine","name":"レボセチリジン","brand":"ザイザル","k":"れぼせちりじん ざいざる","r":"levocetirizine xyzal","dbasis":"day","dnote":"6か月〜1歳未満1.25mg 分1、1〜7歳未満2.5mg 分2、7〜15歳未満5mg 分2","ageBands":[{"a0":0.5,"a1":1,"label":"6ヵ月以上1歳未満","mg":1.25,"times":1},{"a0":1,"a1":7,"label":"1歳以上7歳未満","mg":1.25,"times":2},{"a0":7,"a1":15,"label":"7歳以上15歳未満","mg":2.5,"times":2},{"a0":15,"a1":null,"label":"15歳以上","mg":5,"times":1}],"forms":[{"n":"ザイザルシロップ0.05%","t":"liquid","s":0.5,"ageMin":0.5},{"n":"ザイザル錠5mg","t":"tablet","s":5,"ageMin":7}]},
 {"id":"montelukast","name":"モンテルカスト","brand":"キプレス／シングレア","k":"もんてるかすと きぷれす しんぐれあ","r":"montelukast kipres singulair","dbasis":"day","dnote":"1〜6歳未満4mg 分1、6〜15歳未満5mg 分1、15歳以上10mg 分1（就寝前）","ageBands":[{"a0":1,"a1":6,"label":"1歳以上6歳未満","mg":4,"times":1},{"a0":6,"a1":15,"label":"6歳以上15歳未満","mg":5,"times":1},{"a0":15,"a1":null,"label":"15歳以上","mg":10,"times":1}],"forms":[{"n":"キプレス細粒4mg","t":"sachet","s":4,"ageMin":1,"ageMax":6},{"n":"キプレスチュアブル錠5mg","t":"chew","s":5,"ageMin":6,"ageMax":15},{"n":"キプレス錠5mg","t":"tablet","s":5,"ageMin":15},{"n":"キプレス錠10mg","t":"tablet","s":10,"ageMin":15}]},
 {"id":"pranlukast","name":"プランルカスト","brand":"オノン","k":"ぷらんるかすと おのん","r":"pranlukast onon","dmin":7,"dmax":10,"dbasis":"day","maxDay":450,"maxNote":"成人1日450mg 分2","dnote":"小児 7mg/kg/日 分2（最大10mg/kg/日、450mg/日まで）","forms":[{"n":"オノンドライシロップ10%","t":"powder","s":100},{"n":"オノンカプセル112.5mg","t":"cap","s":112.5,"ageMin":15}]},
 {"id":"epinastine","name":"エピナスチン","brand":"アレジオン","k":"えぴなすちん あれじおん","r":"epinastine alesion","dmin":0.25,"dmax":0.5,"dbasis":"day","maxDay":20,"maxNote":"成人1回10〜20mg 1日1回","dnote":"小児（DS）：アレルギー性鼻炎 1日1回0.25〜0.5mg/kg、蕁麻疹等 1日1回0.5mg/kg。1日20mgを超えない。標準量 3歳以上7歳未満 5〜10mg/日、7歳以上 10〜20mg/日","ageBands":[{"a0":3,"a1":7,"label":"3歳以上7歳未満","dayMin":5,"dayMax":10,"times":1},{"a0":7,"a1":null,"label":"7歳以上","dayMin":10,"dayMax":20,"times":1}],"ageNotFor":["アレジオン錠10mg","アレジオン錠20mg"],"forms":[{"n":"アレジオンドライシロップ1%","t":"powder","s":10},{"n":"アレジオン錠10mg","t":"tablet","s":10,"ageMin":15},{"n":"アレジオン錠20mg","t":"tablet","s":20,"ageMin":15}]},
 {"id":"oseltamivir","name":"オセルタミビル","brand":"タミフル","k":"おせるたみびる たみふる","r":"oseltamivir tamiflu","dmin":2,"dmax":2,"dbasis":"dose","maxDay":150,"maxDose":75,"maxNote":"成人及び体重37.5kg以上の小児 1回75mg 1日2回","dnote":"小児 1回2mg/kg 1日2回 5日間（1回75mgを超えない）","forms":[{"n":"タミフルドライシロップ3%","t":"powder","s":30},{"n":"タミフルカプセル75","t":"cap","s":75}]},
 {"id":"tulobuterol","name":"ツロブテロール","brand":"ホクナリン","k":"つろぶてろーる ほくなりん","r":"tulobuterol hokunalin","dbasis":"day","dnote":"内服 小児 0.04mg/kg/日 分2〜3程度。貼付剤とは用法が異なる","forms":[{"n":"ホクナリンドライシロップ0.1%小児用","t":"powder","s":1},{"n":"ホクナリン錠1mg","t":"tablet","s":1},{"n":"ホクナリン錠2mg","t":"tablet","s":2}]},
 {"id":"valproate","name":"バルプロ酸ナトリウム","brand":"デパケン","k":"ばるぷろさん でぱけん せれにか","r":"valproate depakene selenica","dmin":15,"dmax":30,"dbasis":"day","maxDay":1200,"maxNote":"成人1日400〜1200mg（デパケン）","dnote":"15〜30mg/kg/日 分2〜3（徐放製剤は分1〜2）。※デパケンの添付文書に小児の体重あたり量の記載はない（成書の一般的な量）。成人1日400〜1200mg","forms":[{"n":"デパケン細粒20%","t":"powder","s":200},{"n":"デパケン細粒40%","t":"powder","s":400},{"n":"デパケンシロップ5%","t":"liquid","s":50},{"n":"デパケン錠100mg","t":"tablet","s":100},{"n":"デパケン錠200mg","t":"tablet","s":200},{"n":"デパケンR錠100mg","t":"tablet","s":100,"sr":true},{"n":"デパケンR錠200mg","t":"tablet","s":200,"sr":true},{"n":"セレニカR顆粒40%","t":"powder","s":400,"sr":true}]},
 {"id":"prednisolone","name":"プレドニゾロン","brand":"プレドニン","k":"ぷれどにぞろん ぷれどにん","r":"prednisolone predonine","dmin":0.5,"dmax":2,"dbasis":"day","maxDay":60,"maxNote":"成人1日5〜60mg","dnote":"小児 0.5〜2mg/kg/日 分1〜4（疾患により異なる）。※添付文書に小児の体重あたり量の記載はない。成人1日5〜60mg","forms":[{"n":"プレドニゾロン散1%","t":"powder","s":10},{"n":"プレドニゾロン錠5mg","t":"tablet","s":5},{"n":"プレドニン錠5mg","t":"tablet","s":5}]},
 {"id":"magnesium","name":"酸化マグネシウム","brand":"マグミット","k":"さんかまぐねしうむ まぐみっと かま","r":"magnesium oxide magmitt","un":"g","uf":1000,"dmin":20,"dmax":80,"dbasis":"day","maxDay":2000,"maxNote":"成人1日2g","dnote":"緩下剤：1歳以上の小児 1日20〜80mg/kg 食後2回に分割（成人 1日2g）","forms":[{"n":"酸化マグネシウム原末","t":"powder","s":1000},{"n":"マグミット錠200mg","t":"tablet","s":200},{"n":"マグミット錠250mg","t":"tablet","s":250},{"n":"マグミット錠330mg","t":"tablet","s":330},{"n":"マグミット錠500mg","t":"tablet","s":500}]}
];

const TYPE_INFO = {
  powder:{unit:'g',   label:'散剤・細粒・DS', cont:true},
  liquid:{unit:'mL',  label:'水剤',           cont:true},
  tablet:{unit:'錠',  label:'錠剤',           cont:false},
  chew:  {unit:'錠',  label:'チュアブル錠',   cont:false},
  cap:   {unit:'Cap', label:'カプセル',       cont:false},
  sachet:{unit:'包',  label:'分包品',         cont:false},
  supp:  {unit:'個',  label:'坐剤',           cont:false}
};

const DEFAULT_GROUPS = [
  {id:'g_abx',   name:'抗菌薬',       ids:['clarithromycin','amoxicillin','cefditoren','cefcapene']},
  {id:'g_resp',  name:'去痰・鎮咳',   ids:['carbo','ambroxol','tipepidine']},
  {id:'g_aller', name:'抗アレルギー', ids:['fexofenadine','levocetirizine','epinastine','montelukast','pranlukast']},
  {id:'g_anti',  name:'解熱鎮痛',     ids:['acetaminophen']}
];

/* ================= 保存 =================
   薬剤マスタと薬効グループは、同じドメインの他ツール（水剤MIX調製計算など）と
   共通のキー calcTool.drugMaster.v1 に保存する。localStorage はオリジン単位で
   共有されるため、/mix/ と /dfconv/ は同じデータを参照できる。 */
const LS_SHARED='calcTool.drugMaster.v1';
const LS_S='dfconv.state.v4';
const LS_M_OLD='dfconv.master.v3', LS_G_OLD='dfconv.groups.v1';
function lsGet(k){ try{return window.localStorage.getItem(k);}catch(e){return null;} }
function lsSet(k,v){ try{window.localStorage.setItem(k,v);}catch(e){} }

function loadShared(){
  const raw=lsGet(LS_SHARED);
  if(raw){
    try{ const o=JSON.parse(raw);
      if(o&&Array.isArray(o.drugs)&&o.drugs.length) return o;
    }catch(e){}
  }
  // 旧キーからの移行
  const om=lsGet(LS_M_OLD);
  if(om){
    try{ const d=JSON.parse(om);
      if(Array.isArray(d)&&d.length){
        let g=null;
        try{ g=JSON.parse(lsGet(LS_G_OLD)); }catch(e){}
        return {drugs:d, groups:Array.isArray(g)?g:null, migrated:true};
      }
    }catch(e){}
  }
  return null;
}

let MASTER_IS_BUILTIN=false;
const _shared=loadShared();
let DRUGS=(function(){
  if(_shared) return _shared.drugs;
  MASTER_IS_BUILTIN=true;
  return JSON.parse(JSON.stringify(DEFAULT_DRUGS));
})();

let ADOPTED=(function(){
  if(_shared&&Array.isArray(_shared.adopted)) return _shared.adopted.slice();
  return [];
})();
let GROUPS=(function(){
  if(_shared&&Array.isArray(_shared.groups)&&_shared.groups.length) return _shared.groups;
  return JSON.parse(JSON.stringify(DEFAULT_GROUPS));
})();
// 配布マスタの自動更新で端末の編集を上書きしないための記録
const META={
  baseRev: (_shared&&Number(_shared.baseRev))||0,
  editedIds: (_shared&&Array.isArray(_shared.editedIds))?_shared.editedIds.map(String):[],
  deletedIds: (_shared&&Array.isArray(_shared.deletedIds))?_shared.deletedIds.map(String):[],
  groupsEdited: !!(_shared&&_shared.groupsEdited),
  schema: (_shared&&Number(_shared.schema))||0,
  aliases: (_shared&&_shared.aliases&&typeof _shared.aliases==='object')?_shared.aliases:{}
};
function markEdited(id){ id=String(id); if(META.editedIds.indexOf(id)<0) META.editedIds.push(id);
  META.deletedIds=META.deletedIds.filter(function(x){return x!==id;}); }
function markDeleted(id){ id=String(id); if(META.deletedIds.indexOf(id)<0) META.deletedIds.push(id);
  META.editedIds=META.editedIds.filter(function(x){return x!==id;}); }
function saveGroups(){ META.groupsEdited=true; saveShared(); }
if(_shared&&_shared.migrated) saveShared();
function groupOf(drugId){
  return GROUPS.find(function(g){ return (g.ids||[]).indexOf(drugId)>=0; })||null;
}

function newRp(){ return {mode:'reg', times:3, items:[]}; }
let st={ weight:'', stepTab:0.5, recent:[], rps:[newRp()] };
(function(){
  const raw=lsGet(LS_S); if(!raw) return;
  try{ const s=JSON.parse(raw);
    ['weight','stepTab','recent','rps'].forEach(function(k){ if(s[k]!==undefined) st[k]=s[k]; });
    if(!Array.isArray(st.rps)||!st.rps.length) st.rps=[newRp()];
  }catch(e){}
})();
function saveState(){ lsSet(LS_S, JSON.stringify(st)); }
function saveShared(){
  lsSet(LS_SHARED, JSON.stringify({
    version:1, updatedAt:new Date().toISOString(),
    drugs:DRUGS, groups:GROUPS, adopted:ADOPTED,
    baseRev:META.baseRev, editedIds:META.editedIds, deletedIds:META.deletedIds, groupsEdited:META.groupsEdited,
    schema:META.schema, aliases:META.aliases
  }));
}
function saveMaster(){ saveShared(); }

/* ================= 小物 ================= */
const $=function(id){return document.getElementById(id);};
function fmt(n,dec){
  if(n===null||n===undefined||!isFinite(n)) return '—';
  if(dec===undefined) dec=2;
  let s=Number(n).toFixed(dec);
  if(s.indexOf('.')>=0) s=s.replace(/0+$/,'').replace(/\.$/,'');
  return s;
}
function num(v){ const n=parseFloat(v); return isFinite(n)?n:null; }
function getDrug(id){ return DRUGS.find(function(d){return d.id===id;})||null; }
function uName(d){ return d.un||(d.potency?'mg(力価)':'mg'); }
function uFactor(d){ return d.uf||1; }
function dFactor(d){ return (d.uf&&d.uf<1)?d.uf:1; }          // 用量の表示倍率（μg の薬だけ）
function dUnit(d){ return dFactor(d)<1?'μg':'mg'; }
function doseRange(d){
  const f=dFactor(d), a=d.dmin/f, b=((d.dmax!==undefined)?d.dmax:d.dmin)/f;
  return (a===b?fmt(a,3):fmt(a,3)+'〜'+fmt(b,3))+dUnit(d)+(d.dbasis==='dose'?'/kg/回':'/kg/日');
}
function weightAgeNote(d){ return d.weightAgeMax?('・'+fmt(d.weightAgeMax,1)+'歳未満の基準'):''; }
function unitOf(f){ return (TYPE_INFO[f.t]||TYPE_INFO.tablet).unit; }
function isCont(f){ return !!(TYPE_INFO[f.t]||{}).cont; }
function stepOf(f){ return (f.t==='tablet'||f.t==='chew')?st.stepTab:1; }
function toast(m){
  const t=$('toast'); t.textContent=m; t.classList.add('show');
  clearTimeout(toast._t); toast._t=setTimeout(function(){t.classList.remove('show');},1600);
}
function norm(s){
  return (s||'').toLowerCase()
    .replace(/[\u30a1-\u30f6]/g,function(c){return String.fromCharCode(c.charCodeAt(0)-0x60);})
    .replace(/[\s・ー－―‐]/g,'');
}

/* ================= 換算ロジック ================= */
// mgBase … 定期=1日の成分量(mg) / 頓用=1回の成分量(mg)
function planFor(f, mgBase, mode, times){
  const unit=unitOf(f);
  if(isCont(f)){
    const v=mgBase/f.s;
    return {f:f, unit:unit, val:v, perDose:(mode==='reg'?v/times:v), mg:mgBase, err:0, exact:true};
  }
  const step=stepOf(f);
  let perDose, val;
  if(mode==='reg'){
    perDose=Math.round((mgBase/times/f.s)/step)*step;
    val=perDose*times;
  }else{
    perDose=Math.round((mgBase/f.s)/step)*step;
    val=perDose;
  }
  if(perDose<0) perDose=0;
  const mg=val*f.s;
  const err=mgBase>0?(mg-mgBase)/mgBase*100:0;
  return {f:f, unit:unit, val:val, perDose:perDose, mg:mg,
          err:err, exact:Math.abs(err)<0.05, step:step};
}
function bestTimes(f, mgPerDay, times){
  const step=stepOf(f), out=[];
  [1,2,3,4].forEach(function(t){
    if(t===times) return;
    const r=Math.round((mgPerDay/t/f.s)/step)*step;
    if(r<=0) return;
    out.push({t:t, perDose:r, err:Math.abs((r*t*f.s-mgPerDay)/mgPerDay*100), near:Math.abs(t-times)});
  });
  out.sort(function(a,b){ return Math.abs(a.err-b.err)>0.3?a.err-b.err:a.near-b.near; });
  return out[0];
}
function formAgeNote(f){
  const a0=(typeof f.ageMin==='number')?f.ageMin:null, a1=(typeof f.ageMax==='number')?f.ageMax:null;
  if(a0===null&&a1===null) return '';
  if(a0!==null&&a0>=15) return '成人用（小児の用法なし）';
  return '対象 '+(a0!==null?ageStr(a0)+'以上':'')+(a1!==null?ageStr(a1)+'未満':'');
}
function notesFor(p){
  const f=p.f, a=[];
  const fa=formAgeNote(f); if(fa) a.push(fa);
  if(f.sr) a.push('徐放性製剤。単純換算は不可');
  if(f.note) a.push(f.note);
  if((f.t==='tablet'||f.t==='chew')&&Math.abs(p.perDose%1)>1e-9) a.push('割線の有無と分割の可否を確認');
  if(f.t==='cap') a.push('脱カプセルの可否を確認');
  if(f.t==='chew') a.push('噛み砕いて服用');
  if(f.t==='sachet') a.push('1包単位でのみ調節可');
  if(f.t==='supp'){ a.push('内服と吸収・用法が異なる');
    if(p.perDose>=2) a.push('1回'+fmt(p.perDose,0)+'個になります'); }
  if(p.perDose<=0) a.push('1回量が最小単位に届きません');
  return a;
}
function weightNotForm(d, f){ return !!f&&Array.isArray(d.weightNotFor)&&d.weightNotFor.indexOf(f.n)>=0; }
// 上限（成人量など）：maxDay＝1日量、maxDose＝1回量。成人の処方では別の用法（例：ピロリ除菌）もあるため、体重を入れたときだけ判定
function doseCheck(d, mgDay, mgDose, w, f){
  if(!w||w<=0) return null;
  if(d.maxDay&&mgDay!==null&&mgDay>d.maxDay*(1+1e-9))
    return {cls:'ng', text:'上限 1日'+fmt(d.maxDay/uFactor(d),3)+uName(d)+'超'};
  if(d.maxDose&&mgDose!==null&&mgDose>d.maxDose*(1+1e-9))
    return {cls:'ng', text:'上限 1回'+fmt(d.maxDose/uFactor(d),3)+uName(d)+'超'};
  if(d.dmin===undefined||weightNotForm(d,f)) return null;
  let val, amt;
  if(d.dbasis==='dose'){ amt=mgDose; }
  else{ if(mgDay===null) return null; amt=mgDay; }
  val=amt/w;
  const range=doseRange(d)+weightAgeNote(d);
  const cap=(d.dbasis==='dose')?d.maxDose:d.maxDay;
  if(val<d.dmin*0.9){
    // 体重あたりで計算すると上限を超える大きい子：上限どおりなら適正
    if(cap&&w*d.dmin>cap&&amt>=cap*0.9) return {cls:'ok', text:'上限どおり（体重あたりでは上限を超える体重）'};
    return {cls:'ng', text:'参考用量（'+range+'）未満'};
  }
  const top=(d.dlimit>d.dmax)?d.dlimit:d.dmax;
  if(val>top*1.1) return {cls:'ng', text:'参考用量（'+range+'）超過'};
  if(val>d.dmax*1.1) return {cls:'ok', text:'参考用量超・最高量（'+fmt(d.dlimit/dFactor(d),3)+dUnit(d)+'/kg）以内'};
  return {cls:'ok', text:'参考用量（'+range+'）内'};
}

/* ================= 予測体重 ================= */
function doseMid(d){ return (d.dmin+((d.dmax!==undefined)?d.dmax:d.dmin))/2; }

function weightEstimates(){
  const out=[];
  st.rps.forEach(function(rp){
    rp.items.forEach(function(it){
      const d=getDrug(it.drugId);
      if(!d||!it.mg||it.mg<=0||d.dmin===undefined) return;
      if(weightNotForm(d,d.forms[it.formIdx])) return;
      const times=rp.mode==='reg'?rp.times:1;
      let base, unit;
      if(d.dbasis==='dose'){ base=(rp.mode==='reg')?it.mg/times:it.mg; unit='mg/kg/回'; }
      else{
        if(rp.mode!=='reg') return;   // 頓用で1日量基準の用量は推定できない
        base=it.mg; unit='mg/kg/日';
      }
      const a=base/d.dmin, b=base/((d.dmax!==undefined)?d.dmax:d.dmin);
      out.push({name:d.name, lo:Math.min(a,b), hi:Math.max(a,b), unit:unit,
                dose:doseRange(d)+weightAgeNote(d)});
    });
  });
  return out;
}
function predictedWeight(){
  const es=weightEstimates();
  if(!es.length) return null;
  let lo=-Infinity, hi=Infinity;
  es.forEach(function(e){ lo=Math.max(lo,e.lo); hi=Math.min(hi,e.hi); });
  const ok=(lo<=hi*1.0001);
  const val=ok?((lo+hi)/2):(es.reduce(function(a,e){return a+(e.lo+e.hi)/2;},0)/es.length);
  return {list:es, lo:lo, hi:hi, ok:ok, val:val};
}
function effectiveWeight(){
  const w=num($('weight').value);
  if(w&&w>0) return {lo:w, hi:w, src:'実体重'};
  const p=predictedWeight();
  if(p){
    if(p.ok && isFinite(p.lo) && isFinite(p.hi)){
      return {lo:Math.round(p.lo*10)/10, hi:Math.round(p.hi*10)/10, src:'予測体重'};
    }
    const v=Math.round(p.val*10)/10;
    return {lo:v, hi:v, src:'予測体重'};
  }
  return null;
}
function rangeStr(a, b, dec, unit){
  return (Math.abs(b-a) < Math.pow(10,-dec)/2)
    ? fmt(a,dec)+(unit||'')
    : fmt(a,dec)+'〜'+fmt(b,dec)+(unit||'');
}
function renderPred(){
  const host=$('predWrap');
  const p=predictedWeight();
  if(!p){ host.innerHTML=''; return; }
  const one=Math.abs(p.hi-p.lo)<0.05;
  let h='<div class="pred"><div class="row2"><span>予測体重</span>';
  if(p.ok){
    h+='<span class="big">'+(one?fmt(p.lo,1):fmt(p.lo,1)+'〜'+fmt(p.hi,1))+' kg</span>';
  }else{
    h+='<span class="big">'+fmt(p.val,1)+' kg 前後</span>';
  }
  h+='<button class="btn small" type="button" id="predApply">体重に入れる</button></div>';
  if(!p.ok) h+='<div class="det" style="color:var(--warn)">薬剤ごとに推定値が食い違っています</div>';
  p.list.forEach(function(e){
    h+='<div class="det">'+e.name+'　'+e.dose+' → '+
       (Math.abs(e.hi-e.lo)<0.05?fmt(e.lo,1):fmt(e.lo,1)+'〜'+fmt(e.hi,1))+' kg</div>';
  });
  h+='<div class="det" style="color:var(--mute)">参考用量から逆算した目安です。</div></div>';
  host.innerHTML=h;
  const b=$('predApply');
  if(b) b.addEventListener('click',function(){
    $('weight').value=fmt(Math.round(p.val*10)/10,1);
    st.weight=$('weight').value; saveState(); renderRps();
  });
}

/* ================= 同薬効グループ ================= */
const FORM_BADGE={powder:'散', liquid:'水', tablet:'錠', chew:'噛', cap:'Cap', sachet:'包', supp:'坐'};
function badgeHtml(f){
  return '<span class="fbadge '+f.t+'">'+(FORM_BADGE[f.t]||'')+'</span>';
}
function groupPanelHtml(rp, it, d){
  const g=groupOf(it.drugId);
  if(!g) return '';
  // 入力中の薬剤は上の換算欄に出ているので、グループからは外す
  const others=(g.ids||[]).filter(function(id){ return id!==it.drugId && getDrug(id); });
  if(!others.length) return '';
  let h='<div class="grp-toggle" data-grp="1">'+(it.grpOpen?'▲ ':'▼ ')+'同薬効グループ「'+g.name+'」の標準量</div>';
  if(!it.grpOpen) return h;
  const ew=effectiveWeight();
  h+='<div class="grp">';
  if(!ew){ h+='<div class="ghead">体重が分からないため計算できません</div></div>'; return h; }
  const times=rp.mode==='reg'?rp.times:1;
  const wide=(ew.hi-ew.lo)>0.05;
  h+='<div class="ghead">体重 '+rangeStr(ew.lo,ew.hi,1,'kg')+'（'+ew.src+'）・'+
     (rp.mode==='reg'?'分'+times+'／1日量':'1回量')+'で計算'+
     (wide?'。幅は体重の範囲によるものです':'')+'</div>';

  // 参考用量のある成分を先に、未設定のものを後ろにまとめる
  const ids=others.slice();
  const withDose=ids.filter(function(id){ const x=getDrug(id); return x&&x.dmin!==undefined; });
  const noDose  =ids.filter(function(id){ const x=getDrug(id); return x&&x.dmin===undefined; });
  const open = Array.isArray(it.gOpen) ? it.gOpen : [];

  withDose.concat(noDose).forEach(function(id){
    const dd=getDrug(id); if(!dd) return;
    const has=(dd.dmin!==undefined);
    const isOpen=open.indexOf(id)>=0;
    const doseTxt = has ? doseRange(dd) : '用量未設定';
    h+='<div class="gdrug'+(has?'':' off')+'" data-gd="'+id+'">'+
       '<span class="car">'+(isOpen?'▼':'▶')+'</span>'+
       '<span class="gn">'+dd.name+'</span>'+
       '<span class="gdose">'+doseTxt+'</span></div>';
    if(!isOpen) return;

    h+='<div class="gbody">';
    if(!has){
      dd.forms.forEach(function(f){
        h+='<div class="grow"><div class="n">'+badgeHtml(f)+'<span>'+f.n+'</span></div>'+
           '<div class="r"><div class="m"></div>'+
           '<div class="v" style="font-weight:400;font-size:11.5px;color:var(--mute)">'+
           '含量 '+fmt(f.s,2)+(dd.potency?'mg力価':'mg')+'／'+unitOf(f)+'</div></div></div>';
      });
      h+='</div>';
      return;
    }
    const mid=doseMid(dd);
    const baseOf=function(w){
      if(dd.dbasis==='dose') return (rp.mode==='reg')?mid*w*times:mid*w;
      return (rp.mode==='reg')?mid*w:mid*w/times;
    };
    const un=uName(dd), uf=uFactor(dd), per=rp.mode==='reg'?'／日':'／回';
    dd.forms.forEach(function(f){
      if(f.sr) return;
      const a=planFor(f, baseOf(ew.lo), rp.mode, times);
      const b=planFor(f, baseOf(ew.hi), rp.mode, times);
      h+='<div class="grow"><div class="n">'+badgeHtml(f)+'<span>'+f.n+'</span></div>'+
         '<div class="r"><div class="m">'+rangeStr(a.mg/uf,b.mg/uf,1,un)+'</div>'+
         '<div class="v">'+rangeStr(a.val,b.val,2)+
         '<span class="u">'+unitOf(f)+per+'</span></div></div></div>';
    });
    h+='</div>';
  });
  h+='</div>';
  return h;
}

/* ================= Rp描画 ================= */
function renderRps(){
  const host=$('rpHost'); host.innerHTML='';
  st.rps.forEach(function(rp, ri){
    const card=document.createElement('div'); card.className='card';

    const head=document.createElement('div'); head.className='rp-head';
    const no=document.createElement('span'); no.className='rp-no'; no.textContent='Rp'+(ri+1);
    head.appendChild(no);

    const seg=document.createElement('div'); seg.className='seg-mini';
    [{v:'reg',l:'定期'},{v:'prn',l:'頓用'}].forEach(function(o){
      const b=document.createElement('div');
      b.className=(rp.mode===o.v?'active':''); b.textContent=o.l;
      b.addEventListener('click',function(){ rp.mode=o.v; saveState(); renderRps(); });
      seg.appendChild(b);
    });
    head.appendChild(seg);

    const del=document.createElement('span'); del.className='rp-del'; del.textContent='削除';
    del.addEventListener('click',function(){
      if(st.rps.length<=1){ st.rps[0]=newRp(); }
      else st.rps.splice(ri,1);
      saveState(); renderRps();
    });
    head.appendChild(del);
    card.appendChild(head);

    if(rp.mode==='reg'){
      const tr=document.createElement('div'); tr.className='rp-times';
      const lb=document.createElement('span'); lb.className='lb'; lb.textContent='分割';
      tr.appendChild(lb);
      [1,2,3,4].forEach(function(t){
        const c=document.createElement('div');
        c.className='chip tiny'+(rp.times===t?' active':'');
        c.textContent='分'+t;
        c.addEventListener('click',function(){ rp.times=t; saveState(); renderRps(); });
        tr.appendChild(c);
      });
      card.appendChild(tr);
    }

    const itemsHost=document.createElement('div');
    if(!rp.items.length){
      const e=document.createElement('div'); e.className='empty';
      e.textContent='薬剤が登録されていません。';
      itemsHost.appendChild(e);
    }
    rp.items.forEach(function(it, ii){ itemsHost.appendChild(buildItem(rp, ri, it, ii)); });
    card.appendChild(itemsHost);

    const add=document.createElement('button'); add.type='button'; add.className='add-item';
    add.textContent='＋ 薬剤を追加';
    add.addEventListener('click',function(){
      openPicker(function(id){
        rp.items.push({drugId:id, formIdx:0, mg:null, src:'prod', target:null});
        saveState(); renderRps();
      });
    });
    card.appendChild(add);
    host.appendChild(card);
  });
  renderPred();
}

function buildItem(rp, ri, it, ii){
  const box=document.createElement('div'); box.className='item';
  const d=getDrug(it.drugId);
  if(!d){
    box.innerHTML='<div class="empty">この薬剤はマスタにありません</div>';
    return box;
  }
  const head=document.createElement('div'); head.className='item-head';
  const btn=document.createElement('div'); btn.className='drug-btn';
  btn.textContent=d.brand?d.name+'（'+d.brand.split('／')[0]+'）':d.name;
  btn.addEventListener('click',function(){
    openPicker(function(id){ it.drugId=id; it.formIdx=0; it.mg=null; it.target=null;
      saveState(); renderRps(); });
  });
  const x=document.createElement('span'); x.className='item-x'; x.textContent='×';
  x.addEventListener('click',function(){ rp.items.splice(ii,1); saveState(); renderRps(); });
  head.appendChild(btn); head.appendChild(x);
  box.appendChild(head);

  const sel=document.createElement('select'); sel.className='form-sel';
  d.forms.forEach(function(f,i){
    const o=document.createElement('option'); o.value=i; o.textContent=f.n;
    sel.appendChild(o);
  });
  sel.value=String(Math.min(it.formIdx, d.forms.length-1));
  sel.addEventListener('change',function(){ it.formIdx=parseInt(sel.value,10); saveState(); refresh(); });
  box.appendChild(sel);

  const per=rp.mode==='reg'?'1日量':'1回量';
  const rowP=document.createElement('div'); rowP.className='amt';
  rowP.innerHTML='<div class="lb">製剤量<br>'+per+'</div>'+
    '<input type="number" class="num" inputmode="decimal" step="0.01" min="0" placeholder="0">'+
    '<div class="u"></div>';
  const rowI=document.createElement('div'); rowI.className='amt';
  rowI.innerHTML='<div class="lb">成分量<br>'+per+'</div>'+
    '<input type="number" class="num" inputmode="decimal" step="0.01" min="0" placeholder="0">'+
    '<div class="u"></div>';
  box.appendChild(rowP); box.appendChild(rowI);

  const inP=rowP.querySelector('input'), inI=rowI.querySelector('input');
  inP.addEventListener('input',function(){
    const f=d.forms[it.formIdx], v=num(inP.value);
    it.mg=(v===null||v<=0)?null:v*f.s; it.src='prod'; saveState(); refresh('prod');
  });
  inI.addEventListener('input',function(){
    const v=num(inI.value);
    it.mg=(v===null||v<=0)?null:v*uFactor(d); it.src='ing'; saveState(); refresh('ing');
  });

  const res=document.createElement('div');
  box.appendChild(res);

  function refresh(keep){
    const f=d.forms[Math.min(it.formIdx,d.forms.length-1)];
    rowP.querySelector('.u').textContent=unitOf(f);
    rowI.querySelector('.u').textContent=uName(d);
    if(keep!=='prod') inP.value=(it.mg===null)?'':fmt(it.mg/f.s,3);
    if(keep!=='ing')  inI.value=(it.mg===null)?'':fmt(it.mg/uFactor(d),3);
    rowP.classList.toggle('src', it.src==='prod'); rowP.classList.toggle('derived', it.src!=='prod');
    rowI.classList.toggle('src', it.src==='ing');  rowI.classList.toggle('derived', it.src!=='ing');
    res.innerHTML=itemResultHtml(rp, it, d);
    res.querySelectorAll('.crow').forEach(function(el){
      el.addEventListener('click',function(){
        const gi=parseInt(el.dataset.i,10);
        it.target=(it.target===gi)?null:gi;
        saveState(); refresh();
      });
    });
    const gt=res.querySelector('[data-grp]');
    if(gt) gt.addEventListener('click',function(){ it.grpOpen=!it.grpOpen; saveState(); refresh(); });
    res.querySelectorAll('[data-gd]').forEach(function(el){
      el.addEventListener('click',function(){
        const id=el.dataset.gd;
        const cur=Array.isArray(it.gOpen)?it.gOpen.slice():[];
        const i=cur.indexOf(id);
        if(i>=0) cur.splice(i,1); else cur.push(id);
        it.gOpen=cur; saveState(); refresh();
      });
    });
    renderPred();
  }
  refresh();
  return box;
}

function itemResultHtml(rp, it, d){
  if(it.mg===null||it.mg<=0) return '';
  const times=rp.mode==='reg'?rp.times:1;
  const mgDay=rp.mode==='reg'?it.mg:null;
  const mgDose=rp.mode==='reg'?it.mg/times:it.mg;
  const w=num($('weight').value);
  const un=uName(d), uf=uFactor(d);
  const per=rp.mode==='reg'?'／日':'／回';

  let h='<div class="sum">';
  if(mgDay!==null) h+=fmt(mgDay/uf,3)+' '+un+'／日（1回 '+fmt(mgDose/uf,3)+' '+un+'）';
  else h+=fmt(mgDose/uf,3)+' '+un+'／回';
  if(w) h+=' ・'+fmt((rp.mode==='reg'?mgDay:mgDose)/w,2)+' mg/kg'+(rp.mode==='reg'?'／日':'／回');
  const chk=doseCheck(d,mgDay,mgDose,w,d.forms[it.formIdx]);
  if(chk) h+='<span class="badge '+chk.cls+'">'+chk.text+'</span>';
  h+='</div>';

  h+='<div class="conv"><div class="conv-lb">同じ成分量になる他剤形（タップで変更先に指定）</div>';
  d.forms.forEach(function(g,i){
    if(i===it.formIdx) return;
    const p=planFor(g,it.mg,rp.mode,times);
    h+='<div class="crow'+(it.target===i?' sel':'')+'" data-i="'+i+'">';
    h+='<div class="nm">'+g.n;
    const nt=notesFor(p);
    if(nt.length) h+='<span class="note">'+nt.join('／')+'</span>';
    if(!p.exact&&Math.abs(p.err)>=10&&rp.mode==='reg'){
      const b=bestTimes(g,it.mg,times);
      if(b&&b.err<Math.abs(p.err)-1)
        h+='<span class="tip">分'+b.t+'なら1回 '+fmt(b.perDose,2)+p.unit+'（'+fmt(b.err,1)+'%）</span>';
    }
    h+='</div>';
    h+='<div class="val">'+fmt(p.val,2)+'<span class="u">'+p.unit+per+'</span>'+
       (rp.mode==='reg'&&times>1?'<span class="per">1回 '+fmt(p.perDose,2)+p.unit+'</span>':'')+'</div>';
    h+='<div class="mk'+(p.exact?' eq':(Math.abs(p.err)>=10?' warn':''))+'">'+
       (p.exact?'等量':((p.err>=0?'+':'')+fmt(p.err,1)+'%<br>'+fmt(p.mg/uf,3)+un))+'</div>';
    h+='</div>';
  });
  h+='</div>';
  h+=groupPanelHtml(rp, it, d);
  return h;
}

/* ================= 薬剤ピッカー ================= */
let pickCb=null;
function openPicker(cb){
  pickCb=cb; $('pq').value=''; $('sheet').classList.add('open');
  renderPickList();
  setTimeout(function(){ try{$('pq').focus();}catch(e){} },50);
}
function closePicker(){ $('sheet').classList.remove('open'); pickCb=null; }
function renderPickList(){
  const q=norm($('pq').value), host=$('pChips'), hint=$('pHint');
  host.innerHTML='';
  let list, mode;
  if(q){
    list=DRUGS.filter(function(d){
      return norm(d.name+' '+(d.brand||'')+' '+(d.k||'')+' '+(d.r||'')).indexOf(q)>=0; });
    mode='search';
  }else if(pickAll){ list=DRUGS.slice(); mode='all'; }
  else{
    list=st.recent.map(function(id){return getDrug(id);}).filter(Boolean).slice(0,10);
    const ad=adoptedDrugIds();
    if(ad){
      const have={};
      list.forEach(function(d){ have[d.id]=1; });
      ad.forEach(function(id){
        const d=getDrug(id);
        if(d&&!have[id]&&list.length<24){ list.push(d); have[id]=1; }
      });
      mode='adopted';
    }else{
      mode='recent';
    }
  }
  if(!list.length) host.innerHTML='<span class="empty">該当なし</span>';
  list.slice(0,60).forEach(function(d){
    const el=document.createElement('div'); el.className='chip sub';
    el.textContent=d.brand?d.name+'（'+d.brand.split('／')[0]+'）':d.name;
    el.addEventListener('click',function(){
      st.recent=[d.id].concat(st.recent.filter(function(x){return x!==d.id;})).slice(0,12);
      const cb=pickCb; closePicker(); pickAll=false;
      if(cb) cb(d.id);
    });
    host.appendChild(el);
  });
  if(mode!=='all'){
    const m=document.createElement('div'); m.className='chip sub more';
    m.textContent='すべて '+DRUGS.length+'件';
    m.addEventListener('click',function(){ pickAll=true; $('pq').value=''; renderPickList(); });
    host.appendChild(m);
  }
  hint.textContent = q?(list.length+'件')
    :(mode==='all'?'全件表示中'
      :(mode==='adopted'?'最近使った薬剤・採用品'
        :(st.recent.length?'最近使った薬剤':'検索するか「すべて」から選択')));
}
let pickAll=false;

/* ================= メモ ================= */
function buildMemo(){
  const w=num($('weight').value);
  const L=[];
  L.push('【剤形変更のご相談】'+(w?'体重 '+fmt(w,2)+'kg':''));
  let any=false;
  st.rps.forEach(function(rp,ri){
    const lines=[];
    rp.items.forEach(function(it){
      const d=getDrug(it.drugId); if(!d||it.mg===null||it.mg<=0) return;
      const times=rp.mode==='reg'?rp.times:1;
      const f=d.forms[Math.min(it.formIdx,d.forms.length-1)];
      const per=rp.mode==='reg'?'／日':'／回';
      const un=uName(d), uf=uFactor(d);
      const p0=planFor(f,it.mg,rp.mode,times);
      lines.push('・'+f.n+' '+fmt(p0.val,3)+unitOf(f)+per+
        (rp.mode==='reg'?' 分'+times:'')+'（'+d.name+'として '+fmt(it.mg/uf,3)+un+per+'）');
      const idxs = (it.target!==null&&it.target!==undefined)
        ? [it.target]
        : d.forms.map(function(_,i){return i;}).filter(function(i){return i!==it.formIdx;});
      idxs.forEach(function(i){
        const g=d.forms[i]; if(!g) return;
        const p=planFor(g,it.mg,rp.mode,times);
        lines.push('　→ '+g.n+' '+fmt(p.val,2)+p.unit+per+
          (rp.mode==='reg'&&times>1?'（1回 '+fmt(p.perDose,2)+p.unit+'）':'')+
          (p.exact?'　※成分量は等量':'　※'+fmt(p.mg/uf,3)+un+per+'（'+(p.err>=0?'+':'')+fmt(p.err,1)+'%）')+
          (g.sr?'　※徐放性のため単純換算不可':''));
      });
    });
    if(lines.length){
      any=true;
      L.push('');
      L.push('Rp'+(ri+1)+'（'+(rp.mode==='reg'?'定期・分'+rp.times:'頓用')+'）');
      lines.forEach(function(x){L.push(x);});
    }
  });
  return any?L.join('\n'):'';
}
function copyMemo(){
  const text=buildMemo();
  if(!text){ toast('入力された処方がありません'); return; }
  const ok=function(){toast('コピーしました');};
  if(navigator.clipboard&&navigator.clipboard.writeText)
    navigator.clipboard.writeText(text).then(ok,function(){fb(text,ok);});
  else fb(text,ok);
  function fb(t,cb){
    const ta=document.createElement('textarea');
    ta.value=t; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    try{document.execCommand('copy');cb();}catch(e){toast('コピーできませんでした');}
    document.body.removeChild(ta);
  }
}

/* ================= マスタ編集 ================= */
function renderMasterList(){
  const host=$('masterList'); host.innerHTML='';
  DRUGS.forEach(function(d,i){
    const row=document.createElement('div'); row.className='m-item';
    const nm=document.createElement('div'); nm.className='m-name';
    nm.innerHTML='<strong>'+d.name+'</strong><span>'+d.forms.length+'剤形'+
      (d.brand?'／'+d.brand:'')+(d.ageBands?'／年齢区分'+d.ageBands.length:'')+'</span>';
    const ed=document.createElement('div'); ed.className='m-act'; ed.textContent='編集';
    ed.addEventListener('click',function(){openDrugForm(i);});
    const dl=document.createElement('div'); dl.className='m-act del'; dl.textContent='削除';
    dl.addEventListener('click',function(){
      if(DRUGS.length<=1){toast('最後の1件は削除できません');return;}
      if(!window.confirm(d.name+' を削除しますか？'))return;
      markDeleted(d.id); DRUGS.splice(i,1); saveMaster(); renderMasterList(); renderRps();
    });
    row.appendChild(nm);row.appendChild(ed);row.appendChild(dl);host.appendChild(row);
  });
}
function openDrugForm(index){
  const src = index===-1
    ? {id:'d'+Date.now(),name:'',brand:'',k:'',r:'',dbasis:'day',dnote:'',forms:[{n:'',t:'powder',s:''}]}
    : JSON.parse(JSON.stringify(DRUGS[index]));
  const slot=$('mFormSlot'); slot.innerHTML='';
  const box=document.createElement('div'); box.className='m-form';
  box.innerHTML=
    '<div class="fl">一般名（必須）</div><input type="text" data-f="name">'+
    '<div class="fl">先発名</div><input type="text" data-f="brand">'+
    '<div class="fl">検索用のよみ／ローマ字</div><input type="text" data-f="k" placeholder="ひらがな">'+
    '<input type="text" data-f="r" placeholder="romaji" style="margin-top:5px;">'+
    '<div class="fl">成分量の単位</div>'+
    '<div class="m-sub">計算結果の「成分量」をどの単位で表示するかです。</div>'+
    '<div class="m-frow"><select data-f="un">'+
      '<option value="mg">mg</option><option value="mg(力価)">mg(力価)</option>'+
      '<option value="g">g</option><option value="μg">μg</option></select></div>'+
    '<div class="fl">参考用量メモ</div><input type="text" data-f="dnote">'+
    '<div class="fl">用量チェック・体重予測に使う数値（任意）</div>'+
    '<div class="m-sub">入れておくと、処方が参考用量の範囲内かを自動判定し、処方量からの体重予測にも使われます。'+
      '「体重あたりは○歳未満」は、それ以上の年齢では年齢区分を使う薬（例：プロカテロール 6歳未満）に入れます。'+
      '上限は添付文書の成人の通常量（小児の上限が書かれている薬はその値）です。体重を入れたときに判定し、処方監査ドリルの「成人量の上限」にも使われます。</div>'+
    '<div class="m-frow"><span class="mlb">基準</span>'+
      '<select data-f="dbasis"><option value="day">1日量（mg/kg/日）</option>'+
      '<option value="dose">1回量（mg/kg/回）</option></select></div>'+
    '<div class="m-frow"><span class="mlb">下限</span>'+
      '<input type="number" class="num" data-f="dmin" placeholder="例 20" step="0.01">'+
      '<span class="mlb">上限</span>'+
      '<input type="number" class="num" data-f="dmax" placeholder="例 40" step="0.01">'+
      '<span class="mlb"><span data-du>mg</span>/kg</span></div>'+
    '<div class="m-frow"><span class="mlb">体重あたりは</span>'+
      '<input type="number" class="num" data-f="weightAgeMax" placeholder="空欄＝年齢制限なし" step="0.5">'+
      '<span class="mlb">歳未満</span></div>'+
    '<div class="m-frow"><span class="mlb">1日上限</span>'+
      '<input type="number" class="num" data-f="maxDay" placeholder="例 1000" step="0.1">'+
      '<span class="mlb" data-du>mg</span>'+
      '<span class="mlb">1回上限</span>'+
      '<input type="number" class="num" data-f="maxDose" placeholder="例 75" step="0.1">'+
      '<span class="mlb" data-du>mg</span></div>'+
    '<div class="m-frow"><span class="mlb">上限の根拠</span>'+
      '<input type="text" data-f="maxNote" placeholder="例 成人1回250mg 1日3〜4回"></div>'+
    '<div class="m-frow"><span class="mlb">最高量</span>'+
      '<input type="number" class="num" data-f="dlimit" placeholder="空欄可" step="0.01">'+
      '<span class="mlb"><span data-du>mg</span>/kg（重症時・最高量が通常量より多い薬）</span></div>'+
    '<div class="m-frow"><span class="mlb">許容差 ±</span>'+
      '<input type="number" class="num" data-f="tolerancePct" placeholder="10" step="1">'+
      '<span class="mlb">%（水剤MIXの体重鑑査。範囲からこれ以上外れたら注意）</span></div>'+
    '<div class="m-sub" style="margin-top:6px;">体重あたり用量を使わない剤形（例：体重あたり量が坐剤だけに書かれている薬の内服薬）</div>'+
    '<div id="mWeightNotHost"></div>'+
    '<div class="fl">年齢区分（任意）</div>'+
    '<div class="m-sub">年齢で量が決まる薬はここに登録します。成分量（「成分量の単位」がμgの薬はμg、それ以外はmg）で入力してください。'+
      '「1回量」はザイザル型（1回○mgを1日○回）、「1日量の幅」はアスベリン型（1日○〜○mgを○回に分割、回数は空欄可）です。'+
      '下限0歳は「○歳未満」になります。水剤MIX調製計算の年齢鑑査と処方監査ドリルにも使われます。</div>'+
    '<div id="mBandsHost"></div>'+
    '<button class="btn ghost small" id="mAddBand" type="button" style="margin-top:4px;">＋ 区分を追加</button>'+
    '<div class="m-sub" style="margin-top:6px;">年齢区分を使わない剤形（年齢表がシロップだけに書かれている場合などにチェック）</div>'+
    '<div id="mAgeNotHost"></div>'+
    '<div class="fl">剤形と含量</div>'+
    '<div class="m-sub">含量は1g・1mL・1錠あたりの成分量（mg）で入力します。対象年齢は添付文書で年齢が決まっている製剤だけ入れます（例：アレグラ錠30mg 7歳以上。小児の用法がない成人用の製剤は下限15）。</div><div id="mFormsHost"></div>'+
    '<button class="btn ghost small" id="mAddForm" type="button" style="margin-top:4px;">＋ 剤形を追加</button>'+
    '<div class="btn-row" style="margin-top:10px;">'+
      '<button class="btn" id="mSave" type="button">保存</button>'+
      '<button class="btn ghost" id="mCancel" type="button">キャンセル</button></div>';
  slot.appendChild(box);
  const set=function(k,v){const el=box.querySelector('[data-f="'+k+'"]');if(el)el.value=(v===undefined||v===null)?'':v;};
  set('name',src.name);set('brand',src.brand);set('k',src.k);set('r',src.r);
  // 用量は μg の薬なら μg で見せる（保存は mg）
  const df0=dFactor(src);
  const sc=function(v){ return (v===undefined||v===null||v==='')?v:+(v/df0).toPrecision(12); };
  set('dnote',src.dnote);set('dmin',sc(src.dmin));set('dmax',sc(src.dmax));set('maxDay',sc(src.maxDay));
  set('maxDose',sc(src.maxDose));set('dlimit',sc(src.dlimit));set('maxNote',src.maxNote);
  set('tolerancePct',src.tolerancePct);set('weightAgeMax',src.weightAgeMax);
  box.querySelector('[data-f="dbasis"]').value=src.dbasis||'day';
  box.querySelector('[data-f="un"]').value=src.un||(src.potency?'mg(力価)':'mg');
  const bh=box.querySelector('#mBandsHost');
  // 単位の表示を「成分量の単位」に合わせる
  const updDU=function(){
    const u=(box.querySelector('[data-f="un"]').value==='μg')?'μg':'mg';
    box.querySelectorAll('[data-du]').forEach(function(e){ e.textContent=u; });
  };
  box.querySelector('[data-f="un"]').addEventListener('change',updDU);
  updDU();
  function addBand(b){
    const isRange=(b.dayMin!==undefined&&b.dayMin!==null);
    const r=document.createElement('div'); r.className='m-band';
    r.innerHTML='<div class="m-frow">'+
      '<input type="number" class="num" data-b="a0" placeholder="下限" step="0.1" style="flex:1;">'+
      '<span class="mlb">〜</span>'+
      '<input type="number" class="num" data-b="a1" placeholder="上限" step="0.1" style="flex:1;">'+
      '<span class="mlb">歳</span>'+
      '<select data-b="kind" style="flex:1.4;"><option value="dose">1回量</option><option value="range">1日量の幅</option></select>'+
      '<span class="x">×</span></div>'+
      '<div class="m-frow" data-k="dose">'+
      '<span class="mlb">1回</span><input type="number" class="num" data-b="mg" placeholder="量" step="0.01" style="flex:1.2;">'+
      '<span class="mlb"><span data-du>mg</span> ×</span><input type="number" class="num" data-b="times" placeholder="回" step="1" style="flex:0.8;">'+
      '<span class="mlb">回/日</span></div>'+
      '<div class="m-frow" data-k="range">'+
      '<span class="mlb">1日</span><input type="number" class="num" data-b="dayMin" placeholder="下限" step="0.01" style="flex:1;">'+
      '<span class="mlb">〜</span><input type="number" class="num" data-b="dayMax" placeholder="上限" step="0.01" style="flex:1;">'+
      '<span class="mlb"><span data-du>mg</span> 分</span><input type="number" class="num" data-b="rtimes" placeholder="回" step="1" style="flex:0.7;"></div>';
    const v=function(x){return (x!==undefined&&x!==null)?x:'';};
    r.querySelector('[data-b="a0"]').value=v(b.a0);
    r.querySelector('[data-b="a1"]').value=v(b.a1);
    r.querySelector('[data-b="mg"]').value=v(sc(b.mg));
    r.querySelector('[data-b="times"]').value=isRange?'':v(b.times);
    r.querySelector('[data-b="dayMin"]').value=v(sc(b.dayMin));
    r.querySelector('[data-b="dayMax"]').value=v(sc(b.dayMax));
    // 添付文書の表記（例：「～1歳」）を保つため、年齢を変えなければ元の区分名を使う
    r.dataset.label=(typeof b.label==='string')?b.label:'';
    r.dataset.a0=v(b.a0); r.dataset.a1=v(b.a1);
    r.querySelector('[data-b="rtimes"]').value=isRange?v(b.times):'';
    const kind=r.querySelector('[data-b="kind"]');
    kind.value=isRange?'range':'dose';
    const sync=function(){
      r.querySelector('[data-k="dose"]').style.display=(kind.value==='dose')?'':'none';
      r.querySelector('[data-k="range"]').style.display=(kind.value==='range')?'':'none';
    };
    kind.addEventListener('change',sync); sync();
    r.querySelector('.x').addEventListener('click',function(){r.remove();});
    bh.appendChild(r);
    updDU();
  }
  (src.ageBands||[]).forEach(addBand);
  box.querySelector('#mAddBand').addEventListener('click',function(){addBand({});});
  const anh=box.querySelector('#mAgeNotHost');
  const ageNot=Array.isArray(src.ageNotFor)?src.ageNotFor:[];
  (src.forms||[]).forEach(function(f){
    const lb=document.createElement('label'); lb.className='g-check';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.dataset.an=f.n; cb.checked=ageNot.indexOf(f.n)>=0;
    const sp=document.createElement('span'); sp.textContent=f.n;
    lb.appendChild(cb); lb.appendChild(sp); anh.appendChild(lb);
  });
  if(!(src.forms||[]).length){ anh.textContent='（保存後に剤形が表示されます）'; }
  const wnh=box.querySelector('#mWeightNotHost');
  const wNot=Array.isArray(src.weightNotFor)?src.weightNotFor:[];
  (src.forms||[]).forEach(function(f){
    const lb=document.createElement('label'); lb.className='g-check';
    const cb=document.createElement('input'); cb.type='checkbox'; cb.dataset.wn=f.n; cb.checked=wNot.indexOf(f.n)>=0;
    const sp=document.createElement('span'); sp.textContent=f.n;
    lb.appendChild(cb); lb.appendChild(sp); wnh.appendChild(lb);
  });
  if(!(src.forms||[]).length){ wnh.textContent='（保存後に剤形が表示されます）'; }

  const fh=box.querySelector('#mFormsHost');
  function addRow(f){
    const wrap=document.createElement('div'); wrap.className='m-fi';
    const r=document.createElement('div'); r.className='m-frow';
    r.innerHTML='<input type="text" data-k="n" placeholder="製剤名">'+
      '<select data-k="t">'+Object.keys(TYPE_INFO).map(function(k){
        return '<option value="'+k+'">'+TYPE_INFO[k].label+'</option>';}).join('')+'</select>'+
      '<input type="number" class="num" data-k="s" placeholder="含量" step="0.01">'+
      '<span class="u"></span><span class="x">×</span>';
    r.querySelector('[data-k="n"]').value=f.n||'';
    r.querySelector('[data-k="t"]').value=f.t||'powder';
    r.querySelector('[data-k="s"]').value=(f.s!==undefined?f.s:'');
    r.dataset.sr=f.sr?'1':''; r.dataset.note=f.note||'';
    r.dataset.avoid=JSON.stringify(numList(f.avoid));
    const u=r.querySelector('.u');
    const upd=function(){
      const t=r.querySelector('[data-k="t"]').value;
      const mg=(box.querySelector('[data-f="un"]').value==='mg(力価)')?'mg力価':'mg';
      u.textContent=mg+'/'+(TYPE_INFO[t]?TYPE_INFO[t].unit:'');
    };
    upd();
    r.querySelector('[data-k="t"]').addEventListener('change',upd);
    box.querySelector('[data-f="un"]').addEventListener('change',upd);
    r.querySelector('.x').addEventListener('click',function(){wrap.remove();});
    // 剤形の対象年齢（歳）。上限は「未満」
    const ar=document.createElement('div'); ar.className='m-age';
    ar.innerHTML='<span class="mlb">対象年齢</span>'+
      '<input type="number" class="num" data-k="a0" step="0.5" placeholder="下限">'+
      '<span class="mlb">歳以上</span>'+
      '<input type="number" class="num" data-k="a1" step="0.5" placeholder="上限">'+
      '<span class="mlb">歳未満（空欄＝制限なし）</span>';
    ar.querySelector('[data-k="a0"]').value=(typeof f.ageMin==='number')?f.ageMin:'';
    ar.querySelector('[data-k="a1"]').value=(typeof f.ageMax==='number')?f.ageMax:'';
    // 販売されている規格（ドリルの「含量」の問題で使う。散・DS・シロップ・液のみ）
    const lr=document.createElement('div'); lr.className='m-age';
    const ll=document.createElement('span'); ll.className='mlb'; ll.textContent='販売規格（製剤名の数字・カンマ区切り）';
    const li=document.createElement('input'); li.type='text'; li.className='num'; li.dataset.k='lineup'; li.placeholder='例：20, 50'; li.inputMode='decimal';
    li.value=numList(f.lineup).join(', '); li.style.width='9em'; li.style.textAlign='left';
    lr.appendChild(ll); lr.appendChild(li);
    wrap.appendChild(r); wrap.appendChild(ar); wrap.appendChild(lr);
    fh.appendChild(wrap);
  }
  (src.forms||[]).forEach(addRow);
  box.querySelector('#mAddForm').addEventListener('click',function(){addRow({n:'',t:'powder',s:''});});
  box.querySelector('#mCancel').addEventListener('click',function(){slot.innerHTML='';});
  box.querySelector('#mSave').addEventListener('click',function(){
    const g=function(k){const el=box.querySelector('[data-f="'+k+'"]');return el?el.value.trim():'';};
    const name=g('name'); if(!name){toast('成分名を入力してください');return;}
    const forms=[]; let badAge=0;
    fh.querySelectorAll('.m-fi').forEach(function(w){
      const r=w.querySelector('.m-frow');
      const n=r.querySelector('[data-k="n"]').value.trim();
      const s=num(r.querySelector('[data-k="s"]').value);
      if(!n||s===null||s<=0) return;
      const o={n:n,t:r.querySelector('[data-k="t"]').value,s:s};
      if(r.dataset.sr)o.sr=true; if(r.dataset.note)o.note=r.dataset.note;
      const lu=numList(String(w.querySelector('[data-k="lineup"]').value||'').split(/[,、，\s]+/).filter(Boolean));
      if(lu.length) o.lineup=lu;
      let av=[]; try{ av=numList(JSON.parse(r.dataset.avoid||'[]')); }catch(e){}
      if(av.length) o.avoid=av;
      const a0=num(w.querySelector('[data-k="a0"]').value), a1=num(w.querySelector('[data-k="a1"]').value);
      if((a0!==null&&a0<0)||(a1!==null&&a1<=0)||(a0!==null&&a1!==null&&a1<=a0)) badAge++;
      else{ if(a0!==null&&a0>0)o.ageMin=a0; if(a1!==null)o.ageMax=a1; }
      forms.push(o);
    });
    if(badAge){toast('剤形の対象年齢に不正な値があります');return;}
    if(!forms.length){toast('剤形を1つ以上入力してください');return;}
    const un=g('un');
    const o={id:src.id,name:name,brand:g('brand'),k:g('k'),r:g('r'),
             dnote:g('dnote'),dbasis:g('dbasis'),forms:forms};
    if(un==='mg(力価)') o.potency=true;
    if(un==='g'){o.un='g';o.uf=1000;}
    if(un==='μg'){o.un='μg';o.uf=0.001;}
    // 入力は画面の単位（μg の薬は μg）→ 保存は mg
    const df1=(un==='μg')?0.001:1;
    const toMg=function(v){ return v===null?null:+(v*df1).toPrecision(12); };
    const a=toMg(num(g('dmin'))),b=toMg(num(g('dmax'))),m=toMg(num(g('maxDay'))),tp=num(g('tolerancePct')),wa=num(g('weightAgeMax'));
    const md=toMg(num(g('maxDose'))), dl=toMg(num(g('dlimit'))), mn=g('maxNote');
    if(a!==null){o.dmin=a;o.dmax=(b!==null?b:a);}
    if(m!==null&&m>0)o.maxDay=m;
    if(md!==null&&md>0)o.maxDose=md;
    if(dl!==null&&o.dmax!==undefined&&dl>o.dmax)o.dlimit=dl;
    if(mn&&(o.maxDay||o.maxDose))o.maxNote=mn.slice(0,120);
    if(tp!==null&&tp>0&&tp<100)o.tolerancePct=tp;   // 空欄＝10%
    if(wa!==null&&wa>0)o.weightAgeMax=wa;
    const bands=[]; let badBand=0;
    bh.querySelectorAll('.m-band').forEach(function(r){
      const q0=function(k){return num(r.querySelector('[data-b="'+k+'"]').value);};
      const q=function(k){ const v=q0(k); return (v!==null&&(k==='mg'||k==='dayMin'||k==='dayMax'))?toMg(v):v; };
      const a0=q('a0'), a1=q('a1');
      const kind=r.querySelector('[data-b="kind"]').value;
      if(a0===null&&q('mg')===null&&q('dayMin')===null) return;      // 空の行は無視
      if(a0===null||a0<0||(a1!==null&&a1<=a0)){badBand++;return;}
      const sameAge=r.dataset.label && String(a0)===String(num(r.dataset.a0)) &&
                    String(a1)===String(r.dataset.a1===''?null:num(r.dataset.a1));
      const lbl=sameAge?r.dataset.label:bandLabel(a0,a1);
      if(kind==='range'){
        const lo=q('dayMin'), hi=q('dayMax'), tm=q('rtimes');
        if(lo===null||lo<=0||hi===null||hi<lo){badBand++;return;}
        const o2={a0:a0, a1:(a1===null?null:a1), label:lbl, dayMin:lo, dayMax:hi};
        if(tm!==null&&tm>0) o2.times=Math.round(tm);
        bands.push(o2);
      }else{
        const mg=q('mg'), tm=q('times');
        if(mg===null||mg<=0||tm===null||tm<=0){badBand++;return;}
        bands.push({a0:a0, a1:(a1===null?null:a1), label:lbl, mg:mg, times:Math.round(tm)});
      }
    });
    if(badBand){toast('年齢区分に未入力・不正な行があります');return;}
    bands.sort(function(x,y){return x.a0-y.a0;});
    if(bands.length) o.ageBands=bands;
    const names=forms.map(function(f){return f.n;});
    const an=[];
    anh.querySelectorAll('input[data-an]').forEach(function(cb){
      if(cb.checked && names.indexOf(cb.dataset.an)>=0) an.push(cb.dataset.an);
    });
    if(bands.length && an.length) o.ageNotFor=an;
    const wn=[];
    wnh.querySelectorAll('input[data-wn]').forEach(function(cb){
      if(cb.checked && names.indexOf(cb.dataset.wn)>=0) wn.push(cb.dataset.wn);
    });
    if(o.dmin!==undefined && wn.length) o.weightNotFor=wn;
    if(index===-1)DRUGS.push(o); else DRUGS[index]=o;
    markEdited(o.id);
    saveMaster();slot.innerHTML='';renderMasterList();renderGroupList();renderRps();toast('保存しました');
  });
}

/* ================= 年齢区分 ================= */
function ageStr(v){
  if(v===null||v===undefined||v==='') return '';
  const n=Number(v);
  if(!isFinite(n)) return '';
  return (n<1)?(Math.round(n*12)+'ヵ月'):(fmt(n,1)+'歳');
}
function bandLabel(a0,a1){
  const s1=ageStr(a1);
  if(Number(a0)===0) return s1?(s1+'未満'):'全年齢';
  const s0=ageStr(a0);
  if(!s0) return '';
  return s1?(s0+'以上'+s1+'未満'):(s0+'以上');
}

/* ================= 採用品の設定 ================= */
function allForms(){
  const out=[];
  DRUGS.forEach(function(d){
    (d.forms||[]).forEach(function(f){ out.push({d:d, f:f}); });
  });
  return out;
}
function isAdopted(name){ return ADOPTED.indexOf(name)>=0; }
function toggleAdopted(name){
  const i=ADOPTED.indexOf(name);
  if(i>=0) ADOPTED.splice(i,1); else ADOPTED.push(name);
  saveShared();
}
function adoptedDrugIds(){
  if(!ADOPTED.length) return null;
  const ids=[];
  DRUGS.forEach(function(d){
    if((d.forms||[]).some(function(f){ return isAdopted(f.n); })) ids.push(d.id);
  });
  return ids;
}
function renderAdopted(){
  const host=$('adList'); if(!host) return;
  const q=norm($('adSearch').value);
  let list;
  if(q){
    list=allForms().filter(function(x){
      return norm(x.f.n+' '+x.d.name+' '+(x.d.k||'')+' '+(x.d.r||'')).indexOf(q)>=0;
    }).slice(0,40);
  }else{
    list=allForms().filter(function(x){ return isAdopted(x.f.n); });
  }
  let h='';
  if(!list.length){
    h='<div class="m-sub" style="margin-top:8px;">'+
      (q?'該当する製剤がありません':'まだ採用品が選ばれていません。検索してチェックしてください（未設定なら全製剤が候補になります）。')+
      '</div>';
  }else{
    list.forEach(function(x){
      h+='<label class="g-check"><input type="checkbox" data-ad="'+x.f.n.replace(/"/g,'&quot;')+'"'+
         (isAdopted(x.f.n)?' checked':'')+'>'+
         '<span>'+x.f.n+'<span style="color:var(--mute);font-size:11px;">　'+x.d.name+'</span></span></label>';
    });
  }
  h+='<div class="m-sub" style="margin-top:6px;">採用 '+ADOPTED.length+' 製剤</div>';
  host.innerHTML=h;
  host.querySelectorAll('[data-ad]').forEach(function(el){
    el.addEventListener('change',function(){
      toggleAdopted(el.dataset.ad);
      renderAdopted(); renderRps();
    });
  });
}

/* ================= グループ編集 ================= */
function renderGroupList(){
  const host=$('groupList'); host.innerHTML='';
  if(!GROUPS.length){ host.innerHTML='<div class="empty">グループがありません</div>'; return; }
  GROUPS.forEach(function(g,i){
    const row=document.createElement('div'); row.className='g-item';
    const nm=document.createElement('div'); nm.className='g-name';
    const names=(g.ids||[]).map(function(id){const d=getDrug(id);return d?d.name:null;}).filter(Boolean);
    nm.innerHTML='<strong>'+g.name+'</strong><span>'+(names.length?names.join('／'):'未設定')+'</span>';
    const ed=document.createElement('div'); ed.className='m-act'; ed.textContent='編集';
    ed.addEventListener('click',function(){openGroupForm(i);});
    const dl=document.createElement('div'); dl.className='m-act del'; dl.textContent='削除';
    dl.addEventListener('click',function(){
      if(!window.confirm(g.name+' を削除しますか？'))return;
      GROUPS.splice(i,1); saveGroups(); renderGroupList(); renderRps();
    });
    row.appendChild(nm);row.appendChild(ed);row.appendChild(dl);host.appendChild(row);
  });
}
function openGroupForm(index){
  const src = index===-1 ? {id:'g'+Date.now(), name:'', ids:[]}
                         : JSON.parse(JSON.stringify(GROUPS[index]));
  const slot=$('gFormSlot'); slot.innerHTML='';
  const box=document.createElement('div'); box.className='m-form';
  box.innerHTML='<div class="fl">グループ名（必須）</div><input type="text" id="gName">'+
    '<div class="fl">含める薬剤</div><div id="gChecks"></div>'+
    '<div class="btn-row" style="margin-top:10px;">'+
      '<button class="btn" id="gSave" type="button">保存</button>'+
      '<button class="btn ghost" id="gCancel" type="button">キャンセル</button></div>';
  slot.appendChild(box);
  box.querySelector('#gName').value=src.name||'';
  const ch=box.querySelector('#gChecks');
  DRUGS.forEach(function(d){
    const l=document.createElement('label'); l.className='g-check';
    const i=document.createElement('input'); i.type='checkbox'; i.value=d.id;
    i.checked=(src.ids||[]).indexOf(d.id)>=0;
    l.appendChild(i);
    const sp=document.createElement('span'); sp.textContent=d.name+(d.brand?'（'+d.brand.split('／')[0]+'）':'');
    l.appendChild(sp); ch.appendChild(l);
  });
  box.querySelector('#gCancel').addEventListener('click',function(){slot.innerHTML='';});
  box.querySelector('#gSave').addEventListener('click',function(){
    const name=box.querySelector('#gName').value.trim();
    if(!name){toast('グループ名を入力してください');return;}
    const ids=[];
    ch.querySelectorAll('input:checked').forEach(function(i){ids.push(i.value);});
    const o={id:src.id, name:name, ids:ids};
    if(index===-1) GROUPS.push(o); else GROUPS[index]=o;
    saveGroups(); slot.innerHTML=''; renderGroupList(); renderRps(); toast('保存しました');
  });
}

/* ================= マスタの書き出し・読み込み ================= */
// 読み込んだ文字列は < > & " ' を全角にする（画面に組み込むときにタグや属性として働かないように）
function safeText(v, max){
  return String(v).replace(/[\u0000-\u001f\u007f]/g,' ').replace(/[<>&"']/g,function(c){
    return {'<':'＜','>':'＞','&':'＆','"':'”',"'":'’'}[c]; }).slice(0, max||400);
}
function numList(a){
  const out=[];
  if(Array.isArray(a)) a.slice(0,20).forEach(function(x){ const v=parseFloat(x); if(isFinite(v)&&v>0&&v<100000&&out.indexOf(v)<0) out.push(v); });
  return out.sort(function(x,y){return x-y;});
}
function validDrugs(arr){
  if(!Array.isArray(arr)) return null;
  const out=[];
  arr.forEach(function(d){
    if(!d||typeof d.name!=='string'||!d.name.trim()) return;
    if(!Array.isArray(d.forms)) return;
    const forms=[];
    d.forms.forEach(function(f){
      if(!f||typeof f.n!=='string'||!f.n.trim()) return;
      const s=parseFloat(f.s);
      if(!isFinite(s)||s<=0) return;
      const o={n:safeText(f.n,160), t:(TYPE_INFO[f.t]?f.t:'powder'), s:s};
      if(f.sr) o.sr=true;
      if(f.note) o.note=safeText(f.note,200);
      const a0=parseFloat(f.ageMin), a1=parseFloat(f.ageMax);
      if(isFinite(a0)&&a0>0&&a0<100) o.ageMin=a0;
      if(isFinite(a1)&&a1>0&&a1<=100&&!(o.ageMin>=a1)) o.ageMax=a1;
      // 含量の問題用：販売されている規格（製剤名の数字）と、誤答肢に使わない数字
      ['lineup','avoid'].forEach(function(k){ const l=numList(f[k]); if(l.length) o[k]=l; });
      forms.push(o);
    });
    if(!forms.length) return;
    const o={id:safeText(d.id||('d'+Math.random().toString(36).slice(2)),80), name:safeText(d.name,120), forms:forms};
    ['brand','k','r','dnote','un','maxNote'].forEach(function(k){ if(d[k]) o[k]=safeText(d[k], k==='maxNote'?120:400); });
    ['dmin','dmax','maxDay','maxDose','dlimit','uf','tolerancePct','weightAgeMax'].forEach(function(k){
      const v=parseFloat(d[k]); if(isFinite(v)) o[k]=v; });
    if(!(o.dlimit>o.dmax)) delete o.dlimit;
    if(Array.isArray(d.ageBands)){
      const bands=[];
      d.ageBands.forEach(function(b){
        if(!b||typeof b!=='object') return;
        const a0=parseFloat(b.a0), mg=parseFloat(b.mg), tm=parseFloat(b.times);
        const lo=parseFloat(b.dayMin), hi=parseFloat(b.dayMax);
        const a1=parseFloat(b.a1);
        if(!isFinite(a0)||a0<0) return;
        const base={a0:a0, a1:isFinite(a1)?a1:null,
                    label:(typeof b.label==='string'&&b.label)?safeText(b.label,40):bandLabel(a0,isFinite(a1)?a1:null)};
        if(isFinite(lo)&&isFinite(hi)&&lo>0&&hi>=lo){
          base.dayMin=lo; base.dayMax=hi; if(isFinite(tm)&&tm>0) base.times=Math.round(tm);
          bands.push(base);
        }else if(isFinite(mg)&&mg>0&&isFinite(tm)&&tm>0){
          base.mg=mg; base.times=Math.round(tm);
          bands.push(base);
        }
      });
      if(bands.length) o.ageBands=bands;
    }
    const names=forms.map(function(f){return f.n;});
    if(o.ageBands && Array.isArray(d.ageNotFor)){
      const an=d.ageNotFor.filter(function(x){return typeof x==='string';}).map(function(x){return safeText(x,160);})
        .filter(function(x){return names.indexOf(x)>=0;});
      if(an.length) o.ageNotFor=an;
    }
    if(o.dmin!==undefined && Array.isArray(d.weightNotFor)){
      const wn=d.weightNotFor.filter(function(x){return typeof x==='string';}).map(function(x){return safeText(x,160);})
        .filter(function(x){return names.indexOf(x)>=0;});
      if(wn.length) o.weightNotFor=wn;
    }
    if(d.potency) o.potency=true;
    o.dbasis=(d.dbasis==='dose')?'dose':'day';
    out.push(o);
  });
  return out.length?out:null;
}

function exportMaster(){
  const now=new Date();
  const pad=function(n){return ('0'+n).slice(-2);};
  const stamp=now.getFullYear()+pad(now.getMonth()+1)+pad(now.getDate());
  // rev：このファイルを drug-master.json として置くと、各端末が自動で取り込む目印（日時の数字）
  const rev=Number(stamp+pad(now.getHours())+pad(now.getMinutes()));
  const data={app:'calcTool', version:2, rev:rev, exportedAt:now.toISOString(), drugs:DRUGS, groups:GROUPS, adopted:ADOPTED};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download='剤形変更換算_薬剤マスタ_'+stamp+'.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(url);},1000);
  toast('書き出しました');
}

function pickDrugs(obj){
  if(Array.isArray(obj)) return validDrugs(obj);
  if(obj&&Array.isArray(obj.drugs)) return validDrugs(obj.drugs);
  return null;
}

function validGroups(arr){
  if(!Array.isArray(arr)) return null;
  const out=[];
  arr.forEach(function(g){
    if(!g||typeof g.name!=='string'||!g.name.trim()) return;
    out.push({id:safeText(g.id||('g'+Math.random().toString(36).slice(2)),80),
              name:safeText(g.name,80), ids:Array.isArray(g.ids)?g.ids.map(function(x){return safeText(x,80);}):[]});
  });
  return out.length?out:null;
}
function showImportChoice(list, label, groups, adopted, rev){
  const slot=$('mImportSlot'); slot.innerHTML='';
  const box=document.createElement('div'); box.className='m-form';
  const dup=list.filter(function(d){
    return DRUGS.some(function(x){ return x.id===d.id||x.name===d.name; }); }).length;
  box.innerHTML='<div class="fl">'+label+'：'+list.length+'成分'+
    (dup?'（うち'+dup+'件は現在のマスタと重複）':'')+'</div>'+
    '<div class="hint" style="margin-bottom:8px;">「置き換える」は現在のマスタを全部消して入れ替えます。'+
    '「追加のみ」は重複しないものだけを足します。</div>'+
    '<div class="btn-row">'+
      '<button class="btn small" data-a="rep" type="button">置き換える</button>'+
      '<button class="btn ghost small" data-a="add" type="button">追加のみ</button>'+
      '<button class="btn ghost small" data-a="no" type="button">やめる</button>'+
    '</div>';
  slot.appendChild(box);
  box.querySelectorAll('button').forEach(function(b){
    b.addEventListener('click',function(){
      const a=b.dataset.a;
      if(a==='rep'){
        DRUGS=list; if(groups){GROUPS=groups;} if(adopted){ADOPTED=adopted;}
        META.schema=MASTER_SCHEMA;
        if(rev){ META.baseRev=rev; META.editedIds=[]; META.deletedIds=[]; META.groupsEdited=false; }   // 配布マスタ
        else{ META.editedIds=list.map(function(d){return String(d.id);}); META.deletedIds=[]; META.groupsEdited=true; }   // 手元のファイル
        toast('置き換えました');
      }
      else if(a==='add'){
        let n=0;
        list.forEach(function(d){
          if(DRUGS.some(function(x){ return x.id===d.id||x.name===d.name; })) return;
          DRUGS.push(d); n++; if(!rev) markEdited(d.id);
        });
        if(groups){
          groups.forEach(function(g){
            if(GROUPS.some(function(x){return x.id===g.id||x.name===g.name;})) return;
            GROUPS.push(g);
          });
        }
        toast(n?n+'成分を追加しました':'追加するものがありませんでした');
      }
      slot.innerHTML='';
      if(a!=='no'){ MASTER_IS_BUILTIN=false; saveMaster(); renderMasterList(); renderGroupList(); renderRps(); }
    });
  });
}

function fetchDefaults(silent){
  if(typeof fetch!=='function'){
    if(!silent) toast('この環境では取得できません');
    return Promise.resolve(false);
  }
  return fetch('../drug-master.json?t='+Date.now(),{cache:'no-store'}).then(function(r){
    if(!r.ok) throw new Error('no file');
    return r.json();
  }).then(function(j){
    const list=pickDrugs(j);
    if(!list) throw new Error('bad format');
    const gs=validGroups(j&&j.groups);
    const ad=(j&&Array.isArray(j.adopted))?j.adopted.map(function(x){return safeText(x,160);}):null;
    if(silent){
      DRUGS=list; MASTER_IS_BUILTIN=false;
      if(gs){ GROUPS=gs; }
      if(ad){ ADOPTED=ad; }
      META.baseRev=Number(j&&j.rev)||0; META.editedIds=[]; META.deletedIds=[]; META.groupsEdited=false; META.schema=MASTER_SCHEMA;
      saveShared(); renderRps();
    }else{
      showImportChoice(list,'共通マスタ（drug-master.json）',gs,ad,Number(j&&j.rev)||0);
    }
    return true;
  }).catch(function(){
    if(!silent) toast('drug-master.json が見つかりませんでした');
    return false;
  });
}

/* ================= イベント ================= */
$('weight').value=st.weight||'';
$('weight').addEventListener('input',function(){ st.weight=this.value; saveState(); renderRps(); });
$('addRp').addEventListener('click',function(){ st.rps.push(newRp()); saveState(); renderRps(); });
$('clearAll').addEventListener('click',function(){
  if(!window.confirm('入力内容をすべて消去しますか？'))return;
  st.rps=[newRp()]; st.weight=''; $('weight').value='';
  saveState(); renderRps();
});
$('copyBtn').addEventListener('click',copyMemo);
$('pq').addEventListener('input',renderPickList);
$('sheetClose').addEventListener('click',closePicker);
$('sheet').addEventListener('click',function(e){ if(e.target===this) closePicker(); });
$('basisToggle').addEventListener('click',function(){
  const p=$('basisPanel'); p.classList.toggle('open');
  this.textContent=p.classList.contains('open')?'閉じる':'開く';
});
$('cfgToggle').addEventListener('click',function(){
  const p=$('cfgPanel'); p.classList.toggle('open');
  this.textContent=p.classList.contains('open')?'閉じる':'開く';
  if(p.classList.contains('open')){ renderMasterList(); renderGroupList(); renderAdopted(); }
});
$('mAddBtn').addEventListener('click',function(){openDrugForm(-1);});
$('mResetBtn').addEventListener('click',function(){
  if(!window.confirm('薬剤マスタを初期データに戻します。よろしいですか？'))return;
  DRUGS=JSON.parse(JSON.stringify(DEFAULT_DRUGS));
  META.editedIds=DRUGS.map(function(d){return String(d.id);}); META.deletedIds=[];
  saveMaster();renderMasterList();renderRps();toast('初期データに戻しました');
});
$('adSearch').addEventListener('input',renderAdopted);
$('adClear').addEventListener('click',function(){
  if(!ADOPTED.length) return;
  if(!window.confirm('採用品の設定をすべて解除しますか？（全製剤が候補に戻ります）'))return;
  ADOPTED=[]; saveShared(); renderAdopted(); renderRps(); toast('解除しました');
});
$('gAddBtn').addEventListener('click',function(){openGroupForm(-1);});
$('gResetBtn').addEventListener('click',function(){
  if(!window.confirm('グループを初期データに戻します。よろしいですか？'))return;
  GROUPS=JSON.parse(JSON.stringify(DEFAULT_GROUPS));
  saveGroups(); renderGroupList(); renderRps(); toast('初期データに戻しました');
});
$('mExport').addEventListener('click',exportMaster);
$('mImport').addEventListener('click',function(){ $('mFile').value=''; $('mFile').click(); });
$('mFetchDef').addEventListener('click',function(){ fetchDefaults(false); });
$('mFile').addEventListener('change',function(){
  const f=this.files&&this.files[0]; if(!f) return;
  const rd=new FileReader();
  rd.onload=function(){
    let list=null, gs=null;
    let ad=null;
    try{ const j=JSON.parse(rd.result); list=pickDrugs(j); gs=validGroups(j&&j.groups);
         if(j&&Array.isArray(j.adopted)) ad=j.adopted.map(String); }catch(e){}
    if(!list){ toast('読み込めるマスタが入っていません'); return; }
    showImportChoice(list, f.name, gs, ad);
  };
  rd.readAsText(f);
});

(function(){
  const host=$('tabChips');
  [{v:0.5,l:'0.5錠まで'},{v:1,l:'1錠単位'},{v:0.25,l:'0.25錠まで'}].forEach(function(o){
    const el=document.createElement('div');
    el.className='chip sub'+(o.v===st.stepTab?' active':'');
    el.textContent=o.l;
    el.addEventListener('click',function(){
      st.stepTab=o.v; saveState();
      host.querySelectorAll('.chip').forEach(function(c){c.classList.remove('active');});
      el.classList.add('active');
      renderRps();
    });
    host.appendChild(el);
  });
})();

renderRps();

/* 起動時：配布マスタ（../drug-master.json）を確認する。
   初回はそのまま取り込み、2回目以降は rev が新しいときだけ、端末の編集を残して取り込む */
/* 配布マスタ（../drug-master.json）の自動更新 ― 剤形変更換算・水剤MIX・処方監査ドリル共通
   ファイルの rev が端末のマスタ（baseRev）より新しければ取り込む。
   ・端末で編集した成分（editedIds）と削除した成分（deletedIds）は端末の内容を残す
   ・端末で追加した成分（ファイルにない id）も残す
   ・採用品は端末の設定を優先。薬効グループは端末で編集していなければファイルに合わせる */
// マスタの項目の版。古い版のアプリが新しい項目（上限・対象年齢など）を落として取り込んだ端末でも、同じ rev のまま取り込み直せるようにする
var MASTER_SCHEMA = 5;
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
  // 端末で編集した成分にも、配布マスタで新しく増えた項目（含量の問題用の販売規格 lineup・avoid）は同じ名前の剤形から補う
  var withNewFields = function(ld, fd){
    if(!ld || !Array.isArray(ld.forms) || !Array.isArray(fd.forms)) return ld;
    var c = {}; Object.keys(ld).forEach(function(k){ c[k] = ld[k]; });
    c.forms = ld.forms.map(function(lf){
      var ff = fd.forms.filter(function(x){ return x && lf && x.n === lf.n; })[0];
      if(!ff || !lf || typeof lf !== 'object') return lf;
      var o = {}; Object.keys(lf).forEach(function(k){ o[k] = lf[k]; });
      ['lineup', 'avoid'].forEach(function(k){ if(o[k] === undefined && Array.isArray(ff[k])) o[k] = ff[k].slice(); });
      return o;
    });
    return c;
  };
  var drugs = [];
  fdrugs.forEach(function(fd){
    var id = String(fd.id); inFile[id] = 1;
    if(deleted.indexOf(id) >= 0) return;
    drugs.push((edited.indexOf(id) >= 0 && byId[id]) ? withNewFields(byId[id], fd) : fd);
  });
  // 端末だけにある成分のうち、配布マスタに同じ名前の成分があるものは配布の方に一本化する（同じ薬が2つ並ばないように）
  var nm = function(x){ return String(x || '').normalize('NFKC').replace(/\s+/g, ''); };
  var byName = {}; drugs.forEach(function(d){ byName[nm(d.name)] = String(d.id); });
  var alias = (local.aliases && typeof local.aliases === 'object') ? local.aliases : {};
  local.drugs.forEach(function(ld){
    if(!ld || ld.id == null || inFile[String(ld.id)]) return;
    var same = byName[nm(ld.name)];
    if(same){ alias[String(ld.id)] = same; return; }
    byName[nm(ld.name)] = String(ld.id); drugs.push(ld);
  });
  var fix = function(ids){ var o = []; (Array.isArray(ids) ? ids : []).forEach(function(i){ var k = alias[String(i)] || String(i); if(o.indexOf(k) < 0) o.push(k); }); return o; };
  var lg = Array.isArray(local.groups) ? local.groups : [];
  var base = local.groupsEdited ? lg : fgroups, extra = local.groupsEdited ? fgroups : lg;
  var groups = [];
  // 同じ名前のグループは1つにまとめる（端末のグループ同士は成分を合わせ、配布の同名グループは足さない）
  base.concat(extra).forEach(function(g, i){
    if(!g || typeof g !== 'object') return;
    var hit = null; groups.forEach(function(x){ if(!hit && (x.id === g.id || nm(x.name) === nm(g.name))) hit = x; });
    if(hit){ if(i < base.length) hit.ids = fix(hit.ids.concat(Array.isArray(g.ids) ? g.ids : [])); return; }
    var c = {}; Object.keys(g).forEach(function(k){ c[k] = g[k]; }); c.ids = fix(g.ids); groups.push(c);
  });
  var adopted = (Array.isArray(local.adopted) && local.adopted.length) ? local.adopted
              : ((file && Array.isArray(file.adopted)) ? file.adopted : []);
  var out = {};
  Object.keys(local).forEach(function(k){ out[k] = local[k]; });
  out.version = 1; out.updatedAt = now; out.drugs = drugs; out.groups = groups; out.adopted = adopted;
  out.baseRev = rev; out.editedIds = edited; out.deletedIds = deleted; out.schema = MASTER_SCHEMA; out.aliases = alias;
  return out;
}

function autoUpdateMaster(){
  if(location.protocol.indexOf('http')!==0||typeof fetch!=='function') return;
  if(MASTER_IS_BUILTIN){ fetchDefaults(true); return; }
  fetch('../drug-master.json?t='+Date.now(),{cache:'no-store'}).then(function(r){
    if(!r.ok) throw new Error('no file'); return r.json();
  }).then(function(j){
    const rev=Number(j&&j.rev)||0;
    if(!rev||rev<META.baseRev||(rev===META.baseRev&&META.schema>=MASTER_SCHEMA)) return;
    const list=pickDrugs(j); if(!list) return;
    const merged=mergeDistributedMaster({drugs:DRUGS, groups:GROUPS, adopted:ADOPTED,
      editedIds:META.editedIds, deletedIds:META.deletedIds, groupsEdited:META.groupsEdited, aliases:META.aliases},
      {rev:rev, drugs:list, groups:validGroups(j.groups)||[], adopted:Array.isArray(j.adopted)?j.adopted.map(function(x){return safeText(x,160);}):[]});
    DRUGS=merged.drugs; GROUPS=merged.groups.length?merged.groups:GROUPS; ADOPTED=merged.adopted; META.baseRev=rev; META.schema=MASTER_SCHEMA;
    META.aliases=merged.aliases||{};
    // 一本化した成分を使っている処方の行は、残した方の成分に付け替える
    st.rps.forEach(function(rp){ (rp.items||[]).forEach(function(it){
      if(it&&Object.prototype.hasOwnProperty.call(META.aliases,String(it.drugId))) it.drugId=META.aliases[String(it.drugId)];
    }); });
    saveState(); saveShared(); renderRps();
    if($('cfgPanel').classList.contains('open')){ renderMasterList(); renderGroupList(); renderAdopted(); }
    toast('共通マスタを最新版に更新しました');
  }).catch(function(){});
}
autoUpdateMaster();

/* PWA: Service Worker 登録 */
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').catch(function(){});
  });
}
