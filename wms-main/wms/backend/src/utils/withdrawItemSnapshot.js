/**
 * Snapshot + query helpers for withdrawal line display data.
 * snap_* is filled when a request/line is created (and refreshed on pick-route changes).
 * frozen_at is set on FINISHED so Manual/stock cleanup can never rewrite history.
 */

/** Prefer snap_* when set; after freeze never fall back to live joins. */
function snapOrLive(snapCol, ...liveExprs) {
  const live = liveExprs.filter(Boolean).join(', ');
  return `CASE
    WHEN wi.frozen_at IS NOT NULL THEN wi.${snapCol}
    ELSE COALESCE(wi.${snapCol}${live ? `, ${live}` : ''})
  END`;
}

const WITHDRAW_ITEM_DETAIL_SELECT = `
  wi.*,
  ${snapOrLive('snap_fish_name', 'p.fish_name', 'ii.item_name')} AS fish_name,
  ${snapOrLive('snap_size', 'p.size', 'ii.size')} AS size,
  ${snapOrLive('snap_bulk_weight_kg', 'p.bulk_weight_kg', 'ii.wet_mc')} AS bulk_weight_kg,
  ${snapOrLive('snap_type', 'p.type')} AS type,
  ${snapOrLive('snap_glazing', 'p.glazing')} AS glazing,
  ${snapOrLive('snap_stock_type', "p.stock_type", "IF(wi.import_item_id IS NULL, 'BULK', 'IMPORT')")} AS stock_type,
  ${snapOrLive('snap_order_code', 'p.order_code', 's.inv_no')} AS order_code,
  ${snapOrLive('snap_lot_no', 'l.lot_no')} AS lot_no,
  ${snapOrLive('snap_lot_no_numeric', 'l.lot_no_numeric')} AS lot_no_numeric,
  ${snapOrLive('snap_cs_in_date', 'l.cs_in_date', 's.eta')} AS cs_in_date,
  ${snapOrLive('snap_sticker', 'l.sticker')} AS sticker,
  ${snapOrLive('snap_line_place', 'loc.line_place', "NULLIF(TRIM(ii.lines), '')")} AS line_place,
  ${snapOrLive('snap_stack_no', 'loc.stack_no')} AS stack_no,
  ${snapOrLive('snap_st_no', 'l.st_no')} AS st_no,
  CASE WHEN wi.frozen_at IS NOT NULL THEN NULL ELSE loc.stack_total END AS stack_total,
  ${snapOrLive('snap_import_inv_no', 's.inv_no')} AS import_inv_no`;

const WITHDRAW_ITEM_DETAIL_JOINS = `
  FROM withdraw_items wi
  LEFT JOIN lots l ON wi.lot_id = l.id
  LEFT JOIN products p ON l.product_id = p.id
  LEFT JOIN locations loc ON wi.location_id = loc.id
  LEFT JOIN import_items ii ON wi.import_item_id = ii.id
  LEFT JOIN import_shipments s ON ii.shipment_id = s.id`;

const HAND_ON_BALANCE_SELECT = `
  CASE
    WHEN wi.lot_id IS NOT NULL AND wi.location_id IS NOT NULL THEN (
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
    ELSE 0
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

/**
 * Capture product/lot/location display fields onto snap_* columns.
 * Never rewrites lines that already have frozen_at.
 * @param {{ overwrite?: boolean, freeze?: boolean }} [options]
 *   - overwrite: refresh snaps from live joins (pick-route / line rebuild)
 *   - freeze: set frozen_at (FINISHED) — after this, display never uses live joins
 */
async function snapshotWithdrawItems(conn, requestId, options = {}) {
  const overwrite = Boolean(options.overwrite);
  const freeze = Boolean(options.freeze);

  const setExpr = (snapCol, ...liveExprs) => {
    const live = liveExprs.filter(Boolean).join(', ');
    if (overwrite) {
      return `wi.${snapCol} = COALESCE(${live}, wi.${snapCol})`;
    }
    return `wi.${snapCol} = COALESCE(wi.${snapCol}${live ? `, ${live}` : ''})`;
  };

  await conn.query(
    `UPDATE withdraw_items wi
     LEFT JOIN lots l ON wi.lot_id = l.id
     LEFT JOIN products p ON l.product_id = p.id
     LEFT JOIN locations loc ON wi.location_id = loc.id
     LEFT JOIN import_items ii ON wi.import_item_id = ii.id
     LEFT JOIN import_shipments s ON ii.shipment_id = s.id
     SET
       ${setExpr('snap_fish_name', 'p.fish_name', 'ii.item_name')},
       ${setExpr('snap_size', 'p.size', 'ii.size')},
       ${setExpr('snap_bulk_weight_kg', 'p.bulk_weight_kg', 'ii.wet_mc')},
       ${setExpr('snap_type', 'p.type')},
       ${setExpr('snap_glazing', 'p.glazing')},
       ${setExpr('snap_stock_type', 'p.stock_type', "IF(wi.import_item_id IS NULL, 'BULK', 'IMPORT')")},
       ${setExpr('snap_order_code', 'p.order_code', 's.inv_no')},
       ${setExpr('snap_lot_no', 'l.lot_no')},
       ${setExpr('snap_lot_no_numeric', 'l.lot_no_numeric')},
       ${setExpr('snap_cs_in_date', 'l.cs_in_date', 's.eta')},
       ${setExpr('snap_sticker', 'l.sticker')},
       ${setExpr('snap_line_place', 'loc.line_place', "NULLIF(TRIM(ii.lines), '')")},
       ${setExpr('snap_stack_no', 'loc.stack_no')},
       ${setExpr('snap_st_no', 'l.st_no')},
       ${setExpr('snap_import_inv_no', 's.inv_no')}
     WHERE wi.request_id = ? AND wi.frozen_at IS NULL`,
    [requestId]
  );

  if (freeze) {
    await conn.query(
      `UPDATE withdraw_items
       SET frozen_at = COALESCE(frozen_at, NOW())
       WHERE request_id = ?`,
      [requestId]
    );
  }
}

/** Freeze finished request lines (idempotent). */
async function freezeWithdrawItemsSnapshot(conn, requestId) {
  await snapshotWithdrawItems(conn, requestId, { freeze: true });
}

module.exports = {
  WITHDRAW_ITEM_DETAIL_SELECT,
  WITHDRAW_ITEM_DETAIL_JOINS,
  HAND_ON_BALANCE_SELECT,
  queryWithdrawItemsDetailed,
  snapshotWithdrawItems,
  freezeWithdrawItemsSnapshot,
};
