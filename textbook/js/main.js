// 레몬트리 전자 교재: 화면 전환과 각 화면 (로그인, 학생 홈, 학원 태블릿, 관리자)

import { config, APP_VERSION } from './config.js';
import { h, $, toast, sheet, confirmBox, spinner, busy, icon, toggleSwitch } from './ui.js';
import { openReader } from './reader.js';
import { driveMeta, loadPdf, clearPdfCache } from './pdfsource.js';
import {
  normName, normBirth, isValidBirth, sortToc, makeBookmark, parseDriveId, fmtDate, fmtMinutes,
  songAt, progressLabel, byOrder, dayStart, ymd,
} from './core.js';

const app = $('#app');
let store;
let session = null;
let reader = null;
const ACADEMY = config.academyName || '레몬트리';
const logo = (cls = '') => h('img', { src: 'icons/logo.png', class: 'logo-img ' + cls, alt: '' });

// ---------------- 시작 ----------------
async function boot() {
  app.replaceChildren(spinner('불러오는 중…'));
  store = config.firebase ? await import('./store-firebase.js') : await import('./store-demo.js');
  try { session = await store.init(); } catch { session = null; }
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

const isManageUrl = () => new URLSearchParams(location.search).has('manage');
const goManage = () => { if (isManageUrl()) nav('#/'); else location.href = location.pathname + '?manage#/'; };
const nav = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const hashQuery = () => new URLSearchParams(location.hash.split('?')[1] || '');

async function route() {
  if (reader) { const r = reader; reader = null; await r.exit(false); }
  const parts = location.hash.replace(/^#\/?/, '').split('?')[0].split('/').filter(Boolean);
  session = store.currentSession();
  if (!session) return viewLogin();
  if (session.role === 'admin') {
    if (parts[0] === 'read' && parts[1]) return viewRead({ bookId: parts[1], role: 'admin' });
    return viewAdmin(parts);
  }
  if (session.role === 'kiosk') {
    if (parts[0] === 'k' && parts[1]) {
      if (parts[2] === 'read' && parts[3]) return viewRead({ bookId: parts[3], sid: parts[1], role: 'kiosk' });
      return viewStudentHome(parts[1], 'kiosk');
    }
    return viewKiosk();
  }
  if (parts[0] === 'read' && parts[1]) return viewRead({ bookId: parts[1], sid: session.uid, role: 'student' });
  return viewStudentHome(session.uid, 'student');
}

function demoBanner() {
  if (!store.demo) return null;
  return h('div', { class: 'demo-banner' }, '체험 모드 · 이 기기에만 저장되는 시험용 데이터입니다');
}
function shell(...kids) { app.replaceChildren(h('div', { class: 'page' }, demoBanner(), ...kids)); }

// ---------------- 로그인 ----------------
function viewLogin() {
  const name = h('input', { class: 'input big', placeholder: '예: 김민준', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'next' });
  // '03/15'처럼 빗금을 넣어도 숫자만 남겨 0315로 읽는다
  const birth = h('input', { class: 'input big', placeholder: '예: 0315', inputmode: 'numeric', maxlength: 5, autocomplete: 'off', enterkeyhint: 'go' });
  const msg = h('p', { class: 'form-msg' });
  const go = h('button', { class: 'btn primary big wide', type: 'submit' }, '들어가기');
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); birth.focus(); } });
  const form = h('form', { class: 'login-form', onsubmit: async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const n = normName(name.value), b = normBirth(birth.value);
    if (!n) { msg.textContent = '이름을 써 주세요.'; return name.focus(); }
    if (!isValidBirth(b)) { msg.textContent = '생일은 월과 날짜 4자리로 써 주세요. 3월 15일이면 0315예요.'; return birth.focus(); }
    busy(go, true, '확인하는 중…');
    try { session = await store.loginStudent(n, b); nav('#/'); } catch (err) { msg.textContent = err.message; } finally { busy(go, false); }
  } },
  h('h2', null, '내 교재 열기'),
  h('label', { class: 'field' }, h('span', null, '이름'), name),
  h('label', { class: 'field' }, h('span', null, '생일 4자리 (mm/dd)'), birth,
    h('small', { class: 'field-hint' }, '월 두 자리와 날짜 두 자리를 이어서 써요 · 3월 15일 → 0315, 11월 2일 → 1102')),
  msg, go,
  store.demo ? h('p', { class: 'hint' }, '체험: "민준" · 0315 또는 "서연" · 1102') : null);

  // 관리 주소(?manage)로 열었을 때만 선생님 로그인과 학원 태블릿 등록이 보인다
  const panel = isManageUrl()
    ? h('div', { class: 'login-form' },
      h('h2', null, '관리'),
      h('p', { class: 'muted' }, '선생님 로그인과 학원 태블릿 등록은 이 주소에서만 할 수 있어요.'),
      h('button', { class: 'btn primary big wide', type: 'button', onclick: adminLogin }, '선생님 로그인'),
      h('button', { class: 'btn big wide', type: 'button', onclick: registerTablet }, '이 기기를 학원 태블릿으로 등록'),
      h('div', { class: 'login-links' }, h('a', { class: 'linkish quiet', href: location.pathname + '#/' }, '학생 로그인 화면으로')),
      h('p', { class: 'hint' }, `앱 버전 · ${APP_VERSION}`))
    : form;

  shell(h('main', { class: 'login' },
    h('section', { class: 'login-hero' },
      h('div', { class: 'hero-logo' }, logo()),
      h('div', { class: 'hero-text' }, h('div', { class: 'eyebrow' }, ACADEMY), h('h1', null, '기타 교재'))),
    h('section', { class: 'login-panel' }, panel)));
}

// 학원 태블릿으로 등록했던 기기는 선생님 로그인 전에 학원 태블릿 비밀번호를 한 번 더 묻는다
const KIOSK_FLAG = 'lt-kiosk-device';
const isKioskDevice = () => { try { return localStorage.getItem(KIOSK_FLAG) === '1'; } catch { return false; } };
const setKioskDevice = (on) => { try { on ? localStorage.setItem(KIOSK_FLAG, '1') : localStorage.removeItem(KIOSK_FLAG); } catch {} };

async function askKioskPassword({ title, message, okText, danger }) {
  const res = await sheet((body, close) => {
    const pw = h('input', { class: 'input', type: 'password', placeholder: '학원 태블릿 비밀번호', autocomplete: 'off' });
    const msg = h('p', { class: 'form-msg' });
    const ok = h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: async () => {
      busy(ok, true);
      try { await store.checkKioskPassword(pw.value); close(true); }
      catch (e) { msg.textContent = e.message; pw.select(); } finally { busy(ok, false); }
    } }, okText);
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
    body.append(h('p', { class: 'sheet-msg' }, message), pw, msg, h('div', { class: 'row end' }, ok));
    setTimeout(() => pw.focus(), 50);
  }, { title });
  return res === true;
}

async function adminLogin() {
  if (isKioskDevice()) {
    const ok = await askKioskPassword({ title: '선생님 확인', message: '학원 태블릿으로 쓰던 기기예요. 학원 태블릿 비밀번호를 입력하면 선생님 로그인으로 넘어가요.', okText: '확인' });
    if (!ok) return;
  }
  try {
    const s = await store.loginAdmin();
    if (s) { session = s; nav('#/admin'); }
  } catch (e) { if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast(e.message, 'bad'); }
}

function registerTablet() {
  sheet((body, close) => {
    const pw = h('input', { class: 'input', type: 'password', placeholder: '학원 태블릿 비밀번호' });
    const msg = h('p', { class: 'form-msg' });
    const ok = h('button', { class: 'btn primary', onclick: async () => {
      busy(ok, true);
      try { session = await store.registerKiosk(pw.value); setKioskDevice(true); close(); nav('#/'); toast('이 태블릿을 학원 태블릿으로 등록했어요.', 'good'); }
      catch (e) { msg.textContent = e.message; } finally { busy(ok, false); }
    } }, '등록');
    body.append(h('p', { class: 'sheet-msg' }, '학원 태블릿으로 등록하면 학생들이 이름만 눌러서 들어올 수 있어요. 학원 기기에서만 등록해 주세요.'), pw, msg, h('div', { class: 'row end' }, ok));
    setTimeout(() => pw.focus(), 50);
  }, { title: '학원 태블릿 등록' });
}

function topbar(left, right) {
  return h('header', { class: 'topbar' }, h('div', { class: 'topbar-left' }, left), right ? h('div', { class: 'topbar-right' }, right) : null);
}
const brand = (text) => h('div', { class: 'brand' }, logo('sm'), h('span', null, text));

// ---------------- 학원 태블릿: 이름 고르기 ----------------
async function viewKiosk() {
  shell(spinner());
  let students = [];
  try { students = (await store.listStudents()).filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name, 'ko')); }
  catch { return shell(h('p', { class: 'pad' }, '학생 목록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); }
  shell(
    topbar(brand(`${ACADEMY} 기타 교재`)),
    h('main', { class: 'kiosk' },
      h('h2', { class: 'kiosk-title' }, '내 이름을 눌러 주세요'),
      students.length
        ? h('div', { class: 'name-grid' }, students.map((s) => h('button', { class: 'name-btn', onclick: () => nav(`#/k/${s.id}`) }, s.name)))
        : h('p', { class: 'center muted' }, '등록된 학생이 없어요. 관리자 페이지에서 학생을 추가해 주세요.'),
      h('div', { class: 'kiosk-foot' }, h('button', { class: 'linkish quiet', onclick: async () => {
        const ok = await askKioskPassword({ title: '학원 태블릿 등록 해제', message: '등록을 해제하려면 학원 태블릿 비밀번호를 입력해 주세요.', okText: '해제', danger: true });
        if (ok) { await store.logout(); setKioskDevice(false); goManage(); }
      } }, '학원 태블릿 등록 해제 (선생님용)'))));
}

// ---------------- 학생 홈: 카테고리별 내 교재 ----------------
async function viewStudentHome(sid, role) {
  shell(spinner());
  let st, books, prog, cats;
  try {
    st = await store.getStudent(sid);
    if (!st) throw new Error();
    [books, prog, cats] = await Promise.all([store.getBooks(st.visible || []), store.getProgress(sid), store.listCategories()]);
  } catch {
    return shell(h('p', { class: 'pad' }, '정보를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'),
      h('div', { class: 'pad' }, h('button', { class: 'btn', onclick: () => (role === 'kiosk' ? nav('#/') : store.logout().then(() => nav('#/'))) }, '처음으로')));
  }
  if (role === 'student') store.touchStudent(sid);
  const readHash = (bid) => (role === 'kiosk' ? `#/k/${sid}/read/${bid}` : `#/read/${bid}`);
  const tracks = st.tracks || {};
  const currentIds = new Set(Object.values(tracks));

  // 지금 교재: 큰 카드
  const currentCard = (b) => {
    const p = prog[b.id] || {};
    const total = p.bm?.numPages || b.numPages || 0;
    const pct = p.bm && total ? Math.min(100, Math.round((p.bm.page / total) * 100)) : 0;
    return h('button', { class: 'book-card current', onclick: () => nav(readHash(b.id)) },
      h('div', { class: 'book-top' }, h('span', { class: 'tag now' }, '지금 배우는 교재'), icon('chevron', 'book-chev')),
      h('div', { class: 'book-title' }, b.title),
      h('div', { class: 'book-mark' }, p.bm ? progressLabel(p.bm, b) : '아직 저장한 진도가 없어요'),
      total ? h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } })) : null,
      p.lastAt ? h('div', { class: 'muted small' }, `마지막으로 본 날 · ${fmtDate(p.lastAt)}`) : null);
  };
  // 배운 교재: 지금 교재 아래에 최근 것부터 쌓인다 (맨 아래가 1권)
  const pastRow = (b) => {
    const p = prog[b.id] || {};
    return h('button', { class: 'past-book', onclick: () => nav(readHash(b.id)) },
      h('span', { class: 'past-main' }, h('span', { class: 'past-title' }, b.title),
        h('span', { class: 'muted small' }, p.bm ? progressLabel(p.bm, b) : '저장한 진도 없음')),
      icon('chevron', 'book-chev'));
  };

  const columns = cats.filter((c) => tracks[c.id]).map((c) => {
    const list = books.filter((b) => b.categoryId === c.id).sort(byOrder).reverse();
    if (!list.length) return null;
    const cur = list.find((b) => currentIds.has(b.id));
    const past = list.filter((b) => b !== cur);
    return h('section', { class: 'shelf-col' },
      h('h3', { class: 'shelf-title' }, c.name),
      cur ? currentCard(cur) : null,
      past.length ? h('div', { class: 'past-stack' }, h('div', { class: 'past-label' }, '배운 교재'), past.map(pastRow)) : null);
  }).filter(Boolean);
  const sections = columns.length ? [h('div', { class: 'shelf-cols' }, columns)] : [];

  shell(
    topbar(brand(`${st.name}님`),
      role === 'kiosk'
        ? h('button', { class: 'btn ghost small', onclick: () => nav('#/') }, '처음으로')
        : h('button', { class: 'linkish quiet', onclick: async () => { if (await confirmBox('로그아웃할까요?', { ok: '로그아웃' })) { await store.logout(); nav('#/'); } } }, '로그아웃')),
    h('main', { class: 'student-home' },
      h('div', { class: 'home-hello' }, h('h1', null, '오늘도 연습해 볼까요?')),
      sections.length ? sections : h('div', { class: 'empty' }, '아직 배정된 교재가 없어요. 선생님께 말씀해 주세요.')));
}

// ---------------- 교재 보기 ----------------
async function viewRead({ bookId, sid, role }) {
  app.replaceChildren(spinner('교재를 여는 중…'));
  let book, entry = {}, st = null, likes = [];
  try {
    book = await store.getBook(bookId);
    if (!book) throw new Error('이 교재를 열 수 없어요.');
    if (sid) {
      st = await store.getStudent(sid);
      if (!st || !(st.visible || []).includes(bookId)) throw new Error('아직 볼 수 없는 교재예요.');
      const [prog, myLikes] = await Promise.all([store.getProgress(sid), store.getMyLikes(sid).catch(() => [])]);
      entry = prog[bookId] || {};
      likes = myLikes;
    }
  } catch (e) {
    app.replaceChildren(h('div', { class: 'page' }, h('p', { class: 'pad' }, e.message || '교재를 열 수 없어요.'),
      h('div', { class: 'pad' }, h('button', { class: 'btn', onclick: () => history.back() }, '돌아가기'))));
    return;
  }
  const back = role === 'admin' ? `#/admin/book/${bookId}` : role === 'kiosk' ? `#/k/${sid}` : '#/';
  const readBase = role === 'kiosk' ? `#/k/${sid}/read/` : '#/read/';
  reader = await openReader(app, {
    store, book, role, entry, likes,
    visibleIds: st?.visible || [],
    startSong: hashQuery().get('song') || null,
    onOpenSong: (bid, song) => nav(`${readBase}${bid}?song=${encodeURIComponent(song)}`),
    studentId: sid, studentName: st?.name,
    mode: role === 'kiosk' ? 'academy' : 'home',
    onExit: (viaButton) => { reader = null; if (viaButton) nav(back); },
  });
}

// ---------------- 관리자 ----------------
const ADMIN_TABS = [['students', '학생'], ['books', '교재'], ['logs', '기록'], ['settings', '설정']];

function adminShell(tab, ...kids) {
  shell(
    h('header', { class: 'topbar admin' },
      h('div', { class: 'topbar-left' }, brand('관리자')),
      h('nav', { class: 'tabs' }, ADMIN_TABS.map(([k, label]) => h('a', { href: `#/admin/${k}`, class: tab === k ? 'on' : '' }, label)))),
    h('main', { class: 'admin-main' }, ...kids));
}

async function viewAdmin(parts) {
  const tab = parts[1] || 'students';
  const tabOf = { student: 'students', 'new-student': 'students', book: 'books' };
  adminShell(tabOf[tab] || tab, spinner());
  try {
    if (tab === 'student' && parts[2]) return await adminStudent(parts[2]);
    if (tab === 'new-student') return await adminNewStudent();
    if (tab === 'book' && parts[2]) return await adminBook(parts[2]);
    if (tab === 'students') return await adminStudents();
    if (tab === 'books') return await adminBooks();
    if (tab === 'logs') return await adminLogs();
    if (tab === 'settings') return await adminSettings();
  } catch (e) {
    adminShell(tabOf[tab] || tab, h('p', { class: 'pad' }, `불러오지 못했어요: ${e.message}`));
  }
}

const sumSeconds = (sessions, sid) => sessions.filter((s) => s.sid === sid).reduce((a, s) => a + (s.seconds || 0), 0);

// 학생의 카테고리별 진도를 한 줄로: "일렉기타 2권 · 연습곡 3"
function trackLines(st, books, cats, prog) {
  const out = [];
  for (const c of cats) {
    const bid = st.tracks?.[c.id];
    if (!bid) continue;
    const b = books.find((x) => x.id === bid);
    if (!b) continue;
    const bm = prog?.[bid]?.bm;
    out.push(h('div', { class: 'track-line' }, h('span', { class: 'chip' }, c.name), h('strong', null, b.title), bm ? h('span', { class: 'muted' }, ` · ${progressLabel(bm, b)}`) : null));
  }
  return out.length ? out : [h('span', { class: 'muted' }, '배정된 교재 없음')];
}

async function adminStudents() {
  const [students, books, cats, allProg, sessions] = await Promise.all([
    store.listStudents(), store.listBooks(), store.listCategories(), store.getAllProgress(), store.listSessions(Date.now() - 7 * 86400000)]);
  students.sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'ko'));
  const rows = students.map((s) => {
    const wk = sumSeconds(sessions, s.id);
    return h('tr', { class: s.active ? '' : 'inactive', onclick: () => nav(`#/admin/student/${s.id}`) },
      h('td', { class: 'strong' }, s.name, s.active ? '' : h('span', { class: 'pill' }, '중지')),
      h('td', null, trackLines(s, books, cats, allProg[s.id])),
      h('td', { class: 'nowrap' }, fmtDate(s.lastSeen)),
      h('td', { class: 'nowrap' }, wk ? fmtMinutes(wk) : h('span', { class: 'muted' }, '0분')),
      h('td', { class: 'chev' }, icon('chevron')));
  });
  adminShell('students',
    h('div', { class: 'page-head' }, h('h2', null, `학생 ${students.filter((s) => s.active).length}명`),
      h('button', { class: 'btn primary', onclick: () => nav('#/admin/new-student') }, icon('plus'), '학생 추가')),
    h('section', { class: 'card flush' },
      students.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table clickable' },
          h('thead', null, h('tr', null, ['이름', '교재와 진도', '마지막 접속', '최근 7일 연습', ''].map((t) => h('th', null, t)))),
          h('tbody', null, rows)))
        : h('p', { class: 'muted pad' }, '아직 학생이 없어요.')));
}

// 카테고리별 '지금 교재'와 진도(곡)를 정하는 편집기
function progressEditor(cats, books, tracks, prog) {
  const rows = [];
  const box = h('div', { class: 'prog-editor' });
  const addBtn = h('button', { class: 'btn ghost small', type: 'button', onclick: () => { addRow({}); paint(); } }, icon('plus'), '카테고리 추가');

  function addRow(init) { rows.push({ cat: init.cat || '', book: init.book || '', song: init.song || '', songPage: init.songPage || 1 }); }
  for (const c of cats) {
    const bid = tracks?.[c.id];
    if (!bid) continue;
    const bm = prog?.[bid]?.bm;
    addRow({ cat: c.id, book: bid, song: bm?.tocTitle || '', songPage: (bm?.offset || 0) + 1 });
  }
  if (!rows.length) addRow({});

  const opt = (v, label, sel) => h('option', { value: v, selected: v === sel }, label);
  function paint() {
    box.replaceChildren(...rows.map((r, i) => {
      const used = new Set(rows.filter((x, k) => k !== i).map((x) => x.cat));
      const catSel = h('select', { class: 'input', onchange: (e) => { r.cat = e.target.value; r.book = ''; r.song = ''; paint(); } },
        opt('', '카테고리 고르기', r.cat), cats.filter((c) => !used.has(c.id)).map((c) => opt(c.id, c.name, r.cat)));
      const inCat = books.filter((b) => b.categoryId === r.cat).sort(byOrder);
      const bookSel = h('select', { class: 'input', disabled: !r.cat, onchange: (e) => { r.book = e.target.value; r.song = ''; paint(); } },
        opt('', '교재 고르기', r.book), inCat.map((b) => opt(b.id, b.title, r.book)));
      const book = books.find((b) => b.id === r.book);
      const toc = book ? sortToc(book.toc) : [];
      const songSel = h('select', { class: 'input', disabled: !toc.length, onchange: (e) => { r.song = e.target.value; r.songPage = 1; paint(); } },
        opt('', toc.length ? '곡 (선택 안 함)' : (book ? '목차 없음' : '곡'), r.song), toc.map((e) => opt(e.t, e.t, r.song)));
      let pageSel = null;
      const s = book && r.song ? songAt(book, toc.find((e) => e.t === r.song)?.p || 1) : null;
      if (s && s.span > 1) {
        pageSel = h('select', { class: 'input narrow', onchange: (e) => { r.songPage = +e.target.value; } },
          Array.from({ length: s.span }, (_, k) => h('option', { value: k + 1, selected: k + 1 === r.songPage }, `${k + 1}/${s.span}쪽`)));
      }
      return h('div', { class: 'prog-row' }, catSel, bookSel, songSel, pageSel || h('span'),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': '이 줄 지우기', onclick: () => { rows.splice(i, 1); if (!rows.length) addRow({}); paint(); } }, icon('close')));
    }), addBtn);
  }
  paint();
  return {
    el: box,
    value() {
      const out = { tracks: {}, marks: [] };
      for (const r of rows) {
        if (!r.cat || !r.book) continue;
        out.tracks[r.cat] = r.book;
        if (r.song) {
          const b = books.find((x) => x.id === r.book);
          const e = sortToc(b.toc).find((x) => x.t === r.song);
          if (e) { const page = e.p + (r.songPage || 1) - 1; out.marks.push({ book: b, page }); }
        }
      }
      return out;
    },
  };
}

async function saveProgress(sid, editor) {
  const v = editor.value();
  await store.setTracks(sid, v.tracks);
  for (const m of v.marks) {
    const n = m.book.numPages || m.book.tocPages || m.page;
    await store.saveBookmark(sid, m.book.id, makeBookmark(m.book, m.page, n));
  }
}

async function adminNewStudent() {
  const [books, cats] = await Promise.all([store.listBooks(), store.listCategories()]);
  const name = h('input', { class: 'input', placeholder: '이름' });
  const birth = h('input', { class: 'input', placeholder: '생일 4자리 (예: 0315)', inputmode: 'numeric', maxlength: 4 });
  const editor = progressEditor(cats, books, {}, {});
  const save = h('button', { class: 'btn primary', onclick: async () => {
    const n = normName(name.value), b = normBirth(birth.value);
    if (!n) return toast('이름을 써 주세요.', 'bad');
    if (!isValidBirth(b)) return toast('생일 4자리를 확인해 주세요. 3월 15일이면 0315예요.', 'bad');
    busy(save, true, '추가하는 중…');
    try {
      const id = await store.addStudent(n, b);
      await saveProgress(id, editor);
      toast(`학생을 추가했어요 · ${n}`, 'good');
      nav(`#/admin/student/${id}`);
    } catch (err) { toast(err.message, 'bad'); } finally { busy(save, false); }
  } }, '학생 추가');
  adminShell('students',
    h('a', { class: 'back-link', href: '#/admin/students' }, icon('back'), '학생 목록'),
    h('section', { class: 'card' }, h('h2', null, '학생 추가'),
      h('div', { class: 'form-grid' }, h('label', { class: 'field' }, h('span', null, '이름'), name), h('label', { class: 'field' }, h('span', null, '생일 4자리 (로그인 번호)'), birth)),
      h('p', { class: 'muted small' }, '같은 이름이 있으면 "민준B"처럼 구분해 주세요.')),
    h('section', { class: 'card' }, h('h3', null, '교재와 진도'),
      h('p', { class: 'muted small' }, '카테고리마다 지금 배우는 교재와 곡을 고르세요. 학생에게는 그 카테고리에서 지금 교재와 그 앞 교재만 보여요.'),
      cats.length ? editor.el : h('p', { class: 'muted' }, '교재 탭에서 카테고리와 교재를 먼저 만들어 주세요.')),
    h('div', { class: 'row end' }, save));
  setTimeout(() => name.focus(), 50);
}

async function adminStudent(id) {
  const since30 = Date.now() - 30 * 86400000;
  let [st, books, cats, prog, birthVal, sessions, likes] = await Promise.all([
    store.getStudent(id), store.listBooks(), store.listCategories(), store.getProgress(id), store.getBirth(id),
    store.listSessions(since30), store.listLikes().catch(() => [])]);
  if (!st) return adminShell('students', h('p', { class: 'pad' }, '학생을 찾을 수 없어요.'));
  const editor = progressEditor(cats, books, st.tracks || {}, prog);
  const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
    busy(saveBtn, true); try { await saveProgress(id, editor); toast('진도를 저장했어요.', 'good'); adminStudent(id); } catch (e) { toast(e.message, 'bad'); } finally { busy(saveBtn, false); }
  } }, '진도 저장');

  const visibleBooks = books.filter((b) => (st.visible || []).includes(b.id));
  const myLikes = likes.filter((l) => l.sid === id);
  const birthInput = h('input', { class: 'input narrow', value: birthVal, inputmode: 'numeric', maxlength: 4, placeholder: '0315' });
  // 학생 추가 도중 멈춰서 생일이 저장되지 않은 경우
  const noBirth = birthVal ? h('span') : h('div', { class: 'notice warn' }, '생일이 저장되지 않은 학생이에요. 처음 학생을 추가할 때 입력한 생일 4자리를 넣고 저장을 눌러 주세요.');
  adminShell('students',
    h('a', { class: 'back-link', href: '#/admin/students' }, icon('back'), '학생 목록'),
    h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', null, st.name),
        toggleSwitch({ checked: st.active, label: '계정', onText: '사용', offText: '사용 중지', onChange: async (on) => { await store.updateStudent(id, { active: on }); toast(on ? '사용으로 바꿨어요.' : '사용 중지했어요. 이 학생은 로그인할 수 없어요.'); } })),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, '생일(로그인 번호)'), birthInput,
        h('button', { class: 'btn small', onclick: async (e) => {
          const b = normBirth(birthInput.value);
          if (!isValidBirth(b)) return toast('생일 4자리를 확인해 주세요.', 'bad');
          if (b === birthVal) return;
          busy(e.target, true);
          try { await store.setBirth(id, b); birthVal = b; noBirth.remove(); toast(`생일을 저장했어요 · ${b}`, 'good'); }
          catch (err) { toast(err.message, 'bad'); } finally { busy(e.target, false); }
        } }, birthVal ? '변경' : '저장')),
      noBirth,
      h('p', { class: 'muted small' }, `마지막 접속 ${fmtDate(st.lastSeen)} · 최근 30일 연습 ${fmtMinutes(sumSeconds(sessions, id))}`)),
    h('section', { class: 'card' }, h('h3', null, '교재와 진도'),
      h('p', { class: 'muted small' }, '카테고리마다 지금 배우는 교재와 곡을 정하세요. 학생은 진도 저장 버튼으로 직접 바꿀 수도 있어요.'),
      editor.el, h('div', { class: 'row end' }, saveBtn)),
    h('section', { class: 'card' }, h('h3', null, '학생에게 보이는 교재'),
      visibleBooks.length ? h('div', { class: 'mini-list' }, visibleBooks.map((b) => h('div', { class: 'mini-row' },
        h('strong', null, b.title), h('span', { class: 'muted' }, prog[b.id]?.bm ? progressLabel(prog[b.id].bm, b) : '진도 없음')))) : h('p', { class: 'muted' }, '없음')),
    h('section', { class: 'card' }, h('h3', null, `좋아요 ${myLikes.length}곡`),
      myLikes.length ? h('div', { class: 'chips' }, myLikes.map((l) => h('span', { class: 'chip heart' }, `♥ ${l.song}`))) : h('p', { class: 'muted' }, '아직 없어요.')),
    h('section', { class: 'card' }, h('h3', null, '최근 30일 기록'), sessionTable(sessions.filter((s) => s.sid === id), false)));
}

// ---------------- 관리자: 교재와 카테고리 ----------------
async function adminBooks() {
  const [books, cats, students] = await Promise.all([store.listBooks(), store.listCategories(), store.listStudents()]);
  const opt = (v, label) => h('option', { value: v }, label);
  const link = h('input', { class: 'input', placeholder: '구글 드라이브 파일 링크' });
  const catPick = h('select', { class: 'input narrow' }, cats.map((c) => opt(c.id, c.name)), opt('', '분류 없음'));
  const addBtn = h('button', { class: 'btn primary', type: 'submit' }, '교재 추가');
  const addForm = h('form', { class: 'add-row', onsubmit: async (e) => {
    e.preventDefault();
    if (store.demo) return toast('체험 모드에서는 드라이브 교재를 추가할 수 없어요. Firebase 설정 후 사용할 수 있어요.', 'bad');
    const id = parseDriveId(link.value);
    if (!id) return toast('드라이브 파일 링크를 확인해 주세요.', 'bad');
    if (books.some((b) => b.driveId === id)) return toast('이미 추가된 교재예요.', 'bad');
    busy(addBtn, true, '확인하는 중…');
    try {
      const meta = await driveMeta(id);
      const title = meta.name.replace(/\.pdf$/i, '');
      const bid = await store.addBook({ title, driveId: id, categoryId: catPick.value || null, checkedVersion: null });
      toast(`교재를 추가했어요 · ${title}`, 'good');
      nav(`#/admin/book/${bid}`);
    } catch (err) { toast(err.message, 'bad'); } finally { busy(addBtn, false); }
  } }, link, catPick, addBtn);

  const learners = (bid) => students.filter((s) => s.active && (s.visible || []).includes(bid)).length;
  const statusCells = new Map();

  const swapOrder = async (list, i, j) => {
    const a = list[i], b = list[j];
    if (!a || !b) return;
    const oa = a.order || 0, ob = b.order || 0;
    // 순서 값이 같으면 위치로 다시 매긴다
    const na = oa === ob ? j + 1 : ob, nb = oa === ob ? i + 1 : oa;
    await Promise.all([store.updateBook(a.id, { order: na }), store.updateBook(b.id, { order: nb })]);
    await store.refreshVisibleAll();
    adminBooks();
  };
  const swapCat = async (i, j) => {
    const a = cats[i], b = cats[j];
    if (!a || !b) return;
    await Promise.all([store.updateCategory(a.id, { order: b.order || j + 1 }), store.updateCategory(b.id, { order: a.order || i + 1 })]);
    adminBooks();
  };

  const bookRow = (b, i, list) => {
    const cell = h('span', { class: 'status' }, warnText(b));
    statusCells.set(b.id, cell);
    return h('div', { class: 'shelf-row' },
      h('div', { class: 'order-btns' },
        h('button', { class: 'icon-btn', 'aria-label': '위로', disabled: i === 0, onclick: () => swapOrder(list, i, i - 1) }, icon('up')),
        h('button', { class: 'icon-btn', 'aria-label': '아래로', disabled: i === list.length - 1, onclick: () => swapOrder(list, i, i + 1) }, icon('down'))),
      h('span', { class: 'order-num' }, i + 1),
      h('button', { class: 'shelf-main', onclick: () => nav(`#/admin/book/${b.id}`) },
        h('strong', null, b.title),
        h('span', { class: 'muted small' }, [b.numPages ? `${b.numPages}쪽` : null, (b.toc || []).length ? `곡 ${b.toc.length}개` : '목차 없음', `학생 ${learners(b.id)}명`].filter(Boolean).join(' · '))),
      cell, icon('chevron', 'muted'));
  };

  const catCard = (c, ci) => {
    const list = books.filter((b) => (b.categoryId || null) === (c ? c.id : null)).sort(byOrder);
    if (!c && !list.length) return null;
    return h('section', { class: 'card shelf-card' },
      h('div', { class: 'shelf-head' },
        h('h3', null, c ? c.name : '분류 없음'),
        c ? h('div', { class: 'row tight' },
          h('button', { class: 'icon-btn', 'aria-label': '카테고리 위로', disabled: ci === 0, onclick: () => swapCat(ci, ci - 1) }, icon('up')),
          h('button', { class: 'icon-btn', 'aria-label': '카테고리 아래로', disabled: ci === cats.length - 1, onclick: () => swapCat(ci, ci + 1) }, icon('down')),
          h('button', { class: 'icon-btn', 'aria-label': '이름 바꾸기', onclick: () => renameCategory(c) }, icon('edit')),
          h('button', { class: 'icon-btn', 'aria-label': '카테고리 삭제', onclick: async () => {
            if (!(await confirmBox(`카테고리를 삭제할까요? (${c.name})`, { ok: '삭제', danger: true }))) return;
            try { await store.deleteCategory(c.id); toast('삭제했어요.'); adminBooks(); } catch (e) { toast(e.message, 'bad'); }
          } }, icon('trash'))) : h('span', { class: 'muted small' }, '카테고리를 정해야 학생에게 배정할 수 있어요')),
      c ? h('p', { class: 'muted small' }, '위에서부터 기초 교재 순서입니다. 학생은 지금 교재와 그 위 교재만 볼 수 있어요.') : null,
      list.length ? h('div', { class: 'shelf-list' }, list.map((b, i) => bookRow(b, i, list))) : h('p', { class: 'muted small' }, '아직 교재가 없어요.'));
  };

  const newCat = h('input', { class: 'input', placeholder: '새 카테고리 이름 (예: 일렉기타)' });
  adminShell('books',
    h('section', { class: 'card' }, h('h3', null, '교재 추가'), addForm,
      h('p', { class: 'muted small' }, '드라이브의 GoodNotes 백업 폴더에서 PDF를 열고 공유 › 링크 복사로 얻은 주소를 붙여 넣으세요. 파일은 \'링크가 있는 모든 사용자\'로 공유되어 있어야 해요.')),
    ...cats.map((c, i) => catCard(c, i)),
    catCard(null, -1),
    h('section', { class: 'card' }, h('h3', null, '카테고리 만들기'),
      h('form', { class: 'add-row', onsubmit: async (e) => {
        e.preventDefault();
        const nm = newCat.value.trim(); if (!nm) return;
        await store.addCategory(nm); toast('카테고리를 만들었어요.', 'good'); adminBooks();
      } }, newCat, h('button', { class: 'btn', type: 'submit' }, '만들기'))));

  // 드라이브에서 바뀐 교재는 쪽수를 다시 세어 목차와 맞는지 확인한다
  for (const b of books) {
    if (!b.driveId) continue;
    try {
      const meta = await driveMeta(b.driveId);
      if (meta.modifiedTime !== b.checkedVersion) {
        statusCells.get(b.id)?.replaceChildren(h('span', { class: 'muted small' }, '확인 중…'));
        const n = await countPages(b);
        b.numPages = n; b.checkedVersion = meta.modifiedTime;
        await store.updateBook(b.id, { numPages: n, checkedVersion: meta.modifiedTime });
      }
      statusCells.get(b.id)?.replaceChildren(warnText(b));
    } catch {
      statusCells.get(b.id)?.replaceChildren(h('span', { class: 'bad-text' }, '열 수 없음'));
    }
  }
}

function renameCategory(c) {
  sheet((body, close) => {
    const input = h('input', { class: 'input', value: c.name });
    body.append(input, h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: async () => {
      const nm = input.value.trim(); if (!nm) return;
      await store.updateCategory(c.id, { name: nm }); close(); toast('바꿨어요.', 'good'); adminBooks();
    } }, '저장')));
    setTimeout(() => input.focus(), 50);
  }, { title: '카테고리 이름' });
}

function warnText(b) {
  if ((b.toc || []).length && b.numPages && b.tocPages !== b.numPages) return h('span', { class: 'badge warn' }, '목차 확인 필요');
  return h('span', { class: 'badge ok' }, '정상');
}

async function countPages(book) {
  const { data } = await loadPdf(book);
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(data), cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true }).promise;
  const n = pdf.numPages; pdf.destroy();
  return n;
}

async function adminBook(id) {
  const [b0, cats] = await Promise.all([store.getBook(id), store.listCategories()]);
  let book = b0;
  if (!book) return adminShell('books', h('p', { class: 'pad' }, '교재를 찾을 수 없어요.'));
  let n = book.numPages || 0;
  let toc = sortToc(book.toc).map((e) => ({ ...e }));

  const title = h('input', { class: 'input', value: book.title });
  const catSel = h('select', { class: 'input', onchange: async (e) => {
    const cat = e.target.value || null;
    const all = await store.listBooks();
    const order = Math.max(0, ...all.filter((x) => (x.categoryId || null) === cat && x.id !== id).map((x) => x.order || 0)) + 1;
    await store.updateBook(id, { categoryId: cat, order });
    await store.refreshVisibleAll();
    book.categoryId = cat; toast('카테고리를 옮겼어요. 이 카테고리의 맨 뒤에 놓였어요.', 'good');
  } }, cats.map((c) => h('option', { value: c.id, selected: c.id === book.categoryId }, c.name)), h('option', { value: '', selected: !book.categoryId }, '분류 없음'));
  const tocBox = h('div', { class: 'toc-edit' });
  const pagesNote = h('p', { class: 'muted small' });
  const warn = h('div');

  // 곡의 쪽 수: 다음 곡 시작 쪽까지 (마지막 곡은 교재 끝까지)
  const spanOf = (e) => {
    const later = toc.filter((x) => x !== e && +x.p > +e.p).map((x) => +x.p);
    const end = later.length ? Math.min(...later) - 1 : (n || +e.p);
    return Math.max(1, end - +e.p + 1);
  };
  const unsaved = () => toast('목차 저장을 눌러야 학생들에게 반영돼요.');

  // 이 곡 앞에 새 곡을 넣고, 이 곡부터 뒤의 곡들을 새 곡 쪽 수만큼 뒤로 민다
  const insertBefore = (e) => sheet((body, close) => {
    const P = +e.p;
    const name = h('input', { class: 'input', placeholder: '새 곡 이름' });
    const count = h('input', { class: 'input narrow', type: 'number', min: 1, value: 1, inputmode: 'numeric', 'aria-label': '새 곡의 쪽 수' });
    const msg = h('p', { class: 'muted small' });
    const paintMsg = () => { msg.textContent = `새 곡은 ${P}쪽부터 시작하고, "${e.t || '이 곡'}"부터 뒤의 곡들은 모두 ${Math.max(1, +count.value || 1)}쪽씩 뒤로 밀려요.`; };
    count.addEventListener('input', paintMsg); paintMsg();
    body.append(
      h('label', { class: 'field' }, h('span', null, '곡 이름'), name),
      h('label', { class: 'field inline' }, h('span', null, '쪽 수'), count),
      msg,
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: () => {
        const t = name.value.trim(); if (!t) return name.focus();
        if (toc.some((x) => (x.t || '').trim() === t)) { msg.textContent = `이미 목차에 있는 이름이에요 · ${t}`; return name.select(); }
        const k = Math.max(1, Math.floor(+count.value || 1));
        toc.forEach((x) => { if (+x.p >= P) x.p = +x.p + k; });
        toc.push({ t, p: P });
        toc = sortToc(toc).map((x) => ({ ...x }));
        close(); renderToc(); unsaved();
      } }, '넣기')));
    setTimeout(() => name.focus(), 50);
  }, { title: '이 곡 앞에 곡 넣기' });

  // 곡을 빼면서 뒤의 곡들을 그 곡 쪽 수만큼 당길지 묻는다
  const removeSong = async (e) => {
    const span = spanOf(e);
    const hasLater = toc.some((x) => x !== e && +x.p > +e.p);
    let pull = false;
    if (hasLater) {
      const ans = await sheet((body, close) => {
        body.append(h('p', { class: 'sheet-msg' }, `"${e.t || '이 곡'}"(${span}쪽)을 목차에서 뺍니다. 교재에서도 이 곡을 지웠다면 뒤의 곡들을 ${span}쪽씩 앞으로 당기세요.`),
          h('div', { class: 'row end wrap' },
            h('button', { class: 'btn ghost', onclick: () => close('keep') }, '쪽 번호는 그대로'),
            h('button', { class: 'btn primary', onclick: () => close('pull') }, `${span}쪽씩 당기기`)));
      }, { title: '곡 빼기' });
      if (!ans) return;
      pull = ans === 'pull';
    }
    const P = +e.p;
    toc = toc.filter((x) => x !== e);
    if (pull) toc.forEach((x) => { if (+x.p > P) x.p = +x.p - span; });
    renderToc(); unsaved();
  };

  const renderToc = () => {
    tocBox.replaceChildren(
      ...toc.map((e) => h('div', { class: 'toc-row' },
        h('button', { class: 'icon-btn insert', title: '이 곡 앞에 곡 넣기', 'aria-label': '이 곡 앞에 곡 넣기', onclick: () => insertBefore(e) }, icon('plus')),
        h('input', { class: 'input', value: e.t, placeholder: '곡 이름', oninput: (ev) => { e.t = ev.target.value; paintDupes(); } }),
        h('input', { class: 'input narrow', type: 'number', min: 1, value: e.p, 'aria-label': '시작 쪽', oninput: (ev) => { e.p = +ev.target.value; paintSpans(); } }),
        h('span', { class: 'toc-span muted small', 'data-span': '' }),
        h('button', { class: 'icon-btn', 'aria-label': '삭제', onclick: () => removeSong(e) }, icon('close')))),
      h('button', { class: 'btn ghost small', onclick: () => { toc.push({ t: '', p: Math.min(n || 9999, (toc.length ? Math.max(...toc.map((x) => +x.p)) : 0) + 1) }); renderToc(); tocBox.querySelector('.toc-row:last-of-type input:not([type=number])')?.focus(); } }, icon('plus'), '맨 뒤에 곡 추가'));
    paintSpans(); paintDupes();
  };
  // 같은 이름의 곡을 빨갛게 표시하고, 아래에 어느 쪽끼리 겹치는지 알려 준다
  const dupNote = h('div', { class: 'notice bad hidden' });
  const findDupes = () => {
    const groups = new Map();
    toc.forEach((e) => { const k = (e.t || '').trim(); if (!k) return; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); });
    return [...groups.entries()].filter(([, list]) => list.length > 1);
  };
  const paintDupes = () => {
    const dupes = findDupes();
    const bad = new Set(dupes.flatMap(([, list]) => list));
    tocBox.querySelectorAll('.toc-row').forEach((row, i) => row.querySelector('input:not([type=number])').classList.toggle('dup', bad.has(toc[i])));
    dupNote.classList.toggle('hidden', !dupes.length);
    dupNote.textContent = dupes.length
      ? `이름이 같은 곡이 있어요 · ${dupes.map(([t, list]) => `${t} (${list.map((e) => e.p + '쪽').join(', ')})`).join(' / ')}. 한쪽 이름을 바꿔야 저장할 수 있어요.`
      : '';
    return dupes;
  };
  const paintSpans = () => {
    tocBox.querySelectorAll('.toc-row').forEach((row, i) => { const e = toc[i]; row.querySelector('[data-span]').textContent = e && e.p ? `${spanOf(e)}쪽` : ''; });
  };
  const renderWarn = () => {
    pagesNote.textContent = n ? `지금 교재 파일은 ${n}쪽입니다.` : '쪽수를 확인하는 중…';
    warn.replaceChildren(...[book.toc?.length && n && book.tocPages !== n
      ? h('div', { class: 'notice warn' }, `교재 쪽수가 목차를 저장했을 때(${book.tocPages}쪽)와 달라졌습니다(지금 ${n}쪽). 쪽 번호를 확인한 뒤 '목차 저장'을 눌러 주세요. 저장하기 전까지 학생들에게는 진도 위치가 '확인 필요'로 표시됩니다.`)
      : null].filter(Boolean));
  };
  renderToc(); renderWarn();

  const saveToc = async (btn) => {
    const clean = sortToc(toc.map((e) => ({ t: (e.t || '').trim(), p: +e.p })));
    if (n && clean.some((e) => e.p > n)) return toast(`쪽 번호는 ${n}쪽 이하여야 해요. 굿노트 백업이 아직 드라이브에 올라가지 않았다면 잠시 뒤 이 화면을 다시 열어 주세요.`, 'bad');
    const dupes = paintDupes();
    if (dupes.length) {
      tocBox.querySelector('input.dup')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return toast(`이름이 같은 곡이 있어요 · ${dupes.map(([t]) => t).join(', ')}`, 'bad');
    }
    if (clean.some((e) => !e.t)) return toast('이름이 비어 있는 곡이 있어요.', 'bad');
    busy(btn, true);
    await store.updateBook(id, { toc: clean, tocPages: n });
    book = { ...book, toc: clean, tocPages: n }; toc = clean.map((e) => ({ ...e }));
    renderToc(); renderWarn(); busy(btn, false); toast('목차를 저장했어요.', 'good');
  };

  const toggle = (key, label, help, onText, offText) => toggleSwitch({ checked: !!book[key], label, help, onText, offText,
    onChange: async (on) => { await store.updateBook(id, { [key]: on }); book[key] = on; toast(`저장했어요 · ${label} · ${on ? onText : offText}`, 'good'); } });

  const fileIn = h('input', { class: 'input', placeholder: '새 드라이브 링크 (파일을 바꿀 때만)' });
  adminShell('books',
    h('a', { class: 'back-link', href: '#/admin/books' }, icon('back'), '교재 목록'),
    h('section', { class: 'card' },
      h('div', { class: 'row' }, title, h('button', { class: 'btn', onclick: async () => { await store.updateBook(id, { title: title.value.trim() || book.title }); toast('저장했어요.', 'good'); } }, '이름 저장')),
      h('label', { class: 'field inline' }, h('span', null, '카테고리'), catSel),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => nav(`#/read/${id}`) }, '교재 열어 보기'),
        book.driveId ? h('a', { class: 'btn ghost', href: `https://drive.google.com/file/d/${book.driveId}/view`, target: '_blank', rel: 'noopener' }, '드라이브에서 보기') : null),
      pagesNote,
      h('div', { class: 'tgl-list' },
        toggle('coverSingle', '두 쪽 보기에서 1쪽(표지) 혼자 보이기', '책처럼 짝수 쪽이 왼쪽에 옵니다', '켜짐', '꺼짐'),
        toggle('downloadable', '학생 다운로드', '켜면 학생 교재 화면에 내려받기 버튼이 생겨요', '허용', '허용 안 함'))),
    h('section', { class: 'card' }, h('h3', null, '목차 (곡 목록)'),
      h('p', { class: 'muted small' }, '곡마다 시작 쪽을 적어 주세요. 학생 진도와 좋아요는 이 곡 단위로 저장됩니다. 예를 들어 7쪽에서 시작해 10쪽까지 이어지는 곡의 9쪽을 저장하면 "곡 이름 · 3/4쪽"으로 기록돼요. 곡 사이에 새 곡을 넣을 때는 그 자리 바로 뒤 곡의 왼쪽 +를 누르면, 뒤의 곡들이 새 곡 쪽 수만큼 함께 밀려요. 곡을 뺄 때는 ×를 누르면 뒤의 곡들을 당길지 물어봐요.'),
      warn, tocBox, dupNote,
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: (e) => saveToc(e.currentTarget) }, '목차 저장'))),
    h('section', { class: 'card' }, h('h3', null, '파일 바꾸기 · 삭제'),
      h('p', { class: 'muted small' }, 'GoodNotes 자동 백업으로 같은 파일이 갱신되는 경우에는 바꿀 필요가 없습니다. 아예 다른 파일로 교체할 때만 쓰세요.'),
      h('div', { class: 'row' }, fileIn, h('button', { class: 'btn', onclick: async (e) => {
        const fid = parseDriveId(fileIn.value); if (!fid) return toast('링크를 확인해 주세요.', 'bad');
        const btn = e.currentTarget; busy(btn, true);
        try { await driveMeta(fid); await store.updateBook(id, { driveId: fid, checkedVersion: null }); toast('파일을 바꿨어요. 목차 쪽 번호를 확인해 주세요.', 'good'); adminBook(id); }
        catch (err) { toast(err.message, 'bad'); } finally { busy(btn, false); }
      } }, '교체')),
      h('div', { class: 'row end' }, h('button', { class: 'btn danger', onclick: async () => {
        if (await confirmBox(`이 교재를 삭제할까요? (${book.title}) 학생 진도 배정도 함께 풀리며, 드라이브 파일은 지워지지 않아요.`, { ok: '삭제', danger: true })) { await store.deleteBook(id); toast('삭제했어요.'); nav('#/admin/books'); }
      } }, '교재 삭제'))));

  if (!n) {
    try { n = await countPages(book); if (n !== book.numPages) await store.updateBook(id, { numPages: n }); book.numPages = n; } catch (e) { pagesNote.textContent = e.message; return; }
    renderWarn();
  }
}

// ---------------- 관리자: 기록과 통계 ----------------
function sessionTable(sessions, withName = true) {
  if (!sessions.length) return h('p', { class: 'muted' }, '기록이 없어요.');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, [withName ? '학생' : null, '날짜', '교재', '연습 시간', '본 쪽', '장소'].filter(Boolean).map((t) => h('th', null, t)))),
    h('tbody', null, sessions.slice(0, 500).map((s) => h('tr', null,
      withName ? h('td', { class: 'strong' }, s.name || '-') : null,
      h('td', { class: 'nowrap' }, fmtDate(s.start)),
      h('td', null, s.bookTitle || '-'),
      h('td', { class: 'nowrap' }, fmtMinutes(s.seconds)),
      h('td', { class: 'nowrap' }, s.minPage ? (s.minPage === s.maxPage ? `${s.minPage}쪽` : `${s.minPage}–${s.maxPage}쪽`) : '-'),
      h('td', null, h('span', { class: 'badge ' + (s.mode === 'academy' ? 'plain' : 'at-home') }, s.mode === 'academy' ? '학원' : '집')))))));
}

async function adminLogs() {
  const q = hashQuery();
  const today = ymd(Date.now());
  const fromStr = q.get('from') || ymd(Date.now() - 29 * 86400000);
  const toStr = q.get('to') || today;
  const sid = q.get('sid') || '';
  const from = dayStart(fromStr), to = dayStart(toStr) + 86400000;
  const [sessions, students, likes] = await Promise.all([store.listSessions(from, to), store.listStudents(), store.listLikes().catch(() => [])]);

  const goRange = (f, t, s = sid) => nav(`#/admin/logs?from=${f}&to=${t}${s ? `&sid=${s}` : ''}`);
  const d = new Date();
  const monthStart = (y, m) => ymd(new Date(y, m, 1).getTime());
  const monthEnd = (y, m) => ymd(new Date(y, m + 1, 0).getTime());
  const presets = [
    ['최근 7일', ymd(Date.now() - 6 * 86400000), today],
    ['최근 30일', ymd(Date.now() - 29 * 86400000), today],
    ['이번 달', monthStart(d.getFullYear(), d.getMonth()), today],
    ['지난달', monthStart(d.getFullYear(), d.getMonth() - 1), monthEnd(d.getFullYear(), d.getMonth() - 1)],
  ];
  const fromIn = h('input', { class: 'input narrow date', type: 'date', value: fromStr, max: today });
  const toIn = h('input', { class: 'input narrow date', type: 'date', value: toStr, max: today });
  const sel = h('select', { class: 'input narrow', onchange: (e) => goRange(fromStr, toStr, e.target.value) },
    h('option', { value: '' }, '모든 학생'),
    students.sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((s) => h('option', { value: s.id, selected: s.id === sid }, s.name)));

  const list = sid ? sessions.filter((s) => s.sid === sid) : sessions;
  const sum = {};
  for (const s of sessions) {
    sum[s.sid] = sum[s.sid] || { name: s.name, sec: 0, home: 0, n: 0 };
    sum[s.sid].sec += s.seconds || 0; sum[s.sid].n++;
    if (s.mode === 'home') sum[s.sid].home += s.seconds || 0;
  }
  const ranking = Object.entries(sum).sort((a, b) => b[1].sec - a[1].sec);
  const totalSec = sessions.reduce((a, s) => a + (s.seconds || 0), 0);

  // 좋아요 통계: 곡마다 몇 명이 눌렀는지 (전체 기간)
  const songMap = new Map();
  for (const l of likes) {
    const k = `${l.bookId}::${l.song}`;
    if (!songMap.has(k)) songMap.set(k, { song: l.song, book: l.bookTitle, names: [] });
    songMap.get(k).names.push(l.name);
  }
  const songRank = [...songMap.values()].sort((a, b) => b.names.length - a.names.length || a.song.localeCompare(b.song, 'ko'));
  const maxLike = songRank[0]?.names.length || 1;

  adminShell('logs',
    h('section', { class: 'card' },
      h('div', { class: 'range-bar' },
        h('div', { class: 'presets' }, presets.map(([label, f, t]) => h('button', { class: 'chip-btn' + (f === fromStr && t === toStr ? ' on' : ''), onclick: () => goRange(f, t) }, label))),
        h('form', { class: 'range-form', onsubmit: (e) => { e.preventDefault(); if (fromIn.value && toIn.value) goRange(fromIn.value <= toIn.value ? fromIn.value : toIn.value, fromIn.value <= toIn.value ? toIn.value : fromIn.value); } },
          fromIn, h('span', { class: 'muted' }, '~'), toIn, h('button', { class: 'btn small', type: 'submit' }, '보기')))),
    h('div', { class: 'stat-row' },
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '전체 연습 시간'), h('div', { class: 'stat-value' }, fmtMinutes(totalSec))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '연습한 학생'), h('div', { class: 'stat-value' }, `${ranking.length}명`)),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '집에서 연습'), h('div', { class: 'stat-value' }, fmtMinutes(sessions.filter((s) => s.mode === 'home').reduce((a, s) => a + (s.seconds || 0), 0)))),
      h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, '좋아요 (전체)'), h('div', { class: 'stat-value' }, `${likes.length}개`))),
    h('section', { class: 'card' }, h('h3', null, '학생별 연습 시간'),
      ranking.length ? h('div', { class: 'bars' }, ranking.map(([id, v]) => {
        const max = ranking[0][1].sec || 1;
        return h('button', { class: 'bar-row' + (id === sid ? ' on' : ''), onclick: () => goRange(fromStr, toStr, id === sid ? '' : id) },
          h('span', { class: 'bar-name' }, v.name),
          h('span', { class: 'bar-track' }, h('i', { style: { width: Math.max(2, (v.sec / max) * 100) + '%' } }), h('i', { class: 'at-home', style: { width: Math.max(0, (v.home / max) * 100) + '%' } })),
          h('span', { class: 'bar-val' }, fmtMinutes(v.sec), h('small', { class: 'muted' }, ` · 집 ${fmtMinutes(v.home)}`)));
      })) : h('p', { class: 'muted' }, '이 기간에는 기록이 없어요.')),
    h('section', { class: 'card' }, h('h3', null, '좋아요를 많이 받은 곡'),
      songRank.length ? h('div', { class: 'like-list' }, songRank.slice(0, 30).map((r, i) => h('div', { class: 'like-row' },
        h('span', { class: 'like-rank' }, i + 1),
        h('div', { class: 'like-main' }, h('strong', null, r.song), h('span', { class: 'muted small' }, `${r.book} · ${r.names.join(', ')}`)),
        h('span', { class: 'like-bar' }, h('i', { style: { width: (r.names.length / maxLike) * 100 + '%' } })),
        h('span', { class: 'like-count' }, `♥ ${r.names.length}`)))) : h('p', { class: 'muted' }, '아직 좋아요가 없어요.')),
    h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h3', null, '연습 기록'), sel), sessionTable(list, !sid)));
}

async function adminSettings() {
  const ks = await store.kioskStatus();
  const pw = h('input', { class: 'input', type: 'password', placeholder: ks.exists ? '새 비밀번호 (6자 이상)' : '비밀번호 (6자 이상)' });
  const here = location.href.split('#')[0];
  adminShell('settings',
    h('section', { class: 'card' }, h('h3', null, '학원 태블릿'),
      h('p', { class: 'muted small' }, ks.exists
        ? '학원 태블릿 비밀번호가 설정되어 있습니다. 새로 만들면 기존에 등록한 태블릿은 모두 등록이 해제되니, 각 태블릿에서 새 비밀번호로 다시 등록해 주세요.'
        : '비밀번호를 만든 뒤, 학원 태블릿에서 이 앱을 열고 로그인 화면 아래 \'학원 태블릿으로 등록\'을 눌러 이 비밀번호를 입력하세요.'),
      h('div', { class: 'row' }, pw, h('button', { class: 'btn primary', onclick: async (e) => {
        const btn = e.currentTarget;
        if (pw.value.length < 6) return toast('비밀번호는 6자 이상으로 해 주세요.', 'bad');
        if (ks.exists && !(await confirmBox('기존 학원 태블릿들의 등록이 해제됩니다. 계속할까요?', { ok: '새로 만들기' }))) return;
        busy(btn, true);
        try { await store.createKiosk(pw.value); pw.value = ''; toast('학원 태블릿 비밀번호를 만들었어요.', 'good'); adminSettings(); } catch (err) { toast(err.message, 'bad'); } finally { busy(btn, false); }
      } }, ks.exists ? '새로 만들기' : '만들기'))),
    h('section', { class: 'card' }, h('h3', null, '앱 주소'),
      h('p', null, h('code', null, here)),
      h('p', { class: 'muted small' }, '레노버 태블릿: 크롬으로 이 주소를 열고 메뉴(⋮) › \'앱 설치\' 또는 \'홈 화면에 추가\'. 그다음 설정 › 보안 › 앱 고정을 켜고, 최근 앱 화면에서 이 앱 아이콘을 눌러 \'고정\'을 고르면 이 앱만 쓸 수 있습니다.')),
    h('section', { class: 'card' }, h('h3', null, '이 기기'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn ghost', onclick: async () => { await clearPdfCache(); toast('저장해 둔 교재 파일을 지웠어요. 다음에 열 때 새로 내려받습니다.'); } }, '저장된 교재 파일 지우기'),
        store.demo ? h('button', { class: 'btn ghost', onclick: async () => { if (await confirmBox('체험용 데이터를 처음 상태로 되돌릴까요?')) { await store.resetDemo(); nav('#/'); } } }, '체험 데이터 초기화') : null,
        h('button', { class: 'btn ghost', onclick: async () => { await store.logout(); nav('#/'); } }, '로그아웃')),
      h('p', { class: 'muted small' }, `앱 버전 · ${APP_VERSION}`)));
}

// 학원 태블릿: 오래 꺼져 있다가 켜지면 이름 고르는 화면으로 돌아간다
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  if (session?.role === 'kiosk' && hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000 && location.hash !== '#/') nav('#/');
});

boot();
