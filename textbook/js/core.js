// 데이터 저장 방식과 관계없는 공통 규칙: 이름 정리, 진도 계산, 목차 처리

export const normName = (s) => (s || '').normalize('NFC').replace(/\s+/g, '').trim();
export const normBirth = (s) => (s || '').replace(/\D/g, '');
export const isValidBirth = (b) => {
  if (!/^\d{4}$/.test(b)) return false;
  const m = +b.slice(0, 2), d = +b.slice(2);
  return m >= 1 && m <= 12 && d >= 1 && d <= 31;
};

// 목차를 쪽 순서로 정렬해서 돌려준다. 항목: { t: 제목, p: 쪽 }
export const sortToc = (toc) => [...(toc || [])].filter((e) => e && e.t && e.p > 0).sort((a, b) => a.p - b.p);

// 어떤 쪽이 속한 목차 항목 (그 쪽보다 앞에서 시작하는 마지막 항목)
export function tocEntryFor(toc, page) {
  let hit = null;
  for (const e of sortToc(toc)) { if (e.p <= page) hit = e; else break; }
  return hit;
}

// 진도(북마크)를 저장할 때 남길 정보
export function makeBookmark(book, page, numPages) {
  const e = tocEntryFor(book.toc, page);
  return {
    page,
    tocTitle: e ? e.t : null,
    offset: e ? page - e.p : 0,
    numPages,
    savedAt: Date.now(),
  };
}

// 저장된 진도를 지금 교재 파일에 맞춰 해석한다.
//  status 'ok'      : 그 쪽으로 바로 이동해도 된다
//  status 'unsure'  : 교재가 바뀌어 위치가 다를 수 있다 (쪽은 제안만 한다)
//  status 'missing' : 그 단원이 목차에서 사라졌다 (텍스트로만 보여준다)
export function resolveBookmark(bm, book, numPages) {
  if (!bm || !bm.page) return null;
  const toc = sortToc(book.toc);
  const label = bm.tocTitle ? `${bm.tocTitle}` : `${bm.page}쪽`;
  const tocFresh = toc.length > 0 && book.tocPages === numPages;

  if (bm.tocTitle && toc.length) {
    const i = toc.findIndex((e) => e.t === bm.tocTitle);
    if (i < 0) return { status: 'missing', label, page: null };
    const start = toc[i].p;
    const end = i + 1 < toc.length ? toc[i + 1].p - 1 : numPages;
    const page = Math.max(start, Math.min(end, start + (bm.offset || 0), numPages));
    return { status: tocFresh ? 'ok' : 'unsure', label, page };
  }
  if (bm.page > numPages) return { status: 'missing', label, page: null };
  return { status: bm.numPages === numPages ? 'ok' : 'unsure', label, page: bm.page };
}

export function bookmarkText(bm) {
  if (!bm || !bm.page) return '';
  return bm.tocTitle ? `${bm.tocTitle} · ${bm.page}쪽` : `${bm.page}쪽`;
}

export function fmtDate(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const now = new Date();
  const hm = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (sameDay) return `오늘 ${hm}`;
  if (d.toDateString() === y.toDateString()) return `어제 ${hm}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
}

export function fmtMinutes(sec) {
  const m = Math.round((sec || 0) / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

// 구글 드라이브 링크에서 파일 ID를 꺼낸다
export function parseDriveId(input) {
  const s = (input || '').trim();
  let m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

// 어떤 쪽이 속한 곡(목차 항목)과 그 곡이 몇 쪽짜리인지, 지금 몇째 쪽인지
export function songAt(book, page, numPages) {
  const toc = sortToc(book.toc);
  const n = numPages || book.numPages || 0;
  let i = -1;
  for (let k = 0; k < toc.length; k++) { if (toc[k].p <= page) i = k; else break; }
  if (i < 0) return null;
  const start = toc[i].p;
  const end = i + 1 < toc.length ? toc[i + 1].p - 1 : (n || start);
  return { title: toc[i].t, start, end, span: Math.max(1, end - start + 1), index: page - start + 1 };
}

// 학생이 이 교재에서 마지막으로 보던 곳. 교재를 닫을 때 저장한다.
// (예전에 '진도 저장' 버튼으로 남긴 기록이 더 최근이면 그것을 쓴다)
export function lastSpot(entry, book) {
  if (!entry) return null;
  const bm = entry.bm && entry.bm.page ? entry.bm : null;
  if (entry.lastPage && (!bm || (entry.lastAt || 0) > (bm.savedAt || 0) + 5000)) {
    return makeBookmark(book, entry.lastPage, book.numPages || bm?.numPages || entry.lastPage);
  }
  return bm;
}

// 마지막으로 본 곳을 사람이 읽기 좋게: "할아버지의 낡은 시계 · 3/4쪽" (기록이 없으면 빈 글자)
export function spotLabel(entry, book) {
  return progressLabel(lastSpot(entry, book), book);
}

// 진도를 사람이 읽기 좋게: "할아버지의 낡은 시계 · 3/4쪽"
export function progressLabel(bm, book) {
  if (!bm || !bm.page) return '';
  if (book && bm.tocTitle) {
    const toc = sortToc(book.toc);
    const e = toc.find((x) => x.t === bm.tocTitle);
    if (e) {
      const s = songAt(book, e.p + (bm.offset || 0), book.numPages || bm.numPages);
      if (s && s.title === bm.tocTitle) return s.span > 1 ? `${s.title} · ${s.index}/${s.span}쪽` : s.title;
    }
  }
  return bookmarkText(bm);
}

// 학생에게 보일 교재: 카테고리마다 '지금 교재'와 그 앞 순서의 교재
// tracks = { 카테고리ID: 지금교재ID }
export function visibleBookIds(tracks, books) {
  const out = [];
  for (const [cat, cur] of Object.entries(tracks || {})) {
    const curBook = books.find((b) => b.id === cur);
    if (!curBook) continue;
    books.filter((b) => b.categoryId === cat && (b.order || 0) <= (curBook.order || 0)).forEach((b) => out.push(b.id));
  }
  return [...new Set(out)];
}

export const byOrder = (a, b) => (a.order || 0) - (b.order || 0) || String(a.title || a.name).localeCompare(String(b.title || b.name), 'ko');

// 날짜 입력값(YYYY-MM-DD) ↔ 밀리초
export const dayStart = (s) => new Date(s + 'T00:00:00').getTime();
export const ymd = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// 좋아요 문서 ID (학생·교재·곡마다 하나)
export const likeId = (sid, bookId, song) => `${sid}__${bookId}__${Array.from(new TextEncoder().encode(song)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 300)}`;

// 곡 정보 문서 id: 교재 id + 곡 이름(16진수)
export const songInfoId = (bookId, song) => `${bookId}__${Array.from(new TextEncoder().encode(song)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 600)}`;
