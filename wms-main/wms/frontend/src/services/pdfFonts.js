/**
 * Thai font loader for jsPDF.
 * Fetches Sarabun (Google Fonts) at runtime, caches in memory.
 */

const FONT_URL = 'https://fonts.gstatic.com/s/sarabun/v15/DtVjJx26TKEr37c9YL5rilwm.ttf';
const FONT_BOLD_URL = 'https://fonts.gstatic.com/s/sarabun/v15/DtVmJx26TKEr37c9YNpoulwm6gDXvwE.ttf';

let cachedNormal = null;
let cachedBold = null;

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function fetchFont(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch font: ${res.status}`);
  return arrayBufferToBase64(await res.arrayBuffer());
}

export async function registerThaiFont(doc) {
  try {
    if (!cachedNormal) cachedNormal = await fetchFont(FONT_URL);
    if (!cachedBold) cachedBold = await fetchFont(FONT_BOLD_URL);

    doc.addFileToVFS('Sarabun-Regular.ttf', cachedNormal);
    doc.addFont('Sarabun-Regular.ttf', 'Sarabun', 'normal');

    doc.addFileToVFS('Sarabun-Bold.ttf', cachedBold);
    doc.addFont('Sarabun-Bold.ttf', 'Sarabun', 'bold');

    doc.setFont('Sarabun');
    return true;
  } catch (e) {
    console.warn('Could not load Thai font, falling back to default:', e);
    return false;
  }
}
