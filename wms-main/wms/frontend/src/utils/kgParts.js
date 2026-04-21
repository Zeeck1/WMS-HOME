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

/** @returns {number[]} */
export function parseKgPartsToArray(raw) {
  if (raw == null) return [];
  const s = String(raw).trim();
  if (!s) return [];
  return s
    .split(/[,，;]+/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((p) => parseFloat(p.replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

/** Format part list for print / balance column (comma-separated, 2 decimals). */
export function formatKgPartsArray(parts) {
  if (!parts || parts.length === 0) return '';
  return parts.map((n) => String(round2(n))).join(', ');
}

function partsEqual(a, b) {
  return Math.abs(round2(a) - round2(b)) < 0.001;
}

export function subtractKgPartsMultiset(balanceParts, withdrawParts) {
  const bal = [...balanceParts].map((x) => round2(x));
  for (const w of withdrawParts) {
    const idx = bal.findIndex((b) => partsEqual(b, w));
    if (idx === -1) return { ok: false, remaining: bal };
    bal.splice(idx, 1);
  }
  return { ok: true, remaining: bal };
}

/**
 * When OUT row only has total KG (no kg_parts_out), find if exactly one subset of `parts` sums to target.
 * Used for print display when legacy rows only stored weight_kg_out.
 * @returns {{ inferredParts: number[], remaining: number[] } | null}
 */
export function inferUniqueSubsetRemoval(parts, targetWeight) {
  const target = round2(Number(targetWeight));
  if (!Number.isFinite(target) || target <= 0 || !parts || parts.length === 0) return null;
  const p = parts.map((x) => round2(x));
  const n = p.length;
  if (n > 22) return null;
  const tol = 0.05;
  const solutions = [];
  for (let mask = 1; mask < 1 << n; mask++) {
    let s = 0;
    const idxs = [];
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        s += p[i];
        idxs.push(i);
      }
    }
    s = round2(s);
    if (Math.abs(s - target) < tol) solutions.push(idxs);
  }
  if (solutions.length !== 1) return null;
  const idxSet = new Set(solutions[0]);
  const inferredParts = solutions[0].sort((a, b) => a - b).map((i) => p[i]);
  const remaining = p.filter((_, i) => !idxSet.has(i));
  return { inferredParts, remaining };
}

/**
 * @param {{ kg_parts?: string|null, weight_kg?: number|string }} depositItem
 * @param {{ kg_parts_out?: string|null, weight_kg_out?: number|string }[]} withdrawalsOrdered
 */
export function getRemainingKgState(depositItem, withdrawalsOrdered) {
  const kgParts = depositItem.kg_parts && String(depositItem.kg_parts).trim();
  const wKg = parseFloat(depositItem.weight_kg) || 0;
  if (!kgParts) {
    const tot = withdrawalsOrdered.reduce((s, w) => s + (parseFloat(w.weight_kg_out) || 0), 0);
    return {
      mode: 'scalar',
      balance_kg: round2(wKg - tot),
      balance_kg_parts: null,
      remainingParts: null,
    };
  }

  let parts = parseKgPartsToArray(depositItem.kg_parts);
  let allParts = true;
  for (const w of withdrawalsOrdered) {
    const outStr = w.kg_parts_out && String(w.kg_parts_out).trim();
    if (outStr) {
      const sub = parseKgPartsToArray(w.kg_parts_out);
      const r = subtractKgPartsMultiset(parts, sub);
      if (!r.ok) {
        allParts = false;
        break;
      }
      parts = r.remaining;
    } else if (parseFloat(w.weight_kg_out) > 0) {
      allParts = false;
      break;
    }
  }

  if (!allParts) {
    const tot = withdrawalsOrdered.reduce((s, w) => s + (parseFloat(w.weight_kg_out) || 0), 0);
    return {
      mode: 'scalar',
      balance_kg: round2(wKg - tot),
      balance_kg_parts: null,
      remainingParts: null,
    };
  }

  const sum = parts.reduce((s, p) => s + p, 0);
  return {
    mode: 'parts',
    balance_kg: round2(sum),
    balance_kg_parts: parts.length ? formatKgPartsArray(parts) : '',
    remainingParts: parts,
  };
}
