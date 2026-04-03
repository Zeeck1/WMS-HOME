/**
 * Thai font loader for jsPDF.
 * Prefers same-origin files in `public/fonts/` (reliable in production / restricted networks).
 * Falls back to Google Fonts CDN (URLs must match current css2 API — v15 links 404 as of 2026).
 */

const FONT_URL_NORMAL = 'https://fonts.gstatic.com/s/sarabun/v17/DtVjJx26TKEr37c9WBI.ttf';
const FONT_URL_BOLD = 'https://fonts.gstatic.com/s/sarabun/v17/DtVmJx26TKEr37c9YK5sulw.ttf';

let cachedNormal = null;
let cachedBold = null;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fetchFontAsBase64(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch font: ${res.status}`);
  return arrayBufferToBase64(await res.arrayBuffer());
}

/** CRA/Webpack inlines PUBLIC_URL; same-origin avoids CORS and stale gstatic paths */
function publicFontUrl(filename) {
  const base = typeof process !== 'undefined' && process.env?.PUBLIC_URL != null
    ? String(process.env.PUBLIC_URL).replace(/\/$/, '')
    : '';
  return `${base}/fonts/${filename}`;
}

async function loadNormalBase64() {
  if (cachedNormal) return cachedNormal;
  try {
    cachedNormal = await fetchFontAsBase64(publicFontUrl('Sarabun-Regular.ttf'));
  } catch {
    cachedNormal = await fetchFontAsBase64(FONT_URL_NORMAL);
  }
  return cachedNormal;
}

async function loadBoldBase64() {
  if (cachedBold) return cachedBold;
  try {
    cachedBold = await fetchFontAsBase64(publicFontUrl('Sarabun-Bold.ttf'));
  } catch {
    cachedBold = await fetchFontAsBase64(FONT_URL_BOLD);
  }
  return cachedBold;
}

export async function registerThaiFont(doc) {
  try {
    const normal = await loadNormalBase64();
    const bold = await loadBoldBase64();

    doc.addFileToVFS('Sarabun-Regular.ttf', normal);
    doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal', undefined, 'Identity-H');

    doc.addFileToVFS('Sarabun-Bold.ttf', bold);
    doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold', undefined, 'Identity-H');

    doc.setFont('Sarabun', 'normal');
    return true;
  } catch (e) {
    console.warn('Could not load Thai font, falling back to default:', e);
    return false;
  }
}
