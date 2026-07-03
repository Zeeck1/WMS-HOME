/**
 * Shared inventory loading rules for the Manual page and Stock Summary page.
 * Both pages must show the same data (BULK / CONTAINER_EXTRA / IMPORT) based on
 * the Manual page: same fetch limit, same tab filtering, same row normalization.
 */

export const MANUAL_FETCH_LIMIT = 2000;
export const INVENTORY_PAGE_SIZE = MANUAL_FETCH_LIMIT;

/** Load every inventory row for a tab (paginates past API page size). */
export async function fetchAllInventoryByTab(getInventory, params = {}) {
  const { stock_type, fish_name, location, ...rest } = params;
  const all = [];
  let offset = 0;

  for (;;) {
    const res = await getInventory({
      ...rest,
      stock_type,
      fish_name,
      location,
      limit: INVENTORY_PAGE_SIZE,
      offset,
      _t: Date.now(),
    });
    const batch = Array.isArray(res.data) ? res.data : [];
    all.push(...batch);
    if (batch.length < INVENTORY_PAGE_SIZE) break;
    offset += INVENTORY_PAGE_SIZE;
  }

  return all;
}

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
      fetchAllInventoryByTab(getInventory, { stock_type })
    )
  );
  return dedupeInventoryRows(
    MANUAL_STOCK_TABS.flatMap((tab, i) =>
      filterInventoryRowsByTab(results[i], tab).map(normalizeManualInventoryRow)
    )
  );
}
