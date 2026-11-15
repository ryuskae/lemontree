// 교재 보기 화면: PDF 표시, 한 쪽/두 쪽 보기, 넘기기, 목차, 진도 저장, 다운로드, 연습 시간 기록

import { h, toast, sheet, $ } from './ui.js';
import { loadPdf } from './pdfsource.js';
import { resolveBookmark, makeBookmark, bookmarkText, sortToc, tocEntryFor } from './core.js';

const pdfjsLib = window.pdfjsLib;
if (pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';

const VIEW_KEY = 'lt-view';
const getViewPref = () => { try { return localStorage.getItem(VIEW_KEY) || 'auto'; } catch { return 'auto'; } };
const setViewPref = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* 무시 */ } };

/**
 * opts: { store, book, role, studentId, studentName, entry(진도 기록), mode('academy'|'home'), onExit }
 */
export async function openReader(root, opts) {
  const { store, role } = opts;
  let book = opts.book;
  const tracking = role !== 'admin' && opts.studentId;

  // 나갈 때 정리할 것들 (화면을 여는 도중에 나가도 안전하도록 맨 위에 둔다)
  const cleanups = [];
  let flushFn = async () => {};
  let pdfDoc = null;
  let exiting = false;
  // viaButton: 화면의 '목록' 버튼으로 나갈 때만 목록 화면으로 이동한다
  async function exit(viaButton = false) {
    if (exiting) return; exiting = true;
    cleanups.forEach((f) => { try { f(); } catch { /* 무시 */ } });
    await flushFn(true);
    pdfDoc?.destroy?.();
    opts.onExit?.(viaButton);
  }

  // ---------- 뼈대 ----------
  const titleSub = h('div', { class: 'r-sub' });
  const pageLabel = h('span', { class: 'r-pagelabel' }, '');
  const slider = h('input', { type: 'range', min: 1, max: 1, value: 1, class: 'r-slider', 'aria-label': '쪽 이동' });
  const stage = h('div', { class: 'r-stage', tabindex: '0' });
  const banner = h('div', { class: 'r-banner hidden' });
  const tocPanel = h('aside', { class: 'r-toc hidden', 'aria-label': '목차' });
  const viewBtn = h('button', { class: 'tool view', title: '보기 방식' });
  const markBtn = h('button', { class: 'tool primary', title: '여기까지 연습했어요' }, '★ 진도', h('span', { class: 'hide-sm' }, ' 저장'));
  const dlBtn = book.downloadable ? h('button', { class: 'tool', title: '교재 내려받기' }, '⬇') : null;
  const addTocBtn = role === 'admin' ? h('button', { class: 'tool', title: '이 쪽을 목차에 추가' }, '목차+') : null;

  const wrap = h('div', { class: 'reader' },
    h('header', { class: 'r-top' },
      h('button', { class: 'tool back', onclick: () => exit(true) }, '‹ 목록'),
      h('div', { class: 'r-title' }, h('div', { class: 'r-name' }, book.title), titleSub),
      h('div', { class: 'r-tools' },
        h('button', { class: 'tool', onclick: () => toggleToc() }, '목차'),
        viewBtn, addTocBtn, dlBtn, tracking ? markBtn : null)),
    banner,
    h('div', { class: 'r-main' }, stage, tocPanel),
    h('footer', { class: 'r-bottom' },
      h('button', { class: 'tool nav', 'aria-label': '이전 쪽', onclick: () => prev() }, '‹'),
      slider, pageLabel,
      h('button', { class: 'tool nav', 'aria-label': '다음 쪽', onclick: () => next() }, '›')));
  root.replaceChildren(wrap);

  const loadingBox = h('div', { class: 'loading' }, h('div', { class: 'spin' }), h('div', { class: 'muted' }, '교재를 여는 중…'));
  stage.append(loadingBox);

  // ---------- PDF 열기 ----------
  let bytes, pdf;
  const handle = { exit };
  try {
    const got = await loadPdf(book, (frac) => {
      loadingBox.lastChild.textContent = frac ? `교재를 내려받는 중… ${Math.round(frac * 100)}%` : '교재를 내려받는 중…';
    });
    bytes = got.data;
    if (got.offline) toast('인터넷이 연결되지 않아 저장된 교재를 엽니다.');
    pdf = await pdfjsLib.getDocument({
      data: new Uint8Array(bytes.slice(0)),
      cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true,
      standardFontDataUrl: 'vendor/pdfjs/standard_fonts/',
    }).promise;
    pdfDoc = pdf;
  } catch (e) {
    stage.replaceChildren(h('div', { class: 'r-error' },
      h('p', null, e.message || '교재를 열 수 없습니다.'),
      h('button', { class: 'btn', onclick: () => exit(true) }, '목록으로')));
    return handle;
  }
  const n = pdf.numPages;
  slider.max = n;

  if (role === 'admin' && book.numPages !== n) {
    book.numPages = n;
    store.updateBook(book.id, { numPages: n }).catch(() => {});
  }

  // ---------- 진도 ----------
  let entry = opts.entry || {};
  const resolved = resolveBookmark(entry.bm, book, n);
  // 목차가 고쳐져 쪽이 옮겨졌으면 화면에는 새 쪽 번호를 보여준다
  if (resolved?.status === 'ok' && resolved.page !== entry.bm.page) entry = { ...entry, bm: { ...entry.bm, page: resolved.page } };
  let start = 1;
  if (resolved && resolved.status === 'ok') start = resolved.page;
  else if (entry.lastPage && entry.lastPage <= n) start = entry.lastPage;

  const showBanner = (content, kind = '', autoHide = 0) => {
    banner.className = 'r-banner ' + kind;
    banner.replaceChildren(h('div', { class: 'r-banner-text' }, content),
      h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => banner.classList.add('hidden') }, '✕'));
    if (autoHide) setTimeout(() => banner.classList.add('hidden'), autoHide);
  };
  const updateSub = () => {
    titleSub.textContent = entry.bm ? `내 진도: ${bookmarkText(entry.bm)}` : (tracking ? '아직 저장한 진도가 없어요' : `${n}쪽`);
  };
  updateSub();

  if (resolved && resolved.status === 'ok') {
    showBanner(`지난 진도로 이동했어요: ${bookmarkText(entry.bm)}`, 'ok', 4000);
  } else if (resolved && resolved.status === 'unsure') {
    showBanner(h('span', null, `교재가 바뀌어서 진도 위치가 달라졌을 수 있어요. 지난 진도: ${bookmarkText(entry.bm)} `,
      h('button', { class: 'linkish', onclick: () => { go(resolved.page); banner.classList.add('hidden'); } }, `${resolved.page}쪽으로 가기`)), 'warn');
  } else if (resolved && resolved.status === 'missing') {
    showBanner(`지난 진도: ${bookmarkText(entry.bm)} — 교재가 바뀌어 이 단원을 찾을 수 없어요. 선생님께 확인해 주세요.`, 'warn');
  }

  // ---------- 보기 방식 ----------
  let viewPref = getViewPref();
  const isTwo = () => {
    if (n < 2) return false;
    if (viewPref === '1') return false;
    if (viewPref === '2') return true;
    const r = stage.getBoundingClientRect();
    return r.width > r.height * 1.15 && r.width >= 700;
  };
  const viewLabel = () => ({ auto: '자동 보기', 1: '한 쪽', 2: '두 쪽' }[viewPref]);
  viewBtn.textContent = viewLabel();
  viewBtn.onclick = () => {
    viewPref = { auto: '1', 1: '2', 2: 'auto' }[viewPref];
    setViewPref(viewPref); viewBtn.textContent = viewLabel(); toast(viewLabel());
    clearCache(); show();
  };

  // 두 쪽 보기에서 왼쪽 쪽 번호
  const leftOf = (p) => {
    if (!isTwo()) return p;
    if (book.coverSingle) return p === 1 ? 1 : (p % 2 === 0 ? p : p - 1);
    return p % 2 === 1 ? p : p - 1;
  };
  const visible = (p) => {
    const l = leftOf(p);
    if (!isTwo() || (book.coverSingle && l === 1) || l + 1 > n) return [l];
    return [l, l + 1];
  };

  // ---------- 그리기 ----------
  const cache = new Map();
  const clearCache = () => cache.clear();
  let page = start;
  let token = 0;

  async function renderPage(p, boxW, boxH) {
    const key = `${p}@${boxW}x${boxH}`;
    if (cache.has(key)) return cache.get(key);
    const job = (async () => {
      const pg = await pdf.getPage(p);
      const v1 = pg.getViewport({ scale: 1 });
      const scale = Math.min(boxW / v1.width, boxH / v1.height);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const vp = pg.getViewport({ scale: scale * dpr });
      const c = h('canvas', { class: 'r-page' });
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = Math.floor(v1.width * scale) + 'px';
      c.style.height = Math.floor(v1.height * scale) + 'px';
      await pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
      return c;
    })();
    cache.set(key, job);
    if (cache.size > 10) cache.delete(cache.keys().next().value);
    return job;
  }

  function boxSize(count) {
    const r = stage.getBoundingClientRect();
    const gap = count === 2 ? 4 : 0;
    return [Math.max(50, Math.floor((r.width - 16 - gap) / count)), Math.max(50, Math.floor(r.height - 16))];
  }

  async function show() {
    const my = ++token;
    const pages = visible(page);
    page = pages[0];
    const [bw, bh] = boxSize(isTwo() ? 2 : 1);
    slider.value = page;
    pageLabel.textContent = pages.length === 2 ? `${pages[0]}–${pages[1]} / ${n}` : `${pages[0]} / ${n}`;
    highlightToc();
    track(pages);
    let canvases;
    try { canvases = await Promise.all(pages.map((p) => renderPage(p, bw, bh))); } catch { return; }
    if (my !== token) return;
    const spread = h('div', { class: 'r-spread' + (pages.length === 2 ? ' two' : '') }, canvases);
    stage.replaceChildren(spread);
    // 다음·이전 쪽을 미리 그려 둔다
    const ahead = visible(Math.min(n, pages[pages.length - 1] + 1));
    const behind = visible(Math.max(1, pages[0] - 1));
    setTimeout(() => { if (my === token) [...ahead, ...behind].forEach((p) => renderPage(p, bw, bh).catch(() => {})); }, 120);
  }

  const go = (p) => { const np = Math.max(1, Math.min(n, p)); if (leftOf(np) !== page || np !== page) { page = np; show(); } };
  const next = () => { const v = visible(page); if (v[v.length - 1] < n) { page = v[v.length - 1] + 1; show(); } };
  const prev = () => { if (page > 1) { page = visible(page - 1)[0]; show(); } };

  slider.oninput = () => { pageLabel.textContent = `${slider.value} / ${n}`; };
  slider.onchange = () => go(+slider.value);

  // 넘기기: 화면 왼쪽·오른쪽 누르기, 밀기, 키보드
  let down = null;
  stage.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  stage.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = Date.now() - down.t;
    down = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { dx < 0 ? next() : prev(); return; }
    if (dt < 400 && Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const r = stage.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      if (fx < 0.3) prev(); else if (fx > 0.7) next();
    }
  });
  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next(); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); }
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  let resizeTimer;
  const ro = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { clearCache(); show(); }, 150); });
  ro.observe(stage);
  cleanups.push(() => ro.disconnect());

  // ---------- 목차 ----------
  function buildToc() {
    const toc = sortToc(book.toc);
    tocPanel.replaceChildren(
      h('div', { class: 'r-toc-head' }, h('strong', null, '목차'), h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => toggleToc(false) }, '✕')),
      toc.length
        ? h('ol', { class: 'r-toc-list' }, toc.map((e) => h('li', null,
          h('button', { 'data-p': e.p, onclick: () => { go(e.p); if (window.innerWidth < 900) toggleToc(false); } },
            h('span', null, e.t), h('span', { class: 'muted' }, `${e.p}`)))))
        : h('p', { class: 'muted pad' }, '목차가 없는 교재입니다. 아래 막대로 쪽을 옮겨 주세요.'),
      entry.bm ? h('div', { class: 'r-toc-mark' }, h('div', { class: 'muted' }, '내 진도'),
        h('button', { class: 'linkish', onclick: () => { const r = resolveBookmark(entry.bm, book, n); if (r && r.page) go(r.page); } }, bookmarkText(entry.bm))) : null);
    highlightToc();
  }
  function highlightToc() {
    const e = tocEntryFor(book.toc, page);
    tocPanel.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('on', !!e && +b.dataset.p === e.p));
  }
  function toggleToc(force) {
    const open = force ?? tocPanel.classList.contains('hidden');
    tocPanel.classList.toggle('hidden', !open);
  }
  buildToc();

  // ---------- 진도 저장 ----------
  async function saveMark(p) {
    const bm = makeBookmark(book, p, n);
    entry = { ...entry, bm };
    updateSub(); buildToc();
    try {
      await store.saveBookmark(opts.studentId, book.id, bm);
      toast(`진도를 저장했어요: ${bookmarkText(bm)}`, 'good');
    } catch (e) { toast('진도를 저장하지 못했어요. 인터넷 연결을 확인해 주세요.', 'bad'); }
  }
  markBtn.onclick = () => {
    const v = visible(page);
    if (v.length === 1) return saveMark(v[0]);
    sheet((body, close) => {
      body.append(h('p', { class: 'sheet-msg' }, '어느 쪽까지 연습했나요?'),
        h('div', { class: 'row' }, v.map((p) => h('button', { class: 'btn primary big', onclick: () => { close(); saveMark(p); } },
          `${p}쪽`, h('small', null, tocEntryFor(book.toc, p)?.t || '')))));
    }, { title: '진도 저장' });
  };

  if (dlBtn) {
    dlBtn.onclick = () => {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
      const a = h('a', { href: url, download: `${book.title}.pdf` });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    };
  }

  if (addTocBtn) {
    addTocBtn.onclick = () => sheet((body, close) => {
      const input = h('input', { class: 'input', placeholder: '예: 2단원 연습곡 3', value: '' });
      const p = visible(page)[0];
      body.append(h('p', { class: 'sheet-msg' }, `${p}쪽에서 시작하는 목차 항목을 추가합니다.`), input,
        h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: async () => {
          const t = input.value.trim(); if (!t) return;
          const toc = sortToc([...(book.toc || []).filter((e) => e.p !== p), { t, p }]);
          book = { ...book, toc, tocPages: n };
          await store.updateBook(book.id, { toc, tocPages: n });
          buildToc(); close(); toast('목차에 추가했어요.', 'good');
        } }, '추가')));
      setTimeout(() => input.focus(), 50);
    }, { title: '목차 추가' });
  }

  // ---------- 연습 기록 ----------
  let sessionId = null, seconds = 0, minPage = null, maxPage = null, lastSavedPage = null, dirty = false;
  const seen = new Set();
  function track(pages) {
    if (!tracking) return;
    pages.forEach((p) => { seen.add(p); minPage = minPage === null ? p : Math.min(minPage, p); maxPage = maxPage === null ? p : Math.max(maxPage, p); });
    dirty = true;
  }
  async function flush(final) {
    if (!tracking) return;
    if (sessionId) await store.updateSession(sessionId, { seconds, minPage, maxPage, pagesSeen: seen.size, end: Date.now() }).catch(() => {});
    if (page !== lastSavedPage || final) { lastSavedPage = page; await store.saveLastPage(opts.studentId, book.id, page).catch(() => {}); }
    dirty = false;
  }
  let tick = null, flushTimer = null;
  const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
  if (tracking) {
    store.startSession({ sid: opts.studentId, name: opts.studentName, kind: 'read', bookId: book.id, bookTitle: book.title, mode: opts.mode })
      .then((id) => { sessionId = id; }).catch(() => {});
    store.touchStudent(opts.studentId);
    tick = setInterval(() => { if (document.visibilityState === 'visible') seconds++; }, 1000);
    flushTimer = setInterval(() => { if (dirty || document.visibilityState === 'visible') flush(); }, 60000);
    document.addEventListener('visibilitychange', onVis);
    cleanups.push(() => { clearInterval(tick); clearInterval(flushTimer); document.removeEventListener('visibilitychange', onVis); });
  }
  flushFn = flush;

  stage.focus();
  show();
  return handle;
}
