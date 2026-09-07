function toDateString(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, '0');
    const d = String(value.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const s = String(value).trim();
  const isoT = s.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (isoT) return isoT[1];
  return s;
}

/** Display: MM/YYYY for month-only (YYYY-MM), otherwise DD/MM/YYYY including day 01. */
export function formatFlexibleDateDisplay(value) {
  const s = toDateString(value);
  if (!s) return '';

  const mmY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (mmY) {
    const mm = mmY[1].padStart(2, '0');
    return `${mm}/${mmY[2]}`;
  }

  const monthOnly = s.match(/^(\d{4})-(\d{2})$/);
  if (monthOnly) return `${monthOnly[2]}/${monthOnly[1]}`;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2];
    const dd = iso[3];
    return `${dd}/${mm}/${yyyy}`;
  }

  return s;
}

/** Parse user input: MM/YYYY => YYYY-MM, DD/MM/YYYY => YYYY-MM-DD. */
export function parseFlexibleDateInput(raw) {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';

  const nativeMonth = s.match(/^(\d{4})-(\d{2})$/);
  if (nativeMonth) return `${nativeMonth[1]}-${nativeMonth[2]}`;

  const mmY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (mmY) {
    const mm = mmY[1].padStart(2, '0');
    const yyyy = mmY[2];
    return `${yyyy}-${mm}`;
  }

  const ddmmyyyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const dd = ddmmyyyy[1].padStart(2, '0');
    const mm = ddmmyyyy[2].padStart(2, '0');
    const yyyy = ddmmyyyy[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  return s;
}

export function toMonthInput(value) {
  if (value == null || value === '') return '';
  const match = String(value).trim().match(/^(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : '';
}

export function monthInputToDate(value) {
  if (value == null || value === '') return '';
  const match = String(value).trim().match(/^(\d{4})-(\d{2})$/);
  return match ? `${match[1]}-${match[2]}-01` : '';
}

export function formatMonthYear(value, blank = '-') {
  if (value == null || value === '') return blank;
  const match = String(value).trim().match(/^(\d{4})-(\d{2})/);
  return match ? `${match[2]}/${match[1]}` : blank;
}
