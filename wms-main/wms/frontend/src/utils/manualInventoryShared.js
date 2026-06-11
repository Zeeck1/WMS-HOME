/**
 * Shared inventory loading rules for the Manual page and Stock Summary page.
 * Both pages must show the same data (BULK / CONTAINER_EXTRA / IMPORT) based on
 * the Manual page: same fetch limit, same tab filtering, same row normalization.
 */

export const MANUAL_FETCH_LIMIT = 2000;

/** Ensures each tab only shows rows for that stock type (API must match; this guards stale UI or bad responses). */
export function filterInventoryRowsByTab(rows, tab) {
  const t = String(tab || '').toUpperCase();
  return (rows || []).filter((r) => String(r.stock_type || '').toUpperCase() === t);
}

/** Ensure stack columns from API display as the saved integers (not stale / wrong types). */
export function normalizeManualInventoryRow(r) {
  const stack = r.stack_no;
  const stackTotal = r.stack_total;
  const stNo = r.st_no;
  return {
    ...r,
    st_no: stNo != null && stNo !== '' ? String(stNo).trim() : '',
    stack_no: stack != null && stack !== '' ? Number(stack) : '',
    stack_total: stackTotal != null && stackTotal !== '' ? Number(stackTotal) : '',
  };
}

/** Manual page row identity: one row per lot+location, or one per import item. */
export function inventoryRowKey(r) {
  if (r._imp_item_id != null) return `imp-${r._imp_item_id}`;
  if (r.lot_id != null && r.location_id != null) return `${r.lot_id}-${r.location_id}`;
  return null;
}

/** Drop true duplicate rows (same lot+location), never by stack_no alone. */
export function dedupeInventoryRows(rows) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const key = inventoryRowKey(r);
    if (key != null) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(r);
  }
  return out;
}

const MANUAL_STOCK_TABS = ['BULK', 'CONTAINER_EXTRA', 'IMPORT'];

/** Load all Manual-page inventory rows (BULK + CE + IMPORT) for reports / pick routes. */
export async function fetchManualInventoryAllTabs(getInventory) {
  const results = await Promise.all(
    MANUAL_STOCK_TABS.map((stock_type) =>
      getInventory({ stock_type, limit: MANUAL_FETCH_LIMIT, _t: Date.now() })
    )
  );
  return dedupeInventoryRows(
    MANUAL_STOCK_TABS.flatMap((tab, i) =>
      filterInventoryRowsByTab(results[i].data, tab).map(normalizeManualInventoryRow)
    )
  );
}
