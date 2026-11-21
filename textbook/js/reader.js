// 교재 보기 화면: PDF 표시, 한 쪽/두 쪽 보기, 전체보기, 넘기기, 목차, 진도 저장, 좋아요, 다운로드, 연습 시간 기록

import { showSongInfo } from './songinfo.js';
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
  const markLabel = h('span', null, '진도 저장');
  const markBtn = tracking ? h('button', { class: 'tool mark', title: '여기까지 연습했어요' }, icon('bookmark'), markLabel) : null;
  const tocBtn = tool('list', '목차', { class: 'tool keep', onclick: () => openPanel('toc') });
  const likesBtn = tracking ? tool('heartList', '좋아요 목록', { class: 'tool keep', onclick: () => openPanel('likes') }) : null;
  // 곡 정보가 있는 곡을 보고 있을 때만 나타난다
  const infoBtn = tool('info', '곡 정보', { class: 'tool keep info hidden', onclick: () => openInfo() });
  const dlBtn = book.downloadable ? tool('download', '내려받기') : null;
  const addTocBtn = role === 'admin' ? tool('plus', '목차에 추가') : null;
  const zoomOutBtn = h('button', { class: 'tool nav', 'aria-label': '축소' }, icon('zoomOut'));
  const zoomInBtn = h('button', { class: 'tool nav', 'aria-label': '확대' }, icon('zoomIn'));
  const zoomLabel = h('button', { class: 'zoom-label', title: '화면에 맞추기' }, '100%');
  // 전체보기에서 가운데를 한 번 누르면 잠깐 나타나는 작은 막대
  const fzOut = h('button', { class: 'tool nav', 'aria-label': '축소' }, icon('zoomOut'));
  const fzIn = h('button', { class: 'tool nav', 'aria-label': '확대' }, icon('zoomIn'));
  const fzLabel = h('button', { class: 'zoom-label', title: '화면에 맞추기' }, '100%');
  const fzExit = h('button', { class: 'tool nav', 'aria-label': '전체보기 끝내기' }, icon('close'));
  const fullBar = h('div', { class: 'r-fullbar' }, fzOut, fzLabel, fzIn, h('span', { class: 'r-fullbar-sep' }), fzExit);

  const wrap = h('div', { class: 'reader' },
    h('header', { class: 'r-top' },
      h('button', { class: 'tool back', 'aria-label': '목록으로', onclick: () => exit(true) }, icon('back')),
      h('div', { class: 'r-title' }, h('div', { class: 'r-name' }, book.title), titleSub),
      h('div', { class: 'r-tools' },
        infoBtn, tocBtn, likesBtn,
        segment, fullBtn, addTocBtn, dlBtn, likeBtn, markBtn)),
    banner,
    h('div', { class: 'r-main' }, stage, tocPanel, fullBar),
    h('footer', { class: 'r-bottom' },
      h('button', { class: 'tool nav', 'aria-label': '이전 쪽', onclick: () => prev() }, icon('left')),
      slider, pageLabel,
      h('div', { class: 'zoom-group' }, zoomOutBtn, zoomLabel, zoomInBtn),
      h('button', { class: 'tool nav', 'aria-label': '다음 쪽', onclick: () => next() }, icon('right'))));
  root.replaceChildren(wrap);

  const loadText = h('div', { class: 'muted' }, '교재를 여는 중…');
  const loadFill = h('i');
  const loadBar = h('div', { class: 'load-bar hidden' }, loadFill);
  const loadNote = h('div', { class: 'load-note hidden' });
  const loadingBox = h('div', { class: 'loading' }, h('div', { class: 'spin' }), loadText, loadBar, loadNote);
  stage.append(loadingBox);

  // ---------- PDF 열기 ----------
  let bytes, pdf;
  try {
    // 기기에 아직 없는 교재를 받을 때만 진행 막대와 안내가 나온다 (저장된 교재는 바로 열림)
    const got = await loadPdf(book, (frac, bytesGot, info = {}) => {
      loadText.textContent = frac != null ? `교재를 내려받는 중… ${Math.round(frac * 100)}%` : '교재를 내려받는 중…';
      loadBar.classList.remove('hidden');
      loadBar.classList.toggle('indeterminate', frac == null);
      if (frac != null) loadFill.style.width = `${Math.round(frac * 100)}%`;
      loadNote.classList.remove('hidden');
      loadNote.textContent = info.updating
        ? '교재가 새로 바뀌어 다시 내려받고 있어요. 시간이 조금 걸릴 수 있습니다.'
        : '최초 다운로드 시 시간이 걸릴 수 있습니다.';
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

  // 곡 이름으로 시작 쪽 찾기 (목차가 없는 교재는 교재 이름이 곧 곡 이름)
  function songPage(song) {
    const e = (book.toc || []).find((x) => x.t === song);
    if (e) return Math.min(n, Math.max(1, e.p));
    return song === book.title ? 1 : null;
  }

  // ---------- 진도 ----------
  let entry = opts.entry || {};
  const resolved = resolveBookmark(entry.bm, book, n);
  // 목차가 고쳐져 쪽이 옮겨졌으면 화면에는 새 쪽 번호를 보여준다
  if (resolved?.status === 'ok' && resolved.page !== entry.bm.page) entry = { ...entry, bm: { ...entry.bm, page: resolved.page } };
  let start = 1;
  if (resolved && resolved.status === 'ok') start = resolved.page;
  else if (entry.lastPage && entry.lastPage <= n) start = entry.lastPage;
  const songStart = opts.startSong ? songPage(opts.startSong) : null;
  if (songStart) start = songStart;

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

  if (songStart) {
    showBanner(`좋아요한 곡으로 이동했어요 · ${opts.startSong}`, 'ok', 3500);
  } else if (resolved && resolved.status === 'ok') {
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
    toast('화면 가운데를 한 번 누르면 전체보기가 끝나요');
  }
  function leaveFull() {
    full = false; wrap.classList.remove('full'); hideFullBar();
    const fe = document.fullscreenElement || document.webkitFullscreenElement;
    const ex = document.exitFullscreen || document.webkitExitFullscreen;
    if (fe && ex) Promise.resolve(ex.call(document)).catch(() => {});
  }
  fullBtn.onclick = enterFull;
  let fullBarTimer;
  function hideFullBar() { clearTimeout(fullBarTimer); fullBar.classList.remove('show'); }
  function showFullBar() {
    fullBar.classList.add('show');
    clearTimeout(fullBarTimer);
    fullBarTimer = setTimeout(hideFullBar, 3500);
  }
  fullBar.addEventListener('pointerdown', () => showFullBar());
  fzExit.onclick = () => leaveFull();
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
  let shownPage = 0;
  let shown = null;   // 지금 화면에 놓인 쪽들과 그 그림
  let turning = null; // 넘기는 중인 책장

  // ---------- 확대 ----------
  const ZMIN = 1, ZMAX = 4;
  let zoom = 1;
  let pendingFocus = null;
  let pendingEdge = null; // 확대 상태에서 끌어 넘겼을 때 새 쪽을 어느 쪽 끝에서 보여 줄지 // 확대 후에도 손가락 아래의 악보가 그 자리에 오도록
  const zoomSteps = [1, 1.25, 1.5, 2, 2.5, 3, 4];
  function paintZoom() {
    zoomLabel.textContent = fzLabel.textContent = `${Math.round(zoom * 100)}%`;
    zoomOutBtn.disabled = fzOut.disabled = zoom <= ZMIN;
    zoomInBtn.disabled = fzIn.disabled = zoom >= ZMAX;
  }
  // fx, fy: 화면(무대) 안에서 고정할 지점
  function focusAt(fx, fy) {
    const sp = stage.querySelector('.r-spread');
    if (!sp) return null;
    return {
      fx, fy,
      rx: (stage.scrollLeft + fx - sp.offsetLeft) / sp.offsetWidth,
      ry: (stage.scrollTop + fy - sp.offsetTop) / sp.offsetHeight,
    };
  }
  function setZoom(z, focus) {
    z = Math.round(Math.max(ZMIN, Math.min(ZMAX, z)) * 100) / 100;
    if (Math.abs(z - 1) < 0.06) z = 1;
    if (z === zoom) { const sp = stage.querySelector('.r-spread'); if (sp) sp.style.transform = ''; return; }
    const r = stage.getBoundingClientRect();
    pendingFocus = focus || focusAt(r.width / 2, r.height / 2);
    zoom = z;
    show();
  }
  const stepZoom = (dir, focus) => {
    const i = zoomSteps.findIndex((v) => v >= zoom - 0.01);
    const cur = i < 0 ? zoomSteps.length - 1 : i;
    const target = dir > 0 ? (zoomSteps[cur] > zoom + 0.01 ? zoomSteps[cur] : zoomSteps[Math.min(zoomSteps.length - 1, cur + 1)]) : zoomSteps[Math.max(0, zoomSteps[cur] < zoom - 0.01 ? cur : cur - 1)];
    setZoom(target, focus);
  };
  zoomInBtn.onclick = () => stepZoom(1);
  zoomOutBtn.onclick = () => stepZoom(-1);
  zoomLabel.onclick = () => setZoom(1);
  fzIn.onclick = () => stepZoom(1);
  fzOut.onclick = () => stepZoom(-1);
  fzLabel.onclick = () => setZoom(1);

  // 두 손가락으로 벌리고 오므리기
  let pinch = null, pinchEndAt = 0;
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    const sp = stage.querySelector('.r-spread');
    if (!sp) return;
    const m = mid(e.touches), r = stage.getBoundingClientRect(), sr = sp.getBoundingClientRect();
    pinch = { d0: dist(e.touches), z0: zoom, focus: focusAt(m.x - r.left, m.y - r.top), sp, ox: m.x - sr.left, oy: m.y - sr.top, scale: 1, m };
    sp.style.transformOrigin = `${pinch.ox}px ${pinch.oy}px`;
    down = null;
  }, { passive: true });
  stage.addEventListener('touchmove', (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const s = Math.max(ZMIN / pinch.z0, Math.min(ZMAX / pinch.z0, dist(e.touches) / pinch.d0));
    pinch.scale = s; pinch.m = mid(e.touches);
    pinch.sp.style.transform = `scale(${s})`;
  }, { passive: false });
  const endPinch = () => {
    if (!pinch) return;
    const p = pinch; pinch = null; pinchEndAt = Date.now();
    const r = stage.getBoundingClientRect();
    setZoom(p.z0 * p.scale, p.focus && { ...p.focus, fx: p.m.x - r.left, fy: p.m.y - r.top });
  };
  stage.addEventListener('touchend', (e) => { if (e.touches.length < 2) endPinch(); });
  stage.addEventListener('touchcancel', endPinch);
  // 아이패드 사파리가 화면 전체를 확대하지 않도록
  const stopGesture = (e) => e.preventDefault();
  stage.addEventListener('gesturestart', stopGesture);
  stage.addEventListener('gesturechange', stopGesture);
  // 컴퓨터: Ctrl + 휠, 트랙패드 오므리기
  stage.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    clearTimeout(wheelTimer);
    wheelZoom = (wheelZoom || zoom) * Math.exp(-e.deltaY / 200);
    const f = focusAt(e.clientX - r.left, e.clientY - r.top);
    wheelTimer = setTimeout(() => { const z = wheelZoom; wheelZoom = 0; setZoom(z, f); }, 120);
  }, { passive: false });
  let wheelTimer, wheelZoom = 0;

  // 바탕 그림: 화면에 맞춘 크기 × 확대 배율. 확대했을 때는 메모리를 아끼려고 조금 낮은 해상도로 그리고,
  // 보이는 부분은 아래 '선명한 덧그림'이 원래 해상도로 다시 그린다.
  const DPR = () => Math.min(window.devicePixelRatio || 1, 3);
  async function renderPage(p, boxW, boxH, z) {
    const key = `${p}@${boxW}x${boxH}@${z}`;
    if (cache.has(key)) { const job = cache.get(key); cache.delete(key); cache.set(key, job); return job; }
    const job = (async () => {
      const pg = await pdf.getPage(p);
      const v1 = pg.getViewport({ scale: 1 });
      const scale = Math.min(boxW / v1.width, boxH / v1.height) * z;
      const cssW = v1.width * scale, cssH = v1.height * scale;
      const cap = z > 1 ? 4e6 : 12e6;
      const ratio = Math.min(DPR(), Math.sqrt(cap / (cssW * cssH)));
      const vp = pg.getViewport({ scale: scale * ratio });
      const c = h('canvas', { class: 'r-page' });
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = Math.floor(cssW) + 'px';
      c.style.height = Math.floor(cssH) + 'px';
      await pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
      c._meta = { pg, scale, cssW: Math.floor(cssW), cssH: Math.floor(cssH) };
      return c;
    })();
    cache.set(key, job);
    // 오래된 그림은 지운다 (아이패드는 캔버스 크기를 0으로 해야 메모리를 돌려준다)
    while (cache.size > 12) {
      const oldKey = cache.keys().next().value;
      const old = cache.get(oldKey); cache.delete(oldKey);
      old.then((c) => { if (!c.isConnected) { c.width = 0; c.height = 0; } }).catch(() => {});
    }
    return job;
  }

  // 선명한 덧그림: 확대했을 때 화면에 보이는 부분만 기기 해상도 그대로 다시 그린다
  let detailTasks = [], detailTimer, detailToken = 0;
  function clearDetail() {
    detailTasks.forEach((t) => { try { t.cancel(); } catch {} });
    detailTasks = [];
    stage.querySelectorAll('canvas.r-detail').forEach((c) => { c.width = 0; c.height = 0; c.remove(); });
  }
  function scheduleDetail(delay = 140) {
    clearTimeout(detailTimer);
    detailTimer = setTimeout(renderDetail, delay);
  }
  async function renderDetail() {
    const my = ++detailToken;
    detailTasks.forEach((t) => { try { t.cancel(); } catch {} });
    detailTasks = [];
    if (zoom <= 1 || pinch) return;
    const sr = stage.getBoundingClientRect();
    const dpr = DPR();
    const boxes = [...stage.querySelectorAll('.r-pagebox')];
    await Promise.all(boxes.map(async (box) => {
      const base = box.querySelector('canvas.r-page');
      const meta = base?._meta;
      if (!meta) return;
      const r = box.getBoundingClientRect();
      const x0 = Math.max(0, Math.floor(sr.left - r.left)), y0 = Math.max(0, Math.floor(sr.top - r.top));
      const x1 = Math.min(meta.cssW, Math.ceil(sr.right - r.left)), y1 = Math.min(meta.cssH, Math.ceil(sr.bottom - r.top));
      if (x1 <= x0 || y1 <= y0) { box.querySelector('canvas.r-detail')?.remove(); return; }
      const w = x1 - x0, hgt = y1 - y0;
      const c = document.createElement('canvas');
      c.className = 'r-detail';
      c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr);
      Object.assign(c.style, { left: x0 + 'px', top: y0 + 'px', width: w + 'px', height: hgt + 'px' });
      const vp = meta.pg.getViewport({ scale: meta.scale * dpr });
      const task = meta.pg.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, transform: [1, 0, 0, 1, -x0 * dpr, -y0 * dpr] });
      detailTasks.push(task);
      try { await task.promise; } catch { c.width = 0; c.height = 0; return; }
      if (my !== detailToken || !box.isConnected) { c.width = 0; c.height = 0; return; }
      const old = box.querySelector('canvas.r-detail');
      if (old) { old.width = 0; old.height = 0; old.remove(); }
      box.append(c);
    }));
  }
  stage.addEventListener('scroll', () => { if (zoom > 1) scheduleDetail(); }, { passive: true });

  function boxSize(count) {
    const r = stage.getBoundingClientRect();
    const pad = full ? 0 : 16;
    const gap = count === 2 ? (full ? 0 : 4) : 0;
    return [Math.max(50, Math.floor((r.width - pad - gap) / count)), Math.max(50, Math.floor(r.height - pad))];
  }

  async function show() {
    const my = ++token;
    const pages = visible(page);
    const pageChanged = pages[0] !== shownPage;
    page = pages[0];
    paintSegment();
    const [bw0, bh0] = boxSize(isTwo() ? 2 : 1);
    paintZoom();
    slider.value = page;
    pageLabel.textContent = pages.length === 2 ? `${pages[0]}–${pages[1]} / ${n}` : `${pages[0]} / ${n}`;
    highlightToc();
    paintLike();
    paintMark();
    paintInfo();
    track(pages);
    let canvases;
    try { canvases = await Promise.all(pages.map((p) => renderPage(p, bw0, bh0, zoom))); } catch { return; }
    if (my !== token) return;
    clearDetail();
    settleTurn();
    const build = () => h('div', { class: 'r-spread' + (pages.length === 2 ? ' two' : '') },
      canvases.map((c) => h('div', { class: 'r-pagebox', style: { width: c.style.width, height: c.style.height } }, c)));
    stage.classList.toggle('zoomed', zoom > 1);
    // 쪽이 바뀌면 종이책처럼 책장을 넘긴다 (확대 중이거나 한 쪽↔두 쪽 모양이 달라지면 살짝 밀어 바꾼다)
    const old = shown;
    const dir = old && pageChanged && zoom === 1 && old.zoom === 1 ? Math.sign(pages[0] - old.pages[0]) : 0;
    const canTurn = dir && old.canvases.length === canvases.length && !pages.some((p) => old.pages.includes(p)) && old.canvases.every((c) => c.isConnected);
    // 새 쪽 그림은 처음부터 제자리에 둔다. 넘어가는 책장은 그 위에 복사본으로 그렸다가 끝나면 걷어 낸다
    // (그림을 옮기면 기기에 따라 한순간 검게 깜빡인다)
    const oldSnaps = canTurn ? old.canvases.map(snap) : null;
    const spread = build();
    stage.replaceChildren(spread);
    if (canTurn) turnPage(spread, oldSnaps, canvases, dir);
    else if (dir && spread.animate) spread.animate([{ opacity: 0, transform: `translateX(${dir * 40}px)` }, { opacity: 1, transform: 'none' }], { duration: 240, easing: 'ease-out' });
    shown = { pages, canvases, zoom };
    shownPage = pages[0];
    if (zoom > 1) {
      if (pendingFocus) {
        const f = pendingFocus;
        stage.scrollLeft = spread.offsetLeft + f.rx * spread.offsetWidth - f.fx;
        stage.scrollTop = spread.offsetTop + f.ry * spread.offsetHeight - f.fy;
      } else if (pageChanged) {
        stage.scrollTop = 0;
        if (pendingEdge === 'left') stage.scrollLeft = 0;
        else if (pendingEdge === 'right') stage.scrollLeft = stage.scrollWidth;
      }
    }
    pendingFocus = null;
    pendingEdge = null;
    if (zoom > 1) { scheduleDetail(0); return; }
    // 다음·이전 쪽을 미리 그려 둔다 (확대하지 않았을 때만).
    // 넘기는 방향으로 두 번 넘길 만큼 먼저 그리고, 책장이 넘어가는 동안에는 그리지 않아 움직임이 끊기지 않게 한다
    const after = (p) => visible(Math.min(n, visible(p).slice(-1)[0] + 1));
    const before = (p) => visible(Math.max(1, visible(p)[0] - 1));
    const a1 = after(pages[0]), a2 = after(a1[0]), b1 = before(pages[0]), b2 = before(b1[0]);
    const order = (dir < 0 ? [b1, b2, a1] : [a1, a2, b1]).flat().filter((p) => !pages.includes(p));
    setTimeout(async () => {
      for (const p of [...new Set(order)]) {
        if (my !== token) return;
        await renderPage(p, bw0, bh0, 1).catch(() => {});
      }
    }, canTurn ? TURN_MS + 30 : 60);
  }

  // ---------- 책장 넘기기 ----------
  // 넘어가는 책장 한 장을 앞면·뒷면이 있는 판으로 만들어 책등을 축으로 돌린다.
  // 두 쪽 보기: 앞으로 넘기면 오른쪽 쪽이 들려 왼쪽으로 넘어가고, 그 뒷면이 새 왼쪽 쪽이 된다.
  // 한 쪽 보기: 앞으로 넘기면 지금 쪽이 왼쪽으로 넘어가며 아래의 새 쪽이 드러나고, 뒤로 넘기면 앞 쪽이 왼쪽에서 넘어와 덮는다.
  const TURN_MS = 400;
  function settleTurn() {
    const t = turning;
    if (!t) return;
    turning = null;
    t.anims.forEach((a) => { try { a.cancel(); } catch { /* 무시 */ } });
    t.done();
  }
  // 쪽 그림의 복사본 (넘기는 동안만 쓰므로 해상도를 조금 낮춰 메모리를 아낀다)
  function snap(c) {
    const cssW = parseFloat(c.style.width) || c.width;
    const k = Math.min(1, (cssW * Math.min(DPR(), 2)) / c.width);
    const s = document.createElement('canvas');
    s.width = Math.max(1, Math.round(c.width * k)); s.height = Math.max(1, Math.round(c.height * k));
    s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
    s.style.width = c.style.width; s.style.height = c.style.height;
    s.className = 'r-snap';
    return s;
  }
  function turnPage(spread, oldS, newC, dir) {
    const freeAll = () => oldS.forEach((c) => { c.width = 0; c.height = 0; });
    if (!document.body.animate) return freeAll();
    const two = newC.length === 2;
    const boxes = [...spread.children];
    const extra = [];
    const snaps = [...oldS];
    // 덮개: 책장이 다 넘어올 때까지 옛 쪽을 그대로 보여 준다
    const cover = (b, c) => { const el = h('div', { class: 'r-cover' }, c); b.append(el); extra.push(el); };
    let host, front, back, from, to, hingeRight = false;
    if (!two) {
      host = boxes[0];
      if (dir > 0) { front = oldS[0]; from = 0; to = -180; }
      else { cover(host, oldS[0]); front = snap(newC[0]); snaps.push(front); from = -180; to = 0; }
      back = null;
    } else if (dir > 0) {
      host = boxes[1]; cover(boxes[0], oldS[0]);
      front = oldS[1]; back = snap(newC[0]); snaps.push(back); from = 0; to = -180;
    } else {
      host = boxes[0]; cover(boxes[1], oldS[1]);
      front = oldS[0]; back = snap(newC[1]); snaps.push(back); from = 0; to = 180; hingeRight = true;
    }
    // 책등 쪽이 어둡게: 앞면은 책등이 왼쪽(뒤로 넘길 때는 오른쪽), 뒷면은 그 반대
    const nearSpine = (side) => `linear-gradient(to ${side}, rgba(0,0,0,.42), rgba(0,0,0,.14) 45%, rgba(0,0,0,.04))`;
    const frontSide = hingeRight ? 'left' : 'right', backSide = hingeRight ? 'right' : 'left';
    const fShade = h('div', { class: 'r-shade', style: { background: nearSpine(frontSide) } });
    const bShade = h('div', { class: 'r-shade', style: { background: nearSpine(backSide) } });
    const under = h('div', { class: 'r-shade', style: { background: nearSpine(frontSide) } });
    const fFace = h('div', { class: 'r-face' }, front, fShade);
    const bFace = h('div', { class: 'r-face back' + (back ? '' : ' blank') }, back, bShade);
    const leaf = h('div', { class: 'r-leaf' }, fFace, bFace);
    host.classList.add('turning');
    host.append(under, leaf);
    extra.push(under, leaf);
    spread.classList.add('r-flip');
    if (two) {
      const gap = Math.max(0, boxes[1].offsetLeft - boxes[0].offsetLeft - boxes[0].offsetWidth);
      leaf.style.transformOrigin = hingeRight ? `calc(100% + ${gap / 2}px) 50%` : `${-gap / 2}px 50%`;
    } else leaf.style.transformOrigin = '0 50%';

    const ease = 'cubic-bezier(.25,.55,.3,1)'; // 바로 움직이기 시작해 부드럽게 멈춘다
    const opt = { duration: TURN_MS, easing: ease, fill: 'both' };
    const startsFront = from === 0; // 처음에 보이는 면
    // 앞면·뒷면은 책장이 똑바로 선 순간(가운데)에 직접 바꿔 보여 준다 (브라우저의 뒷면 숨김은 끝 무렵에 깜빡일 수 있다)
    const showFirst = [{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0, offset: 0.5 }, { opacity: 0 }];
    const showSecond = [{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 0.5 }, { opacity: 1 }];
    // 그림자는 책장이 서 있을 때만 진하고 처음과 끝에는 없다
    const shadeFrames = [{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }];
    let leafFrames = [{ transform: `rotateY(${from}deg)` }, { transform: `rotateY(${to}deg)` }];
    // 한 쪽 보기에서는 넘어간 책장이 쪽 바깥에 남지 않도록 쪽 밖에 있을 때 흐리게 한다
    if (!two) {
      const [a, b] = dir > 0 ? [1, 0] : [0, 1];
      leafFrames = [{ ...leafFrames[0], opacity: a }, { opacity: 1, offset: dir > 0 ? 0.62 : 0.38 }, { ...leafFrames[1], opacity: b }];
    }
    const anims = [
      leaf.animate(leafFrames, opt),
      fFace.animate(startsFront ? showFirst : showSecond, opt),
      bFace.animate(startsFront ? showSecond : showFirst, opt),
      fShade.animate(shadeFrames, opt),
      bShade.animate(shadeFrames, opt),
      under.animate(dir > 0 || two ? [{ opacity: 0.7 }, { opacity: 0 }] : [{ opacity: 0 }, { opacity: 0.5 }], opt),
    ];
    const t = { anims, done: () => {
      extra.forEach((el) => el.remove());
      host.classList.remove('turning'); spread.classList.remove('r-flip');
      snaps.forEach((c) => { c.width = 0; c.height = 0; });
    } };
    turning = t;
    anims[0].onfinish = () => { if (turning === t) { turning = null; t.done(); } };
  }

  const go = (p) => { page = Math.max(1, Math.min(n, p)); show(); };
  const next = () => { const v = visible(page); if (v[v.length - 1] < n) { page = v[v.length - 1] + 1; show(); } };
  const prev = () => { if (page > 1) { page = visible(page - 1)[0]; show(); } };

  slider.oninput = () => { pageLabel.textContent = `${slider.value} / ${n}`; };
  slider.onchange = () => go(+slider.value);

  // 넘기기: 화면 왼쪽·오른쪽 누르기, 밀기, 키보드. 전체보기에서는 가운데를 한 번 누르면 끝난다.
  let down = null;
  stage.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || pinch) { down = null; return; }
    down = { x: e.clientX, y: e.clientY, t: Date.now(), sl: stage.scrollLeft, st: stage.scrollTop, mouse: e.pointerType === 'mouse', edge: edgeState() };
  });
  stage.addEventListener('pointermove', (e) => {
    if (!down) return;
    // 확대하지 않았을 때는 충분히 밀면 손가락을 떼기 전에 바로 넘긴다
    if (zoom <= 1 && !down.done && !pinch) {
      const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.3) { down.done = true; dx < 0 ? next() : prev(); return; }
    }
    if (!down.mouse || zoom <= 1) return;
    stage.scrollLeft = down.sl - (e.clientX - down.x);
    stage.scrollTop = down.st - (e.clientY - down.y);
  });
  stage.addEventListener('pointercancel', () => { down = null; });
  stage.addEventListener('pointerup', (e) => {
    if (!down || pinch || Date.now() - pinchEndAt < 350) { down = null; return; }
    const dx = e.clientX - down.x, dy = e.clientY - down.y, dt = Date.now() - down.t;
    const d0 = down;
    down = null;
    if (d0.done) return;
    // 확대한 상태에서 마우스로 끌 때: 쪽 끝에서 시작해 더 끌면 넘긴다
    if (zoom > 1 && d0.mouse && edgeTurn(d0.edge, dx, dy)) return;
    if (zoom <= 1 && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.3) { dx < 0 ? next() : prev(); return; }
    if (dt < 400 && Math.abs(dx) < 12 && Math.abs(dy) < 12) {
      const r = stage.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      if (fx < 0.3) prev();
      else if (fx > 0.7) next();
      else if (full) leaveFull();
    }
  });
  // 굿노트처럼: 확대한 쪽을 끝까지 옮긴 뒤 같은 방향으로 한 번 더 끌면 다음(이전) 쪽으로 넘긴다
  function edgeState() {
    const max = stage.scrollWidth - stage.clientWidth;
    return { left: stage.scrollLeft <= 2, right: stage.scrollLeft >= max - 2 };
  }
  function edgeTurn(edge, dx, dy) {
    if (!edge || Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.2) return false;
    if (dx < 0 && edge.right && visible(page).slice(-1)[0] < n) { pendingEdge = 'left'; next(); return true; }
    if (dx > 0 && edge.left && page > 1) { pendingEdge = 'right'; prev(); return true; }
    return false;
  }
  let zdrag = null;
  stage.addEventListener('touchstart', (e) => {
    zdrag = zoom > 1 && e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, edge: edgeState() } : null;
  }, { passive: true });
  stage.addEventListener('touchend', (e) => {
    const z = zdrag; zdrag = null;
    if (!z || pinch || zoom <= 1 || e.touches.length) return;
    const t = e.changedTouches[0];
    edgeTurn(z.edge, t.clientX - z.x, t.clientY - z.y);
  });
  stage.addEventListener('touchcancel', () => { zdrag = null; });

  const onKey = (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); next(); }
    if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); prev(); }
    if (e.key === 'Escape' && full) leaveFull();
    if (e.key === '+' || e.key === '=') { e.preventDefault(); stepZoom(1); }
    if (e.key === '-') { e.preventDefault(); stepZoom(-1); }
    if (e.key === '0') { e.preventDefault(); setZoom(1); }
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));

  let resizeTimer;
  const ro = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { clearCache(); show(); }, 150); });
  ro.observe(stage);
  cleanups.push(() => ro.disconnect());

  // ---------- 목차 ----------
  let tocTab = 'toc';
  function buildToc() {
    const toc = sortToc(book.toc);
    const mine = myLikes.slice().sort((a, b) => (songPage(a.song) || 1e9) - (songPage(b.song) || 1e9));
    const others = (opts.likes || []).filter((l) => l.bookId !== book.id && (!opts.visibleIds || opts.visibleIds.includes(l.bookId)));
    const closeIfNarrow = () => { if (window.innerWidth < 900) toggleToc(false); };

    let body;
    if (tocTab === 'toc') {
      const mp = markedPage();
      const markP = mp ? tocEntryFor(book.toc, mp)?.p : null;
      body = toc.length
        ? h('ol', { class: 'r-toc-list' }, toc.map((e) => h('li', { class: e.p === markP ? 'my-mark' : null },
          h('button', { 'data-p': e.p, onclick: () => { go(e.p); closeIfNarrow(); } },
            h('span', null, e.t, likedSongs().has(e.t) ? h('span', { class: 'heart-mini' }, ' ♥') : null, hasInfo(e.t) ? h('span', { class: 'info-mini', title: '곡 정보 있음' }, ' ⓘ') : null,
              e.p === markP ? h('span', { class: 'toc-mark' }, icon('bookmark'), '내 진도') : null), h('span', { class: 'muted' }, `${e.p}`)))))
        : h('p', { class: 'muted pad' }, '목차가 없는 교재입니다. 아래 막대로 쪽을 옮겨 주세요.');
    } else {
      const row = (song, right, below, onclick) => h('li', null, h('button', { onclick, disabled: !onclick },
        h('span', { class: 'like-item' }, h('span', null, h('span', { class: 'heart-mini' }, '♥ '), song), below ? h('span', { class: 'muted small' }, below) : null),
        h('span', { class: 'muted' }, right)));
      body = h('div', null,
        mine.length || others.length ? null : h('p', { class: 'muted pad' }, '아직 좋아요를 누른 곡이 없어요. 마음에 드는 곡에서 좋아요를 눌러 보세요.'),
        mine.length ? h('ol', { class: 'r-toc-list' }, mine.map((l) => {
          const p = songPage(l.song);
          return row(l.song, p ? `${p}` : '목차에 없음', null, p ? () => { go(p); closeIfNarrow(); } : null);
        })) : null,
        others.length ? h('div', { class: 'r-toc-sub' }, '다른 교재') : null,
        others.length ? h('ol', { class: 'r-toc-list' }, others.map((l) => row(l.song, '', l.bookTitle || '', opts.onOpenSong ? () => opts.onOpenSong(l.bookId, l.song) : null))) : null);
    }
    tocPanel.replaceChildren(...[
      h('div', { class: 'r-toc-head' },
        h('strong', null, tocTab === 'toc' ? '목차' : `좋아요 목록 · ${myLikes.length + others.length}곡`),
        h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => toggleToc(false) }, icon('close'))),
      body,
      entry.bm && tocTab === 'toc' ? h('div', { class: 'r-toc-mark' }, h('div', { class: 'muted small' }, '내 진도'),
        h('button', { class: 'linkish', onclick: () => { const r = resolveBookmark(entry.bm, book, n); if (r && r.page) go(r.page); } }, progressLabel(entry.bm, book))) : null].filter(Boolean));
    highlightToc();
  }
  function highlightToc() {
    const e = tocEntryFor(book.toc, page);
    tocPanel.querySelectorAll('[data-p]').forEach((b) => b.classList.toggle('on', !!e && +b.dataset.p === e.p));
  }
  function toggleToc(force) {
    const open = force ?? tocPanel.classList.contains('hidden');
    tocPanel.classList.toggle('hidden', !open);
    tocBtn.classList.toggle('active', open && tocTab === 'toc');
    likesBtn?.classList.toggle('active', open && tocTab === 'likes');
  }
  // 같은 버튼을 다시 누르면 닫고, 다른 버튼을 누르면 그 목록으로 바꾼다
  function openPanel(tab) {
    const isOpen = !tocPanel.classList.contains('hidden');
    if (isOpen && tocTab === tab) return toggleToc(false);
    tocTab = tab; buildToc(); toggleToc(true);
  }

  // ---------- 곡 고르기 (두 쪽에 곡이 둘이면 물어본다) ----------
  const songOf = (p) => songAt(book, p, n)?.title || book.title;
  // ---------- 곡 정보 ----------
  const hasInfo = (song) => (book.infoSongs || []).includes(song);
  function paintInfo() { infoBtn.classList.toggle('hidden', !visible(page).some((p) => hasInfo(songOf(p)))); }
  function openInfo() {
    const pages = visible(page).filter((p) => hasInfo(songOf(p)));
    if (!pages.length) return;
    pickSong('어느 곡의 정보를 볼까요?', pages, (p, song) => showSongInfo(song, store.getSongInfo(book.id, song)));
  }

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
  // 지금 보이는 쪽에 내 진도가 있으면 버튼이 노랗게 채워진다
  function markedPage() {
    const r = entry.bm ? resolveBookmark(entry.bm, book, n) : null;
    return r && r.status === 'ok' ? r.page : null;
  }
  function paintMark() {
    if (!markBtn) return;
    const mp = markedPage();
    const on = !!mp && visible(page).includes(mp);
    markBtn.classList.toggle('marked', on);
    markLabel.textContent = on ? '내 진도' : '진도 저장';
    markBtn.title = on ? '지금 보이는 쪽이 내 진도예요' : '여기까지 연습했어요';
  }
  // 누르자마자 화면에 반영하고 알린다. 서버 저장은 뒤에서 하고, 실패하면 되돌린다
  async function saveMark(p) {
    const bm = makeBookmark(book, p, n);
    const prevEntry = entry;
    entry = { ...entry, bm };
    paintMark();
    toast(`진도를 저장했어요 · ${progressLabel(bm, book)}`, 'good');
    requestAnimationFrame(() => { updateSub(); buildToc(); });
    try {
      await store.saveBookmark(opts.studentId, book.id, bm);
    } catch {
      if (entry.bm === bm) { entry = prevEntry; updateSub(); buildToc(); paintMark(); }
      toast('진도를 저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요.', 'bad');
    }
  }
  if (markBtn) markBtn.onclick = () => {
    const vis = visible(page), mp = markedPage();
    // 이미 이 쪽이 진도이고 화면에 곡이 하나뿐이면 다시 저장할 필요가 없다
    if (mp && vis.includes(mp) && new Set(vis.map(songOf)).size === 1) return toast(`이 쪽이 지금 내 진도예요 · ${progressLabel(entry.bm, book)}`);
    markPick(vis);
  };
  const markPick = (vis) => pickSong('어느 곡까지 연습했나요?', vis, (p, song) => {
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
      if (on) toast(`좋아요를 눌렀어요 · ${song} · 목차의 좋아요 탭에서 모아 볼 수 있어요`, 'good');
      paintLike(); buildToc();
      if (!on) toast(`좋아요를 취소했어요 · ${song}`);
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
          if ((book.toc || []).some((e) => e.t === t && e.p !== p)) return toast(`이미 목차에 있는 이름이에요 · ${t}`, 'bad');
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
