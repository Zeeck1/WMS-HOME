/**
 * Snapshot + query helpers for permanent FINISHED withdrawal line data.
 * When a request is finished, product/lot/location display fields are frozen on each line
 * so records survive stock cleanup or master-data deletion.
 */

const WITHDRAW_ITEM_DETAIL_SELECT = `
  wi.*,
  COALESCE(wi.snap_fish_name, p.fish_name, ii.item_name) AS fish_name,
  COALESCE(wi.snap_size, p.size, ii.size) AS size,
  COALESCE(wi.snap_bulk_weight_kg, p.bulk_weight_kg, ii.wet_mc) AS bulk_weight_kg,
  COALESCE(wi.snap_type, p.type) AS type,
  COALESCE(wi.snap_glazing, p.glazing) AS glazing,
  COALESCE(wi.snap_stock_type, p.stock_type, IF(wi.import_item_id IS NULL, 'BULK', 'IMPORT')) AS stock_type,
  COALESCE(wi.snap_order_code, p.order_code, s.inv_no) AS order_code,
  COALESCE(wi.snap_lot_no, l.lot_no) AS lot_no,
  COALESCE(wi.snap_lot_no_numeric, l.lot_no_numeric) AS lot_no_numeric,
  COALESCE(wi.snap_cs_in_date, l.cs_in_date, s.eta) AS cs_in_date,
  COALESCE(wi.snap_sticker, l.sticker) AS sticker,
  COALESCE(wi.snap_line_place, loc.line_place, NULLIF(TRIM(ii.lines), '')) AS line_place,
  COALESCE(wi.snap_stack_no, loc.stack_no) AS stack_no,
  COALESCE(wi.snap_st_no, l.st_no) AS st_no,
  loc.stack_total,
  COALESCE(wi.snap_import_inv_no, s.inv_no) AS import_inv_no`;

const WITHDRAW_ITEM_DETAIL_JOINS = `
  FROM withdraw_items wi
  LEFT JOIN lots l ON wi.lot_id = l.id
  LEFT JOIN products p ON l.product_id = p.id
  LEFT JOIN locations loc ON wi.location_id = loc.id
  LEFT JOIN import_items ii ON wi.import_item_id = ii.id
  LEFT JOIN import_shipments s ON ii.shipment_id = s.id`;

const HAND_ON_BALANCE_SELECT = `
  CASE
    WHEN wi.lot_id IS NOT NULL THEN (
      SELECT
        COALESCE(SUM(CASE WHEN m2.movement_type = 'IN' THEN m2.quantity_mc ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN m2.movement_type = 'OUT' THEN m2.quantity_mc ELSE 0 END), 0)
      FROM movements m2
      WHERE m2.lot_id = wi.lot_id AND m2.location_id = wi.location_id
    )
    WHEN wi.import_item_id IS NOT NULL THEN (
      SELECT IFNULL(ifi.factory_mc, 0) - IFNULL((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ifi.id), 0)
      FROM import_items ifi
      WHERE ifi.id = wi.import_item_id
    )
    ELSE NULL
  END AS hand_on_balance`;

async function queryWithdrawItemsDetailed(conn, requestId, { includeHandOn = false } = {}) {
  const extra = includeHandOn ? `, ${HAND_ON_BALANCE_SELECT}` : '';
  const [items] = await conn.query(
    `SELECT ${WITHDRAW_ITEM_DETAIL_SELECT}${extra}
     ${WITHDRAW_ITEM_DETAIL_JOINS}
     WHERE wi.request_id = ?
     ORDER BY wi.id`,
    [requestId]
  );
  return items;
}

async function freezeWithdrawItemsSnapshot(conn, requestId) {
  await conn.query(
    `UPDATE withdraw_items wi
     LEFT JOIN lots l ON wi.lot_id = l.id
     LEFT JOIN products p ON l.product_id = p.id
     LEFT JOIN locations loc ON wi.location_id = loc.id
     LEFT JOIN import_items ii ON wi.import_item_id = ii.id
     LEFT JOIN import_shipments s ON ii.shipment_id = s.id
     SET
       wi.snap_fish_name = COALESCE(wi.snap_fish_name, p.fish_name, ii.item_name),
       wi.snap_size = COALESCE(wi.snap_size, p.size, ii.size),
       wi.snap_bulk_weight_kg = COALESCE(wi.snap_bulk_weight_kg, p.bulk_weight_kg, ii.wet_mc),
       wi.snap_type = COALESCE(wi.snap_type, p.type),
       wi.snap_glazing = COALESCE(wi.snap_glazing, p.glazing),
       wi.snap_stock_type = COALESCE(wi.snap_stock_type, p.stock_type, IF(wi.import_item_id IS NULL, 'BULK', 'IMPORT')),
       wi.snap_order_code = COALESCE(wi.snap_order_code, p.order_code, s.inv_no),
       wi.snap_lot_no = COALESCE(wi.snap_lot_no, l.lot_no),
       wi.snap_lot_no_numeric = COALESCE(wi.snap_lot_no_numeric, l.lot_no_numeric),
       wi.snap_cs_in_date = COALESCE(wi.snap_cs_in_date, l.cs_in_date, s.eta),
       wi.snap_sticker = COALESCE(wi.snap_sticker, l.sticker),
       wi.snap_line_place = COALESCE(wi.snap_line_place, loc.line_place, NULLIF(TRIM(ii.lines), '')),
       wi.snap_stack_no = COALESCE(wi.snap_stack_no, loc.stack_no),
       wi.snap_st_no = COALESCE(wi.snap_st_no, l.st_no),
       wi.snap_import_inv_no = COALESCE(wi.snap_import_inv_no, s.inv_no),
       wi.frozen_at = COALESCE(wi.frozen_at, NOW())
     WHERE wi.request_id = ?`,
    [requestId]
  );
}

/** Delete withdraw lines for a lot only when the parent request is not FINISHED. */
async function deleteWithdrawItemsForLotExcludingFinished(conn, lotId) {
  await conn.query(
    `DELETE wi FROM withdraw_items wi
     INNER JOIN withdraw_requests wr ON wr.id = wi.request_id
     WHERE wi.lot_id = ? AND wr.status != 'FINISHED'`,
    [lotId]
  );
}

async function countWithdrawItemsForLot(conn, lotId) {
  const [rows] = await conn.query(
    'SELECT COUNT(*) AS c FROM withdraw_items WHERE lot_id = ?',
    [lotId]
  );
  return Number(rows[0]?.c) || 0;
}

module.exports = {
  WITHDRAW_ITEM_DETAIL_SELECT,
  WITHDRAW_ITEM_DETAIL_JOINS,
  HAND_ON_BALANCE_SELECT,
  queryWithdrawItemsDetailed,
  freezeWithdrawItemsSnapshot,
  deleteWithdrawItemsForLotExcludingFinished,
  countWithdrawItemsForLot,
};
