/* 入口ページ  app.js（index.html から分離。Content-Security-Policy と Trusted Types で、外部・インラインのスクリプトと画面への不正な書き込みを禁止するため） */
'use strict';

/* ============================================================
   ツール一覧
   ============================================================
   新しいアプリを追加したいときは、この配列に1件追加するだけでOK。
   カードのHTML・CSSは書き換える必要はありません。

   各項目：
     href     : アプリの場所（例 './mix/'）
     category : カード右上に出す小さいタグの文字（例 '水剤'）
     title    : カードの見出し
     desc     : 1〜2行の説明文
     icon     : アイコンの種類。下のICONSに用意されているキーを指定。
                未指定・未登録のキーを指定した場合は自動的に既定アイコンになる。
*/
const TOOLS = [
  {
    href: './mix/',
    category: '水剤',
    title: '水剤MIX調製計算',
    desc: '複数の水剤を混合し、1回量が割り切れる単位になるよう賦形量を算出します。',
    icon: 'liquid',
  },
  {
    href: './ontmix/',
    category: '軟膏',
    title: '軟膏ツボ選択',
    desc: '軟膏MIXの配合比を保ったまま、壺の組み合わせと充填量をすばやく算出します。',
    icon: 'ointment',
  },
  {
    href: './dfconv/',
    category: '換算',
    title: '剤形変更 換算',
    desc: '散剤・水剤・錠剤の剤形変更を成分量ベースで換算し、疑義照会メモを作ります。',
    icon: 'convert',
  },
  {
    href: './drill/',
    category: '練習',
    title: '処方監査ドリル',
    desc: '体重・年齢・処方量・製剤量の換算と用量監査をタイムアタックで反復練習します。',
    icon: 'drill',
  },
  // ここに追加していく。例：
  // {
  //   href: './powder/',
  //   category: '散剤',
  //   title: '散剤分包計算',
  //   desc: '散剤の分包量を計算します。',
  //   icon: 'powder',
  // },
];

/* アイコン集。中身は<svg>の中に入れるパス文字列。
   新しいカテゴリのアイコンを増やしたいときは、ここにキーを追加する。
   ICONSに無いキーが指定された場合は自動的に 'default' が使われる。 */
const ICONS = {
  liquid: '<path d="M10.5 2.5h3M11 3v5.2c0 .5-.15.98-.44 1.38L5.9 16.2A3.5 3.5 0 0 0 8.72 21.5h6.56a3.5 3.5 0 0 0 2.82-5.3l-4.66-6.62A2.5 2.5 0 0 1 13 7.2V3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M7.6 15.5h8.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  ointment: '<path d="M8.5 9.2 9.3 4h5.4l.8 5.2" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M7.6 9h8.8l1.1 10.2a1.8 1.8 0 0 1-1.79 2H8.29a1.8 1.8 0 0 1-1.79-2L7.6 9Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 4h6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  powder: '<path d="M6 14.5c0 3.6 2.7 6 6 6s6-2.4 6-6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M4.5 14.5h15" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M12 3v6.2M9.3 6.3 12 9l2.7-2.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  injection: '<path d="m17.5 3.5 3 3M14 7l6 6M4 20l3.2-.6a2 2 0 0 0 1.06-.56L18.2 8.9a1.5 1.5 0 0 0 0-2.12l-1-1a1.5 1.5 0 0 0-2.12 0L5.16 15.74a2 2 0 0 0-.56 1.06L4 20Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  convert: '<path d="M4 9h13.5M14.5 5.8 17.8 9l-3.3 3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M20 15H6.5M9.5 11.8 6.2 15l3.3 3.2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  drill: '<circle cx="12" cy="13.5" r="7" stroke="currentColor" stroke-width="1.6"/><path d="M10 3.5h4M12 3.5v3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="m9.2 13.6 2 2 3.8-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="m17.6 7.4 1.3-1.3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  default: '<rect x="4.5" y="3.5" width="15" height="17" rx="2.2" stroke="currentColor" stroke-width="1.6"/><path d="M8 8h8M8 12h4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};

const ARROW_SVG = '<path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

/* Trusted Types（index.html の Content-Security-Policy で必須にしている）
   画面に書き込める HTML は、上の ICONS・ARROW_SVG から作る決まった SVG だけ。
   Service Worker として登録できるのは sw.js だけ。 */
const SVG_OPEN = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">';
const ALLOWED_HTML = new Set(Object.keys(ICONS).map(function (k) { return SVG_OPEN + ICONS[k] + '</svg>'; })
  .concat(['開く ' + SVG_OPEN + ARROW_SVG + '</svg>']));
let policy = null;
try {
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    policy = window.trustedTypes.createPolicy('portal', {
      createHTML: function (s) { if (ALLOWED_HTML.has(s)) return s; throw new TypeError('blocked html'); },
      createScriptURL: function (u) { if (u === 'sw.js') return u; throw new TypeError('blocked: ' + u); }
    });
  }
} catch (e) { policy = null; }
function html(s) {
  if (policy) return policy.createHTML(s);
  if (!ALLOWED_HTML.has(s)) throw new TypeError('blocked html');
  return s;
}

function renderTools(tools) {
  const shelf = document.getElementById('shelf');
  shelf.replaceChildren();

  if (!tools || tools.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'color:var(--ink-faint);font-size:13px;';
    empty.textContent = 'ツールがまだ登録されていません。';
    shelf.appendChild(empty);
    return;
  }

  tools.forEach(tool => {
    const card = document.createElement('a');
    card.className = 'card';
    card.href = tool.href;

    const tab = document.createElement('div');
    tab.className = 'tab';
    card.appendChild(tab);

    const body = document.createElement('div');
    body.className = 'card-body';

    const top = document.createElement('div');
    top.className = 'card-top';

    const icon = document.createElement('div');
    icon.className = 'icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = html(SVG_OPEN + (ICONS[tool.icon] || ICONS.default) + '</svg>');
    top.appendChild(icon);

    if (tool.category) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = tool.category;
      top.appendChild(tag);
    }
    body.appendChild(top);

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = tool.title;
    body.appendChild(title);

    const desc = document.createElement('p');
    desc.className = 'card-desc';
    desc.textContent = tool.desc || '';
    body.appendChild(desc);

    const go = document.createElement('div');
    go.className = 'go';
    go.innerHTML = html('開く ' + SVG_OPEN + ARROW_SVG + '</svg>');
    body.appendChild(go);

    card.appendChild(body);
    shelf.appendChild(card);
  });
}

renderTools(TOOLS);

/* PWA: Service Worker 登録（このページと同じ階層の sw.js） */
if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register(policy ? policy.createScriptURL('sw.js') : 'sw.js').catch(function(){});
  });
}
