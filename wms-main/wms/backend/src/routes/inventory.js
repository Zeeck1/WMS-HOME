const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, superadminOnly } = require('../middleware/auth');

async function fetchImportShipmentRows(filters = {}) {
  const { fish_name, location } = filters;
  let sql = `
    SELECT
      ii.id AS _imp_item_id,
      s.id AS _imp_shipment_id,
      ii.item_name AS fish_name,
      ii.size,
      ii.wet_mc AS bulk_weight_kg,
      s.inv_no AS order_code,
      s.inv_no AS lot_no,
      NULL AS lot_no_numeric,
      s.eta AS cs_in_date,
      s.production_date,
      s.expiry_date AS expiration_date,
      CASE
        WHEN NULLIF(TRIM(ii.lines), '') IS NULL THEN NULL
        WHEN NULLIF(TRIM(ii.lines), '') = NULLIF(TRIM(IFNULL(s.origin_country, '')), '') THEN NULL
        ELSE NULLIF(TRIM(ii.lines), '')
      END AS line_place,
      ii.lines AS stack_no,
      ii.remark,
      NULLIF(TRIM(s.origin_country), '') AS country,
      'IMPORT' AS stock_type,
      NULL AS lot_id,
      NULL AS location_id,
      ii.factory_mc - COALESCE((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS hand_on_balance_mc,
      ii.factory_nw_kgs - COALESCE((SELECT SUM(o.nw_kgs) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS hand_on_balance_kg,
      0 AS old_balance_mc,
      0 AS new_income_mc,
      0 AS stack_total,
      '' AS type,
      '' AS glazing,
      '' AS sticker,
      '' AS st_no,
      '_shipment' AS _source
    FROM import_items ii
    JOIN import_shipments s ON ii.shipment_id = s.id
    WHERE ii.item_name IS NOT NULL AND ii.item_name != ''
  `;
  const params = [];
  if (fish_name) { sql += ' AND ii.item_name LIKE ?'; params.push(`%${fish_name}%`); }
  if (location) { sql += ' AND (s.origin_country LIKE ? OR ii.lines LIKE ?)'; params.push(`%${location}%`, `%${location}%`); }
  sql += ' ORDER BY s.inv_no ASC, ii.seq_no ASC';
  const [rows] = await pool.query(sql, params);
  return rows;
}

// GET inventory (stock table - mirrors Excel view, optional ?stock_type= filter)
router.get('/', async (req, res) => {
  try {
    const { fish_name, location, lot_no, stock_type, limit, offset } = req.query;
    let sql = 'SELECT * FROM inventory_view WHERE 1=1';
    const params = [];

    if (stock_type) { sql += ' AND stock_type = ?'; params.push(stock_type); }
    if (fish_name) { sql += ' AND fish_name LIKE ?'; params.push(`%${fish_name}%`); }
    if (location) { sql += ' AND line_place LIKE ?'; params.push(`%${location}%`); }
    if (lot_no) { sql += ' AND lot_no LIKE ?'; params.push(`%${lot_no}%`); }

    sql += ' ORDER BY line_place, stack_no, fish_name';

    const limitNum = parseInt(limit, 10);
    const offsetNum = parseInt(offset, 10);
    if (limitNum > 0) sql += ' LIMIT ?'; if (limitNum > 0) params.push(limitNum);
    if (offsetNum > 0) sql += ' OFFSET ?'; if (offsetNum > 0) params.push(offsetNum);

    const [rows] = await pool.query(sql, params);

    // Import-shipment rows (Excel import_items): only merge when explicitly requesting IMPORT,
    // or when ?merge_import_shipments=1 (e.g. layout / charts that need all sources).
    // Do NOT merge when stock_type is BULK or CONTAINER_EXTRA — avoids wrong data on those tabs.
    const stUpper = String(stock_type || '').toUpperCase();
    const mergeImportShipments =
      stUpper === 'IMPORT' ||
      ['1', 'true', 'yes'].includes(String(req.query.merge_import_shipments || '').toLowerCase());

    if (mergeImportShipments) {
      try {
        const impRows = await fetchImportShipmentRows({ fish_name, location });
        rows.push(...impRows);
      } catch (e) {
        console.error('Failed to fetch import shipment items for inventory:', e);
      }
    }

    res.json(rows);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// GET dashboard summary
router.get('/dashboard', async (req, res) => {
  try {
    const [summary] = await pool.query('SELECT * FROM dashboard_summary');
    
    // Get recent movements
    const [recentMovements] = await pool.query(`
      SELECT m.*, l.lot_no, p.fish_name, loc.line_place
      FROM movements m
      JOIN lots l ON m.lot_id = l.id
      JOIN products p ON l.product_id = p.id
      JOIN locations loc ON m.location_id = loc.id
      ORDER BY m.created_at DESC
      LIMIT 10
    `);

    // Negative MC balance per lot + location (data inconsistency — more OUT than IN)
    const [errorRows] = await pool.query(`
      SELECT x.lot_id, x.location_id, x.balance_mc,
        l.lot_no, p.fish_name, p.size, loc.line_place, p.stock_type
      FROM (
        SELECT lot_id, location_id,
          SUM(CASE WHEN movement_type = 'IN' THEN quantity_mc ELSE 0 END) -
          SUM(CASE WHEN movement_type = 'OUT' THEN quantity_mc ELSE 0 END) AS balance_mc
        FROM movements
        GROUP BY lot_id, location_id
        HAVING balance_mc < 0
      ) x
      JOIN lots l ON x.lot_id = l.id
      JOIN products p ON l.product_id = p.id
      JOIN locations loc ON x.location_id = loc.id
      ORDER BY x.balance_mc ASC, l.lot_no, loc.line_place
    `);

    const stock_issues = errorRows.map((r) => ({
      lot_id: r.lot_id,
      location_id: r.location_id,
      lot_no: r.lot_no,
      fish_name: r.fish_name,
      size: r.size,
      line_place: r.line_place,
      balance_mc: Number(r.balance_mc),
      stock_type: r.stock_type,
    }));

    res.json({
      ...summary[0],
      stock_status: stock_issues.length === 0 ? 'Correct' : `Error (${stock_issues.length} issues)`,
      recent_movements: recentMovements,
      error_count: stock_issues.length,
      stock_issues,
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard data' });
  }
});

// DELETE all stock data for a given stock_type (movements + lots) — superadmin only
router.delete('/all', authMiddleware, superadminOnly, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { stock_type } = req.query;
    if (!stock_type) {
      return res.status(400).json({ error: 'stock_type query param is required' });
    }

    await conn.beginTransaction();

    // Find all lots linked to products of this stock_type
    const [lots] = await conn.query(
      'SELECT l.id FROM lots l JOIN products p ON l.product_id = p.id WHERE p.stock_type = ?',
      [stock_type]
    );
    const lotIds = lots.map(l => l.id);

    let movementsDeleted = 0;
    let lotsDeleted = 0;

    if (lotIds.length > 0) {
      // Delete withdraw_items referencing these lots
      await conn.query(
        `DELETE FROM withdraw_items WHERE lot_id IN (${lotIds.map(() => '?').join(',')})`,
        lotIds
      );

      // Delete movements for these lots
      const [mResult] = await conn.query(
        `DELETE FROM movements WHERE lot_id IN (${lotIds.map(() => '?').join(',')})`,
        lotIds
      );
      movementsDeleted = mResult.affectedRows;

      // Delete the lots themselves
      const [lResult] = await conn.query(
        `DELETE FROM lots WHERE id IN (${lotIds.map(() => '?').join(',')})`,
        lotIds
      );
      lotsDeleted = lResult.affectedRows;
    }

    await conn.commit();

    res.json({
      message: `Deleted ${movementsDeleted} movements and ${lotsDeleted} lots for ${stock_type}`,
      movements_deleted: movementsDeleted,
      lots_deleted: lotsDeleted
    });
  } catch (error) {
    await conn.rollback();
    console.error('Error deleting stock data:', error);
    res.status(500).json({ error: 'Failed to delete stock data' });
  } finally {
    conn.release();
  }
});

module.exports = router;
