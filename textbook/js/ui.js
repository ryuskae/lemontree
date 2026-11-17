// 화면 조립에 쓰는 작은 도우미들

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') el.innerHTML = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);

let toastTimer;
export function toast(msg, kind = '') {
  let t = $('#toast');
  if (!t) { t = h('div', { id: 'toast', role: 'status' }); document.body.append(t); }
  t.className = 'toast show ' + kind;
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 2600);
}

// 아래에서 올라오는 시트. 닫힐 때 resolve된다.
export function sheet(build, { title, wide } = {}) {
  return new Promise((resolve) => {
    const close = (val) => { back.classList.remove('show'); setTimeout(() => back.remove(), 180); resolve(val); };
    const body = h('div', { class: 'sheet-body' });
    const panel = h('div', { class: 'sheet' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      title ? h('div', { class: 'sheet-head' }, h('h3', null, title), h('button', { class: 'icon-btn', 'aria-label': '닫기', onclick: () => close(null) }, '✕')) : null,
      body);
    const back = h('div', { class: 'sheet-back', onclick: (e) => { if (e.target === back) close(null); } }, panel);
    document.body.append(back);
    build(body, close);
    requestAnimationFrame(() => back.classList.add('show'));
  });
}

export function confirmBox(msg, { ok = '확인', danger = false } = {}) {
  return sheet((body, close) => {
    body.append(
      h('p', { class: 'sheet-msg' }, msg),
      h('div', { class: 'row end' },
        h('button', { class: 'btn ghost', onclick: () => close(false) }, '취소'),
        h('button', { class: 'btn ' + (danger ? 'danger' : 'primary'), onclick: () => close(true) }, ok)),
    );
  });
}

export function spinner(text = '') {
  return h('div', { class: 'loading' }, h('div', { class: 'spin' }), text ? h('div', { class: 'muted' }, text) : null);
}

// 버튼을 잠시 '처리 중'으로 바꾼다. 아이콘이 있는 버튼도 원래 모양으로 되돌린다.
export function busy(btn, on, label) {
  if (on) {
    if (!btn._saved) btn._saved = [...btn.childNodes];
    btn.textContent = label || '잠시만요…'; btn.disabled = true;
  } else {
    if (btn._saved) { btn.replaceChildren(...btn._saved); btn._saved = null; }
    btn.disabled = false;
  }
}

// 선 아이콘 (24×24, 2px 선)
const ICONS = {
  back: '<path d="M15 18l-6-6 6-6"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1"/><circle cx="3.5" cy="12" r="1"/><circle cx="3.5" cy="18" r="1"/>',
  page1: '<rect x="6" y="3" width="12" height="18" rx="2"/>',
  page2: '<rect x="2" y="4" width="9" height="16" rx="1.5"/><rect x="13" y="4" width="9" height="16" rx="1.5"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  zoomIn: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  heart: '<path d="M12 20s-7-4.4-9.2-8.6C1.3 8.3 3.1 5 6.4 5c2.1 0 3.4 1.2 4.1 2.3h3c.7-1.1 2-2.3 4.1-2.3 3.3 0 5.1 3.3 3.6 6.4C19 15.6 12 20 12 20z" transform="translate(0 -.5)"/>',
  bookmark: '<path d="M6 3h12v18l-6-4.5L6 21z"/>',
  heartList: '<path d="M3 6h10M3 11h6M3 16h5"/><path d="M16.5 21s-4.6-2.9-5.7-5.5c-.8-1.9.4-3.9 2.3-3.9 1.3 0 2.2.8 2.6 1.5h1.6c.4-.7 1.3-1.5 2.6-1.5 1.9 0 3.1 2 2.3 3.9-1.1 2.6-5.7 5.5-5.7 5.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  up: '<path d="M6 15l6-6 6 6"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
};
export function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
  s.setAttribute('class', 'ic ' + cls);
  s.innerHTML = ICONS[name] || '';
  return s;
}

// 켜짐·꺼짐이 한눈에 보이는 스위치. onChange가 실패하면 원래대로 돌아간다.
export function toggleSwitch({ checked = false, label, help, onText = '켜짐', offText = '꺼짐', onChange }) {
  let on = !!checked, saving = false;
  const state = h('span', { class: 'tgl-state' });
  const btn = h('button', { class: 'tgl', type: 'button', role: 'switch' }, h('span', { class: 'tgl-thumb' }));
  const paint = () => { btn.setAttribute('aria-checked', String(on)); btn.classList.toggle('on', on); state.textContent = on ? onText : offText; state.classList.toggle('on', on); };
  paint();
  btn.addEventListener('click', async () => {
    if (saving) return;
    const prev = on; on = !on; paint();
    saving = true; btn.classList.add('saving');
    try { await onChange?.(on); }
    catch (e) { on = prev; paint(); toast('저장하지 못했어요. 인터넷 연결을 확인해 주세요.', 'bad'); }
    finally { saving = false; btn.classList.remove('saving'); }
  });
  return h('div', { class: 'tgl-row' },
    h('div', { class: 'tgl-text' }, h('span', { class: 'tgl-label' }, label), help ? h('small', { class: 'muted' }, help) : null),
    state, btn);
}
