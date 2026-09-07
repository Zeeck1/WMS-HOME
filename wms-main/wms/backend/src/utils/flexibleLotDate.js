/**
 * Production / expiration dates:
 * - MM/YYYY stored as YYYY-MM (month-only)
 * - DD/MM/YYYY stored as YYYY-MM-DD (including day 01)
 */
function parseFlexibleLotDate(raw, label = 'Date') {
  if (raw == null || String(raw).trim() === '') return { value: null };
  const s = String(raw).trim();

  const monthOnlyIso = s.match(/^(\d{4})-(\d{2})$/);
  if (monthOnlyIso) {
    const yyyy = monthOnlyIso[1];
    const mm = monthOnlyIso[2];
    if (Number(mm) < 1 || Number(mm) > 12) {
      return { error: `${label} must be DD/MM/YYYY or MM/YYYY` };
    }
    return { value: `${yyyy}-${mm}` };
  }

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2];
    const dd = iso[3];
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) {
      return { error: `${label} must be DD/MM/YYYY or MM/YYYY` };
    }
    return { value: `${yyyy}-${mm}-${dd}` };
  }

  const mmY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (mmY) {
    const mm = mmY[1].padStart(2, '0');
    const yyyy = mmY[2];
    if (Number(mm) < 1 || Number(mm) > 12) {
      return { error: `${label} must be DD/MM/YYYY or MM/YYYY` };
    }
    return { value: `${yyyy}-${mm}` };
  }

  const ddmmyyyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const dd = ddmmyyyy[1].padStart(2, '0');
    const mm = ddmmyyyy[2].padStart(2, '0');
    const yyyy = ddmmyyyy[3];
    if (Number(mm) < 1 || Number(mm) > 12 || Number(dd) < 1 || Number(dd) > 31) {
      return { error: `${label} must be DD/MM/YYYY or MM/YYYY` };
    }
    return { value: `${yyyy}-${mm}-${dd}` };
  }

  return { error: `${label} must be DD/MM/YYYY or MM/YYYY` };
}

module.exports = { parseFlexibleLotDate };
