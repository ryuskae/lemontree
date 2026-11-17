// 체험 모드 저장소: 이 브라우저의 localStorage에만 저장되는 시험용 데이터
// Firebase 저장소(store-firebase.js)와 똑같은 함수들을 제공한다.

import { normName, normBirth, visibleBookIds, likeId, byOrder, songInfoId } from './core.js';

const KEY = 'lt-demo-v2';
const SESSION_KEY = 'lt-demo-session';

const DEMO_TOC = [
  { t: '1단원 개방현과 기초 음계', p: 2 },
  { t: '연습곡 1 6번줄', p: 3 },
  { t: '연습곡 2 5번줄', p: 4 },
  { t: '연습곡 3 4번줄', p: 5 },
  { t: '2단원 할아버지의 낡은 시계', p: 6 },
  { t: '3단원 헨델의 미뉴에트', p: 9 },
  { t: '복습', p: 11 },
];

function seed() {
  const now = Date.now();
  const day = 86400000;
  return {
    categories: {
      c1: { name: '일렉기타', order: 1 },
      c2: { name: '클래식기타', order: 2 },
    },
    students: {
      s1: { name: '민준', active: true, tracks: { c1: 'b1', c2: 'b3' }, visible: ['b1', 'b2', 'b3'], lastSeen: now - day, createdAt: now - 30 * day },
      s2: { name: '서연', active: true, tracks: { c1: 'b1' }, visible: ['b1'], lastSeen: now - 3 * day, createdAt: now - 20 * day },
      s3: { name: '지호', active: true, tracks: {}, visible: [], lastSeen: null, createdAt: now - 2 * day },
    },
    secrets: { s1: { birth: '0315' }, s2: { birth: '1102' }, s3: { birth: '0707' } },
    books: {
      b1: { title: '체험용 일렉기타 1권', categoryId: 'c1', order: 1, src: 'samples/demo-book.pdf', toc: DEMO_TOC, tocPages: 12, numPages: 12, coverSingle: true, downloadable: true, createdAt: now - 30 * day },
      b4: { title: '체험용 일렉기타 2권', categoryId: 'c1', order: 2, src: 'samples/demo-book.pdf', toc: DEMO_TOC, tocPages: 12, numPages: 12, coverSingle: true, downloadable: false, createdAt: now - 30 * day },
      b2: { title: '헨델 미뉴에트', categoryId: 'c2', order: 1, src: 'samples/minuet.pdf', toc: [{ t: '미뉴에트 7', p: 1 }], tocPages: 1, numPages: 1, coverSingle: false, downloadable: false, createdAt: now - 30 * day },
      b3: { title: '할아버지의 낡은 시계', categoryId: 'c2', order: 2, src: 'samples/clock.pdf', toc: [{ t: '할아버지의 낡은 시계', p: 1 }], tocPages: 2, numPages: 2, coverSingle: false, downloadable: true, createdAt: now - 10 * day },
    },
    progress: {
      s1: {
        b1: { bm: { page: 4, tocTitle: '연습곡 2 5번줄', offset: 0, numPages: 12, savedAt: now - day }, lastPage: 4, lastAt: now - day },
        b3: { bm: { page: 2, tocTitle: '할아버지의 낡은 시계', offset: 1, numPages: 2, savedAt: now - 2 * day }, lastPage: 2, lastAt: now - 2 * day },
      },
      s2: { b1: { bm: { page: 7, tocTitle: '2단원 할아버지의 낡은 시계', offset: 1, numPages: 12, savedAt: now - 3 * day }, lastPage: 7, lastAt: now - 3 * day } },
    },
    sessions: {
      x1: { sid: 's1', name: '민준', kind: 'read', bookId: 'b1', bookTitle: '체험용 일렉기타 1권', mode: 'academy', start: now - day, seconds: 1260, minPage: 3, maxPage: 4, pagesSeen: 2 },
      x2: { sid: 's1', name: '민준', kind: 'read', bookId: 'b3', bookTitle: '할아버지의 낡은 시계', mode: 'home', start: now - 2 * day, seconds: 540, minPage: 1, maxPage: 2, pagesSeen: 2 },
      x3: { sid: 's2', name: '서연', kind: 'read', bookId: 'b1', bookTitle: '체험용 일렉기타 1권', mode: 'academy', start: now - 3 * day, seconds: 1500, minPage: 6, maxPage: 7, pagesSeen: 2 },
      x4: { sid: 's2', name: '서연', kind: 'read', bookId: 'b1', bookTitle: '체험용 일렉기타 1권', mode: 'home', start: now - 40 * day, seconds: 900, minPage: 3, maxPage: 5, pagesSeen: 3 },
    },
    likes: Object.fromEntries([
      { sid: 's1', name: '민준', bookId: 'b3', bookTitle: '할아버지의 낡은 시계', song: '할아버지의 낡은 시계', at: now - 2 * day },
      { sid: 's2', name: '서연', bookId: 'b1', bookTitle: '체험용 일렉기타 1권', song: '2단원 할아버지의 낡은 시계', at: now - 3 * day },
      { sid: 's1', name: '민준', bookId: 'b1', bookTitle: '체험용 일렉기타 1권', song: '3단원 헨델의 미뉴에트', at: now - day },
    ].map((l) => [likeId(l.sid, l.bookId, l.song), l])),
    kiosk: { password: '' },
  };
}

let db = null;
const load = () => {
  try { db = JSON.parse(localStorage.getItem(KEY)) || seed(); } catch { db = seed(); }
};
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* 저장 공간이 없으면 메모리에만 둔다 */ } };
const uid = () => Math.random().toString(36).slice(2, 10);
const clone = (o) => JSON.parse(JSON.stringify(o));
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

let session = null;
const setSession = (s) => {
  session = s;
  try { s ? localStorage.setItem(SESSION_KEY, JSON.stringify(s)) : localStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ }
  return s;
};

export const demo = true;

export async function init() {
  load();
  try { session = JSON.parse(localStorage.getItem(SESSION_KEY)); } catch { session = null; }
  return session;
}

export function currentSession() { return session; }

export async function loginStudent(name, birth) {
  await wait();
  const n = normName(name), b = normBirth(birth);
  const id = Object.keys(db.students).find((k) => normName(db.students[k].name) === n);
  if (!id || db.secrets[id]?.birth !== b) throw new Error('이름이나 생일이 맞지 않습니다.');
  if (!db.students[id].active) throw new Error('지금은 사용할 수 없는 계정입니다. 선생님께 문의해 주세요.');
  return setSession({ role: 'student', uid: id, name: db.students[id].name });
}

export async function loginAdmin() {
  await wait();
  return setSession({ role: 'admin', uid: 'admin', name: '선생님' });
}

export async function checkKioskPassword(password) {
  await wait();
  if (db.kiosk.password && password !== db.kiosk.password) throw new Error('비밀번호가 맞지 않습니다.');
}

export async function registerKiosk(password) {
  await wait();
  if (!db.kiosk.password) throw new Error('관리자 페이지의 설정 탭에서 학원 태블릿 비밀번호를 먼저 만들어 주세요.');
  if (password !== db.kiosk.password) throw new Error('비밀번호가 맞지 않습니다.');
  return setSession({ role: 'kiosk', uid: 'kiosk', name: '학원 태블릿' });
}

export async function logout() { setSession(null); }

// 학생
export async function listStudents() {
  return Object.entries(db.students).map(([id, s]) => ({ id, ...clone(s) }));
}
export async function getStudent(id) {
  const s = db.students[id];
  return s ? { id, ...clone(s) } : null;
}
export async function addStudent(name, birth) {
  await wait();
  const n = normName(name);
  if (Object.values(db.students).some((s) => normName(s.name) === n)) {
    throw new Error(`이미 '${n}' 학생이 있습니다. '${n}B'처럼 구분할 수 있는 이름으로 등록해 주세요.`);
  }
  const id = 's' + uid();
  db.students[id] = { name: n, active: true, tracks: {}, visible: [], lastSeen: null, createdAt: Date.now() };
  db.secrets[id] = { birth: normBirth(birth) };
  save();
  return id;
}
export async function updateStudent(id, patch) { Object.assign(db.students[id], clone(patch)); save(); }
export async function getBirth(id) { return db.secrets[id]?.birth || ''; }
export async function setBirth(id, birth) { db.secrets[id] = { birth: normBirth(birth) }; save(); }
export async function touchStudent(id) { if (db.students[id]) { db.students[id].lastSeen = Date.now(); save(); } }

// 교재
export async function listBooks() {
  return Object.entries(db.books).map(([id, b]) => ({ id, ...clone(b) })).sort(byOrder);
}
export async function getBook(id) { const b = db.books[id]; return b ? { id, ...clone(b) } : null; }
export async function getBooks(ids) { return (await Promise.all((ids || []).map(getBook))).filter(Boolean); }
export async function addBook(data) {
  const id = 'b' + uid();
  const order = Math.max(0, ...Object.values(db.books).filter((b) => b.categoryId === (data.categoryId || null)).map((b) => b.order || 0)) + 1;
  db.books[id] = { toc: [], tocPages: 0, coverSingle: true, downloadable: false, categoryId: null, order, createdAt: Date.now(), ...clone(data) };
  save();
  return id;
}
export async function updateBook(id, patch) { Object.assign(db.books[id], clone(patch)); save(); }
export async function deleteBook(id) {
  delete db.books[id];
  for (const st of Object.values(db.students)) {
    for (const [c, b] of Object.entries(st.tracks || {})) if (b === id) delete st.tracks[c];
  }
  save();
  await refreshVisibleAll();
}

// 카테고리
export async function listCategories() {
  return Object.entries(db.categories).map(([id, c]) => ({ id, ...clone(c) })).sort(byOrder);
}
export async function addCategory(name) {
  const id = 'c' + uid();
  db.categories[id] = { name, order: Math.max(0, ...Object.values(db.categories).map((c) => c.order || 0)) + 1 };
  save();
  return id;
}
export async function updateCategory(id, patch) { Object.assign(db.categories[id], clone(patch)); save(); }
export async function deleteCategory(id) {
  if (Object.values(db.books).some((b) => b.categoryId === id)) throw new Error('카테고리 안에 교재가 있어요. 교재를 먼저 옮기거나 지워 주세요.');
  delete db.categories[id];
  for (const st of Object.values(db.students)) if (st.tracks) delete st.tracks[id];
  save();
}

// 학생이 지금 배우는 교재(카테고리마다 하나)와 그에 따라 보이는 교재
export async function setTracks(sid, tracks) {
  const books = await listBooks();
  db.students[sid].tracks = clone(tracks);
  db.students[sid].visible = visibleBookIds(tracks, books);
  save();
}
export async function refreshVisibleAll() {
  const books = await listBooks();
  for (const st of Object.values(db.students)) st.visible = visibleBookIds(st.tracks || {}, books);
  save();
}

// 진도
export async function getProgress(sid) { return clone(db.progress[sid] || {}); }
export async function getAllProgress() { return clone(db.progress); }
export async function saveBookmark(sid, bookId, bm) {
  db.progress[sid] = db.progress[sid] || {};
  db.progress[sid][bookId] = { ...(db.progress[sid][bookId] || {}), bm: clone(bm) };
  save();
}
export async function saveLastPage(sid, bookId, page) {
  db.progress[sid] = db.progress[sid] || {};
  db.progress[sid][bookId] = { ...(db.progress[sid][bookId] || {}), lastPage: page, lastAt: Date.now() };
  save();
}

// 기록
export async function startSession(data) {
  const id = 'x' + uid();
  db.sessions[id] = { start: Date.now(), seconds: 0, ...clone(data) };
  save();
  return id;
}
export async function updateSession(id, patch) {
  if (db.sessions[id]) { Object.assign(db.sessions[id], clone(patch)); save(); }
}
export async function listSessions(from, to = Date.now() + 86400000) {
  return Object.entries(db.sessions).map(([id, x]) => ({ id, ...clone(x) }))
    .filter((x) => x.start >= from && x.start < to).sort((a, b) => b.start - a.start);
}

// 좋아요
export async function getMyLikes(sid) {
  return Object.values(db.likes).filter((l) => l.sid === sid).map(clone);
}
export async function setLike(sid, name, book, song, on) {
  const id = likeId(sid, book.id, song);
  if (on) db.likes[id] = { sid, name, bookId: book.id, bookTitle: book.title, song, at: Date.now() };
  else delete db.likes[id];
  save();
}
export async function listLikes() { return Object.values(db.likes).map(clone); }

// 학원 태블릿
export async function kioskStatus() { return { exists: !!db.kiosk.password }; }
export async function createKiosk(password) { db.kiosk.password = password; save(); }

export async function resetDemo() { db = seed(); save(); setSession(null); }

// 곡 정보
export async function getSongInfo(bookId, song) {
  await wait();
  const v = (db.songInfo || {})[songInfoId(bookId, song)];
  return v ? clone(v) : null;
}
export async function setSongInfo(book, song, { text, images }) {
  await wait();
  db.songInfo = db.songInfo || {};
  db.songInfo[songInfoId(book.id, song)] = { bookId: book.id, song, text: text || '', images: images || [], updatedAt: Date.now() };
  const infoSongs = [...new Set([...(db.books[book.id].infoSongs || []), song])];
  db.books[book.id].infoSongs = infoSongs;
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { throw new Error('체험 모드의 저장 공간이 가득 찼어요. 사진 수를 줄여 주세요.'); }
  return infoSongs;
}
export async function deleteSongInfo(book, song) {
  await wait();
  delete (db.songInfo || {})[songInfoId(book.id, song)];
  const infoSongs = (db.books[book.id].infoSongs || []).filter((t) => t !== song);
  db.books[book.id].infoSongs = infoSongs; save();
  return infoSongs;
}
export async function renameSongInfo(book, from, to) {
  const old = (db.songInfo || {})[songInfoId(book.id, from)];
  if (!old) return db.books[book.id].infoSongs || [];
  db.songInfo[songInfoId(book.id, to)] = { ...old, song: to };
  delete db.songInfo[songInfoId(book.id, from)];
  const infoSongs = (db.books[book.id].infoSongs || []).map((t) => (t === from ? to : t));
  db.books[book.id].infoSongs = infoSongs; save();
  return infoSongs;
}
