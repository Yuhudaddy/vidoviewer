import {formatBytes} from './core/format.js';
// 主畫面：最近／收藏／資料庫三個分頁，塊狀或條列，每頁 20 筆，條列可左滑收藏或刪除；可依檔名搜尋目前分頁。
import {listDrawings, setFavorite, softDelete, restoreDrawing, purgeIfDeleted, UNDO_MS} from './library.js';

const $ = id => document.getElementById(id);
const VIEW_KEY = 'vidoviewer-view', SESSION_KEY = 'vidoviewer-home';
const SWIPE_START = 10, SWIPE_RATIO = 1.5; // 橫移超過 10px 且大於縱移 1.5 倍才算滑動
const TABS = {
  recent: {empty: '沒有最近開啟的圖面', pick: all => all.filter(r => r.openedAt).sort((a, b) => b.openedAt - a.openedAt)},
  favorites: {empty: '沒有收藏', pick: all => all.filter(r => r.favorite)},
  library: {empty: '還沒有圖面', pick: all => all},
};
export const fmtBytes = formatBytes;
const cssNumber = (name, fallback) => { const n = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)); return Number.isFinite(n) ? n : fallback; };
const read = (storage, key) => { try { return storage.getItem(key); } catch { return null; } };
const write = (storage, key, value) => { try { storage.setItem(key, value); } catch {} };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function icon(id, className = 'vv-icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  use.setAttribute('href', '#' + id);
  svg.append(use);
  return svg;
}
function button(className, label) {
  const node = el('button', className);
  node.type = 'button';
  if (label) node.setAttribute('aria-label', label);
  return node;
}

export function initHome({open}) {
  const scroller = $('homeScroll'), list = $('drawingList');
  const saved = (() => { try { return JSON.parse(read(sessionStorage, SESSION_KEY)) || {}; } catch { return {}; } })();
  // state：tab 與 page 跟著這次瀏覽階段，view（塊狀或條列）存在本機
  const state = {tab: TABS[saved.tab] ? saved.tab : null, page: saved.page || 1, view: read(localStorage, VIEW_KEY) === 'list' ? 'list' : 'grid'};
  let records = [], query = '', scrollTop = saved.scroll || 0, openRow = null, swipe = null, swallowClick = false, menuFor = null;
  // pending：還能復原的刪除，id → {timer, page}。每一筆各有自己的 5 秒，互不影響。
  const pending = new Map();
  let toastTimer = 0;

  const remember = () => write(sessionStorage, SESSION_KEY, JSON.stringify({tab: state.tab, page: state.page, scroll: scrollTop}));
  scroller.addEventListener('scroll', () => { if (!$('library').hidden) scrollTop = scroller.scrollTop; closeRow(); closeMenu(); }, {passive: true});
  window.addEventListener('pagehide', remember);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !$('library').hidden) refresh(); }); // 其他分頁可能改過資料

  // ---------- 提示 ----------
  function toast(text, {undo = false, ms = 3000} = {}) {
    if (pending.size && !undo) return; // 還有刪除可復原時，不讓其他訊息蓋掉復原鈕
    clearTimeout(toastTimer);
    $('toastText').textContent = text;
    $('toastUndo').hidden = !undo;
    $('toast').hidden = false;
    if (ms) toastTimer = setTimeout(() => { $('toast').hidden = true; }, ms);
  }
  function hideToast() { clearTimeout(toastTimer); $('toast').hidden = true; }

  // ---------- 清單 ----------
  const meta = r => `${r.format} · ${fmtBytes(r.blob.size)}`;
  function picture(r) { // 開過的圖用小圖；舊紀錄或還沒開過的用文件圖示
    if (typeof r.thumb !== 'string' || !r.thumb.startsWith('data:image/')) return icon('i-doc');
    const img = el('img', 'vv-tile__art');
    img.alt = '';
    img.decoding = 'async';
    img.src = r.thumb;
    img.onerror = () => img.replaceWith(icon('i-doc'));
    return img;
  }
  function tile(r) {
    const wrap = el('div', 'vv-tile'), openButton = button('vv-tile__open drawing-item'), thumb = el('span', 'vv-tile__thumb'), cap = el('span', 'vv-tile__cap');
    wrap.dataset.id = r.id;
    thumb.append(picture(r));
    cap.append(el('span', 'vv-tile__name', r.name), el('span', 'vv-tile__meta', meta(r)));
    openButton.append(thumb, cap);
    const star = button('vv-tile__star', '收藏'), bg = el('span', 'vv-tile__star-bg');
    star.setAttribute('aria-pressed', String(!!r.favorite));
    bg.append(icon('i-star'));
    star.append(bg);
    const more = button('vv-icon-btn is-off vv-tile__more', '更多');
    more.setAttribute('aria-haspopup', 'menu');
    more.append(icon('i-more'));
    wrap.append(openButton, star, more);
    return wrap;
  }
  function row(r) {
    const item = el('li', 'vv-lrow'), actions = el('div', 'vv-lrow__actions'), body = el('div', 'vv-lrow__body'), openButton = button('vv-lrow__open drawing-item');
    item.dataset.id = r.id;
    const fav = button('vv-lrow__action vv-lrow__action--fav'), del = button('vv-lrow__action vv-lrow__action--delete');
    fav.dataset.action = 'favorite';
    fav.append(icon('i-star'), r.favorite ? '取消收藏' : '收藏');
    del.dataset.action = 'delete';
    del.append(icon('t-trash'), '刪除');
    actions.append(fav, del);
    const thumb = el('span', 'vv-lrow__thumb'), main = el('span', 'vv-lrow__main');
    thumb.append(picture(r));
    main.append(el('span', 'vv-lrow__name', r.name), el('span', 'vv-lrow__meta', meta(r)));
    openButton.append(thumb, main);
    body.append(openButton);
    if (r.favorite) { const mark = el('span', 'vv-lrow__fav'); mark.append(icon('i-star')); body.append(mark); }
    item.append(actions, body);
    return item;
  }
  let indicatorGeometry = null, tabColorFrame = 0;
  // 氣泡經過哪個分頁，那個分頁的字就變深色；和圖面 Dock 的白色氣泡同一套做法。
  function syncTabColors() {
    const bubble = $('tabIndicator').getBoundingClientRect();
    for (const tab of document.querySelectorAll('.vv-tab')) {
      const r = tab.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      tab.classList.toggle('is-bubble-over', cx > bubble.left && cx < bubble.right && cy > bubble.top && cy < bubble.bottom);
    }
  }
  function animateTabColors() { syncTabColors(); if ($('tabIndicator').getAnimations().length) tabColorFrame = requestAnimationFrame(animateTabColors); else $('tabs').classList.remove('is-moving'); }
  function updateTabIndicator() {
    const tabs = $('tabs'), selected = tabs.querySelector('[aria-selected="true"]'), indicator = $('tabIndicator');
    if (!selected || tabs.hidden || !tabs.offsetWidth) return;
    cancelAnimationFrame(tabColorFrame);
    const outer = tabs.getBoundingClientRect(), target = selected.getBoundingClientRect();
    const next = {x: target.left - outer.left, width: target.width};
    const previous = indicatorGeometry; indicatorGeometry = next;
    indicator.style.width = `${next.width}px`;
    indicator.style.transform = `translate(${next.x}px, -50%)`;
    indicator.getAnimations().forEach(a => a.cancel());
    if (previous && previous.x !== next.x && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const delta = next.x - previous.x, mid = previous.x + delta / 2, lift = 'calc(-50% - 10px)';
      tabs.classList.add('is-moving');
      indicator.animate([
        {transform: `translate(${previous.x}px, -50%) scale(1)`},
        {transform: `translate(${mid}px, ${lift}) scale(.94, 1.06)`, offset: .48},
        {transform: `translate(${next.x + delta * .055}px, calc(-50% + 2px)) scale(1.06, .94)`, offset: .78},
        {transform: `translate(${next.x}px, -50%) scale(1)`}
      ], {duration: 540, easing: 'cubic-bezier(.2,.65,.2,1)'});
      animateTabColors();
    } else { tabs.classList.remove('is-moving'); syncTabColors(); }
  }
  window.addEventListener('resize', updateTabIndicator);
  function render() {
    const needle = query.trim().toLowerCase(), inTab = TABS[state.tab].pick(records);
    const items = needle ? inTab.filter(r => r.name.toLowerCase().includes(needle)) : inTab, size = cssNumber('--page-size', 20), pages = Math.max(1, Math.ceil(items.length / size));
    state.page = Math.max(1, Math.min(pages, state.page));
    const shown = items.slice((state.page - 1) * size, state.page * size);
    for (const tab of document.querySelectorAll('.vv-tab')) {
      const on = tab.dataset.tab === state.tab;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    updateTabIndicator();
    $('homePanel').setAttribute('aria-labelledby', 'tab-' + state.tab);
    $('viewbar').hidden = !items.length;
    $('searchClear').disabled = !query;
    $('homeCount').textContent = `${items.length} 張圖面`;
    $('viewGrid').setAttribute('aria-pressed', String(state.view === 'grid'));
    $('viewList').setAttribute('aria-pressed', String(state.view === 'list'));
    openRow = null;
    closeMenu();
    const holder = state.view === 'grid' ? el('div', 'vv-grid') : el('ul', 'vv-list');
    holder.append(...shown.map(state.view === 'grid' ? tile : row));
    list.replaceChildren(...(items.length ? [holder] : []));
    $('homeEmpty').hidden = !!items.length;
    $('homeEmpty').textContent = needle && inTab.length ? '找不到符合的圖面' : TABS[state.tab].empty;
    $('pager').hidden = pages < 2;
    $('pageLabel').textContent = `${state.page} / ${pages}`;
    $('pagePrev').disabled = state.page <= 1;
    $('pageNext').disabled = state.page >= pages;
    $('usage').hidden = state.tab !== 'library' || !records.length || !!needle;
    $('usageValue').textContent = fmtBytes(records.reduce((sum, r) => sum + r.blob.size, 0));
    remember();
  }
  async function refresh({keepScroll = true} = {}) {
    const keep = keepScroll ? scrollTop : 0; // 重畫前先記住位置
    try {
      const all = await listDrawings();
      // 上次頁面關閉時還沒過復原時限的刪除：已過時限就真的刪掉，還沒過的在 start() 重新給復原機會
      for (const r of all) if (r.deletedAt && !pending.has(r.id) && Date.now() - r.deletedAt >= UNDO_MS) await purgeIfDeleted(r.id);
      records = all.filter(r => !r.deletedAt && !r.example).sort((a, b) => b.id - a.id); // 內建範例圖不列在清單，只能從使用說明開啟
      if (!state.tab) state.tab = records.some(r => r.openedAt) ? 'recent' : 'library';
      render();
      scroller.scrollTop = scrollTop = keep;
    } catch { toast('無法讀取本機圖面清單'); }
  }
  function go(change) {
    Object.assign(state, change);
    scrollTop = 0;
    render();
    scroller.scrollTop = 0;
  }
  for (const tab of document.querySelectorAll('.vv-tab')) tab.onclick = () => go({tab: tab.dataset.tab, page: 1});
  $('tabs').addEventListener('keydown', e => { // 方向鍵在分頁間移動
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const keys = Object.keys(TABS), next = keys[(keys.indexOf(state.tab) + (e.key === 'ArrowRight' ? 1 : keys.length - 1)) % keys.length];
    go({tab: next, page: 1});
    $('tab-' + next).focus();
  });
  const setView = view => { write(localStorage, VIEW_KEY, view); go({view, page: 1}); };
  $('viewGrid').onclick = () => setView('grid');
  $('viewList').onclick = () => setView('list');
  $('pagePrev').onclick = () => go({page: state.page - 1});
  $('pageNext').onclick = () => go({page: state.page + 1});

  // ---------- 搜尋：依檔名篩選目前分頁，清除後回到原清單 ----------
  function setQuery(text) { query = text; $('searchInput').value = text; go({page: 1}); }
  function closeSearch() {
    $('searchBar').hidden = true;
    $('searchToggle').setAttribute('aria-expanded', 'false');
    if (query) setQuery('');
  }
  $('searchToggle').onclick = () => {
    if (!$('searchBar').hidden) { closeSearch(); return; }
    $('searchBar').hidden = false;
    $('searchToggle').setAttribute('aria-expanded', 'true');
    scroller.scrollTop = scrollTop = 0;
    $('searchInput').focus();
  };
  $('searchInput').addEventListener('input', () => { query = $('searchInput').value; go({page: 1}); });
  $('searchInput').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); closeSearch(); $('searchToggle').focus(); } });
  $('searchClear').onclick = () => { setQuery(''); $('searchInput').focus(); };

  // ---------- 使用說明面板 ----------
  const helpParts = () => [scroller, $('tabs'), $('import'), $('toast'), $('tileMenu')];
  function closeHelp({focus = true} = {}) {
    if ($('helpSheet').hidden) return;
    $('helpSheet').hidden = true;
    for (const node of helpParts()) node.inert = false;
    $('tabs').hidden = $('import').hidden = false; // 面板開著時底部分頁與加號不顯示
    if (focus) $('helpOpen').focus();
  }
  $('helpOpen').onclick = () => {
    closeMenu(); closeRow();
    for (const node of helpParts()) node.inert = true;
    $('tabs').hidden = $('import').hidden = true;
    $('helpSheet').hidden = false;
    $('helpList').scrollTop = 0;
    $('helpClose').focus();
  };
  $('helpClose').onclick = () => closeHelp();
  $('helpSheet').addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); closeHelp(); return; }
    if (e.key !== 'Tab') return; // 焦點留在面板內
    const stops = [$('helpClose'), $('helpList'), $('logout'), $('example')], at = stops.indexOf(document.activeElement);
    e.preventDefault();
    stops[(at + (e.shiftKey ? stops.length - 1 : 1)) % stops.length].focus();
  });
  // 面板開著時其餘區域是 inert，點擊會落在外層，所以掛在 document 上判斷「點面板外」
  document.addEventListener('pointerdown', e => { if (!$('helpSheet').hidden && !e.target.closest('#helpSheet')) closeHelp({focus: false}); });

  // ---------- 收藏、刪除與復原 ----------
  async function toggleFavorite(id) {
    const record = records.find(r => r.id === id);
    if (!record) return;
    await setFavorite(id, !record.favorite);
    await refresh();
  }
  function showPending() { // 多筆待復原合併成一個提示
    if (!pending.size) { hideToast(); return; }
    toast(pending.size > 1 ? `已刪除 ${pending.size} 個` : '已刪除', {undo: true, ms: 0});
  }
  async function expire(id) { // 這一筆的復原時限到了：真的刪除本機副本
    if (!pending.delete(id)) return;
    showPending();
    await purgeIfDeleted(id);
  }
  function arm(id, page, ms) {
    clearTimeout(pending.get(id)?.timer);
    pending.set(id, {page, timer: setTimeout(() => expire(id), ms)});
    showPending();
  }
  async function remove(id) {
    const page = state.page;
    await softDelete(id);
    arm(id, page, UNDO_MS);
    await refresh();
  }
  $('toastUndo').onclick = async () => { // 復原所有還在時限內的刪除
    if (!pending.size) return;
    const entries = [...pending];
    pending.clear();
    hideToast();
    for (const [id, {timer}] of entries) { clearTimeout(timer); await restoreDrawing(id); }
    state.page = entries[entries.length - 1][1].page; // 最後一頁被刪空時頁碼會往前，復原後回到刪除時那一頁
    await refresh();
  };

  // ---------- 塊狀：星號與「更多」選單 ----------
  function closeMenu() {
    if ($('tileMenu').hidden) return;
    $('tileMenu').hidden = true;
    menuFor?.setAttribute('aria-expanded', 'false');
    menuFor = null;
  }
  function openMenu(trigger, id) {
    const record = records.find(r => r.id === id);
    menuFor = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    $('menuFavoriteLabel').textContent = record?.favorite ? '取消收藏' : '收藏';
    $('tileMenu').dataset.id = id;
    $('tileMenu').hidden = false;
    $('menuFavorite').focus();
  }
  $('menuFavorite').onclick = () => { const id = Number($('tileMenu').dataset.id); closeMenu(); toggleFavorite(id); };
  $('menuDelete').onclick = () => { const id = Number($('tileMenu').dataset.id); closeMenu(); remove(id); };
  $('tileMenu').addEventListener('keydown', e => {
    if (e.key === 'Escape') { const trigger = menuFor; closeMenu(); trigger?.focus(); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); (document.activeElement === $('menuFavorite') ? $('menuDelete') : $('menuFavorite')).focus(); }
  });
  document.addEventListener('pointerdown', e => {
    if (!$('tileMenu').hidden && !e.target.closest('#tileMenu, .vv-tile__more')) closeMenu();
    if (openRow && !openRow.contains(e.target)) { // 點其他地方只收合，不開圖
      closeRow();
      if (e.target.closest('.drawing-item')) { swallowClick = true; setTimeout(() => { swallowClick = false; }, 700); }
    }
  }, true);

  // ---------- 條列：左右滑動 ----------
  function closeRow(except) {
    if (openRow && openRow !== except) { openRow.classList.remove('is-open'); openRow = null; }
  }
  function settle(rowNode, opened) {
    rowNode.classList.remove('is-dragging');
    rowNode.style.removeProperty('--vv-dx');
    rowNode.classList.toggle('is-open', opened);
    if (opened) openRow = rowNode; else if (openRow === rowNode) openRow = null;
  }
  list.addEventListener('pointerdown', e => {
    const rowNode = e.target.closest('.vv-lrow');
    if (!rowNode || (e.pointerType === 'mouse' && e.button !== 0)) return; // 展開後從動作鈕上往右滑也要能收合
    swipe = {row: rowNode, id: e.pointerId, x: e.clientX, y: e.clientY, max: cssNumber('--lrow-action-w', 72) * 2, wasOpen: rowNode.classList.contains('is-open'), active: false, offset: 0};
  });
  list.addEventListener('pointermove', e => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y;
    if (!swipe.active) {
      if (Math.abs(dx) > SWIPE_START && Math.abs(dx) > SWIPE_RATIO * Math.abs(dy)) {
        swipe.active = true;
        closeRow(swipe.row);
        swipe.row.classList.add('is-dragging');
        swipe.row.setPointerCapture(e.pointerId);
      } else { if (Math.abs(dy) > SWIPE_START) swipe = null; return; } // 垂直移動交給清單捲動
    }
    swipe.offset = Math.max(-swipe.max, Math.min(0, (swipe.wasOpen ? -swipe.max : 0) + dx));
    swipe.row.style.setProperty('--vv-dx', `${swipe.offset}px`);
  });
  function endSwipe(e, cancelled) {
    if (!swipe || e.pointerId !== swipe.id) return;
    const done = swipe;
    swipe = null;
    if (!done.active) return;
    settle(done.row, cancelled ? done.wasOpen : done.offset < -done.max / 2); // 超過一半（72px）才停在開啟
    swallowClick = true; // 滑動放開後跟著來的 click 不可開圖
    setTimeout(() => { swallowClick = false; }, 350);
  }
  list.addEventListener('pointerup', e => endSwipe(e, false));
  list.addEventListener('pointercancel', e => endSwipe(e, true));
  $('library').addEventListener('click', e => {
    if (!swallowClick) return;
    swallowClick = false;
    e.preventDefault();
    e.stopPropagation();
  }, true);

  list.addEventListener('click', e => {
    const holder = e.target.closest('[data-id]');
    if (!holder) return;
    const id = Number(holder.dataset.id);
    if (e.target.closest('.vv-tile__star')) toggleFavorite(id);
    else if (e.target.closest('.vv-tile__more')) { if (menuFor) closeMenu(); else openMenu(e.target.closest('.vv-tile__more'), id); }
    else if (e.target.closest('[data-action="favorite"]')) toggleFavorite(id);
    else if (e.target.closest('[data-action="delete"]')) remove(id);
    else if (e.target.closest('.drawing-item')) {
      if (holder.classList.contains('is-open')) { closeRow(); return; } // 已展開的列：點一下先收合
      remember();
      open(id);
    }
  });

  return {
    refresh, toast, closeHelp, remove,
    showTab(tab) { state.tab = tab; state.page = 1; },
    async start() {
      await refresh();
      // 上次頁面關閉時還在時限內的刪除：各自用剩下的時間重新提供復原
      for (const r of await listDrawings()) if (r.deletedAt && Date.now() - r.deletedAt < UNDO_MS) arm(r.id, state.page, UNDO_MS - (Date.now() - r.deletedAt));
    },
  };
}
