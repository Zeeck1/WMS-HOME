const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { bangkokYYYYMMDD } = require('../utils/bangkokTime');
const { sumKgPartsString, normalizeKgParts } = require('../utils/kgParts');

// ── CRUD: Customers ────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM customers ORDER BY name ASC');
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Summary (all deposit items with balance for a customer or all) ────
router.get('/summary/all', async (req, res) => {
  try {
    const { customer_id } = req.query;
    let sql = `
      SELECT di.*, d.deposit_date, d.doc_ref, d.customer_id,
        c.name AS customer_name,
        COALESCE((SELECT SUM(wi.boxes_out) FROM customer_withdrawal_items wi WHERE wi.deposit_item_id = di.id), 0) AS total_out_boxes,
        COALESCE((SELECT SUM(wi.weight_kg_out) FROM customer_withdrawal_items wi WHERE wi.deposit_item_id = di.id), 0) AS total_out_kg,
        di.boxes - COALESCE((SELECT SUM(wi.boxes_out) FROM customer_withdrawal_items wi WHERE wi.deposit_item_id = di.id), 0) AS balance_boxes,
        di.weight_kg - COALESCE((SELECT SUM(wi.weight_kg_out) FROM customer_withdrawal_items wi WHERE wi.deposit_item_id = di.id), 0) AS balance_kg
      FROM customer_deposit_items di
      JOIN customer_deposits d ON di.deposit_id = d.id
      JOIN customers c ON d.customer_id = c.id`;
    const params = [];
    if (customer_id) { sql += ' WHERE d.customer_id = ?'; params.push(customer_id); }
    sql += ' ORDER BY c.name ASC, di.receive_date DESC, di.seq_no ASC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/summary/detail/:depositItemId', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT wi.*, w.withdraw_date, w.doc_ref AS wd_doc_ref
       FROM customer_withdrawal_items wi
       JOIN customer_withdrawals w ON wi.withdrawal_id = w.id
       WHERE wi.deposit_item_id = ?
       ORDER BY w.withdraw_date ASC, wi.id ASC`,
      [req.params.depositItemId]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Customer not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const { name, address, document_no, phone } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    const [r] = await pool.query(
      'INSERT INTO customers (name, address, document_no, phone) VALUES (?,?,?,?)',
      [name.trim(), address || null, document_no || null, phone || null]
    );
    const [row] = await pool.query('SELECT * FROM customers WHERE id = ?', [r.insertId]);
    res.status(201).json(row[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const { name, address, document_no, phone } = req.body;
    await pool.query(
      'UPDATE customers SET name=?, address=?, document_no=?, phone=? WHERE id=?',
      [name, address || null, document_no || null, phone || null, req.params.id]
    );
    const [row] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
    res.json(row[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM customers WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete all deposits for a customer ──────────────────────────────────
router.delete('/:id/deposits', async (req, res) => {
  try {
    const [deps] = await pool.query('SELECT id FROM customer_deposits WHERE customer_id = ?', [req.params.id]);
    if (deps.length > 0) {
      const ids = deps.map(d => d.id);
      await pool.query('DELETE FROM customer_withdrawal_items WHERE deposit_item_id IN (SELECT id FROM customer_deposit_items WHERE deposit_id IN (?))', [ids]);
      await pool.query('DELETE FROM customer_withdrawals WHERE customer_id = ?', [req.params.id]);
      await pool.query('DELETE FROM customer_deposit_items WHERE deposit_id IN (?)', [ids]);
      await pool.query('DELETE FROM customer_deposits WHERE customer_id = ?', [req.params.id]);
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete all withdrawals for a customer ───────────────────────────────
router.delete('/:id/withdrawals', async (req, res) => {
  try {
    await pool.query('DELETE FROM customer_withdrawal_items WHERE withdrawal_id IN (SELECT id FROM customer_withdrawals WHERE customer_id = ?)', [req.params.id]);
    await pool.query('DELETE FROM customer_withdrawals WHERE customer_id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Deposits (IN) ──────────────────────────────────────────────────────
router.get('/:id/deposits', async (req, res) => {
  try {
    const [deps] = await pool.query(
      `SELECT d.*, c.name AS customer_name,
        (SELECT COUNT(*) FROM customer_deposit_items WHERE deposit_id = d.id) AS item_count,
        (SELECT COALESCE(SUM(boxes),0) FROM customer_deposit_items WHERE deposit_id = d.id) AS total_boxes,
        (SELECT MIN(receive_date) FROM customer_deposit_items WHERE deposit_id = d.id) AS first_receive_date,
        (SELECT MAX(receive_date) FROM customer_deposit_items WHERE deposit_id = d.id) AS last_receive_date
       FROM customer_deposits d
       JOIN customers c ON d.customer_id = c.id
       WHERE d.customer_id = ?
       ORDER BY d.deposit_date DESC, d.id DESC`, [req.params.id]);
    res.json(deps);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/deposits/:depositId', async (req, res) => {
  try {
    const [deps] = await pool.query(
      `SELECT d.*, c.name AS customer_name, c.address, c.document_no, c.phone
       FROM customer_deposits d JOIN customers c ON d.customer_id = c.id
       WHERE d.id = ?`, [req.params.depositId]);
    if (!deps[0]) return res.status(404).json({ error: 'Deposit not found' });
    const [items] = await pool.query(
      'SELECT * FROM customer_deposit_items WHERE deposit_id = ? ORDER BY seq_no', [req.params.depositId]);
    res.json({ ...deps[0], items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/deposits', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { deposit_date, doc_ref, receiver_name, inspector_name, items } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'At least one item required' });

    await conn.beginTransaction();
    const [d] = await conn.query(
      'INSERT INTO customer_deposits (customer_id, deposit_date, doc_ref, receiver_name, inspector_name) VALUES (?,?,?,?,?)',
      [req.params.id, deposit_date || bangkokYYYYMMDD(), doc_ref || null, receiver_name || null, inspector_name || null]
    );
    const depositId = d.insertId;

    for (const item of items) {
      const kgParts = normalizeKgParts(item.kg_parts);
      let weightKg = parseFloat(item.weight_kg) || 0;
      if (kgParts) weightKg = sumKgPartsString(kgParts);
      await conn.query(
        `INSERT INTO customer_deposit_items (deposit_id, seq_no, receive_date, item_name, lot_no, boxes, weight_kg, kg_parts, nw_unit, time_str, remark)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [depositId, item.seq_no || 0, item.receive_date || null, item.item_name || '',
         item.lot_no || null, item.boxes || 0, weightKg, kgParts || null, item.nw_unit || 0,
         item.time_str || null, item.remark || null]
      );
    }
    await conn.commit();
    res.status(201).json({ ok: true, deposit_id: depositId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ── Deposit items with balance (for OUT page) ──────────────────────────
router.get('/:id/deposit-items', async (req, res) => {
  try {
    const { cs_in_date, fish_name, lot_no } = req.query;
    let sql = `
      SELECT di.*, d.deposit_date, d.doc_ref,
        COALESCE((SELECT SUM(wi.boxes_out) FROM customer_withdrawal_items wi WHERE wi.deposit_item_id = di.id), 0) AS total_withdrawn_boxes,
        COALESCE((SELECT SUM(wi.weight_kg_out) FROM customer_withdrawal_items wi WHERE wi.deposit_item_id = di.id), 0) AS total_withdrawn_kg,
        di.boxes - COALESCE((SELECT SUM(wi.boxes_out) FROM customer_withdrawal_items wi WHERE wi.deposit_item_id = di.id), 0) AS balance_boxes,
        (di.weight_kg) - COALESCE((SELECT SUM(wi.weight_kg_out) FROM customer_withdrawal_items wi WHERE wi.deposit_item_id = di.id), 0) AS balance_kg
      FROM customer_deposit_items di
      JOIN customer_deposits d ON di.deposit_id = d.id
      WHERE d.customer_id = ?`;
    const params = [req.params.id];

    if (cs_in_date) { sql += ' AND di.receive_date = ?'; params.push(cs_in_date); }
    if (fish_name) { sql += ' AND di.item_name LIKE ?'; params.push(`%${fish_name}%`); }
    if (lot_no) { sql += ' AND di.lot_no LIKE ?'; params.push(`%${lot_no}%`); }

    sql += ' HAVING balance_boxes > 0 ORDER BY di.receive_date DESC, di.seq_no ASC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Withdrawals (OUT) ──────────────────────────────────────────────────
router.get('/:id/withdrawals', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT w.*, c.name AS customer_name,
        (SELECT COUNT(*) FROM customer_withdrawal_items WHERE withdrawal_id = w.id) AS item_count,
        (SELECT COALESCE(SUM(boxes_out),0) FROM customer_withdrawal_items WHERE withdrawal_id = w.id) AS total_boxes_out
       FROM customer_withdrawals w
       JOIN customers c ON w.customer_id = c.id
       WHERE w.customer_id = ?
       ORDER BY w.withdraw_date DESC, w.id DESC`, [req.params.id]);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/withdrawals/:wId', async (req, res) => {
  try {
    const [ws] = await pool.query(
      `SELECT w.*, c.name AS customer_name, c.address, c.document_no, c.phone
       FROM customer_withdrawals w JOIN customers c ON w.customer_id = c.id
       WHERE w.id = ?`, [req.params.wId]);
    if (!ws[0]) return res.status(404).json({ error: 'Withdrawal not found' });
    const [items] = await pool.query(
      `SELECT wi.*, di.item_name, di.lot_no, di.receive_date, di.boxes AS orig_boxes, di.weight_kg AS orig_weight_kg, di.nw_unit,
        di.boxes - COALESCE((SELECT SUM(wi2.boxes_out) FROM customer_withdrawal_items wi2 WHERE wi2.deposit_item_id = di.id), 0) AS remaining_boxes,
        di.weight_kg - COALESCE((SELECT SUM(wi2.weight_kg_out) FROM customer_withdrawal_items wi2 WHERE wi2.deposit_item_id = di.id), 0) AS remaining_kg
       FROM customer_withdrawal_items wi
       JOIN customer_deposit_items di ON wi.deposit_item_id = di.id
       WHERE wi.withdrawal_id = ?
       ORDER BY wi.id`, [req.params.wId]);
    res.json({ ...ws[0], items });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/withdrawals', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { withdraw_date, doc_ref, withdrawer_name, inspector_name, items } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ error: 'At least one item required' });

    await conn.beginTransaction();
    const [w] = await conn.query(
      'INSERT INTO customer_withdrawals (customer_id, withdraw_date, doc_ref, withdrawer_name, inspector_name) VALUES (?,?,?,?,?)',
      [req.params.id, withdraw_date || bangkokYYYYMMDD(), doc_ref || null, withdrawer_name || null, inspector_name || null]
    );
    const wId = w.insertId;

    for (const item of items) {
      await conn.query(
        `INSERT INTO customer_withdrawal_items (withdrawal_id, deposit_item_id, boxes_out, weight_kg_out, time_str, remark)
         VALUES (?,?,?,?,?,?)`,
        [wId, item.deposit_item_id, item.boxes_out || 0, item.weight_kg_out || 0,
         item.time_str || null, item.remark || null]
      );
    }
    await conn.commit();
    res.status(201).json({ ok: true, withdrawal_id: wId });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ error: err.message });
  } finally { conn.release(); }
});

// ── Print data (combined IN + OUT) ─────────────────────────────────────
router.get('/print/:depositId/:withdrawalId', async (req, res) => {
  try {
    const { depositId, withdrawalId } = req.params;
    let deposit = null, withdrawal = null, withdrawalItems = [];

    if (withdrawalId && withdrawalId !== '0') {
      const [ws] = await pool.query(
        `SELECT w.*, c.name AS customer_name, c.address, c.document_no, c.phone
         FROM customer_withdrawals w JOIN customers c ON w.customer_id = c.id WHERE w.id = ?`, [withdrawalId]);
      if (ws[0]) {
        withdrawal = ws[0];
        const customerId = ws[0].customer_id;

        const [thisWdItems] = await pool.query(
          'SELECT deposit_item_id FROM customer_withdrawal_items WHERE withdrawal_id = ?', [withdrawalId]);
        const depItemIds = [...new Set(thisWdItems.map(i => i.deposit_item_id))];

        if (depItemIds.length > 0) {
          const [allWdItems] = await pool.query(
            `SELECT wi.*, w.withdraw_date, w.id AS w_id,
              di.item_name, di.lot_no, di.receive_date, di.deposit_id,
              di.boxes AS orig_boxes, di.weight_kg AS orig_weight_kg, di.nw_unit
             FROM customer_withdrawal_items wi
             JOIN customer_withdrawals w ON wi.withdrawal_id = w.id
             JOIN customer_deposit_items di ON wi.deposit_item_id = di.id
             WHERE wi.deposit_item_id IN (?)
             ORDER BY w.withdraw_date ASC, w.id ASC, wi.id ASC`,
            [depItemIds]
          );
          withdrawalItems = allWdItems;

          const [depItems] = await pool.query(
            'SELECT * FROM customer_deposit_items WHERE id IN (?) ORDER BY seq_no', [depItemIds]);

          const [cust] = await pool.query(
            `SELECT c.name AS customer_name, c.address, c.document_no, c.phone
             FROM customers c WHERE c.id = ?`, [customerId]);

          const depIds = [...new Set(depItems.map(i => i.deposit_id))];
          const [deps] = await pool.query(
            'SELECT * FROM customer_deposits WHERE id IN (?) ORDER BY deposit_date ASC', [depIds]);

          deposit = {
            ...(cust[0] || {}),
            ...(deps[0] || {}),
            customer_id: customerId,
            doc_ref: deps.map(d => d.doc_ref).filter(Boolean).join(', ') || cust[0]?.document_no,
            receiver_name: deps[deps.length - 1]?.receiver_name || '',
            inspector_name: deps[deps.length - 1]?.inspector_name || '',
            items: depItems
          };
        }
      }
    } else if (depositId && depositId !== '0') {
      const [deps] = await pool.query(
        `SELECT d.*, c.name AS customer_name, c.address, c.document_no, c.phone
         FROM customer_deposits d JOIN customers c ON d.customer_id = c.id WHERE d.id = ?`, [depositId]);
      if (deps[0]) {
        const [items] = await pool.query('SELECT * FROM customer_deposit_items WHERE deposit_id = ? ORDER BY seq_no', [depositId]);
        deposit = { ...deps[0], items };
      }
    }

    res.json({ deposit, withdrawal, withdrawalItems });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
