/**
 * All business dates/times use Asia/Bangkok (UTC+7), including on Railway (server default is UTC).
 */

const BANGKOK_TZ = 'Asia/Bangkok';

function bangkokParts(date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: BANGKOK_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return { y: get('year'), m: get('month'), d: get('day') };
}

function bangkokYYYYMMDD(date = new Date()) {
  const { y, m, d } = bangkokParts(date);
  return `${y}-${m}-${d}`;
}

/** YYYYMMDD (e.g. for withdraw request numbers). */
function bangkokYYYYMMDDCompact(date = new Date()) {
  return bangkokYYYYMMDD(date).replace(/-/g, '');
}

/** Previous calendar day in Bangkok. */
function bangkokYMDYesterday(date = new Date()) {
  const { y, m, d } = bangkokParts(date);
  const noonBangkok = new Date(`${y}-${m}-${d}T12:00:00+07:00`);
  const prev = new Date(noonBangkok.getTime() - 24 * 60 * 60 * 1000);
  return bangkokYYYYMMDD(prev);
}

/**
 * YYYY-MM-DD for a Date / ISO string in Bangkok (not UTC).
 * Plain YYYY-MM-DD strings are returned unchanged.
 */
function dateToYYYYMMDDInBangkok(input) {
  if (input == null || input === '') return '';
  if (typeof input === 'string') {
    const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return bangkokYYYYMMDD(d);
}

/** Excel serial day → YYYY-MM-DD in Bangkok (same calendar convention as sheet). */
function excelSerialToBangkokYYYYMMDD(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial)) return null;
  const utcMs = (serial - 25569) * 86400 * 1000;
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return null;
  return bangkokYYYYMMDD(d);
}

function bangkokHHMM(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

function bangkokLocaleString(date = new Date(), options = {}) {
  return date.toLocaleString('en-GB', { timeZone: BANGKOK_TZ, ...options });
}

function bangkokISOWithOffset(date = new Date()) {
  const ymd = bangkokYYYYMMDD(date);
  const hm = bangkokHHMM(date);
  return `${ymd}T${hm}:00+07:00`;
}

module.exports = {
  BANGKOK_TZ,
  bangkokYYYYMMDD,
  bangkokYYYYMMDDCompact,
  bangkokYMDYesterday,
  dateToYYYYMMDDInBangkok,
  excelSerialToBangkokYYYYMMDD,
  bangkokHHMM,
  bangkokLocaleString,
  bangkokISOWithOffset,
};
