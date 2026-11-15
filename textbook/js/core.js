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
