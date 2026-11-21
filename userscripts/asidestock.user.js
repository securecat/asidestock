// ==UserScript==
// @name         asidestock
// @namespace    https://github.com/securecat/asidestock
// @version      1.0.0
// @description  Picks up option lists that Claude writes in a JSON notation and keeps them in a small panel beside the chat.
// @description:ja Claudeが決まったJSON記法で出した案リストを拾って、チャットの脇の小さなパネルにためておく
// @author       https://github.com/securecat
// @updateURL    https://raw.githubusercontent.com/securecat/asidestock/main/userscripts/asidestock.user.js
// @downloadURL  https://raw.githubusercontent.com/securecat/asidestock/main/userscripts/asidestock.user.js
// @match        https://claude.ai/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ---------- 設定 ----------
  const HIDE_RAW_BLOCKS = true; // チャット内のJSONブロックを畳んでバッジに置き換えるか
  const KIND_DEF = 'options';
  const KIND_OP = 'options-op';

  // ---------- 言語 ----------
  // ブラウザの第一言語が日本語なら日本語、それ以外は英語
  const firstLang = ((navigator.languages && navigator.languages[0]) || navigator.language || 'en').toLowerCase();
  const LANG = firstLang.startsWith('ja') ? 'ja' : 'en';

  const STR = {
    ja: {
      count: n => `${n}件`,
      collapse: 'たたむ',
      expand: 'ひらく',
      dragHint: 'ドラッグで移動、ダブルクリックで定位置に戻す',
      empty: 'この会話の案はまだありません。Claudeが案を出すとここに並びます。',
      listTitle: '案リストの見出し',
      hideList: 'この案リストを隠す（Claudeが再び触れると戻ります）',
      focusItem: id => `案${id}に注目`,
      doneItem: id => `案${id}を完了`,
      itemTitle: id => `案${id}のタイトル`,
      itemDesc: id => `案${id}のメモ`,
      addItem: '＋ 案を足す',
      newItem: '新しい案',
      placeholder: 'メモを書く',
      badgeDef: t => `📋 案リスト「${t}」をasidestockに追加`,
      badgeOp: d => `📋 asidestockを更新：${d}`,
      badgeTitle: 'クリックで元のJSONを表示／非表示',
      opFocus: id => `案${id}に注目`,
      opDone: ids => `案${ids}を完了`,
      opUndone: ids => `案${ids}を未完了に`,
      opAdd: ids => `案${ids}を追加`,
      opJoin: '・',
      opSep: '／',
      opNone: '更新',
    },
    en: {
      count: n => (n === 1 ? '1 list' : `${n} lists`),
      collapse: 'Collapse',
      expand: 'Expand',
      dragHint: 'Drag to move, double-click to reset position',
      empty: 'No options in this chat yet. They’ll appear here when Claude suggests some.',
      listTitle: 'List heading',
      hideList: 'Hide this list (it comes back when Claude updates it)',
      focusItem: id => `Focus on option ${id}`,
      doneItem: id => `Mark option ${id} as done`,
      itemTitle: id => `Title of option ${id}`,
      itemDesc: id => `Note for option ${id}`,
      addItem: '+ Add option',
      newItem: 'New option',
      placeholder: 'Add a note',
      badgeDef: t => `📋 Added “${t}” to asidestock`,
      badgeOp: d => `📋 asidestock updated: ${d}`,
      badgeTitle: 'Click to show or hide the raw JSON',
      opFocus: id => `focus on ${id}`,
      opDone: ids => `marked ${ids} done`,
      opUndone: ids => `marked ${ids} not done`,
      opAdd: ids => `added ${ids}`,
      opJoin: ', ',
      opSep: '; ',
      opNone: 'updated',
    },
  };
  const T = STR[LANG];

  let convId = null;
  let state = null;
  let scanTimer = null;
  let host, root, panel, minBtn;

  // ---------- 保存 ----------
  const emptyState = () => ({ sets: {}, setOrder: [], applied: [] });
  function load(id) {
    try {
      const raw = GM_getValue('conv:' + id, null);
      return raw ? JSON.parse(raw) : emptyState();
    } catch { return emptyState(); }
  }
  function save() {
    if (convId && state) GM_setValue('conv:' + convId, JSON.stringify(state));
  }
  const ui = (() => { try { return JSON.parse(GM_getValue('ui', '{}')); } catch { return {}; } })();
  const saveUi = () => GM_setValue('ui', JSON.stringify(ui));

  function currentConvId() {
    const m = location.pathname.match(/\/chat\/([0-9a-f-]{8,})/i);
    return m ? m[1] : null;
  }

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

  // ---------- 記法の読み取り ----------
  function tryParse(text) {
    const a = text.indexOf('{');
    const b = text.lastIndexOf('}');
    if (a < 0 || b <= a) return null;
    try {
      const obj = JSON.parse(text.slice(a, b + 1));
      if (obj && (obj.kind === KIND_DEF || obj.kind === KIND_OP) && typeof obj.set === 'string') return obj;
    } catch { /* 書きかけ・別物は無視 */ }
    return null;
  }

  function ensureSet(id, title) {
    if (!state.sets[id]) {
      state.sets[id] = { title: title || id, titleEdited: false, items: {}, order: [], focus: null, hidden: false };
    }
    const s = state.sets[id];
    if (title && !s.titleEdited) s.title = title;
    s.hidden = false;
    return s;
  }

  function upsertItem(s, it) {
    if (!it || it.id == null) return;
    const id = String(it.id);
    if (!s.items[id]) {
      s.items[id] = { title: '', desc: '', done: false, edited: false };
      s.order.push(id);
    }
    const x = s.items[id];
    if (!x.edited) { // ユーザーが手で直した案は上書きしない
      if (it.title != null) x.title = String(it.title);
      if (it.desc != null) x.desc = String(it.desc);
    }
  }

  function applyBlock(o) {
    const s = ensureSet(o.set, o.title);
    if (o.kind === KIND_DEF) {
      arr(o.items).forEach(it => upsertItem(s, it));
    } else {
      arr(o.add).forEach(it => upsertItem(s, it));
      if (o.focus != null) s.focus = String(o.focus);
      arr(o.done).forEach(id => { const x = s.items[String(id)]; if (x) x.done = true; });
      arr(o.undone).forEach(id => { const x = s.items[String(id)]; if (x) x.done = false; });
    }
    // 最後に触れた案リストを一番上へ
    state.setOrder = [o.set, ...state.setOrder.filter(k => k !== o.set)];
  }

  function describeOp(o) {
    const p = [];
    if (o.focus != null) p.push(T.opFocus(o.focus));
    if (o.done != null) p.push(T.opDone(arr(o.done).join(T.opJoin)));
    if (o.undone != null) p.push(T.opUndone(arr(o.undone).join(T.opJoin)));
    if (o.add != null) p.push(T.opAdd(arr(o.add).map(x => x && x.id).join(T.opJoin)));
    return p.join(T.opSep) || T.opNone;
  }

  function collapseBlock(pre, obj) {
    if (pre.dataset.asidestockDone) return;
    pre.dataset.asidestockDone = '1';
    // 言語ラベルやコピーボタンを含む外枠まで遡る
    let box = pre;
    const preLen = (pre.textContent || '').length;
    for (let i = 0; i < 4; i++) {
      const p = box.parentElement;
      if (!p) break;
      const extra = (p.textContent || '').length - preLen;
      if (extra > 40 || p.querySelectorAll('pre').length > 1) break;
      box = p;
    }
    if (!box.parentElement) return;
    const badge = document.createElement('div');
    badge.textContent = obj.kind === KIND_DEF ? T.badgeDef(obj.title || obj.set) : T.badgeOp(describeOp(obj));
    badge.title = T.badgeTitle;
    badge.style.cssText =
      'display:inline-block;margin:6px 0;padding:3px 10px;font-size:12px;opacity:.7;' +
      'border:1px dashed currentColor;border-radius:999px;cursor:pointer;user-select:none;';
    badge.addEventListener('click', () => {
      box.style.display = box.style.display === 'none' ? '' : 'none';
    });
    box.style.display = 'none';
    box.parentElement.insertBefore(badge, box);
  }

  function scan() {
    if (!convId || !state) return;
    const seen = {};
    let changed = false;
    document.querySelectorAll('pre').forEach(pre => {
      const code = pre.querySelector('code') || pre;
      const text = code.textContent || '';
      if (!text.includes('"kind"')) return;
      const obj = tryParse(text);
      if (!obj) return;
      const h = hash(JSON.stringify(obj));
      seen[h] = (seen[h] || 0) + 1;
      const key = h + '#' + seen[h];
      if (!state.applied.includes(key)) {
        applyBlock(obj);
        state.applied.push(key);
        changed = true;
      }
      if (HIDE_RAW_BLOCKS) collapseBlock(pre, obj);
    });
    if (changed) { save(); render(); }
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 600); // ストリーミング中は落ち着くまで待つ
  }

  // ---------- パネル ----------
  const CSS = `
    :host { all: initial; }
    #asidestock-panel {
      --bg:#FCFCFD; --ink:#1A1A1A; --muted:#666666; --line:#E3E6EB; --frame:#767676;
      --accent:#2F6F8F; --accent-soft:#EAF2F6;
      position:fixed; width:300px; max-height:70vh; display:flex; flex-direction:column;
      background:var(--bg); color:var(--ink); border:1px solid var(--frame); border-radius:12px;
      box-shadow:0 6px 24px rgba(15,20,30,.14);
      font:13px/1.5 system-ui,-apple-system,"Hiragino Sans","Noto Sans JP",sans-serif;
      overflow:hidden;
    }
    @media (prefers-color-scheme: dark) {
      #asidestock-panel { --bg:#22252B; --ink:#FFFFFF; --muted:#CCCCCC; --line:#343843; --frame:#949494;
               --accent:#7FB8D4; --accent-soft:#2A3640; box-shadow:0 6px 24px rgba(0,0,0,.4); }
    }
    header { display:flex; align-items:center; gap:8px; padding:8px 10px; cursor:move;
             border-bottom:1px solid var(--line); user-select:none; }
    h2 { margin:0; flex:1; min-width:0; display:flex; align-items:baseline; gap:6px;
         font-size:13px; font-weight:600; line-height:1.5; }
    .count { color:var(--muted); font-size:12px; font-weight:400; }
    button { background:none; border:none; color:var(--muted); cursor:pointer; font:inherit; padding:2px 6px; border-radius:6px; }
    button:hover { color:var(--accent); }
    button:focus-visible, input:focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
    .min-btn { flex:none; width:24px; height:24px; padding:0; display:grid; place-items:center;
               border:1px solid var(--ink); color:var(--ink); font-size:16px; line-height:1; }
    .min-btn:hover { color:var(--ink); background:var(--accent-soft); }
    .body { overflow:auto; padding:6px 8px 10px; }
    #asidestock-panel.min .body { display:none; }
    #asidestock-panel.min header { border-bottom:none; }
    .set + .set { border-top:1px solid var(--line); margin-top:6px; padding-top:6px; }
    .set-head { display:flex; align-items:center; gap:6px; padding:4px 2px; }
    .set-title { font-weight:600; flex:1; }
    .item { display:grid; grid-template-columns:auto 1fr auto; gap:6px; align-items:start;
            padding:6px; border-radius:8px; border-left:3px solid transparent; }
    .item.focus { background:var(--accent-soft); border-left-color:var(--accent); }
    .item.done .item-title, .item.done .desc { text-decoration:line-through; color:var(--muted); }
    .tag { font-weight:600; color:var(--accent); margin-right:6px; }
    .desc { color:var(--muted); font-size:12px; white-space:pre-wrap; }
    .desc:empty::before { content:attr(data-placeholder); opacity:.7; }
    [contenteditable]:focus { outline:2px solid var(--accent); outline-offset:1px; border-radius:4px; }
    input { accent-color:var(--accent); margin-top:3px; cursor:pointer; }
    .add { font-size:12px; margin-top:2px; }
    .empty { color:var(--muted); font-size:12px; margin:6px 2px; }
  `;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function editable(node, label, onSave, multiline) {
    node.contentEditable = 'plaintext-only';
    node.spellcheck = false;
    node.setAttribute('role', 'textbox');
    node.setAttribute('aria-label', label);
    if (multiline) node.setAttribute('aria-multiline', 'true');
    const before = node.textContent;
    const stop = e => e.stopPropagation(); // claude.ai側のショートカットに入力を取られないように
    node.addEventListener('keydown', e => {
      stop(e);
      if (e.key === 'Enter' && !e.isComposing && (!multiline || e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        node.blur();
      }
    });
    node.addEventListener('keyup', stop);
    node.addEventListener('keypress', stop);
    node.addEventListener('blur', () => {
      const v = node.textContent.trim();
      if (v !== before) { onSave(v); save(); }
    });
  }

  function nextId(s) {
    for (let c = 65; c < 91; c++) {
      const k = String.fromCharCode(c);
      if (!s.items[k]) return k;
    }
    return String(s.order.length + 1);
  }

  function renderSet(sid, s) {
    const sec = el('section', 'set');
    const head = el('div', 'set-head');
    const t = el('div', 'set-title', s.title);
    editable(t, T.listTitle, v => { s.title = v; s.titleEdited = true; });
    const hide = el('button', '', '×');
    hide.type = 'button';
    hide.title = T.hideList;
    hide.setAttribute('aria-label', T.hideList);
    hide.addEventListener('click', () => { s.hidden = true; save(); render(); });
    head.append(t, hide);
    sec.append(head);

    s.order.forEach(id => {
      const it = s.items[id];
      const row = el('div', 'item' + (s.focus === id ? ' focus' : '') + (it.done ? ' done' : ''));

      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'f-' + sid;
      radio.checked = s.focus === id;
      radio.title = T.focusItem(id);
      radio.setAttribute('aria-label', T.focusItem(id));
      radio.addEventListener('change', () => { s.focus = id; save(); render(); });

      const main = el('div', 'main');
      const line = el('div');
      const title = el('span', 'item-title', it.title);
      editable(title, T.itemTitle(id), v => { it.title = v; it.edited = true; });
      line.append(el('span', 'tag', id), title);
      const desc = el('div', 'desc', it.desc);
      desc.dataset.placeholder = T.placeholder;
      editable(desc, T.itemDesc(id), v => { it.desc = v; it.edited = true; }, true);
      main.append(line, desc);

      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = it.done;
      cb.title = T.doneItem(id);
      cb.setAttribute('aria-label', T.doneItem(id));
      cb.addEventListener('change', () => { it.done = cb.checked; save(); render(); });

      row.append(radio, main, cb);
      sec.append(row);
    });

    const add = el('button', 'add', T.addItem);
    add.type = 'button';
    add.addEventListener('click', () => {
      const id = nextId(s);
      s.items[id] = { title: T.newItem, desc: '', done: false, edited: true };
      s.order.push(id);
      save();
      render();
    });
    sec.append(add);
    return sec;
  }

  function render() {
    if (!panel) return;
    host.style.display = convId ? '' : 'none';
    const body = root.querySelector('.body');
    body.textContent = '';
    const ids = state ? state.setOrder.filter(k => state.sets[k] && !state.sets[k].hidden) : [];
    root.querySelector('.count').textContent = ids.length ? T.count(ids.length) : '';
    if (!ids.length) {
      body.append(el('p', 'empty', T.empty));
      return;
    }
    ids.forEach(sid => body.append(renderSet(sid, state.sets[sid])));
  }

  function placePanel() {
    if (ui.pos) {
      panel.style.left = Math.min(ui.pos.x, innerWidth - 80) + 'px';
      panel.style.top = Math.min(ui.pos.y, innerHeight - 40) + 'px';
      panel.style.right = 'auto';
    } else {
      panel.style.left = '';
      panel.style.right = '16px';
      panel.style.top = '72px';
    }
    const min = !!ui.min;
    panel.classList.toggle('min', min);
    minBtn.textContent = min ? '+' : '−';
    minBtn.title = min ? T.expand : T.collapse;
    minBtn.setAttribute('aria-label', min ? T.expand : T.collapse);
    minBtn.setAttribute('aria-expanded', String(!min));
  }

  function buildPanel() {
    host = document.createElement('div');
    host.id = 'asidestock-host';
    document.body.appendChild(host);
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML =
      `<style>${CSS}</style>` +
      `<aside id="asidestock-panel" lang="${LANG}" aria-labelledby="asidestock-title">` +
      `<header title="${T.dragHint}">` +
      `<h2><span class="title" id="asidestock-title">asidestock</span> <span class="count"></span></h2>` +
      `<button type="button" class="min-btn" aria-controls="asidestock-body"></button>` +
      `</header>` +
      `<div class="body" id="asidestock-body"></div>` +
      `</aside>`;
    panel = root.querySelector('#asidestock-panel');
    minBtn = root.querySelector('.min-btn');
    const header = root.querySelector('header');

    minBtn.addEventListener('click', () => {
      ui.min = !ui.min;
      saveUi();
      placePanel();
    });

    header.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;
      const r = panel.getBoundingClientRect();
      const dx = e.clientX - r.left;
      const dy = e.clientY - r.top;
      const move = ev => {
        const x = Math.min(Math.max(0, ev.clientX - dx), innerWidth - 80);
        const y = Math.min(Math.max(0, ev.clientY - dy), innerHeight - 40);
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
        panel.style.right = 'auto';
        ui.pos = { x, y };
      };
      const up = () => {
        removeEventListener('pointermove', move);
        removeEventListener('pointerup', up);
        saveUi();
      };
      addEventListener('pointermove', move);
      addEventListener('pointerup', up);
    });

    // ダブルクリックで定位置に戻す
    header.addEventListener('dblclick', e => {
      if (e.target.closest('button')) return;
      delete ui.pos;
      saveUi();
      placePanel();
    });

    placePanel();
  }

  // ---------- 会話の切り替え監視 ----------
  function syncConversation() {
    const id = currentConvId();
    if (id === convId) return;
    convId = id;
    state = id ? load(id) : null;
    render();
    scheduleScan();
  }

  buildPanel();
  syncConversation();
  setInterval(syncConversation, 800);
  new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true, characterData: true });
})();
