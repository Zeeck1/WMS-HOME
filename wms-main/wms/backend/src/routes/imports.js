const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ── Stock Table view: import items with balance for Stock Table page ─────
router.get('/stock-table', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        ii.id AS item_id,
        s.id AS shipment_id,
        s.inv_no,
        s.origin_country,
        s.eta,
        s.production_date,
        s.expiry_date,
        ii.item_name,
        ii.size,
        ii.pack,
        ii.wet_mc,
        ii.inv_mc,
        ii.inv_nw_kgs,
        ii.factory_mc,
        ii.factory_nw_kgs,
        ii.remark,
        ii.unit_price,
        ii.lines AS item_lines,
        COALESCE((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS total_out_mc,
        COALESCE((SELECT SUM(o.nw_kgs) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS total_out_nw,
        ii.factory_mc - COALESCE((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS balance_mc,
        ii.factory_nw_kgs - COALESCE((SELECT SUM(o.nw_kgs) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS balance_nw_kgs
      FROM import_items ii
      JOIN import_shipments s ON ii.shipment_id = s.id
      ORDER BY s.inv_no ASC, ii.seq_no ASC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Movement History view: import stock outs formatted as movements ──────
router.get('/movement-history', async (req, res) => {
  try {
    const { from_date, to_date, limit } = req.query;
    let sql = `
      SELECT
        o.id,
        o.created_at,
        o.date_out,
        'OUT' AS movement_type,
        ii.item_name AS fish_name,
        ii.size,
        s.inv_no AS lot_no,
        CONCAT(s.origin_country, ' Import') AS line_place,
        '' AS stack_no,
        o.mc AS quantity_mc,
        o.nw_kgs AS weight_kg,
        o.order_ref AS reference_no,
        'import' AS created_by,
        CONCAT('Import shipment ', s.inv_no) AS notes
      FROM import_stock_outs o
      JOIN import_items ii ON o.item_id = ii.id
      JOIN import_shipments s ON ii.shipment_id = s.id
      WHERE 1=1
    `;
    const params = [];
    if (from_date) { sql += ' AND DATE(o.date_out) >= ?'; params.push(from_date); }
    if (to_date) { sql += ' AND DATE(o.date_out) <= ?'; params.push(to_date); }
    sql += ' ORDER BY o.created_at DESC, o.id DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── List all import shipments ────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT s.*,
        (SELECT COUNT(*) FROM import_items WHERE shipment_id = s.id) AS item_count,
        (SELECT COALESCE(SUM(inv_nw_kgs), 0) FROM import_items WHERE shipment_id = s.id) AS total_inv_kgs
      FROM import_shipments s
      ORDER BY s.created_at DESC
    `);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Get single shipment with items, stock outs, expenses ─────────────────
router.get('/:id', async (req, res) => {
  try {
    const [shipRows] = await pool.query('SELECT * FROM import_shipments WHERE id = ?', [req.params.id]);
    if (!shipRows[0]) return res.status(404).json({ error: 'Shipment not found' });

    const shipment = shipRows[0];

    const [items] = await pool.query(
      'SELECT * FROM import_items WHERE shipment_id = ? ORDER BY seq_no ASC',
      [shipment.id]
    );

    const itemIds = items.map(i => i.id);
    let stockOuts = [];
    if (itemIds.length > 0) {
      const [outs] = await pool.query(
        'SELECT * FROM import_stock_outs WHERE item_id IN (?) ORDER BY date_out ASC, id ASC',
        [itemIds]
      );
      stockOuts = outs;
    }

    const [expenses] = await pool.query(
      'SELECT * FROM import_expenses WHERE shipment_id = ? ORDER BY seq_no ASC',
      [shipment.id]
    );

    res.json({ shipment, items, stockOuts, expenses });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Helper: auto-register import items as products in Product Master
async function syncProductMaster(conn, items) {
  for (const it of items) {
    if (!it.item_name || !it.item_name.trim()) continue;
    const name = it.item_name.trim();
    const size = (it.size || '-').trim();
    const [existing] = await conn.query(
      "SELECT id FROM products WHERE fish_name = ? AND size = ? AND stock_type = 'IMPORT'",
      [name, size]
    );
    if (existing.length === 0) {
      await conn.query(
        "INSERT INTO products (fish_name, size, bulk_weight_kg, stock_type) VALUES (?, ?, ?, 'IMPORT')",
        [name, size, it.wet_mc || 0]
      );
    }
  }
}

// ── Create new shipment ──────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { shipment, items, expenses } = req.body;

    const [sr] = await conn.query(
      `INSERT INTO import_shipments (inv_no, container_no, seal_no, eta, origin_country, production_date, expiry_date, total_net_weight)
       VALUES (?,?,?,?,?,?,?,?)`,
      [shipment.inv_no, shipment.container_no || null, shipment.seal_no || null,
       shipment.eta || null, shipment.origin_country || null,
       shipment.production_date || null, shipment.expiry_date || null,
       shipment.total_net_weight || 0]
    );
    const shipmentId = sr.insertId;

    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        await conn.query(
          `INSERT INTO import_items (shipment_id, seq_no, item_name, size, pack, wet_mc, inv_mc, inv_nw_kgs, factory_mc, factory_nw_kgs, remark, unit_price, \`lines\`)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [shipmentId, i + 1, it.item_name || '', it.size || '', it.pack || '',
           it.wet_mc || 0, it.inv_mc || 0, it.inv_nw_kgs || 0,
           it.factory_mc || 0, it.factory_nw_kgs || 0, it.remark || '', it.unit_price || 0, it.lines || null]
        );
      }
      await syncProductMaster(conn, items);
    }

    if (expenses && expenses.length > 0) {
      for (let i = 0; i < expenses.length; i++) {
        const ex = expenses[i];
        await conn.query(
          `INSERT INTO import_expenses (shipment_id, seq_no, expense_name, total_baht, amount_usd_kgs, amount_usd_kgs_expr)
           VALUES (?,?,?,?,?,?)`,
          [shipmentId, i + 1, ex.expense_name || '', ex.total_baht || 0, ex.amount_usd_kgs || 0, ex.amount_usd_kgs_expr || null]
        );
      }
    }

    await conn.commit();
    res.status(201).json({ id: shipmentId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ── Update shipment (header + items + expenses, full replace) ────────────
router.put('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { shipment, items, expenses } = req.body;
    const id = req.params.id;

    await conn.query(
      `UPDATE import_shipments SET inv_no=?, container_no=?, seal_no=?, eta=?,
       origin_country=?, production_date=?, expiry_date=?, last_update_stock=NOW(), total_net_weight=?
       WHERE id=?`,
      [shipment.inv_no, shipment.container_no || null, shipment.seal_no || null,
       shipment.eta || null, shipment.origin_country || null,
       shipment.production_date || null, shipment.expiry_date || null,
       shipment.total_net_weight || 0, id]
    );

    // Rebuild items: keep existing ones with stock outs, delete removed, upsert
    const [existingItems] = await conn.query('SELECT id FROM import_items WHERE shipment_id = ?', [id]);
    const existingIds = new Set(existingItems.map(e => e.id));
    const incomingIds = new Set(items.filter(i => i.id).map(i => i.id));

    // Delete items that were removed (cascade deletes their stock outs)
    for (const eid of existingIds) {
      if (!incomingIds.has(eid)) {
        await conn.query('DELETE FROM import_items WHERE id = ?', [eid]);
      }
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.id && existingIds.has(it.id)) {
        await conn.query(
          `UPDATE import_items SET seq_no=?, item_name=?, size=?, pack=?, wet_mc=?,
           inv_mc=?, inv_nw_kgs=?, factory_mc=?, factory_nw_kgs=?, remark=?, unit_price=?, \`lines\`=?
           WHERE id=?`,
          [i + 1, it.item_name || '', it.size || '', it.pack || '', it.wet_mc || 0,
           it.inv_mc || 0, it.inv_nw_kgs || 0, it.factory_mc || 0, it.factory_nw_kgs || 0,
           it.remark || '', it.unit_price || 0, it.lines || null, it.id]
        );
      } else {
        await conn.query(
          `INSERT INTO import_items (shipment_id, seq_no, item_name, size, pack, wet_mc, inv_mc, inv_nw_kgs, factory_mc, factory_nw_kgs, remark, unit_price, \`lines\`)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [id, i + 1, it.item_name || '', it.size || '', it.pack || '', it.wet_mc || 0,
           it.inv_mc || 0, it.inv_nw_kgs || 0, it.factory_mc || 0, it.factory_nw_kgs || 0,
           it.remark || '', it.unit_price || 0, it.lines || null]
        );
      }
    }

    await syncProductMaster(conn, items);

    // Rebuild expenses
    await conn.query('DELETE FROM import_expenses WHERE shipment_id = ?', [id]);
    if (expenses && expenses.length > 0) {
      for (let i = 0; i < expenses.length; i++) {
        const ex = expenses[i];
        await conn.query(
          `INSERT INTO import_expenses (shipment_id, seq_no, expense_name, total_baht, amount_usd_kgs, amount_usd_kgs_expr)
           VALUES (?,?,?,?,?,?)`,
          [id, i + 1, ex.expense_name || '', ex.total_baht || 0, ex.amount_usd_kgs || 0, ex.amount_usd_kgs_expr || null]
        );
      }
    }

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ── Delete shipment ──────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM import_shipments WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Stock Out CRUD ───────────────────────────────────────────────────────
async function getItemBalance(itemId) {
  const [itemRows] = await pool.query(
    'SELECT factory_mc, factory_nw_kgs FROM import_items WHERE id = ?', [itemId]
  );
  if (!itemRows[0]) return null;
  const [outRows] = await pool.query(
    'SELECT COALESCE(SUM(mc),0) AS total_mc, COALESCE(SUM(nw_kgs),0) AS total_nw FROM import_stock_outs WHERE item_id = ?', [itemId]
  );
  return {
    balance_mc: Number(itemRows[0].factory_mc) - Number(outRows[0].total_mc),
    balance_nw: Number(itemRows[0].factory_nw_kgs) - Number(outRows[0].total_nw)
  };
}

router.post('/:id/stock-out', async (req, res) => {
  try {
    const { item_id, date_out, order_ref, mc, nw_kgs } = req.body;
    const reqMc = Number(mc) || 0;
    const reqNw = Number(nw_kgs) || 0;

    const bal = await getItemBalance(item_id);
    if (!bal) return res.status(404).json({ error: 'Item not found' });
    if (reqMc > bal.balance_mc) {
      return res.status(400).json({ error: `Insufficient MC balance. Available: ${bal.balance_mc}, Requested: ${reqMc}` });
    }
    if (reqNw > bal.balance_nw) {
      return res.status(400).json({ error: `Insufficient N/W balance. Available: ${bal.balance_nw.toFixed(2)}, Requested: ${reqNw.toFixed(2)}` });
    }

    const [r] = await pool.query(
      'INSERT INTO import_stock_outs (item_id, date_out, order_ref, mc, nw_kgs) VALUES (?,?,?,?,?)',
      [item_id, date_out, order_ref || '', reqMc, reqNw]
    );
    await pool.query('UPDATE import_shipments SET last_update_stock = NOW() WHERE id = ?', [req.params.id]);
    const [row] = await pool.query('SELECT * FROM import_stock_outs WHERE id = ?', [r.insertId]);
    res.status(201).json(row[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/stock-out/:outId', async (req, res) => {
  try {
    const { date_out, order_ref, mc, nw_kgs } = req.body;
    const reqMc = Number(mc) || 0;
    const reqNw = Number(nw_kgs) || 0;

    const [existing] = await pool.query('SELECT item_id, mc, nw_kgs FROM import_stock_outs WHERE id = ?', [req.params.outId]);
    if (!existing[0]) return res.status(404).json({ error: 'Stock out record not found' });

    const bal = await getItemBalance(existing[0].item_id);
    if (!bal) return res.status(404).json({ error: 'Item not found' });
    const availMc = bal.balance_mc + Number(existing[0].mc);
    const availNw = bal.balance_nw + Number(existing[0].nw_kgs);
    if (reqMc > availMc) {
      return res.status(400).json({ error: `Insufficient MC balance. Available: ${availMc}, Requested: ${reqMc}` });
    }
    if (reqNw > availNw) {
      return res.status(400).json({ error: `Insufficient N/W balance. Available: ${availNw.toFixed(2)}, Requested: ${reqNw.toFixed(2)}` });
    }

    await pool.query(
      'UPDATE import_stock_outs SET date_out=?, order_ref=?, mc=?, nw_kgs=? WHERE id=?',
      [date_out, order_ref || '', reqMc, reqNw, req.params.outId]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/stock-out/:outId', async (req, res) => {
  try {
    await pool.query('DELETE FROM import_stock_outs WHERE id = ?', [req.params.outId]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
