// 교재 PDF 가져오기: 구글 드라이브(또는 체험용 견본 파일) → 기기 저장소(Cache Storage)
// 같은 버전은 한 번만 내려받고, 드라이브 파일이 바뀌면(수정 시각 변경) 새로 받는다.

import { config } from './config.js';

const CACHE = 'lt-pdfs-v1';
const KEY_HOST = 'https://lt-cache.invalid/pdf/';
const apiKey = () => config.driveApiKey || config.firebase?.apiKey || '';
const metaUrl = (id) => `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,modifiedTime,size,mimeType&supportsAllDrives=true&key=${apiKey()}`;
const mediaUrl = (id) => `https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true&key=${apiKey()}`;

export class PdfError extends Error {}

function driveError(status, body) {
  const reason = body?.error?.errors?.[0]?.reason || body?.error?.status || '';
  if (status === 404) return new PdfError('드라이브에서 파일을 찾을 수 없습니다. 파일을 \'링크가 있는 모든 사용자\'로 공유했는지, 링크가 맞는지 확인해 주세요.');
  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') return new PdfError('Google Drive API가 꺼져 있습니다. 설정 안내서의 5단계를 확인해 주세요.');
  if (status === 403 && /referer|API_KEY|keyInvalid|forbidden/i.test(JSON.stringify(body))) return new PdfError('API 키가 드라이브 접근을 허용하지 않습니다. 설정 안내서의 5단계를 확인해 주세요.');
  if (status === 403) return new PdfError('드라이브 파일을 열 권한이 없습니다. \'링크가 있는 모든 사용자\'로 공유했는지 확인해 주세요.');
  return new PdfError(`드라이브 오류 (${status}) ${reason}`);
}

// 드라이브 파일 정보: { name, modifiedTime, size }
export async function driveMeta(id) {
  let res;
  try { res = await fetch(metaUrl(id)); } catch { throw new PdfError('인터넷 연결을 확인해 주세요.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw driveError(res.status, body);
  if (body.mimeType && body.mimeType !== 'application/pdf') throw new PdfError(`PDF 파일이 아닙니다 (${body.mimeType}).`);
  return body;
}

async function openCache() {
  try { return await caches.open(CACHE); } catch { return null; }
}

async function cachedVersions(cache, id) {
  if (!cache) return [];
  const keys = await cache.keys();
  return keys.filter((r) => r.url.startsWith(KEY_HOST + id + '?'));
}

// onProgress(비율 또는 null, 받은 바이트, { updating }): updating은 예전 버전이 기기에 있을 때 true
async function readWithProgress(res, total, onProgress, info = {}) {
  onProgress?.(total ? 0 : null, 0, info);
  if (!res.body || !onProgress) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    onProgress(total ? got / total : null, got, info);
  }
  const out = new Uint8Array(got);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out.buffer;
}

// 교재 PDF의 바이트를 돌려준다: { data: ArrayBuffer, version, fromCache, offline }
export async function loadPdf(book, onProgress) {
  if (book.src) { // 체험용 견본
    const res = await fetch(book.src);
    if (!res.ok) throw new PdfError('견본 파일을 열 수 없습니다.');
    return { data: await readWithProgress(res, +res.headers.get('content-length') || 0, onProgress), version: 'sample', fromCache: false };
  }
  const id = book.driveId;
  const cache = await openCache();
  let meta = null;
  try { meta = await driveMeta(id); } catch (e) {
    // 인터넷이 안 되면 기기에 저장된 가장 최근 버전을 연다
    const olds = await cachedVersions(cache, id);
    if (olds.length) {
      const res = await cache.match(olds[olds.length - 1]);
      return { data: await res.arrayBuffer(), version: new URL(olds[olds.length - 1].url).searchParams.get('v'), fromCache: true, offline: true };
    }
    throw e;
  }
  const key = `${KEY_HOST}${id}?v=${encodeURIComponent(meta.modifiedTime)}`;
  if (cache) {
    const hit = await cache.match(key);
    if (hit) return { data: await hit.arrayBuffer(), version: meta.modifiedTime, fromCache: true };
  }
  const updating = cache ? (await cachedVersions(cache, id)).length > 0 : false;
  onProgress?.(meta.size ? 0 : null, 0, { updating });
  let res;
  try { res = await fetch(mediaUrl(id)); } catch { throw new PdfError('인터넷 연결을 확인해 주세요.'); }
  if (!res.ok) throw driveError(res.status, await res.json().catch(() => ({})));
  const data = await readWithProgress(res, +meta.size || 0, onProgress, { updating });
  if (cache) {
    for (const old of await cachedVersions(cache, id)) await cache.delete(old);
    await cache.put(key, new Response(data.slice(0), { headers: { 'Content-Type': 'application/pdf' } })).catch(() => {});
  }
  return { data, version: meta.modifiedTime, fromCache: false };
}

export async function clearPdfCache() {
  try { await caches.delete(CACHE); } catch { /* 무시 */ }
}

export async function cacheUsage() {
  const cache = await openCache();
  if (!cache) return { count: 0 };
  return { count: (await cache.keys()).length };
}
