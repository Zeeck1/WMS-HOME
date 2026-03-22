/**
 * Warehouse Layout Configuration
 * 
 * Each warehouse defines its lines (rows), sections (rack types), and dimensions.
 * Location code format: {Line}{Position:2}{Side} e.g. A01R, A01L
 * 
 * Designed to support multiple warehouses (CS-1, CS-2, CS-3, etc.)
 */

export const WAREHOUSES = {
  'CS-3': {
    id: 'CS-3',
    name: 'Cold Storage 3',
    // Lines on the left side of the central aisle (bottom to top in physical layout)
    leftLines: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O'],
    // Lines on the right side of the central aisle (top to bottom in physical layout)
    rightLines: ['P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'BB', 'CC', 'DD'],
    // Rack sections for each line, ordered left-to-right across the warehouse
    sections: [
      { id: 'LL', label: 'Left (Long)',  side: 'L', positions: 8, levels: 4, desc: '8x4/15' },
      { id: 'RS', label: 'Right (Short)', side: 'R', positions: 4, levels: 4, desc: '4x4/15' },
      // --- Central Aisle ---
      { id: 'LS', label: 'Left (Short)',  side: 'L', positions: 4, levels: 4, desc: '4x4/15' },
      { id: 'RL', label: 'Right (Long)',  side: 'R', positions: 8, levels: 4, desc: '8x4/15' },
    ],
    totalLevels: 4
  }
};

// Helper: Get all lines for a warehouse
export function getAllLines(warehouseId) {
  const wh = WAREHOUSES[warehouseId];
  if (!wh) return [];
  return [...wh.leftLines, ...wh.rightLines];
}

// Helper: Get all location codes for a warehouse
export function getAllLocationCodes(warehouseId) {
  const wh = WAREHOUSES[warehouseId];
  if (!wh) return [];
  const codes = [];
  const allLines = [...wh.leftLines, ...wh.rightLines];
  for (const line of allLines) {
    for (const section of wh.sections) {
      for (let pos = 1; pos <= section.positions; pos++) {
        const posStr = String(pos).padStart(2, '0');
        const code = `${line}${posStr}${section.side}`;
        codes.push(code);
      }
    }
  }
  return codes;
}

// Helper: Parse a location code like "A01R-1" or "CC01-1" into parts
export function parseLocationCode(code) {
  if (!code) return null;
  const upper = code.toUpperCase().trim();
  // Match patterns: A01R-1, AA03L-2, A01R, DD08L  — and also CC01-1 (no L/R side)
  const match = upper.match(/^([A-Z]{1,2})(\d{1,2})([LR])?(?:-(\d+))?$/);
  if (!match) return null;
  return {
    line: match[1],
    position: parseInt(match[2]),
    side: match[3] || 'L',
    level: match[4] ? parseInt(match[4]) : null,
    raw: upper
  };
}

/**
 * Nearest location logic (warehouse CS-3):
 *
 * Lines A–O:
 *   L side (Long rack, 8 pos): 08 nearest → 01 far
 *   R side (Short rack, 4 pos): 04 nearest → 01 far
 *
 * Lines P–DD:
 *   R side (Long rack, 8 pos): 08 nearest → 01 far
 *   L side (Short rack, 4 pos): 04 nearest → 01 far
 *
 * Higher position number = closer to the aisle.
 * Level 4 = nearest, then 3, 2, 1.
 * If both sides tie on position+level, either may come first.
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

/** Sort locations nearest-first: position desc → level desc → line alpha → raw alpha */
export function sortLocationsNearestFirst(items, linePlaceKey = 'line_place') {
  const getKey = (it) => typeof it === 'string' ? it : (it && it[linePlaceKey]);
  return [...items].sort((a, b) => {
    const lpA = getKey(a);
    const lpB = getKey(b);
    const pA = getLocationSortParts(lpA);
    const pB = getLocationSortParts(lpB);
    if (pA.position !== pB.position) return pB.position - pA.position; // higher position = nearer
    if (pA.level !== pB.level) return pB.level - pA.level;             // level 4 before 3 before 2 before 1
    if (pA.line !== pB.line) return pA.line.localeCompare(pB.line);
    return String(lpA || '').localeCompare(String(lpB || ''));
  });
}

export default WAREHOUSES;
