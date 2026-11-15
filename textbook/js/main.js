// 레몬트리 전자 교재: 화면 전환과 각 화면 (로그인, 학생 홈, 학원 태블릿, 관리자)

import { config } from './config.js';
import { h, $, toast, sheet, confirmBox, spinner, busy } from './ui.js';
import { openReader } from './reader.js';
import { driveMeta, loadPdf, clearPdfCache } from './pdfsource.js';
import {
  normName, normBirth, isValidBirth, bookmarkText, sortToc, makeBookmark, parseDriveId, fmtDate, fmtMinutes,
} from './core.js';

const app = $('#app');
let store;
let session = null;
let reader = null;
const ACADEMY = config.academyName || '레몬트리';

// ---------------- 시작 ----------------
async function boot() {
  app.replaceChildren(spinner('불러오는 중…'));
  store = config.firebase ? await import('./store-firebase.js') : await import('./store-demo.js');
  try { session = await store.init(); } catch { session = null; }
  window.addEventListener('hashchange', route);
  route();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}

const nav = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

async function route() {
  if (reader) { const r = reader; reader = null; await r.exit(false); }
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
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

function shell(...kids) {
  app.replaceChildren(h('div', { class: 'page' }, demoBanner(), ...kids));
}

// ---------------- 로그인 ----------------
function viewLogin() {
  const name = h('input', { class: 'input big', placeholder: '이름 (예: 김민준)', autocomplete: 'off', autocapitalize: 'off', enterkeyhint: 'next' });
  const birth = h('input', { class: 'input big', placeholder: '생일 4자리 (예: 0315)', inputmode: 'numeric', maxlength: 4, autocomplete: 'off', enterkeyhint: 'go' });
  const msg = h('p', { class: 'form-msg' });
  const go = h('button', { class: 'btn primary big wide', type: 'submit' }, '들어가기');
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); birth.focus(); } });
  const form = h('form', { class: 'login-card', onsubmit: async (e) => {
    e.preventDefault();
    msg.textContent = '';
    const n = normName(name.value), b = normBirth(birth.value);
    if (!n) { msg.textContent = '이름을 써 주세요.'; return name.focus(); }
    if (!isValidBirth(b)) { msg.textContent = '생일은 월과 날짜 4자리로 써 주세요. 3월 15일이면 0315예요.'; return birth.focus(); }
    busy(go, true, '확인하는 중…');
    try { session = await store.loginStudent(n, b); nav('#/'); } catch (err) { msg.textContent = err.message; } finally { busy(go, false); }
  } },
  h('div', { class: 'brand' }, h('div', { class: 'logo' }, '🍋'), h('h1', null, `${ACADEMY} 기타 교재`)),
  h('label', { class: 'field' }, h('span', null, '이름'), name),
  h('label', { class: 'field' }, h('span', null, '생일'), birth),
  msg, go,
  store.demo ? h('p', { class: 'hint' }, '체험: 이름 "민준", 생일 "0315" 또는 "서연", "1102"') : null);

  shell(h('main', { class: 'login' }, form,
    h('div', { class: 'login-links' },
      h('button', { class: 'linkish', onclick: registerTablet }, '학원 태블릿으로 등록'),
      h('span', { class: 'dot' }, '·'),
      h('button', { class: 'linkish', onclick: adminLogin }, '선생님 로그인'))));
}

async function adminLogin() {
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
      try { session = await store.registerKiosk(pw.value); close(); nav('#/'); toast('이 태블릿을 학원 태블릿으로 등록했어요.', 'good'); }
      catch (e) { msg.textContent = e.message; } finally { busy(ok, false); }
    } }, '등록');
    body.append(h('p', { class: 'sheet-msg' }, '학원 태블릿으로 등록하면 학생들이 이름만 눌러서 들어올 수 있어요. 학원 기기에서만 등록해 주세요.'), pw, msg, h('div', { class: 'row end' }, ok));
    setTimeout(() => pw.focus(), 50);
  }, { title: '학원 태블릿 등록' });
}

// ---------------- 학원 태블릿: 이름 고르기 ----------------
async function viewKiosk() {
  shell(spinner());
  let students = [];
  try { students = (await store.listStudents()).filter((s) => s.active).sort((a, b) => a.name.localeCompare(b.name, 'ko')); }
  catch (e) { return shell(h('p', { class: 'pad' }, '학생 목록을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')); }
  const grid = h('div', { class: 'name-grid' }, students.map((s) =>
    h('button', { class: 'name-btn', onclick: () => nav(`#/k/${s.id}`) }, s.name)));
  shell(
    h('header', { class: 'topbar' }, h('div', { class: 'brand small' }, h('span', { class: 'logo' }, '🍋'), `${ACADEMY} 기타 교재`)),
    h('main', { class: 'kiosk' }, h('h2', { class: 'center' }, '내 이름을 눌러 주세요'),
      students.length ? grid : h('p', { class: 'center muted' }, '등록된 학생이 없어요. 관리자 페이지에서 학생을 추가해 주세요.'),
      h('div', { class: 'kiosk-foot' }, h('button', { class: 'linkish', onclick: async () => {
        if (await confirmBox('이 태블릿의 학원 태블릿 등록을 해제할까요? 다시 쓰려면 학원 태블릿 비밀번호가 필요해요.', { ok: '해제', danger: true })) { await store.logout(); nav('#/'); }
      } }, '학원 태블릿 등록 해제 (선생님용)'))));
}

// ---------------- 학생 홈: 내 교재 ----------------
async function viewStudentHome(sid, role) {
  shell(spinner());
  let st, books, prog;
  try {
    st = await store.getStudent(sid);
    if (!st) throw new Error();
    [books, prog] = await Promise.all([store.getBooks(st.assigned || []), store.getProgress(sid)]);
  } catch {
    return shell(h('p', { class: 'pad' }, '정보를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'),
      h('div', { class: 'pad' }, h('button', { class: 'btn', onclick: () => (role === 'kiosk' ? nav('#/') : store.logout().then(() => nav('#/'))) }, '처음으로')));
  }
  if (role === 'student') store.touchStudent(sid);
  const readHash = (bid) => (role === 'kiosk' ? `#/k/${sid}/read/${bid}` : `#/read/${bid}`);
  const cur = books.find((b) => b.id === st.current);
  const others = books.filter((b) => b.id !== st.current).sort((a, b) => (prog[b.id]?.lastAt || 0) - (prog[a.id]?.lastAt || 0));

  const card = (b, big) => {
    const p = prog[b.id] || {};
    const total = p.bm?.numPages || b.numPages || 0;
    const pct = p.bm && total ? Math.min(100, Math.round((p.bm.page / total) * 100)) : 0;
    return h('button', { class: 'book-card' + (big ? ' big' : ''), onclick: () => nav(readHash(b.id)) },
      h('div', { class: 'book-spine' }),
      h('div', { class: 'book-info' },
        big ? h('div', { class: 'tag' }, '지금 배우는 교재') : null,
        h('div', { class: 'book-title' }, b.title),
        h('div', { class: 'book-mark' }, p.bm ? `내 진도: ${bookmarkText(p.bm)}` : '아직 저장한 진도가 없어요'),
        total ? h('div', { class: 'bar' }, h('i', { style: { width: pct + '%' } })) : null,
        p.lastAt ? h('div', { class: 'muted small' }, `마지막으로 본 날: ${fmtDate(p.lastAt)}`) : null),
      h('div', { class: 'book-go' }, big ? '이어서 보기 ›' : '›'));
  };

  shell(
    h('header', { class: 'topbar' },
      h('div', { class: 'hello' }, h('span', { class: 'logo' }, '🍋'), `${st.name}님, 안녕하세요`),
      role === 'kiosk'
        ? h('button', { class: 'btn ghost', onclick: () => nav('#/') }, '처음으로')
        : h('button', { class: 'linkish', onclick: async () => { if (await confirmBox('로그아웃할까요?', { ok: '로그아웃' })) { await store.logout(); nav('#/'); } } }, '로그아웃')),
    h('main', { class: 'home' },
      cur ? card(cur, true) : null,
      others.length ? h('h3', { class: 'section' }, cur ? '배운 교재' : '내 교재') : null,
      others.length ? h('div', { class: 'book-list' }, others.map((b) => card(b))) : null,
      !books.length ? h('div', { class: 'empty' }, '아직 배정된 교재가 없어요. 선생님께 말씀해 주세요.') : null));
}

// ---------------- 교재 보기 ----------------
async function viewRead({ bookId, sid, role }) {
  app.replaceChildren(spinner('교재를 여는 중…'));
  let book, entry = {}, st = null;
  try {
    book = await store.getBook(bookId);
    if (!book) throw new Error('이 교재를 열 수 없어요.');
    if (sid) {
      st = await store.getStudent(sid);
      if (!st || !(st.assigned || []).includes(bookId)) throw new Error('배정되지 않은 교재예요.');
      entry = (await store.getProgress(sid))[bookId] || {};
    }
  } catch (e) {
    app.replaceChildren(h('div', { class: 'page' }, h('p', { class: 'pad' }, e.message || '교재를 열 수 없어요.'),
      h('div', { class: 'pad' }, h('button', { class: 'btn', onclick: () => history.back() }, '돌아가기'))));
    return;
  }
  const back = role === 'admin' ? `#/admin/book/${bookId}` : role === 'kiosk' ? `#/k/${sid}` : '#/';
  reader = await openReader(app, {
    store, book, role, entry,
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
      h('div', { class: 'brand small' }, h('span', { class: 'logo' }, '🍋'), '관리자'),
      h('nav', { class: 'tabs' }, ADMIN_TABS.map(([k, label]) => h('a', { href: `#/admin/${k}`, class: tab === k ? 'on' : '' }, label)))),
    h('main', { class: 'admin-main' }, ...kids));
}

async function viewAdmin(parts) {
  const tab = parts[1] || 'students';
  if (tab === 'student' && parts[2]) return adminStudent(parts[2]);
  if (tab === 'book' && parts[2]) return adminBook(parts[2]);
  adminShell(tab, spinner());
  try {
    if (tab === 'students') return await adminStudents();
    if (tab === 'books') return await adminBooks();
    if (tab === 'logs') return await adminLogs(parts[2]);
    if (tab === 'settings') return await adminSettings();
  } catch (e) {
    adminShell(tab, h('p', { class: 'pad' }, `불러오지 못했어요: ${e.message}`));
  }
}

const weekSeconds = (sessions, sid) => {
  const since = Date.now() - 7 * 86400000;
  return sessions.filter((s) => s.sid === sid && s.start >= since).reduce((a, s) => a + (s.seconds || 0), 0);
};

async function adminStudents() {
  const [students, books, allProg, sessions] = await Promise.all([store.listStudents(), store.listBooks(), store.getAllProgress(), store.listSessions(7)]);
  const bookName = Object.fromEntries(books.map((b) => [b.id, b.title]));
  students.sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name, 'ko'));

  const name = h('input', { class: 'input', placeholder: '이름' });
  const birth = h('input', { class: 'input', placeholder: '생일 4자리 (0315)', inputmode: 'numeric', maxlength: 4 });
  const addBtn = h('button', { class: 'btn primary', type: 'submit' }, '학생 추가');
  const addForm = h('form', { class: 'add-row', onsubmit: async (e) => {
    e.preventDefault();
    const n = normName(name.value), b = normBirth(birth.value);
    if (!n || !isValidBirth(b)) return toast('이름과 생일 4자리를 확인해 주세요.', 'bad');
    busy(addBtn, true, '추가하는 중…');
    try { const id = await store.addStudent(n, b); toast(`학생을 추가했어요: ${n}`, 'good'); nav(`#/admin/student/${id}`); }
    catch (err) { toast(err.message, 'bad'); } finally { busy(addBtn, false); }
  } }, name, birth, addBtn);

  const rows = students.map((s) => {
    const p = allProg[s.id]?.[s.current];
    const wk = weekSeconds(sessions, s.id);
    return h('tr', { class: s.active ? '' : 'inactive', onclick: () => nav(`#/admin/student/${s.id}`) },
      h('td', { class: 'strong' }, s.name, s.active ? '' : h('span', { class: 'pill' }, '중지')),
      h('td', null, s.current ? bookName[s.current] || '-' : h('span', { class: 'muted' }, '없음')),
      h('td', null, p?.bm ? bookmarkText(p.bm) : h('span', { class: 'muted' }, '-')),
      h('td', null, fmtDate(s.lastSeen)),
      h('td', null, wk ? fmtMinutes(wk) : h('span', { class: 'muted' }, '0분')),
      h('td', { class: 'chev' }, '›'));
  });
  adminShell('students',
    h('section', { class: 'card' }, h('h3', null, '학생 추가'), addForm,
      h('p', { class: 'muted small' }, '학생은 이름과 생일 4자리로 로그인합니다. 같은 이름이 있으면 "민준B"처럼 구분해 주세요.')),
    h('section', { class: 'card' }, h('h3', null, `학생 ${students.filter((s) => s.active).length}명`),
      students.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'table clickable' },
          h('thead', null, h('tr', null, ['이름', '지금 교재', '진도', '마지막 접속', '최근 7일 연습', ''].map((t) => h('th', null, t)))),
          h('tbody', null, rows)))
        : h('p', { class: 'muted' }, '아직 학생이 없어요.')));
}

async function adminStudent(id) {
  adminShell('students', spinner());
  const [st, books, prog, birthVal, sessions] = await Promise.all([store.getStudent(id), store.listBooks(), store.getProgress(id), store.getBirth(id), store.listSessions(30)]);
  if (!st) return adminShell('students', h('p', { class: 'pad' }, '학생을 찾을 수 없어요.'));
  let assigned = new Set(st.assigned || []);
  let current = st.current;

  const saveAssign = async () => {
    if (current && !assigned.has(current)) current = null;
    await store.updateStudent(id, { assigned: [...assigned], current: current || null });
    toast('저장했어요.', 'good');
    adminStudent(id);
  };

  const bookRows = books.map((b) => {
    const p = prog[b.id] || {};
    const on = assigned.has(b.id);
    return h('div', { class: 'assign-row' + (on ? ' on' : '') },
      h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: on, onchange: (e) => { e.target.checked ? assigned.add(b.id) : assigned.delete(b.id); saveAssign(); } }), h('span', null, b.title)),
      on ? h('label', { class: 'radio' }, h('input', { type: 'radio', name: 'cur', checked: current === b.id, onchange: () => { current = b.id; saveAssign(); } }), '지금 교재') : h('span'),
      on ? h('div', { class: 'assign-prog' },
        h('span', null, p.bm ? bookmarkText(p.bm) : h('span', { class: 'muted' }, '진도 없음')),
        h('button', { class: 'btn small ghost', onclick: () => setProgressSheet(id, b, p) }, '진도 정하기')) : h('span'));
  });

  const mySessions = sessions.filter((s) => s.sid === id);
  const birthInput = h('input', { class: 'input short', value: birthVal, inputmode: 'numeric', maxlength: 4 });
  adminShell('students',
    h('a', { class: 'back-link', href: '#/admin/students' }, '‹ 학생 목록'),
    h('section', { class: 'card' },
      h('div', { class: 'row between' }, h('h2', null, st.name),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', checked: st.active, onchange: async (e) => { await store.updateStudent(id, { active: e.target.checked }); toast(e.target.checked ? '사용으로 바꿨어요.' : '사용 중지했어요. 이 학생은 로그인할 수 없어요.'); } }), h('span', null, '사용'))),
      h('div', { class: 'row' }, h('span', { class: 'muted' }, '생일(로그인 번호)'), birthInput,
        h('button', { class: 'btn small', onclick: async (e) => {
          const b = normBirth(birthInput.value);
          if (!isValidBirth(b)) return toast('생일 4자리를 확인해 주세요.', 'bad');
          if (b === birthVal) return;
          busy(e.target, true); try { await store.setBirth(id, b); toast('바꿨어요.', 'good'); } catch (err) { toast(err.message, 'bad'); } finally { busy(e.target, false); }
        } }, '변경')),
      h('p', { class: 'muted small' }, `마지막 접속 ${fmtDate(st.lastSeen)} · 최근 7일 연습 ${fmtMinutes(weekSeconds(sessions, id))}`)),
    h('section', { class: 'card' }, h('h3', null, '교재 배정과 진도'),
      h('p', { class: 'muted small' }, '체크한 교재만 학생에게 보입니다. 앞으로 배울 교재는 체크하지 않으면 됩니다.'),
      books.length ? bookRows : h('p', { class: 'muted' }, '교재 탭에서 교재를 먼저 추가해 주세요.')),
    h('section', { class: 'card' }, h('h3', null, '최근 30일 기록'), sessionTable(mySessions, false)));
}

function setProgressSheet(sid, book, p) {
  sheet((body, close) => {
    const toc = sortToc(book.toc);
    const n = book.numPages || book.tocPages || 0;
    const pageIn = h('input', { class: 'input short', type: 'number', min: 1, max: n || 9999, value: p.bm?.page || '' });
    const save = async (page) => {
      if (!page || page < 1) return toast('쪽 번호를 확인해 주세요.', 'bad');
      const bm = makeBookmark(book, page, n || page);
      await store.saveBookmark(sid, book.id, bm);
      close(); toast(`진도를 정했어요: ${bookmarkText(bm)}`, 'good'); adminStudent(sid);
    };
    body.append(
      h('p', { class: 'sheet-msg' }, `이 학생이 연습한 위치를 정합니다. (${book.title})`),
      toc.length ? h('div', { class: 'toc-pick' }, toc.map((e) => h('button', { class: 'btn ghost', onclick: () => save(e.p) }, h('span', null, e.t), h('small', null, `${e.p}쪽`)))) : null,
      h('div', { class: 'row' }, h('span', null, '쪽 번호로:'), pageIn, h('button', { class: 'btn primary', onclick: () => save(+pageIn.value) }, '저장')));
  }, { title: '진도 정하기' });
}

async function adminBooks() {
  const [books, students] = await Promise.all([store.listBooks(), store.listStudents()]);
  const link = h('input', { class: 'input', placeholder: '구글 드라이브 파일 링크를 붙여 넣으세요' });
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
      const bid = await store.addBook({ title, driveId: id, checkedVersion: null });
      toast(`교재를 추가했어요: ${title}`, 'good');
      nav(`#/admin/book/${bid}`);
    } catch (err) { toast(err.message, 'bad'); } finally { busy(addBtn, false); }
  } }, link, addBtn);

  const count = (bid) => students.filter((s) => s.active && (s.assigned || []).includes(bid)).length;
  const statusCells = new Map();
  const rows = books.map((b) => {
    const cell = h('td', null, warnText(b));
    statusCells.set(b.id, cell);
    return h('tr', { onclick: () => nav(`#/admin/book/${b.id}`) },
      h('td', { class: 'strong' }, b.title),
      h('td', null, b.numPages ? `${b.numPages}쪽` : '-'),
      h('td', null, (b.toc || []).length ? `${b.toc.length}개` : h('span', { class: 'muted' }, '없음')),
      h('td', null, `${count(b.id)}명`),
      cell, h('td', { class: 'chev' }, '›'));
  });
  adminShell('books',
    h('section', { class: 'card' }, h('h3', null, '교재 추가'), addForm,
      h('p', { class: 'muted small' }, '드라이브의 GoodNotes 백업 폴더에서 PDF를 열고 공유 › 링크 복사로 얻은 주소를 붙여 넣으면 됩니다. 파일은 \'링크가 있는 모든 사용자\'로 공유되어 있어야 해요.')),
    h('section', { class: 'card' }, h('h3', null, `교재 ${books.length}권`),
      books.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'table clickable' },
        h('thead', null, h('tr', null, ['교재', '쪽수', '목차', '배정', '상태', ''].map((t) => h('th', null, t)))),
        h('tbody', null, rows))) : h('p', { class: 'muted' }, '아직 교재가 없어요.')));

  // 드라이브에서 바뀐 교재는 쪽수를 다시 세어 목차와 맞는지 확인한다
  for (const b of books) {
    if (!b.driveId) continue;
    try {
      const meta = await driveMeta(b.driveId);
      if (meta.modifiedTime !== b.checkedVersion) {
        statusCells.get(b.id)?.replaceChildren(h('span', { class: 'muted' }, '확인 중…'));
        const n = await countPages(b);
        b.numPages = n; b.checkedVersion = meta.modifiedTime;
        await store.updateBook(b.id, { numPages: n, checkedVersion: meta.modifiedTime });
      }
      statusCells.get(b.id)?.replaceChildren(warnText(b));
    } catch (e) {
      statusCells.get(b.id)?.replaceChildren(h('span', { class: 'bad-text' }, '열 수 없음'));
    }
  }
}

function warnText(b) {
  if ((b.toc || []).length && b.numPages && b.tocPages !== b.numPages) return h('span', { class: 'warn-text' }, '목차 확인 필요');
  return h('span', { class: 'good-text' }, '정상');
}

async function countPages(book) {
  const { data } = await loadPdf(book);
  const pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(data), cMapUrl: 'vendor/pdfjs/cmaps/', cMapPacked: true }).promise;
  const n = pdf.numPages; pdf.destroy();
  return n;
}

async function adminBook(id) {
  adminShell('books', spinner());
  let book = await store.getBook(id);
  if (!book) return adminShell('books', h('p', { class: 'pad' }, '교재를 찾을 수 없어요.'));
  let n = book.numPages || 0;
  let toc = sortToc(book.toc).map((e) => ({ ...e }));

  const title = h('input', { class: 'input', value: book.title });
  const tocBox = h('div', { class: 'toc-edit' });
  const pagesNote = h('p', { class: 'muted small' });
  const warn = h('div');

  const renderToc = () => {
    tocBox.replaceChildren(
      ...toc.map((e, i) => h('div', { class: 'toc-row' },
        h('input', { class: 'input', value: e.t, placeholder: '항목 이름', oninput: (ev) => { e.t = ev.target.value; } }),
        h('input', { class: 'input short', type: 'number', min: 1, value: e.p, oninput: (ev) => { e.p = +ev.target.value; } }),
        h('button', { class: 'icon-btn', 'aria-label': '삭제', onclick: () => { toc.splice(i, 1); renderToc(); } }, '✕'))),
      h('button', { class: 'btn ghost small', onclick: () => { toc.push({ t: '', p: (toc[toc.length - 1]?.p || 0) + 1 }); renderToc(); tocBox.querySelector('.toc-row:last-of-type input')?.focus(); } }, '+ 항목 추가'));
  };
  const renderWarn = () => {
    pagesNote.textContent = n ? `지금 교재 파일은 ${n}쪽입니다.` : '쪽수를 확인하는 중…';
    warn.replaceChildren(book.toc?.length && n && book.tocPages !== n
      ? h('div', { class: 'notice warn' }, `교재 쪽수가 목차를 저장했을 때(${book.tocPages}쪽)와 달라졌습니다(지금 ${n}쪽). 쪽 번호를 확인한 뒤 '목차 저장'을 눌러 주세요. 저장하기 전까지 학생들에게는 진도 위치가 '확인 필요'로 표시됩니다.`)
      : null);
  };
  renderToc(); renderWarn();

  const saveToc = async (btn) => {
    const clean = sortToc(toc.map((e) => ({ t: (e.t || '').trim(), p: +e.p })));
    if (n && clean.some((e) => e.p > n)) return toast(`쪽 번호는 ${n}쪽 이하여야 해요.`, 'bad');
    const titles = clean.map((e) => e.t);
    if (new Set(titles).size !== titles.length) return toast('같은 이름의 항목이 있어요. 진도를 찾을 때 헷갈리므로 이름을 다르게 해 주세요.', 'bad');
    busy(btn, true);
    await store.updateBook(id, { toc: clean, tocPages: n });
    book = { ...book, toc: clean, tocPages: n }; toc = clean.map((e) => ({ ...e }));
    renderToc(); renderWarn(); busy(btn, false); toast('목차를 저장했어요.', 'good');
  };

  const toggle = (key, label, help) => h('label', { class: 'switch' },
    h('input', { type: 'checkbox', checked: !!book[key], onchange: async (e) => { await store.updateBook(id, { [key]: e.target.checked }); book[key] = e.target.checked; toast('저장했어요.', 'good'); } }),
    h('span', null, label), help ? h('small', { class: 'muted' }, help) : null);

  const fileIn = h('input', { class: 'input', placeholder: '새 드라이브 링크 (파일을 바꿀 때만)' });
  adminShell('books',
    h('a', { class: 'back-link', href: '#/admin/books' }, '‹ 교재 목록'),
    h('section', { class: 'card' },
      h('div', { class: 'row' }, title, h('button', { class: 'btn', onclick: async () => { await store.updateBook(id, { title: title.value.trim() || book.title }); toast('저장했어요.', 'good'); } }, '이름 저장')),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn primary', onclick: () => nav(`#/read/${id}`) }, '교재 열어 보기'),
        book.driveId ? h('a', { class: 'btn ghost', href: `https://drive.google.com/file/d/${book.driveId}/view`, target: '_blank', rel: 'noopener' }, '드라이브에서 보기') : null),
      pagesNote,
      toggle('coverSingle', '두 쪽 보기에서 1쪽(표지)은 혼자 보이기', '책처럼 짝수 쪽이 왼쪽에 옵니다'),
      toggle('downloadable', '학생이 내려받을 수 있게 하기')),
    h('section', { class: 'card' }, h('h3', null, '목차'),
      h('p', { class: 'muted small' }, '학생 진도는 이 목차 항목 기준으로 저장됩니다. 교재를 고쳐서 쪽이 밀리면 여기 쪽 번호만 고쳐 주세요. 교재를 연 상태에서 \'목차+\' 버튼으로 지금 쪽을 바로 추가할 수도 있어요.'),
      warn, tocBox,
      h('div', { class: 'row end' }, h('button', { class: 'btn primary', onclick: (e) => saveToc(e.target) }, '목차 저장'))),
    h('section', { class: 'card' }, h('h3', null, '파일 바꾸기 · 삭제'),
      h('p', { class: 'muted small' }, 'GoodNotes 자동 백업으로 같은 파일이 갱신되는 경우에는 바꿀 필요가 없습니다. 아예 다른 파일로 교체할 때만 쓰세요.'),
      h('div', { class: 'row' }, fileIn, h('button', { class: 'btn', onclick: async (e) => {
        const fid = parseDriveId(fileIn.value); if (!fid) return toast('링크를 확인해 주세요.', 'bad');
        busy(e.target, true);
        try { await driveMeta(fid); await store.updateBook(id, { driveId: fid, checkedVersion: null }); toast('파일을 바꿨어요. 목차 쪽 번호를 확인해 주세요.', 'good'); adminBook(id); }
        catch (err) { toast(err.message, 'bad'); } finally { busy(e.target, false); }
      } }, '교체')),
      h('div', { class: 'row end' }, h('button', { class: 'btn danger', onclick: async () => {
        if (await confirmBox(`이 교재를 삭제할까요? (${book.title}) 학생 배정도 함께 풀리며, 드라이브 파일은 지워지지 않아요.`, { ok: '삭제', danger: true })) { await store.deleteBook(id); toast('삭제했어요.'); nav('#/admin/books'); }
      } }, '교재 삭제'))));

  if (!n) {
    try { n = await countPages(book); if (n !== book.numPages) await store.updateBook(id, { numPages: n }); book.numPages = n; } catch (e) { pagesNote.textContent = e.message; return; }
    renderWarn();
  }
}

function sessionTable(sessions, withName = true) {
  if (!sessions.length) return h('p', { class: 'muted' }, '기록이 없어요.');
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table' },
    h('thead', null, h('tr', null, [withName ? '학생' : null, '날짜', '교재', '연습 시간', '본 쪽', '장소'].filter(Boolean).map((t) => h('th', null, t)))),
    h('tbody', null, sessions.slice(0, 300).map((s) => h('tr', null,
      withName ? h('td', { class: 'strong' }, s.name || '-') : null,
      h('td', null, fmtDate(s.start)),
      h('td', null, s.bookTitle || '-'),
      h('td', null, fmtMinutes(s.seconds)),
      h('td', null, s.minPage ? (s.minPage === s.maxPage ? `${s.minPage}쪽` : `${s.minPage}–${s.maxPage}쪽`) : '-'),
      h('td', null, s.mode === 'academy' ? '학원' : '집'))))));
}

async function adminLogs(filterSid) {
  const [sessions, students] = await Promise.all([store.listSessions(30), store.listStudents()]);
  const sel = h('select', { class: 'input short', onchange: (e) => nav(e.target.value ? `#/admin/logs/${e.target.value}` : '#/admin/logs') },
    h('option', { value: '' }, '모든 학생'),
    students.sort((a, b) => a.name.localeCompare(b.name, 'ko')).map((s) => h('option', { value: s.id, selected: s.id === filterSid }, s.name)));
  const list = filterSid ? sessions.filter((s) => s.sid === filterSid) : sessions;
  const since7 = Date.now() - 7 * 86400000;
  const sum = {};
  for (const s of sessions.filter((x) => x.start >= since7)) {
    sum[s.sid] = sum[s.sid] || { name: s.name, sec: 0, home: 0, n: 0 };
    sum[s.sid].sec += s.seconds || 0; sum[s.sid].n++;
    if (s.mode === 'home') sum[s.sid].home += s.seconds || 0;
  }
  const ranking = Object.entries(sum).sort((a, b) => b[1].sec - a[1].sec);
  adminShell('logs',
    h('section', { class: 'card' }, h('h3', null, '최근 7일 연습 시간'),
      ranking.length ? h('div', { class: 'bars' }, ranking.map(([sid, v]) => {
        const max = ranking[0][1].sec || 1;
        return h('button', { class: 'bar-row', onclick: () => nav(`#/admin/logs/${sid}`) },
          h('span', { class: 'bar-name' }, v.name),
          h('span', { class: 'bar-track' }, h('i', { style: { width: Math.max(2, (v.sec / max) * 100) + '%' } })),
          h('span', { class: 'bar-val' }, fmtMinutes(v.sec), h('small', { class: 'muted' }, ` 집 ${fmtMinutes(v.home)}`)));
      })) : h('p', { class: 'muted' }, '최근 7일 기록이 없어요.')),
    h('section', { class: 'card' }, h('div', { class: 'row between' }, h('h3', null, '최근 30일 기록'), sel), sessionTable(list, !filterSid)));
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
        if (pw.value.length < 6) return toast('비밀번호는 6자 이상으로 해 주세요.', 'bad');
        if (ks.exists && !(await confirmBox('기존 학원 태블릿들의 등록이 해제됩니다. 계속할까요?', { ok: '새로 만들기' }))) return;
        busy(e.target, true);
        try { await store.createKiosk(pw.value); pw.value = ''; toast('학원 태블릿 비밀번호를 만들었어요.', 'good'); adminSettings(); } catch (err) { toast(err.message, 'bad'); } finally { busy(e.target, false); }
      } }, ks.exists ? '새로 만들기' : '만들기'))),
    h('section', { class: 'card' }, h('h3', null, '앱 주소'),
      h('p', null, h('code', null, here)),
      h('p', { class: 'muted small' }, '레노버 태블릿: 크롬으로 이 주소를 열고 메뉴(⋮) › \'앱 설치\' 또는 \'홈 화면에 추가\'. 그다음 설정 › 보안 › 앱 고정을 켜고, 최근 앱 화면에서 이 앱 아이콘을 눌러 \'고정\'을 고르면 이 앱만 쓸 수 있습니다.')),
    h('section', { class: 'card' }, h('h3', null, '이 기기'),
      h('div', { class: 'row wrap' },
        h('button', { class: 'btn ghost', onclick: async () => { await clearPdfCache(); toast('저장해 둔 교재 파일을 지웠어요. 다음에 열 때 새로 내려받습니다.'); } }, '저장된 교재 파일 지우기'),
        store.demo ? h('button', { class: 'btn ghost', onclick: async () => { if (await confirmBox('체험용 데이터를 처음 상태로 되돌릴까요?')) { await store.resetDemo(); nav('#/'); } } }, '체험 데이터 초기화') : null,
        h('button', { class: 'btn ghost', onclick: async () => { await store.logout(); nav('#/'); } }, '로그아웃'))));
}

// 학원 태블릿: 오래 꺼져 있다가 켜지면 이름 고르는 화면으로 돌아간다
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
  if (session?.role === 'kiosk' && hiddenAt && Date.now() - hiddenAt > 5 * 60 * 1000 && location.hash !== '#/') nav('#/');
});

boot();
