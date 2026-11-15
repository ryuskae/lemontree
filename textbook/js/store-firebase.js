// 실제 모드 저장소: Firebase 인증 + Firestore
// 보안은 firestore.rules가 맡는다. 이 파일은 화면에서 쓰는 함수만 제공한다.

import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, signInWithRedirect, GoogleAuthProvider, signOut, updatePassword,
  setPersistence, inMemoryPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where, orderBy, limit,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { config } from './config.js';
import { normName, normBirth, visibleBookIds, likeId, byOrder } from './core.js';

export const demo = false;

const DOMAIN = 'lemontree-textbook.app';
const app = initializeApp(config.firebase);
const auth = getAuth(app);
let db;
try {
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
} catch {
  db = initializeFirestore(app, {});
}

// 한글 이름을 로그인용 이메일로 바꾼다 (실제로 메일이 가지는 않는다)
const hex = (s) => Array.from(new TextEncoder().encode(s)).map((b) => b.toString(16).padStart(2, '0')).join('');
const studentEmail = (name) => `s${hex(normName(name))}@${DOMAIN}`;
const studentPassword = (birth) => `lt-${normBirth(birth)}-guitar`;
const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : v || null);
const plain = (snap) => {
  const d = snap.data() || {};
  for (const k of ['lastSeen', 'createdAt', 'start']) if (d[k]) d[k] = ms(d[k]);
  return { id: snap.id, ...d };
};

let session = null;

async function resolveSession(user) {
  if (!user) return null;
  const email = user.email || '';
  if (email.startsWith('kiosk-') && email.endsWith('@' + DOMAIN)) {
    const r = await getDoc(doc(db, 'roles', user.uid)).catch(() => null);
    if (r && r.exists() && r.data().role === 'kiosk') return { role: 'kiosk', uid: user.uid, name: '학원 태블릿' };
    await signOut(auth);
    throw new Error('이 태블릿 등록이 해제되었습니다. 새 비밀번호로 다시 등록해 주세요.');
  }
  if (email.endsWith('@' + DOMAIN)) {
    const s = await getDoc(doc(db, 'students', user.uid));
    if (!s.exists() || !s.data().active) {
      await signOut(auth);
      throw new Error('지금은 사용할 수 없는 계정입니다. 선생님께 문의해 주세요.');
    }
    return { role: 'student', uid: user.uid, name: s.data().name };
  }
  // 구글 계정: 관리자 전용 문서를 읽을 수 있으면 관리자
  try {
    await getDoc(doc(db, 'adminCheck', 'ping'));
  } catch (e) {
    // 권한 거부일 때만 관리자가 아니다. 인터넷이 끊긴 경우에는 로그인 상태를 유지한다 (데이터는 보안 규칙이 지킨다)
    if (e.code === 'permission-denied') {
      await signOut(auth);
      throw new Error('관리자 계정이 아닙니다.');
    }
  }
  return { role: 'admin', uid: user.uid, name: user.displayName || '선생님' };
}

export function init() {
  return new Promise((resolve) => {
    const off = onAuthStateChanged(auth, async (user) => {
      off();
      try { session = await resolveSession(user); } catch { session = null; }
      resolve(session);
    });
  });
}

export function currentSession() { return session; }

export async function loginStudent(name, birth) {
  try {
    const cred = await signInWithEmailAndPassword(auth, studentEmail(name), studentPassword(birth));
    session = await resolveSession(cred.user);
    return session;
  } catch (e) {
    if (String(e.code || '').startsWith('auth/')) {
      if (e.code === 'auth/too-many-requests') throw new Error('여러 번 틀려서 잠시 막혔습니다. 조금 뒤에 다시 해 주세요.');
      if (e.code === 'auth/network-request-failed') throw new Error('인터넷 연결을 확인해 주세요.');
      throw new Error('이름이나 생일이 맞지 않습니다.');
    }
    throw e;
  }
}

export async function loginAdmin() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  let cred;
  try {
    cred = await signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw e;
  }
  session = await resolveSession(cred.user);
  return session;
}

export async function registerKiosk(password) {
  const info = await getDoc(doc(db, 'publicInfo', 'kiosk'));
  if (!info.exists()) throw new Error('관리자 페이지의 설정 탭에서 학원 태블릿 비밀번호를 먼저 만들어 주세요.');
  try {
    const cred = await signInWithEmailAndPassword(auth, info.data().email, password);
    session = await resolveSession(cred.user);
    return session;
  } catch (e) {
    if (String(e.code || '').startsWith('auth/')) throw new Error('비밀번호가 맞지 않습니다.');
    throw e;
  }
}

export async function logout() { await signOut(auth); session = null; }

// 관리자가 다른 계정을 만들 때 쓰는 보조 인증 (관리자 로그인은 그대로 유지된다)
async function withSecondaryAuth(fn) {
  const sec = initializeApp(config.firebase, 'secondary-' + Date.now());
  const sAuth = getAuth(sec);
  await setPersistence(sAuth, inMemoryPersistence);
  try { return await fn(sAuth); } finally { await signOut(sAuth).catch(() => {}); await deleteApp(sec).catch(() => {}); }
}

// 학생
export async function listStudents() {
  const snap = await getDocs(collection(db, 'students'));
  return snap.docs.map(plain);
}
export async function getStudent(id) {
  const s = await getDoc(doc(db, 'students', id));
  return s.exists() ? plain(s) : null;
}
export async function addStudent(name, birth) {
  const n = normName(name), b = normBirth(birth);
  const uid = await withSecondaryAuth(async (sAuth) => {
    try {
      const cred = await createUserWithEmailAndPassword(sAuth, studentEmail(n), studentPassword(b));
      return cred.user.uid;
    } catch (e) {
      if (e.code === 'auth/email-already-in-use') {
        // 예전에 지웠던 학생이면 같은 계정을 다시 살린다
        try {
          const cred = await signInWithEmailAndPassword(sAuth, studentEmail(n), studentPassword(b));
          return cred.user.uid;
        } catch {
          throw new Error(`이미 '${n}' 학생 계정이 있습니다. '${n}B'처럼 구분할 수 있는 이름으로 등록해 주세요.`);
        }
      }
      throw e;
    }
  });
  await setDoc(doc(db, 'students', uid), { name: n, active: true, tracks: {}, visible: [], lastSeen: null, createdAt: Date.now() }, { merge: true });
  await setDoc(doc(db, 'studentSecrets', uid), { birth: b });
  return uid;
}
export async function updateStudent(id, patch) { await updateDoc(doc(db, 'students', id), patch); }
export async function getBirth(id) {
  const s = await getDoc(doc(db, 'studentSecrets', id));
  return s.exists() ? s.data().birth : '';
}
export async function setBirth(id, birth) {
  const st = await getStudent(id);
  const old = await getBirth(id);
  await withSecondaryAuth(async (sAuth) => {
    const cred = await signInWithEmailAndPassword(sAuth, studentEmail(st.name), studentPassword(old));
    await updatePassword(cred.user, studentPassword(birth));
  });
  await setDoc(doc(db, 'studentSecrets', id), { birth: normBirth(birth) });
}
export async function touchStudent(id) { await updateDoc(doc(db, 'students', id), { lastSeen: Date.now() }).catch(() => {}); }

// 교재
export async function listBooks() {
  const snap = await getDocs(collection(db, 'books'));
  return snap.docs.map(plain).sort(byOrder);
}
export async function getBook(id) {
  try {
    const s = await getDoc(doc(db, 'books', id));
    return s.exists() ? plain(s) : null;
  } catch { return null; }
}
export async function getBooks(ids) { return (await Promise.all((ids || []).map(getBook))).filter(Boolean); }
export async function addBook(data) {
  const all = await listBooks();
  const order = Math.max(0, ...all.filter((b) => (b.categoryId || null) === (data.categoryId || null)).map((b) => b.order || 0)) + 1;
  const ref = await addDoc(collection(db, 'books'), { toc: [], tocPages: 0, coverSingle: true, downloadable: false, categoryId: null, order, createdAt: Date.now(), ...data });
  return ref.id;
}
export async function updateBook(id, patch) { await updateDoc(doc(db, 'books', id), patch); }
export async function deleteBook(id) {
  await deleteDoc(doc(db, 'books', id));
  const studs = await listStudents();
  await Promise.all(studs.filter((st) => Object.values(st.tracks || {}).includes(id)).map((st) => {
    const tracks = { ...st.tracks };
    for (const [c, b] of Object.entries(tracks)) if (b === id) delete tracks[c];
    return updateStudent(st.id, { tracks });
  }));
  await refreshVisibleAll();
}

// 카테고리
export async function listCategories() {
  const snap = await getDocs(collection(db, 'categories'));
  return snap.docs.map(plain).sort(byOrder);
}
export async function addCategory(name) {
  const all = await listCategories();
  const ref = await addDoc(collection(db, 'categories'), { name, order: Math.max(0, ...all.map((c) => c.order || 0)) + 1 });
  return ref.id;
}
export async function updateCategory(id, patch) { await updateDoc(doc(db, 'categories', id), patch); }
export async function deleteCategory(id) {
  const books = await listBooks();
  if (books.some((b) => b.categoryId === id)) throw new Error('카테고리 안에 교재가 있어요. 교재를 먼저 옮기거나 지워 주세요.');
  await deleteDoc(doc(db, 'categories', id));
  const studs = await listStudents();
  await Promise.all(studs.filter((st) => st.tracks && st.tracks[id]).map((st) => {
    const tracks = { ...st.tracks }; delete tracks[id];
    return updateStudent(st.id, { tracks });
  }));
}

// 학생이 지금 배우는 교재(카테고리마다 하나)와 그에 따라 보이는 교재
export async function setTracks(sid, tracks) {
  const books = await listBooks();
  await updateDoc(doc(db, 'students', sid), { tracks, visible: visibleBookIds(tracks, books) });
}
export async function refreshVisibleAll() {
  const [books, studs] = await Promise.all([listBooks(), listStudents()]);
  await Promise.all(studs.map((st) => {
    const v = visibleBookIds(st.tracks || {}, books);
    if (JSON.stringify(v) === JSON.stringify(st.visible || [])) return null;
    return updateDoc(doc(db, 'students', st.id), { visible: v });
  }));
}

// 진도: progress/{학생} = { books: { 교재ID: { bm, lastPage, lastAt } } }
export async function getProgress(sid) {
  const s = await getDoc(doc(db, 'progress', sid));
  return s.exists() ? s.data().books || {} : {};
}
export async function getAllProgress() {
  const snap = await getDocs(collection(db, 'progress'));
  const out = {};
  snap.docs.forEach((d) => { out[d.id] = d.data().books || {}; });
  return out;
}
export async function saveBookmark(sid, bookId, bm) {
  await setDoc(doc(db, 'progress', sid), { books: { [bookId]: { bm } } }, { merge: true });
}
export async function saveLastPage(sid, bookId, page) {
  await setDoc(doc(db, 'progress', sid), { books: { [bookId]: { lastPage: page, lastAt: Date.now() } } }, { merge: true });
}

// 기록
export async function startSession(data) {
  const ref = await addDoc(collection(db, 'sessions'), { start: Date.now(), seconds: 0, ...data });
  return ref.id;
}
export async function updateSession(id, patch) { await updateDoc(doc(db, 'sessions', id), patch).catch(() => {}); }
export async function listSessions(from, to = Date.now() + 86400000) {
  const snap = await getDocs(query(collection(db, 'sessions'), where('start', '>=', from), where('start', '<', to), orderBy('start', 'desc'), limit(3000)));
  return snap.docs.map(plain);
}

// 좋아요: likes/{학생__교재__곡}
export async function getMyLikes(sid) {
  const snap = await getDocs(query(collection(db, 'likes'), where('sid', '==', sid)));
  return snap.docs.map(plain);
}
export async function setLike(sid, name, book, song, on) {
  const ref = doc(db, 'likes', likeId(sid, book.id, song));
  if (on) await setDoc(ref, { sid, name, bookId: book.id, bookTitle: book.title, song, at: Date.now() });
  else await deleteDoc(ref);
}
export async function listLikes() {
  const snap = await getDocs(collection(db, 'likes'));
  return snap.docs.map(plain);
}

// 학원 태블릿 계정: 만들 때마다 새 계정을 만들고 이전 계정의 권한은 지운다
export async function kioskStatus() {
  const s = await getDoc(doc(db, 'publicInfo', 'kiosk'));
  return { exists: s.exists() };
}
export async function createKiosk(password) {
  const email = `kiosk-${Math.random().toString(36).slice(2, 8)}@${DOMAIN}`;
  const uid = await withSecondaryAuth(async (sAuth) => (await createUserWithEmailAndPassword(sAuth, email, password)).user.uid);
  const old = await getDocs(query(collection(db, 'roles'), where('role', '==', 'kiosk')));
  await Promise.all(old.docs.map((d) => deleteDoc(d.ref)));
  await setDoc(doc(db, 'roles', uid), { role: 'kiosk', email, createdAt: Date.now() });
  await setDoc(doc(db, 'publicInfo', 'kiosk'), { email });
}

export { serverTimestamp };
