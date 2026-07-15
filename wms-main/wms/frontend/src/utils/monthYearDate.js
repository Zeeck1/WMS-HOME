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
