// 교재 보기 화면: PDF 표시, 한 쪽/두 쪽 보기, 전체보기, 넘기기, 목차, 진도 저장, 좋아요, 다운로드, 연습 시간 기록

import { h, toast, sheet, icon } from './ui.js';
import { loadPdf } from './pdfsource.js';
import { resolveBookmark, makeBookmark, sortToc, tocEntryFor, songAt, progressLabel } from './core.js';

const pdfjsLib = window.pdfjsLib;
if (pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs/pdf.worker.min.js';

const VIEW_KEY = 'lt-view';
const getViewPref = () => { try { return localStorage.getItem(VIEW_KEY) || ''; } catch { return ''; } };
const setViewPref = (v) => { try { localStorage.setItem(VIEW_KEY, v); } catch { /* 무시 */ } };

/**
 * opts: { store, book, role, studentId, studentName, entry(진도 기록), likes(내 좋아요 목록), mode('academy'|'home'), onExit }
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
  const handle = { exit };

  // ---------- 뼈대 ----------
  const tool = (ic, label, attrs = {}) => h('button', { class: 'tool', title: label, 'aria-label': label, ...attrs }, icon(ic), h('span', { class: 'tool-label' }, label));
  const titleSub = h('div', { class: 'r-sub' });
  const pageLabel = h('span', { class: 'r-pagelabel' }, '');
  const slider = h('input', { type: 'range', min: 1, max: 1, value: 1, class: 'r-slider', 'aria-label': '쪽 이동' });
  const stage = h('div', { class: 'r-stage', tabindex: '0' });
  const banner = h('div', { class: 'r-banner hidden' });
  const tocPanel = h('aside', { class: 'r-toc hidden', 'aria-label': '목차' });
  const oneBtn = h('button', { class: 'seg', 'aria-label': '한 쪽 보기' }, icon('page1'), h('span', { class: 'tool-label' }, '한 쪽'));
  const twoBtn = h('button', { class: 'seg', 'aria-label': '두 쪽 보기' }, icon('page2'), h('span', { class: 'tool-label' }, '두 쪽'));
  const segment = h('div', { class: 'segmented' }, oneBtn, twoBtn);
  const fullBtn = tool('expand', '전체보기');
  const likeBtn = tracking ? tool('heart', '좋아요', { class: 'tool like' }) : null;
  const markBtn = tracking ? h('button', { class: 'tool primary', title: '여기까지 연습했어요' }, icon('bookmark'), h('span', null, '진도 저장')) : null;
  const dlBtn = book.downloadable ? tool('download', '내려받기') : null;
  const addTocBtn = role === 'admin' ? tool('plus', '목차에 추가') : null;

  const wrap = h('div', { class: 'reader' },
    h('header', { class: 'r-top' },
      h('button', { class: 'tool back', 'aria-label': '목록으로', onclick: () => exit(true) }, icon('back')),
      h('div', { class: 'r-title' }, h('div', { class: 'r-name' }, book.title), titleSub),
      h('div', { class: 'r-tools' },
        tool('list', '목차', { onclick: () => toggleToc() }),
        segment, fullBtn, addTocBtn, dlBtn, likeBtn, markBtn)),
    banner,
    h('div', { class: 'r-main' }, stage, tocPanel),
    h('footer', { class: 'r-bottom' },
      h('button', { class: 'tool nav', 'aria-label': '이전 쪽', onclick: () => prev() }, icon('left')),
      slider, pageLabel,
      h('button', { class: 'tool nav', 'aria-label': '다음 쪽', onclick: () => next() }, icon('right'))));
  root.replaceChildren(wrap);

  const loadingBox = h('div', { class: 'loading' }, h('div', { class: 'spin' }), h('div', { class: 'muted' }, '교재를 여는 중…'));
  stage.append(loadingBox);

  // ---------- PDF 열기 ----------
  let bytes, pdf;
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
  book = { ...book, numPages: n };

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
      h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => banner.classList.add('hidden') }, icon('close')));
    if (autoHide) setTimeout(() => banner.classList.add('hidden'), autoHide);
  };
  const updateSub = () => {
    titleSub.textContent = entry.bm ? `내 진도 · ${progressLabel(entry.bm, book)}` : (tracking ? '아직 저장한 진도가 없어요' : `${n}쪽`);
  };
  updateSub();

  if (resolved && resolved.status === 'ok') {
    showBanner(`지난 진도로 이동했어요 · ${progressLabel(entry.bm, book)}`, 'ok', 3500);
  } else if (resolved && resolved.status === 'unsure') {
    showBanner(h('span', null, `교재가 바뀌어서 진도 위치가 달라졌을 수 있어요. 지난 진도: ${progressLabel(entry.bm, book)} `,
      h('button', { class: 'linkish', onclick: () => { go(resolved.page); banner.classList.add('hidden'); } }, `${resolved.page}쪽으로 가기`)), 'warn');
  } else if (resolved && resolved.status === 'missing') {
    showBanner(`지난 진도: ${progressLabel(entry.bm, book)} — 교재가 바뀌어 이 곡을 찾을 수 없어요. 선생님께 확인해 주세요.`, 'warn');
  }

  // ---------- 보기 방식: 한 쪽 / 두 쪽 / 전체보기 ----------
  let viewPref = getViewPref(); // '' = 화면 모양에 따라, '1', '2'
  const isTwo = () => {
    if (n < 2) return false;
    if (viewPref === '1') return false;
    if (viewPref === '2') return true;
    const r = stage.getBoundingClientRect();
    return r.width > r.height * 1.15 && r.width >= 700;
  };
  const paintSegment = () => { const two = isTwo(); oneBtn.classList.toggle('on', !two); twoBtn.classList.toggle('on', two); };
  const choose = (v) => { viewPref = v; setViewPref(v); clearCache(); show(); };
  oneBtn.onclick = () => choose('1');
  twoBtn.onclick = () => { if (n < 2) return toast('한 쪽짜리 교재예요.'); choose('2'); };

  let full = false;
  const fsEl = document.documentElement;
  function enterFull() {
    full = true; wrap.classList.add('full');
    const req = fsEl.requestFullscreen || fsEl.webkitRequestFullscreen;
    if (req) Promise.resolve(req.call(fsEl)).catch(() => {});
    toast('가운데를 두 번 누르면 전체보기가 끝나요');
  }
  function leaveFull() {
    full = false; wrap.classList.remove('full');
    const fe = document.fullscreenElement || document.webkitFullscreenElement;
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (fe && ex) Promise.resolve(ex.call(document)).catch(() => {});
  }
  fullBtn.onclick = enterFull;
  const onFsChange = () => { if (!(document.fullscreenElement || document.webkitFullscreenElement) && full) leaveFull(); };
  document.addEventListener('fullscreenchange', onFsChange);
  document.addEventListener('webkitfullscreenchange', onFsChange);
  cleanups.push(() => {
    document.removeEventListener('fullscreenchange', onFsChange);
    document.removeEventListener('webkitfullscreenchange', onFsChange);
    if (full) leaveFull();
  });

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
    const pad = full ? 0 : 16;
    const gap = count === 2 ? (full ? 0 : 4) : 0;
    return [Math.max(50, Math.floor((r.width - pad - gap) / count)), Math.max(50, Math.floor(r.height - pad))];
  }

  async function show() {
    const my = ++token;
    const pages = visible(page);
    page = pages[0];
    paintSegment();
    const [bw, bh] = boxSize(isTwo() ? 2 : 1);
    slider.value = page;
    pageLabel.textContent = pages.length === 2 ? `${pages[0]}–${pages[1]} / ${n}` : `${pages[0]} / ${n}`;
    highlightToc();
    paintLike();
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

  const go = (p) => { page = Math.max(1, Math.min(n, p)); show(); };
  const next = () => { const v = visible(page); if (v[v.length - 1] < n) { page = v[v.length - 1] + 1; show(); } };
  const prev = () => { if (page > 1) { page = visible(page - 1)[0]; show(); } };

  slider.oninput = () => { pageLabel.textContent = `${slider.value} / ${n}`; };
  slider.onchange = () => go(+slider.value);

  // 넘기기: 화면 왼쪽·오른쪽 누르기, 밀기, 키보드. 전체보기에서는 가운데를 두 번 누르면 끝난다.
  let down = null, lastCenterTap = 0;
  stage.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
  stage.addEventListener('pointerup', (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = Date.now() - down.t;
    down = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { dx < 0 ? next() : prev(); return; }
    if (dt < 400 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const r = stage.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      if (fx < 0.3) prev();
      else if (fx > 0.7) next();
      else if (full) {
        const now = Date.now();
        if (now - lastCenterTap < 400) { lastCenterTap = 0; leaveFull(); } else lastCenterTap = now;
      }
    }
  });
  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next(); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); }
    if (e.key === 'Escape' && full) leaveFull();
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
      h('div', { class: 'r-toc-head' }, h('strong', null, '목차'), h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => toggleToc(false) }, icon('close'))),
      toc.length
        ? h('ol', { class: 'r-toc-list' }, toc.map((e) => h('li', null,
          h('button', { 'data-p': e.p, onclick: () => { go(e.p); if (window.innerWidth < 900) toggleToc(false); } },
            h('span', null, e.t, likedSongs().has(e.t) ? h('span', { class: 'heart-mini' }, ' ♥') : null), h('span', { class: 'muted' }, `${e.p}`)))))
        : h('p', { class: 'muted pad' }, '목차가 없는 교재입니다. 아래 막대로 쪽을 옮겨 주세요.'),
      entry.bm ? h('div', { class: 'r-toc-mark' }, h('div', { class: 'muted small' }, '내 진도'),
        h('button', { class: 'linkish', onclick: () => { const r = resolveBookmark(entry.bm, book, n); if (r && r.page) go(r.page); } }, progressLabel(entry.bm, book))) : null);
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

  // ---------- 곡 고르기 (두 쪽에 곡이 둘이면 물어본다) ----------
  const songOf = (p) => songAt(book, p, n)?.title || book.title;
  function pickSong(title, pages, then) {
    const songs = [...new Set(pages.map(songOf))];
    if (songs.length === 1) return then(pages[0], songs[0]);
    sheet((body, close) => {
      body.append(h('p', { class: 'sheet-msg' }, title),
        h('div', { class: 'choice-list' }, pages.map((p) => h('button', { class: 'choice', onclick: () => { close(); then(p, songOf(p)); } },
          h('strong', null, songOf(p)), h('span', { class: 'muted' }, `${p}쪽`)))));
    }, { title: '곡 고르기' });
  }

  // ---------- 진도 저장 ----------
  async function saveMark(p) {
    const bm = makeBookmark(book, p, n);
    entry = { ...entry, bm };
    updateSub(); buildToc();
    try {
      await store.saveBookmark(opts.studentId, book.id, bm);
      toast(`진도를 저장했어요 · ${progressLabel(bm, book)}`, 'good');
    } catch { toast('진도를 저장하지 못했어요. 인터넷 연결을 확인해 주세요.', 'bad'); }
  }
  if (markBtn) markBtn.onclick = () => pickSong('어느 곡까지 연습했나요?', visible(page), (p, song) => {
    // 두 쪽이 같은 곡이고 기존 진도가 화면 안에 있으면 그 쪽을 지킨다
    const cur = entry.bm?.page;
    if (cur && cur !== p && visible(page).includes(cur) && songOf(cur) === song) p = cur;
    saveMark(p);
  });

  // ---------- 좋아요 ----------
  let myLikes = (opts.likes || []).filter((l) => l.bookId === book.id);
  function likedSongs() { return new Set(myLikes.map((l) => l.song)); }
  function paintLike() {
    if (!likeBtn) return;
    const liked = visible(page).some((p) => likedSongs().has(songOf(p)));
    likeBtn.classList.toggle('on', liked);
    likeBtn.querySelector('.tool-label').textContent = liked ? '좋아요 취소' : '좋아요';
  }
  async function toggleLike(song) {
    const on = !likedSongs().has(song);
    try {
      await store.setLike(opts.studentId, opts.studentName, book, song, on);
      myLikes = on ? [...myLikes, { bookId: book.id, song }] : myLikes.filter((l) => l.song !== song);
      paintLike(); buildToc();
      toast(on ? `좋아요를 눌렀어요 · ${song}` : `좋아요를 취소했어요 · ${song}`, on ? 'good' : '');
    } catch { toast('저장하지 못했어요. 인터넷 연결을 확인해 주세요.', 'bad'); }
  }
  if (likeBtn) likeBtn.onclick = () => pickSong('어느 곡이 좋았나요?', visible(page), (_, song) => toggleLike(song));

  buildToc();

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
      const input = h('input', { class: 'input', placeholder: '예: 할아버지의 낡은 시계' });
      const p = visible(page)[0];
      body.append(h('p', { class: 'sheet-msg' }, `${p}쪽에서 시작하는 곡(목차 항목)을 추가합니다.`), input,
        h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: async () => {
          const t = input.value.trim(); if (!t) return;
          const toc = sortToc([...(book.toc || []).filter((e) => e.p !== p), { t, p }]);
          book = { ...book, toc, tocPages: n };
          await store.updateBook(book.id, { toc, tocPages: n });
          buildToc(); close(); toast('목차에 추가했어요.', 'good');
        } }, '추가')));
      setTimeout(() => input.focus(), 50);
    }, { title: '목차에 추가' });
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
  if (tracking) {
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    store.startSession({ sid: opts.studentId, name: opts.studentName, kind: 'read', bookId: book.id, bookTitle: book.title, mode: opts.mode })
      .then((id) => { sessionId = id; }).catch(() => {});
    store.touchStudent(opts.studentId);
    const tick = setInterval(() => { if (document.visibilityState === 'visible') seconds++; }, 1000);
    const flushTimer = setInterval(() => { if (dirty || document.visibilityState === 'visible') flush(); }, 60000);
    document.addEventListener('visibilitychange', onVis);
    cleanups.push(() => { clearInterval(tick); clearInterval(flushTimer); document.removeEventListener('visibilitychange', onVis); });
  }
  flushFn = flush;

  stage.focus();
  show();
  return handle;
}
