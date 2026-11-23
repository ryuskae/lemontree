// 곡 정보의 유튜브 영상
// 유튜브 화면 안의 'YouTube에서 보기' 같은 버튼을 누르면 유튜브 앱이 열려 버리므로,
// 영상 위를 투명한 막으로 덮어 누를 수 없게 하고 재생·멈춤·이동·속도·크게 보기는 앱의 버튼으로 한다.
// 단, 재생을 눌렀는데 영상 시간이 흐르지 않을 때(광고, 불러오는 중, 기기가 재생을 막은 경우)는
// 막을 걷어 광고의 '건너뛰기'나 유튜브 자체 재생 버튼을 직접 누를 수 있게 한다. 제목 줄만 계속 막는다.

import { h, icon } from './ui.js';

const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';
const svg = (html) => { const s = h('span', { class: 'yt-ic' }); s.innerHTML = html; return s; };

let apiPromise = null;
function loadApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) {
    apiPromise = new Promise((res, rej) => {
      const before = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { try { before?.(); } catch { /* 무시 */ } res(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.async = true;
      s.onerror = () => { apiPromise = null; s.remove(); rej(new Error('youtube api')); };
      document.head.append(s);
    });
  }
  return apiPromise;
}

const fmt = (s) => {
  s = Math.max(0, Math.floor(s || 0));
  const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0');
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`;
};

const RATES = [1, 0.75, 0.5];

// 점검용: 재생 시간 글자를 빠르게 5번 누르면 유튜브가 알려 주는 상태 번호가 함께 보인다(다시 5번 누르면 꺼짐)
const debugOn = () => { try { return localStorage.getItem('lt-ytdebug') === '1'; } catch { return false; } };
let taps = [];
function debugTap() {
  const now = Date.now(); taps = taps.filter((x) => now - x < 2000); taps.push(now);
  if (taps.length >= 5) { taps = []; try { localStorage.setItem('lt-ytdebug', debugOn() ? '0' : '1'); } catch { /* 무시 */ } }
}

export function youtubePlayer({ id, start = 0 }) {
  const slot = h('div', { class: 'yt-slot' });
  const big = h('span', { class: 'yt-big' }, svg(ICON_PLAY));
  const shield = h('div', { class: 'yt-shield', role: 'button', 'aria-label': '재생', tabindex: '0' }, big);
  const msg = h('div', { class: 'yt-msg hidden' });
  const playBtn = h('button', { class: 'yt-btn', type: 'button', 'aria-label': '재생' }, svg(ICON_PLAY));
  const seek = h('input', { type: 'range', class: 'yt-seek', min: 0, max: 1, step: 1, value: 0, 'aria-label': '재생 위치', disabled: true });
  const time = h('span', { class: 'yt-time' }, '0:00');
  const soundBtn = h('button', { class: 'yt-btn yt-sound hidden', type: 'button', 'aria-label': '소리 켜기' }, svg(ICON_MUTED), h('span', null, '소리 켜기'));
  time.addEventListener('click', debugTap);
  const rateBtn = h('button', { class: 'yt-btn yt-rate', type: 'button', 'aria-label': '재생 속도', title: '재생 속도' }, '1×');
  const canFull = !!(document.documentElement.requestFullscreen || document.documentElement.webkitRequestFullscreen);
  const fsBtn = canFull ? h('button', { class: 'yt-btn', type: 'button', 'aria-label': '크게 보기', title: '크게 보기' }, icon('expand')) : null;
  const bar = h('div', { class: 'yt-bar' }, playBtn, seek, time, soundBtn, rateBtn, fsBtn);
  const guard = h('div', { class: 'yt-guard' });
  const box = h('div', { class: 'yt' }, h('div', { class: 'yt-frame' }, slot, shield, guard, msg), bar);

  let player = null, ready = false, state = -1, wantPlay = false, dragging = false, timer = null, ri = 0;
  let requested = false;
  const log = [];
  const playing = () => state === 1 || state === 3;

  // 광고가 나오는 동안은 유튜브가 '재생 중'이라고 알려 주지 않으므로, 막을 걷은 상태도 재생 중으로 본다
  const visiblyOn = () => playing() || (requested && box.classList.contains('yt-pass'));
  function paint() {
    const on = visiblyOn();
    playBtn.replaceChildren(svg(on ? ICON_PAUSE : ICON_PLAY));
    playBtn.setAttribute('aria-label', on ? '멈춤' : '재생');
    shield.setAttribute('aria-label', on ? '멈춤' : '재생');
    box.classList.toggle('is-playing', on);
    soundBtn.classList.toggle('hidden', !(ready && player.isMuted?.()));
  }
  // 재생을 요청한 뒤 유튜브가 '재생 중'이라고 알리지 않으면 광고·불러오는 중·재생 차단으로 보고 막을 걷는다.
  // 광고 중에는 본 영상이 '멈춤'으로 보고되기도 하므로, 멈춤은 앱의 버튼으로 멈췄을 때(requested=false)만 인정한다.
  function updatePass() {
    const pass = requested && state !== 1 && state !== 0;
    if (pass !== box.classList.contains('yt-pass')) { box.classList.toggle('yt-pass', pass); paint(); }
  }
  function tick() {
    if (!box.isConnected) return destroy();
    if (!ready) return;
    const t = player.getCurrentTime?.() || 0, d = player.getDuration?.() || 0;
    updatePass();
    if (dragging) return;
    if (d) { seek.max = Math.floor(d); seek.disabled = false; }
    seek.value = Math.floor(t);
    const dbg = debugOn() ? ` [${state}|${requested ? 1 : 0}|${log.join(',')}]` : '';
    time.textContent = (box.classList.contains('yt-pass') ? '광고·준비 중' : (d ? `${fmt(t)} / ${fmt(d)}` : fmt(t))) + dbg;
  }
  function showMsg(text) { msg.textContent = text; msg.classList.remove('hidden'); bar.classList.add('hidden'); big.classList.add('hidden'); }
  function destroy() {
    clearInterval(timer); io?.disconnect();
    try { player?.destroy(); } catch { /* 무시 */ }
    player = null; ready = false;
  }

  function play() {
    if (!ready) { wantPlay = true; create(); return; }
    requested = true;
    player.playVideo();
    // 영상이 바로 흐르지 않으면 updatePass가 막을 걷어, 광고 건너뛰기나 유튜브 재생 버튼을 직접 누르게 한다
  }
  const toggle = () => {
    if (!visiblyOn()) return play();
    if (ready) player.pauseVideo();
    requested = false; updatePass(); paint();
  };
  shield.addEventListener('click', (e) => { e.preventDefault(); toggle(); });
  shield.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  shield.addEventListener('contextmenu', (e) => e.preventDefault());
  playBtn.onclick = toggle;
  soundBtn.onclick = () => { if (!ready) return; player.unMute(); player.setVolume(100); paint(); };
  rateBtn.onclick = () => {
    ri = (ri + 1) % RATES.length;
    rateBtn.textContent = `${RATES[ri]}×`;
    if (ready) player.setPlaybackRate(RATES[ri]);
  };
  seek.addEventListener('input', () => { dragging = true; time.textContent = `${fmt(+seek.value)} / ${fmt(+seek.max)}`; });
  seek.addEventListener('change', () => { dragging = false; if (ready) player.seekTo(+seek.value, true); });
  if (fsBtn) fsBtn.onclick = () => {
    const fe = document.fullscreenElement || document.webkitFullscreenElement;
    if (fe === box) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else Promise.resolve((box.requestFullscreen || box.webkitRequestFullscreen).call(box)).catch(() => {});
  };

  let creating = false;
  function create() {
    if (creating || player) return;
    creating = true;
    loadApi().then((YT) => {
      if (!box.isConnected && !document.body.contains(box)) { creating = false; return; }
      const el = h('div');
      slot.replaceChildren(el);
      player = new YT.Player(el, {
        host: 'https://www.youtube-nocookie.com',
        videoId: id,
        width: '100%', height: '100%',
        playerVars: {
          controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3,
          cc_load_policy: 0, enablejsapi: 1, origin: location.origin, ...(start ? { start } : {}),
        },
        events: {
          onReady: () => {
            ready = true; creating = false;
            if (RATES[ri] !== 1) player.setPlaybackRate(RATES[ri]);
            tick(); paint();
            timer = setInterval(tick, 250);
            if (wantPlay) { wantPlay = false; play(); }
          },
          onStateChange: (e) => {
            state = e.data;
            if (state === 1) requested = true;
            if (state === 0) requested = false;
            log.push(state); if (log.length > 8) log.shift();
            paint(); tick();
          },
          onError: () => showMsg('이 영상은 교재 앱 안에서 재생할 수 없어요. 선생님께 알려 주세요.'),
        },
      });
      const f = slot.querySelector('iframe');
      if (f) { f.title = '유튜브 영상'; f.setAttribute('tabindex', '-1'); }
    }).catch(() => { creating = false; showMsg('영상을 불러오지 못했어요. 인터넷 연결을 확인해 주세요.'); });
  }

  // 화면에 보일 때 영상을 준비한다 (곡 정보 창을 열자마자 영상을 모두 받지 않도록)
  const io = 'IntersectionObserver' in window
    ? new IntersectionObserver((ents) => { if (ents.some((x) => x.isIntersecting)) { io.disconnect(); create(); } }, { rootMargin: '200px' })
    : null;
  if (io) requestAnimationFrame(() => io.observe(box)); else setTimeout(create, 0);
  return box;
}
