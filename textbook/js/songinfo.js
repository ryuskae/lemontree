// 곡 정보: 학생이 보는 창과 선생님이 쓰는 편집 창
// 사진은 기기에서 줄여서(JPEG) 곡 정보 문서 안에 함께 저장한다.
// Firestore 문서 하나는 1MB까지라서, 사진 전체를 약 850KB 안으로 맞춘다.

import { h, sheet, toast, busy, icon } from './ui.js';

const MAX_TOTAL = 850 * 1024;
const MAX_IMAGES = 6;

// 글 안의 인터넷 주소는 누를 수 있는 링크로 바꾼다
function linkify(text) {
  const out = [];
  const re = /(https?:\/\/[^\s]+)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('a', { href: m[1], target: '_blank', rel: 'noopener' }, m[1]));
    last = m.index + m[1].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// 사진을 크게 보기 (누르면 닫힘)
function openImage(src) {
  const back = h('div', { class: 'img-zoom', onclick: () => { back.classList.remove('show'); setTimeout(() => back.remove(), 160); } },
    h('img', { src, alt: '' }), h('button', { class: 'icon-btn img-zoom-close', 'aria-label': '닫기' }, icon('close')));
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add('show'));
}

// 학생이 보는 곡 정보 창. info는 객체이거나 객체를 돌려줄 Promise
export function showSongInfo(song, info) {
  return sheet((body) => {
    body.classList.add('song-info');
    const box = h('div', null, h('div', { class: 'loading' }, h('div', { class: 'spin' })));
    body.append(box);
    Promise.resolve(info).then((v) => {
      if (!v || (!v.text && !(v.images || []).length)) { box.replaceChildren(h('p', { class: 'muted' }, '아직 등록된 곡 정보가 없어요.')); return; }
      box.replaceChildren(...[
        v.text ? h('div', { class: 'song-info-text' }, linkify(v.text)) : null,
        ...(v.images || []).map((src) => h('button', { class: 'song-info-img', onclick: () => openImage(src), 'aria-label': '사진 크게 보기' }, h('img', { src, alt: '', loading: 'lazy' }))),
      ].filter(Boolean));
    }).catch(() => box.replaceChildren(h('p', { class: 'bad-text' }, '곡 정보를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.')));
  }, { title: song, wide: true });
}

// 사진 파일을 JPEG로 줄인다
async function shrink(file, maxSide, quality) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const data = c.toDataURL('image/jpeg', quality);
    c.width = 0; c.height = 0;
    return data;
  } finally { URL.revokeObjectURL(url); }
}
const sizeOf = (list) => list.reduce((a, s) => a + s.length, 0);

// 선생님용 편집 창. 저장하면 true, 지우면 'deleted'를 돌려준다
export function editSongInfo({ store, book, song, onSaved }) {
  return sheet((body, close) => {
    body.classList.add('song-info');
    const text = h('textarea', { class: 'input textarea', rows: 8, placeholder: '곡에 대한 설명, 작곡가, 연습 요령, 참고 영상 주소 등을 자유롭게 적어 주세요.' });
    let images = [];
    const thumbs = h('div', { class: 'thumbs' });
    const meter = h('p', { class: 'muted small' });
    const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden' });
    const addBtn = h('button', { class: 'btn small', type: 'button', onclick: () => fileIn.click() }, icon('plus'), '사진 추가');
    const paintThumbs = () => {
      thumbs.replaceChildren(...images.map((src, i) => h('div', { class: 'thumb' },
        h('img', { src, alt: '' }),
        h('div', { class: 'thumb-tools' },
          i > 0 ? h('button', { class: 'icon-btn', 'aria-label': '앞으로', onclick: () => { [images[i - 1], images[i]] = [images[i], images[i - 1]]; paintThumbs(); } }, icon('left')) : null,
          h('button', { class: 'icon-btn', 'aria-label': '사진 빼기', onclick: () => { images.splice(i, 1); paintThumbs(); } }, icon('trash'))))));
      const kb = Math.round(sizeOf(images) / 1024);
      meter.textContent = images.length ? `사진 ${images.length}장 · ${kb}KB / ${Math.round(MAX_TOTAL / 1024)}KB` : '사진은 없어도 돼요.';
      addBtn.disabled = images.length >= MAX_IMAGES;
    };
    fileIn.addEventListener('change', async () => {
      const files = [...fileIn.files].slice(0, MAX_IMAGES - images.length);
      fileIn.value = '';
      busy(addBtn, true, '사진 줄이는 중…');
      try {
        for (const f of files) {
          // 남은 용량에 맞춰 크기와 화질을 낮춰 가며 넣는다
          const room = MAX_TOTAL - sizeOf(images);
          let data = null;
          for (const [side, q] of [[1600, 0.82], [1300, 0.78], [1000, 0.72], [800, 0.66]]) {
            data = await shrink(f, side, q);
            if (data.length <= Math.min(room, 320 * 1024)) break;
          }
          if (!data || data.length > room) { toast('사진이 너무 많거나 커서 더 넣을 수 없어요. 다른 사진을 빼 주세요.', 'bad'); break; }
          images.push(data);
          paintThumbs();
        }
      } catch { toast('사진을 읽지 못했어요. 다른 사진으로 시도해 주세요.', 'bad'); }
      finally { busy(addBtn, false); paintThumbs(); }
    });

    const saveBtn = h('button', { class: 'btn primary', onclick: async () => {
      const t = text.value.trim();
      if (!t && !images.length) return toast('글이나 사진을 넣어 주세요. 곡 정보를 없애려면 \'곡 정보 지우기\'를 누르세요.', 'bad');
      busy(saveBtn, true, '저장하는 중…');
      try {
        const infoSongs = await store.setSongInfo(book, song, { text: t, images });
        onSaved?.(infoSongs); toast(`곡 정보를 저장했어요 · ${song}`, 'good'); close(true);
      } catch (e) { toast(e.message || '저장하지 못했어요.', 'bad'); } finally { busy(saveBtn, false); }
    } }, '저장');
    const delBtn = h('button', { class: 'btn danger', onclick: async () => {
      busy(delBtn, true);
      try { const infoSongs = await store.deleteSongInfo(book, song); onSaved?.(infoSongs); toast(`곡 정보를 지웠어요 · ${song}`); close('deleted'); }
      catch (e) { toast(e.message || '지우지 못했어요.', 'bad'); } finally { busy(delBtn, false); }
    } }, '곡 정보 지우기');

    const has = (book.infoSongs || []).includes(song);
    body.append(
      h('label', { class: 'field' }, h('span', null, '글'), text),
      h('div', { class: 'field' }, h('span', null, '사진'), thumbs, h('div', { class: 'row wrap' }, addBtn, fileIn), meter),
      h('p', { class: 'muted small' }, '사진은 기기에서 자동으로 줄여서 저장해요. 악보나 손글씨처럼 글씨가 작은 사진은 한 장씩 넣는 편이 선명해요.'),
      h('div', { class: 'row between wrap' }, has ? delBtn : h('span'), saveBtn));
    paintThumbs();
    if (has) {
      text.disabled = true; text.placeholder = '불러오는 중…';
      store.getSongInfo(book.id, song).then((v) => {
        text.disabled = false; text.placeholder = '곡에 대한 설명, 작곡가, 연습 요령, 참고 영상 주소 등을 자유롭게 적어 주세요.';
        if (v) { text.value = v.text || ''; images = [...(v.images || [])]; paintThumbs(); }
      }).catch(() => { text.disabled = false; toast('곡 정보를 불러오지 못했어요.', 'bad'); });
    }
  }, { title: `곡 정보 · ${song}`, wide: true });
}
