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

/**
 * Exact datetime when the user clicked Submit Request (created_at).
 */
export function formatWithdrawRequestedAt(row) {
  if (!row?.created_at) return '';
  const d = new Date(row.created_at);
  if (Number.isNaN(d.getTime())) return '';
  const dateYmd = dateToYYYYMMDDInBangkok(d);
  const time = bangkokHHMMSS(d);
  if (!dateYmd) return time;
  const [y, m, day] = dateYmd.split('-');
  return `${day}/${m}/${y} ${time}`;
}

/** HH:MM from Withdraw Request Time / เวลาที่ขอ — do not convert through Date (avoids TZ shift). */
export function formatWithdrawSelectedTime(raw) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  const only = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (only) return `${only[1].padStart(2, '0')}:${only[2]}`;
  const iso = s.match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  return '';
}

/** DD/MM/YYYY from Withdraw Date / วันที่เบิก. */
export function formatWithdrawSelectedDate(raw) {
  if (raw == null || raw === '') return '';
  const ymd = dateToYYYYMMDDInBangkok(raw);
  if (!ymd) return '';
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}

/** User-selected วันที่เบิก + เวลาที่ขอ from the Withdraw cart. */
export function formatWithdrawSelectedAt(row) {
  const dateStr = formatWithdrawSelectedDate(row?.withdraw_date);
  const timeStr = formatWithdrawSelectedTime(row?.request_time);
  if (dateStr && timeStr) return `${dateStr} ${timeStr}`;
  return dateStr || timeStr || '';
}

export function bangkokLocaleString(date = new Date(), options = {}) {
  return date.toLocaleString('en-GB', { timeZone: BANGKOK_TZ, ...options });
}

export function bangkokLocaleDateString(date = new Date(), options = {}) {
  return date.toLocaleDateString('en-GB', { timeZone: BANGKOK_TZ, ...options });
}
