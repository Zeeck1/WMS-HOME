/** Parse "15.2, 16.2, 14.3" → sum for display / weight_kg. */
export function sumKgPartsString(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  const parts = s.split(/[,，;]+/).map((x) => x.trim()).filter(Boolean);
  let sum = 0;
  for (const p of parts) {
    const n = parseFloat(p.replace(/,/g, ''));
    if (Number.isFinite(n)) sum += n;
  }
  return Math.round(sum * 100) / 100;
}
