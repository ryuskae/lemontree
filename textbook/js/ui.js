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

export function busy(btn, on, label) {
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || '잠시만요…'; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}
