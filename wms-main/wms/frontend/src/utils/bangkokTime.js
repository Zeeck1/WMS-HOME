/**
 * Business dates/times use Asia/Bangkok (UTC+7) so hosted (UTC) and local dev match Thailand operations.
 */

export const BANGKOK_TZ = 'Asia/Bangkok';

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

export function bangkokYYYYMMDD(date = new Date()) {
  const { y, m, d } = bangkokParts(date);
  return `${y}-${m}-${d}`;
}

export function bangkokYMDYesterday(date = new Date()) {
  const { y, m, d } = bangkokParts(date);
  const noonBangkok = new Date(`${y}-${m}-${d}T12:00:00+07:00`);
  const prev = new Date(noonBangkok.getTime() - 24 * 60 * 60 * 1000);
  return bangkokYYYYMMDD(prev);
}

/** YYYY-MM-DD in Bangkok for Date / datetime strings (not UTC calendar). */
export function dateToYYYYMMDDInBangkok(input) {
  if (input == null || input === '') return '';
  if (typeof input === 'string') {
    const iso = input.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return bangkokYYYYMMDD(d);
}

export function bangkokHHMM(date = new Date()) {
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

export function bangkokHHMMSS(date = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: BANGKOK_TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')}:${get('second')}`;
}

function normalizeRequestTime(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return '';
  return `${m[1].padStart(2, '0')}:${m[2]}:${m[3] || '00'}`;
}

/**
 * Exact requested withdraw datetime: DD/MM/YYYY HH:MM:SS
 * Uses withdraw_date + request_time when set, otherwise created_at.
 */
export function formatWithdrawRequestedAt(row) {
  if (!row) return '';
  const dateYmd = row.withdraw_date
    ? dateToYYYYMMDDInBangkok(row.withdraw_date)
    : (row.created_at ? dateToYYYYMMDDInBangkok(row.created_at) : '');
  let time = normalizeRequestTime(row.request_time);
  if (!time && row.created_at) {
    const d = new Date(row.created_at);
    if (!Number.isNaN(d.getTime())) time = bangkokHHMMSS(d);
  }
  if (!dateYmd) return time;
  const [y, m, d] = dateYmd.split('-');
  const dateStr = `${d}/${m}/${y}`;
  return time ? `${dateStr} ${time}` : dateStr;
}

export function bangkokLocaleString(date = new Date(), options = {}) {
  return date.toLocaleString('en-GB', { timeZone: BANGKOK_TZ, ...options });
}

export function bangkokLocaleDateString(date = new Date(), options = {}) {
  return date.toLocaleDateString('en-GB', { timeZone: BANGKOK_TZ, ...options });
}
