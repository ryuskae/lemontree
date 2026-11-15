// 체험 모드 저장소: 이 브라우저의 localStorage에만 저장되는 시험용 데이터
// Firebase 저장소(store-firebase.js)와 똑같은 함수들을 제공한다.

import { normName, normBirth } from './core.js';

const KEY = 'lt-demo-v1';
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
  const db = {
    students: {
      s1: { name: '민준', active: true, assigned: ['b1', 'b2'], current: 'b1', lastSeen: now - day, createdAt: now - 30 * day },
      s2: { name: '서연', active: true, assigned: ['b1'], current: 'b1', lastSeen: now - 3 * day, createdAt: now - 20 * day },
      s3: { name: '지호', active: true, assigned: [], current: null, lastSeen: null, createdAt: now - 2 * day },
    },
    secrets: { s1: { birth: '0315' }, s2: { birth: '1102' }, s3: { birth: '0707' } },
    books: {
      b1: { title: '체험용 기타 교재', src: 'samples/demo-book.pdf', toc: DEMO_TOC, tocPages: 12, numPages: 12, coverSingle: true, downloadable: true, order: 1, createdAt: now - 30 * day },
      b2: { title: '헨델 미뉴에트 (오선+타브)', src: 'samples/minuet.pdf', toc: [], tocPages: 0, numPages: 1, coverSingle: false, downloadable: false, order: 2, createdAt: now - 30 * day },
      b3: { title: '할아버지의 낡은 시계', src: 'samples/clock.pdf', toc: [], tocPages: 0, numPages: 2, coverSingle: false, downloadable: true, order: 3, createdAt: now - 10 * day },
    },
    progress: {
      s1: { b1: { bm: { page: 4, tocTitle: '연습곡 2 5번줄', offset: 0, numPages: 12, savedAt: now - day }, lastPage: 4, lastAt: now - day } },
      s2: { b1: { bm: { page: 7, tocTitle: '2단원 할아버지의 낡은 시계', offset: 1, numPages: 12, savedAt: now - 3 * day }, lastPage: 7, lastAt: now - 3 * day } },
    },
    sessions: {
      x1: { sid: 's1', name: '민준', kind: 'read', bookId: 'b1', bookTitle: '체험용 기타 교재', mode: 'academy', start: now - day, seconds: 1260, minPage: 3, maxPage: 4, pagesSeen: 2 },
      x2: { sid: 's1', name: '민준', kind: 'read', bookId: 'b1', bookTitle: '체험용 기타 교재', mode: 'home', start: now - 2 * day, seconds: 540, minPage: 3, maxPage: 3, pagesSeen: 1 },
      x3: { sid: 's2', name: '서연', kind: 'read', bookId: 'b1', bookTitle: '체험용 기타 교재', mode: 'academy', start: now - 3 * day, seconds: 1500, minPage: 6, maxPage: 7, pagesSeen: 2 },
    },
    kiosk: { password: '' },
  };
  return db;
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
  db.students[id] = { name: n, active: true, assigned: [], current: null, lastSeen: null, createdAt: Date.now() };
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
  return Object.entries(db.books).map(([id, b]) => ({ id, ...clone(b) })).sort((a, b) => (a.order || 0) - (b.order || 0));
}
export async function getBook(id) { const b = db.books[id]; return b ? { id, ...clone(b) } : null; }
export async function getBooks(ids) { return (await Promise.all((ids || []).map(getBook))).filter(Boolean); }
export async function addBook(data) {
  const id = 'b' + uid();
  const order = Math.max(0, ...Object.values(db.books).map((b) => b.order || 0)) + 1;
  db.books[id] = { toc: [], tocPages: 0, coverSingle: true, downloadable: false, order, createdAt: Date.now(), ...clone(data) };
  save();
  return id;
}
export async function updateBook(id, patch) { Object.assign(db.books[id], clone(patch)); save(); }
export async function deleteBook(id) {
  delete db.books[id];
  for (const s of Object.values(db.students)) {
    s.assigned = (s.assigned || []).filter((b) => b !== id);
    if (s.current === id) s.current = null;
  }
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
export async function listSessions(days = 30) {
  const since = Date.now() - days * 86400000;
  return Object.entries(db.sessions).map(([id, s]) => ({ id, ...clone(s) }))
    .filter((s) => s.start >= since).sort((a, b) => b.start - a.start);
}

// 학원 태블릿
export async function kioskStatus() { return { exists: !!db.kiosk.password }; }
export async function createKiosk(password) { db.kiosk.password = password; save(); }

export async function resetDemo() { db = seed(); save(); setSession(null); }
