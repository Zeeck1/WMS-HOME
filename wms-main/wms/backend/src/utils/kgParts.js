/**
 * Comma / semicolon-separated kg values (e.g. "15.2, 16.2, 14.3") — sum, multiset balance, OUT validation.
 */

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function sumKgPartsString(raw) {
  if (raw == null) return 0;
  const s = String(raw).trim();
  if (!s) return 0;
  const parts = s.split(/[,，;]+/).map((x) => x.trim()).filter(Boolean);
  let sum = 0;
  for (const p of parts) {
    const n = parseFloat(p.replace(/,/g, ''));
    if (Number.isFinite(n)) sum += n;
  }
  return round2(sum);
}

function normalizeKgParts(raw) {
  if (raw == null) return '';
  return String(raw).trim();
}

/** @returns {number[]} */
function parseKgPartsArray(raw) {
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

function formatKgPartsArray(parts) {
  if (!parts || parts.length === 0) return '';
  return parts.map((n) => String(round2(n))).join(', ');
}

function partsEqual(a, b) {
  return Math.abs(round2(a) - round2(b)) < 0.001;
}

/**
 * Remove each withdraw value from balance (first match). Used when IN line has kg_parts.
 * @returns {{ ok: boolean, remaining: number[] }}
 */
function subtractKgPartsMultiset(balanceParts, withdrawParts) {
  const bal = [...balanceParts].map((x) => round2(x));
  for (const w of withdrawParts) {
    const idx = bal.findIndex((b) => partsEqual(b, w));
    if (idx === -1) return { ok: false, remaining: bal };
    bal.splice(idx, 1);
  }
  return { ok: true, remaining: bal };
}

/**
 * @param {{ kg_parts?: string|null, weight_kg?: number|string }} depositItem
 * @param {{ kg_parts_out?: string|null, weight_kg_out?: number|string }[]} withdrawalsOrdered
 * @returns {{ mode: 'parts'|'scalar', balance_kg: number, balance_kg_parts: string|null, remainingParts: number[]|null }}
 */
function getRemainingKgState(depositItem, withdrawalsOrdered) {
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

  let parts = parseKgPartsArray(depositItem.kg_parts);
  let allParts = true;
  for (const w of withdrawalsOrdered) {
    const outStr = w.kg_parts_out && String(w.kg_parts_out).trim();
    if (outStr) {
      const sub = parseKgPartsArray(w.kg_parts_out);
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

/**
 * When OUT rows only stored total KG (no kg_parts_out), find exactly one subset of `parts` summing to target.
 */
function inferUniqueSubsetRemoval(parts, targetWeight) {
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
  const remaining = p.filter((_, i) => !idxSet.has(i));
  return { remaining };
}

/**
 * Like getRemainingKgState, but when scalar mode would hide part breakdown, replay withdrawals using
 * subset inference for weight-only lines so balance_kg_parts can still be shown (list/search UI).
 */
function getRemainingKgStateWithInference(depositItem, withdrawalsOrdered) {
  const base = getRemainingKgState(depositItem, withdrawalsOrdered);
  if (base.mode === 'parts') return base;

  const kgParts = depositItem.kg_parts && String(depositItem.kg_parts).trim();
  if (!kgParts) return base;

  let parts = parseKgPartsArray(depositItem.kg_parts);
  for (const w of withdrawalsOrdered) {
    const outStr = w.kg_parts_out && String(w.kg_parts_out).trim();
    if (outStr) {
      const sub = parseKgPartsArray(w.kg_parts_out);
      const r = subtractKgPartsMultiset(parts, sub);
      if (!r.ok) return base;
      parts = r.remaining;
    } else {
      const wt = parseFloat(w.weight_kg_out) || 0;
      if (wt <= 0) continue;
      const infer = inferUniqueSubsetRemoval(parts, wt);
      if (!infer) return base;
      parts = infer.remaining;
    }
  }

  const sum = parts.reduce((s, p) => s + p, 0);
  return {
    mode: 'parts',
    balance_kg: round2(sum),
    balance_kg_parts: parts.length ? formatKgPartsArray(parts) : '',
    remainingParts: parts,
  };
}

module.exports = {
  sumKgPartsString,
  normalizeKgParts,
  parseKgPartsArray,
  formatKgPartsArray,
  subtractKgPartsMultiset,
  getRemainingKgState,
  getRemainingKgStateWithInference,
  round2,
};
