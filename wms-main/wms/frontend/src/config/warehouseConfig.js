/**
 * Warehouse Layout Configuration
 *
 * Location code format: {Line}{Position:2}{Side} e.g. A01L, K04R
 *
 * layoutMode:
 * - single-aisle: one cold room — left rack | line labels | right rack (CS-1, CS-2)
 * - double-aisle: two blocks with central aisle (CS-3)
 */

export const WAREHOUSES = {
  // Layout-only in UI until stock is keyed to this room (see LocationLayout warehouseUsesInventory).
  'CS-1': {
    id: 'CS-1',
    name: 'Cold Storage 1',
    layoutMode: 'single-aisle',
    lines: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'],
    leftRack: { side: 'L', positions: 6, label: 'Left (Long)', levels: 4 },
    rightRack: { side: 'R', positions: 4, label: 'Right (Short)', levels: 4 },
    levels: 4,
  },
  // Layout-only in UI until stock is keyed to this room (see LocationLayout warehouseUsesInventory).
  'CS-2': {
    id: 'CS-2',
    name: 'Cold Storage 2',
    layoutMode: 'single-aisle',
    lines: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'],
    leftRack: { side: 'L', positions: 4, label: 'Left (Short)', levels: 4 },
    rightRack: { side: 'R', positions: 7, label: 'Right (Long)', levels: 4 },
    levels: 4,
  },
  'CS-3': {
    id: 'CS-3',
    name: 'Cold Storage 3',
    layoutMode: 'double-aisle',
    leftLines: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
    rightLines: ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'BB', 'CC', 'DD'],
    leftBlock: {
      long: { side: 'L', positions: 8, label: 'Left (Long)', levels: 4 },
      short: { side: 'R', positions: 4, label: 'Right (Short)', levels: 4 },
    },
    rightBlock: {
      long: { side: 'R', positions: 8, label: 'Right (Long)', levels: 4 },
      short: { side: 'L', positions: 4, label: 'Left (Short)', levels: 4 },
    },
    levels: 4,
  },
};

/** All line IDs for a warehouse (for inventory / parsing helpers) */
export function getAllLines(warehouseId) {
  const wh = WAREHOUSES[warehouseId];
  if (!wh) return [];
  if (wh.layoutMode === 'single-aisle') return [...wh.lines];
  return [...wh.leftLines, ...wh.rightLines];
}

/** Positions per line (sum of both sides) */
export function getPositionsPerLine(warehouseId) {
  const wh = WAREHOUSES[warehouseId];
  if (!wh) return 0;
  if (wh.layoutMode === 'single-aisle') {
    return wh.leftRack.positions + wh.rightRack.positions;
  }
  return wh.leftBlock.long.positions + wh.leftBlock.short.positions;
}

/** Total floor positions (line count × positions per line) for double-aisle: both blocks */
export function getTotalFloorPositions(warehouseId) {
  const wh = WAREHOUSES[warehouseId];
  if (!wh) return 0;
  if (wh.layoutMode === 'single-aisle') {
    return wh.lines.length * (wh.leftRack.positions + wh.rightRack.positions);
  }
  const perLeft = wh.leftBlock.long.positions + wh.leftBlock.short.positions;
  const perRight = wh.rightBlock.long.positions + wh.rightBlock.short.positions;
  return wh.leftLines.length * perLeft + wh.rightLines.length * perRight;
}

export function getAllLocationCodes(warehouseId) {
  const wh = WAREHOUSES[warehouseId];
  if (!wh) return [];
  const codes = [];

  if (wh.layoutMode === 'single-aisle') {
    for (const line of wh.lines) {
      for (let p = 1; p <= wh.leftRack.positions; p++) {
        codes.push(`${line}${String(p).padStart(2, '0')}${wh.leftRack.side}`);
      }
      for (let p = 1; p <= wh.rightRack.positions; p++) {
        codes.push(`${line}${String(p).padStart(2, '0')}${wh.rightRack.side}`);
      }
    }
    return codes;
  }

  for (const line of wh.leftLines) {
    for (let p = 1; p <= wh.leftBlock.long.positions; p++) {
      codes.push(`${line}${String(p).padStart(2, '0')}${wh.leftBlock.long.side}`);
    }
    for (let p = 1; p <= wh.leftBlock.short.positions; p++) {
      codes.push(`${line}${String(p).padStart(2, '0')}${wh.leftBlock.short.side}`);
    }
  }
  for (const line of wh.rightLines) {
    for (let p = 1; p <= wh.rightBlock.short.positions; p++) {
      codes.push(`${line}${String(p).padStart(2, '0')}${wh.rightBlock.short.side}`);
    }
    for (let p = 1; p <= wh.rightBlock.long.positions; p++) {
      codes.push(`${line}${String(p).padStart(2, '0')}${wh.rightBlock.long.side}`);
    }
  }
  return codes;
}

export function parseLocationCode(code) {
  if (!code) return null;
  const upper = code.toUpperCase().trim();
  const match = upper.match(/^([A-Z]{1,2})(\d{1,2})([LR])?(?:-(\d+))?$/);
  if (!match) return null;
  return {
    line: match[1],
    position: parseInt(match[2], 10),
    side: match[3] || 'L',
    level: match[4] ? parseInt(match[4], 10) : null,
    raw: upper,
  };
}

/**
 * Nearest location (CS-3 and single-aisle): higher position = closer to aisle where applicable;
 * short sides reversed in UI so position order matches physical layout.
 */
export function getLocationSortParts(code) {
  const parsed = parseLocationCode(code);
  if (!parsed) return { position: 0, level: 0, line: 'ZZZZ' };
  return {
    position: parsed.position,
    level: parsed.level || 0,
    line: parsed.line,
  };
}

export function sortLocationsNearestFirst(items, linePlaceKey = 'line_place') {
  const getKey = (it) => (typeof it === 'string' ? it : it && it[linePlaceKey]);
  return [...items].sort((a, b) => {
    const lpA = getKey(a);
    const lpB = getKey(b);
    const pA = getLocationSortParts(lpA);
    const pB = getLocationSortParts(lpB);
    if (pA.position !== pB.position) return pB.position - pA.position;
    if (pA.level !== pB.level) return pB.level - pA.level;
    if (pA.line !== pB.line) return pA.line.localeCompare(pB.line);
    return String(lpA || '').localeCompare(String(lpB || ''));
  });
}

export default WAREHOUSES;
