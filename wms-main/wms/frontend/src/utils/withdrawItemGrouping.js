import { sortLocationsNearestFirst } from '../config/warehouseConfig';

/** @typedef {'nearest' | 'cs_in_date'} WithdrawItemSortMode */

export const requestedMc = (it) => Number(it.requested_mc ?? it.quantity_mc ?? 0);
/** Actual picked qty for this line — same as Withdraw form (not live stock balance) */
export const actualMc = (it) => Number(it.quantity_mc ?? 0);

/** Product identity key (matches Withdraw / Stock Summary grouping). */
export function withdrawProductKey(item) {
  const st = item.stock_type || 'BULK';
  const oc = item.order_code || '';
  const stk = item.sticker || '';
  return `${item.fish_name}||${item.size}||${Number(item.bulk_weight_kg)}||${item.type || ''}||${item.glazing || ''}||${st}||${oc}||${stk}`;
}

/** Group key — same for nearest and oldest-lot report layout. */
export function withdrawItemGroupKey(item) {
  return withdrawProductKey(item);
}

function withdrawInventoryLineKey(inv) {
  if (inv._imp_item_id != null) return `imp:${inv._imp_item_id}`;
  if (inv.lot_id != null && inv.location_id != null) return `lot:${inv.lot_id}:${inv.location_id}`;
  return null;
}

function withdrawRequestLineKey(wi) {
  if (wi.import_item_id != null) return `imp:${wi.import_item_id}`;
  if (wi.lot_id != null && wi.location_id != null) return `lot:${wi.lot_id}:${wi.location_id}`;
  return null;
}

function withdrawLineMatchesInventory(wi, inv) {
  if (wi.import_item_id != null) {
    return inv._imp_item_id === wi.import_item_id;
  }
  if (wi.lot_id != null && wi.location_id != null) {
    return inv.lot_id === wi.lot_id && inv.location_id === wi.location_id;
  }
  return false;
}

/** Allocate request MC totals onto Stock Summary rows in pick order. */
function allocateRequestOntoStock(withdrawList, inventory, stockSortMode) {
  const productTotals = {};
  const productOrder = [];
  withdrawList.forEach((wi) => {
    const pk = withdrawProductKey(wi);
    if (!productTotals[pk]) {
      productTotals[pk] = { totalReqMc: 0, totalActMc: 0, sample: wi };
      productOrder.push(pk);
    }
    productTotals[pk].totalReqMc += requestedMc(wi);
    productTotals[pk].totalActMc += actualMc(wi);
  });

  const allLines = [];
  for (const pk of productOrder) {
    const { totalReqMc, totalActMc, sample } = productTotals[pk];
    const stockLines = inventory.filter(
      (inv) => withdrawProductKey(inv) === pk && Number(inv.hand_on_balance_mc) > 0
    );
    const sorted = sortWithdrawItems(stockLines, stockSortMode);
    let remReq = totalReqMc;
    let remAct = totalActMc;
    let lineIdx = 0;
    for (const inv of sorted) {
      if (remReq <= 0 && remAct <= 0) break;
      const avail = Number(inv.hand_on_balance_mc) || 0;
      if (avail <= 0) continue;
      const takeReq = Math.min(remReq, avail);
      const takeAct = Math.min(remAct, avail);
      if (takeReq <= 0 && takeAct <= 0) continue;
      const wi = withdrawList.find((w) => withdrawProductKey(w) === pk && withdrawLineMatchesInventory(w, inv));
      allLines.push({
        ...inv,
        fish_name: inv.fish_name ?? sample.fish_name,
        size: inv.size ?? sample.size,
        bulk_weight_kg: inv.bulk_weight_kg ?? sample.bulk_weight_kg,
        type: inv.type ?? sample.type ?? '',
        glazing: inv.glazing ?? sample.glazing ?? '',
        sticker: inv.sticker ?? sample.sticker ?? '',
        stock_type: inv.stock_type ?? sample.stock_type,
        order_code: inv.order_code ?? sample.order_code ?? '',
        cs_in_date: inv.cs_in_date,
        lot_no: inv.lot_no,
        lot_no_numeric: inv.lot_no_numeric,
        line_place: inv.line_place,
        stack_no: inv.stack_no,
        id: wi?.id ?? `pick-${pk}-${lineIdx++}`,
        requested_mc: takeReq,
        quantity_mc: takeAct,
      });
      remReq -= takeReq;
      remAct -= takeAct;
    }
    if (remReq > 0 || remAct > 0) {
      for (const wi of withdrawList.filter((w) => withdrawProductKey(w) === pk)) {
        if (remReq <= 0 && remAct <= 0) break;
        if (allLines.some((l) => withdrawLineMatchesInventory(wi, l))) continue;
        const takeReq = Math.min(remReq, requestedMc(wi));
        const takeAct = Math.min(remAct, actualMc(wi));
        if (takeReq <= 0 && takeAct <= 0) continue;
        allLines.push({ ...wi, requested_mc: takeReq, quantity_mc: takeAct });
        remReq -= takeReq;
        remAct -= takeAct;
      }
    }
  }
  return sortWithdrawItems(allLines, stockSortMode);
}

/**
 * Oldest-lot: same request totals, lines from Stock Summary (FIFO).
 */
export function buildOldestLotReportFromStockSummary(withdrawItems, inventoryRows) {
  const withdrawList = withdrawItems || [];
  const inventory = inventoryRows || [];
  if (!withdrawList.length) return [];
  return allocateRequestOntoStock(withdrawList, inventory, 'cs_in_date');
}

/** Nearest-line: same request totals, lines from Stock Summary (aisle proximity). */
export function buildNearestLineReportFromStockSummary(withdrawItems, inventoryRows) {
  const withdrawList = withdrawItems || [];
  const inventory = inventoryRows || [];
  if (!withdrawList.length) return [];
  return allocateRequestOntoStock(withdrawList, inventory, 'nearest');
}

/** Stable key for edit/save while previewing FIFO lines (before DB ids exist). */
export function withdrawDisplayLineKey(item) {
  if (item.import_item_id != null) return `imp:${item.import_item_id}`;
  if (item._imp_item_id != null) return `imp:${item._imp_item_id}`;
  if (item.lot_id != null && item.location_id != null) return `lot:${item.lot_id}:${item.location_id}`;
  if (item.id != null) return `wi:${item.id}`;
  return `row:${item.fish_name}:${item.line_place}:${item.stack_no}`;
}

function inventoryBalanceForLine(inventory, line) {
  const inv = (inventory || []).find((row) => withdrawLineMatchesInventory(line, row));
  return inv != null ? Number(inv.hand_on_balance_mc) : Number(line.hand_on_balance ?? 0);
}

/** Overlay user-edited actual MC onto request lines before pick-route allocation. */
export function applyEditedQtyToWithdrawList(withdrawItems, editedQtyByKey = {}) {
  return (withdrawItems || []).map((wi) => {
    const key = withdrawDisplayLineKey(wi);
    const qty = editedQtyByKey[key] !== undefined ? Number(editedQtyByKey[key]) : actualMc(wi);
    return { ...wi, quantity_mc: qty };
  });
}

/**
 * Manage / report display lines for current pick-route tab.
 * @param {Record<string, number>} [editedQtyByKey] — keyed by withdrawDisplayLineKey
 */
export function getManageDisplayItems(withdrawItems, inventory, sortMode, editedQtyByKey = {}, options = {}) {
  const { useSavedLines = false } = options;
  const itemsForAlloc = applyEditedQtyToWithdrawList(withdrawItems, editedQtyByKey);
  let lines;
  if (useSavedLines) {
    lines = sortWithdrawItems([...itemsForAlloc], sortMode);
  } else if (sortMode === 'cs_in_date' && inventory?.length) {
    lines = buildOldestLotReportFromStockSummary(itemsForAlloc, inventory);
  } else if (inventory?.length) {
    lines = buildNearestLineReportFromStockSummary(itemsForAlloc, inventory);
  } else {
    lines = sortWithdrawItems([...itemsForAlloc], 'nearest');
  }
  return lines.map((line) => {
    const key = withdrawDisplayLineKey(line);
    const reqMc = requestedMc(line);
    const actMc = editedQtyByKey[key] !== undefined ? Number(editedQtyByKey[key]) : actualMc(line);
    return {
      ...line,
      _lineKey: key,
      hand_on_balance: inventoryBalanceForLine(inventory, line),
      requested_mc: reqMc,
      quantity_mc: actMc,
      reqMc,
      actMc,
    };
  });
}

/** Payload for PUT /withdrawals/:id/pick-route */
export function linesToPickRoutePayload(lines) {
  return (lines || []).map((line) => {
    const qty = actualMc(line);
    const req = requestedMc(line);
    const weightKg = qty * Number(line.bulk_weight_kg || 0);
    const base = {
      quantity_mc: qty,
      requested_mc: req,
      weight_kg: weightKg,
      production_process: line.production_process || null,
    };
    if (line.import_item_id != null || line._imp_item_id != null) {
      return { ...base, import_item_id: line.import_item_id ?? line._imp_item_id };
    }
    return { ...base, lot_id: line.lot_id, location_id: line.location_id };
  });
}

/** Normalize cs_in_date to YYYY-MM-DD for sort (oldest = smallest). */
export function csInDateSortKey(item) {
  const raw = item?.cs_in_date;
  if (raw == null || raw === '') return '9999-12-31';
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) {
    return raw.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const dd = dmy[1].padStart(2, '0');
    const mm = dmy[2].padStart(2, '0');
    return `${dmy[3]}-${mm}-${dd}`;
  }
  const my = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (my) return `${my[2]}-${my[1].padStart(2, '0')}-01`;
  return s;
}

function lotSortKey(item) {
  const num = item?.lot_no_numeric;
  if (num != null && num !== '' && !Number.isNaN(Number(num))) return Number(num);
  const lot = item?.lot_no || item?.order_code || '';
  const n = Number(lot);
  if (!Number.isNaN(n) && String(lot).trim() !== '') return n;
  return String(lot);
}

function compareStackNo(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

/**
 * Sort withdrawal request lines.
 * - nearest: aisle proximity
 * - cs_in_date: oldest Stock Summary CS IN date first, then lot, then location
 */
export function sortWithdrawItems(items, sortMode = 'nearest') {
  const list = [...(items || [])];
  if (sortMode === 'cs_in_date') {
    return list.sort((a, b) => {
      const dateCmp = csInDateSortKey(a).localeCompare(csInDateSortKey(b));
      if (dateCmp !== 0) return dateCmp;
      const lotA = lotSortKey(a);
      const lotB = lotSortKey(b);
      if (lotA !== lotB) {
        if (typeof lotA === 'number' && typeof lotB === 'number') return lotA - lotB;
        return String(lotA).localeCompare(String(lotB));
      }
      const locCmp = String(a.line_place || '').localeCompare(String(b.line_place || ''));
      if (locCmp !== 0) return locCmp;
      return compareStackNo(a.stack_no, b.stack_no);
    });
  }
  return sortLocationsNearestFirst(list, 'line_place');
}

/** Group by product; same layout for nearest and oldest-lot modes. */
export function groupWithdrawItems(items, sortMode = 'nearest') {
  const sorted = sortWithdrawItems(items, sortMode);
  const groups = {};
  const groupOrder = [];
  sorted.forEach((item) => {
    const key = withdrawItemGroupKey(item);
    const st = item.stock_type || 'BULK';
    const oc = item.order_code || '';
    const stk = item.sticker || '';
    if (!groups[key]) {
      groups[key] = {
        key,
        fish_name: item.fish_name,
        size: item.size,
        bulk_weight_kg: item.bulk_weight_kg,
        type: item.type || '',
        glazing: item.glazing || '',
        sticker: stk,
        stock_type: st,
        order_code: oc,
        lines: [],
        totalReqMc: 0,
        totalActMc: 0,
      };
      groupOrder.push(key);
    }
    const reqMc = requestedMc(item);
    const actMc = actualMc(item);
    groups[key].lines.push({ ...item, reqMc, actMc });
    groups[key].totalReqMc += reqMc;
    groups[key].totalActMc += actMc;
  });
  return groupOrder.map((k) => groups[k]);
}

/** Oldest CS IN date among lines in a product group (for group header). */
export function oldestCsInDateInGroup(lines) {
  if (!lines?.length) return null;
  let oldest = lines[0];
  for (const line of lines) {
    if (csInDateSortKey(line).localeCompare(csInDateSortKey(oldest)) < 0) {
      oldest = line;
    }
  }
  return oldest.cs_in_date;
}

/** Format cs_in_date for report display (DD/MM/YYYY). */
export function formatWithdrawCsInDate(value) {
  if (value == null || value === '') return '—';
  const s = String(value).split('T')[0];
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

export function withdrawFishNameLabel(group) {
  const st = group.stock_type;
  if ((st === 'CONTAINER_EXTRA' || st === 'IMPORT') && group.order_code) {
    return `${group.fish_name} (${group.order_code})`;
  }
  return group.fish_name;
}
