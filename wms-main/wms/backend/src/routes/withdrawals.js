const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// ─── GET all withdrawal requests ─────────────────────
router.get('/', async (req, res) => {
  try {
    const { department, status, date } = req.query;
    let sql = `
      SELECT wr.*,
        (SELECT COUNT(*) FROM withdraw_items wi WHERE wi.request_id = wr.id) AS item_count,
        (SELECT COALESCE(SUM(wi.requested_mc), 0) FROM withdraw_items wi WHERE wi.request_id = wr.id) AS total_requested_mc,
        (SELECT COALESCE(SUM(wi.quantity_mc), 0) FROM withdraw_items wi WHERE wi.request_id = wr.id) AS total_mc,
        (SELECT COALESCE(SUM(wi.quantity_mc * p.bulk_weight_kg), 0)
         FROM withdraw_items wi
         JOIN lots l ON wi.lot_id = l.id
         JOIN products p ON l.product_id = p.id
         WHERE wi.request_id = wr.id) AS total_kg
      FROM withdraw_requests wr
      WHERE 1=1
    `;
    const params = [];
    if (department) { sql += ' AND wr.department = ?'; params.push(department); }
    if (status) { sql += ' AND wr.status = ?'; params.push(status); }
    if (date) { sql += ' AND DATE(COALESCE(wr.withdraw_date, wr.created_at)) = ?'; params.push(date); }
    sql += ' ORDER BY wr.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching withdrawals:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

// ─── GET single withdrawal with items ────────────────
router.get('/:id', async (req, res) => {
  try {
    const [requests] = await pool.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    if (requests.length === 0) return res.status(404).json({ error: 'Request not found' });

    const [items] = await pool.query(`
      SELECT wi.*,
        l.lot_no, l.cs_in_date, l.sticker,
        p.fish_name, p.size, p.bulk_weight_kg, p.type, p.glazing, p.stock_type, p.order_code,
        loc.line_place, loc.stack_no, loc.stack_total,
        (
          COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity_mc ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity_mc ELSE 0 END), 0)
        ) AS hand_on_balance
      FROM withdraw_items wi
      JOIN lots l ON wi.lot_id = l.id
      JOIN products p ON l.product_id = p.id
      JOIN locations loc ON wi.location_id = loc.id
      LEFT JOIN movements m ON m.lot_id = wi.lot_id AND m.location_id = wi.location_id
      WHERE wi.request_id = ?
      GROUP BY wi.id, l.lot_no, l.cs_in_date, l.sticker,
               p.fish_name, p.size, p.bulk_weight_kg, p.type, p.glazing, p.stock_type, p.order_code,
               loc.line_place, loc.stack_no, loc.stack_total
    `, [req.params.id]);

    res.json({ ...requests[0], items });
  } catch (error) {
    console.error('Error fetching withdrawal:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawal' });
  }
});

// ─── POST create a new withdrawal request ────────────
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { department, items, notes, requested_by, withdraw_date, request_time } = req.body;

    if (!department || !['PK', 'RM'].includes(department)) {
      return res.status(400).json({ error: 'Department must be PK or RM' });
    }
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'At least one item is required' });
    }

    // Generate request number: WD-PK-20260209-001
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const [countRows] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM withdraw_requests WHERE DATE(created_at) = CURDATE() AND department = ?`,
      [department]
    );
    const seq = String((countRows[0].cnt || 0) + 1).padStart(3, '0');
    const requestNo = `WD-${department}-${today}-${seq}`;

    // Create request
    const [result] = await conn.query(
      `INSERT INTO withdraw_requests (request_no, department, status, withdraw_date, request_time, notes, requested_by)
       VALUES (?, ?, 'PENDING', ?, ?, ?, ?)`,
      [requestNo, department, withdraw_date || null, request_time || null, notes || null, requested_by || 'system']
    );
    const requestId = result.insertId;

    // Validate & insert items
    for (const item of items) {
      if (!item.lot_id || !item.location_id || !item.quantity_mc || item.quantity_mc <= 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Each item must have lot_id, location_id, and quantity_mc > 0' });
      }

      // Check available balance
      const [balance] = await conn.query(`
        SELECT
          COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity_mc ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN quantity_mc ELSE 0 END), 0) AS hand_on
        FROM movements WHERE lot_id = ? AND location_id = ?
      `, [item.lot_id, item.location_id]);

      if (item.quantity_mc > balance[0].hand_on) {
        await conn.rollback();
        return res.status(400).json({
          error: `Insufficient stock: requested ${item.quantity_mc} MC but only ${balance[0].hand_on} MC available`
        });
      }

      await conn.query(
        `INSERT INTO withdraw_items (request_id, lot_id, location_id, requested_mc, quantity_mc, weight_kg, production_process) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [requestId, item.lot_id, item.location_id, item.quantity_mc, item.quantity_mc, item.weight_kg || 0, item.production_process || null]
      );
    }

    await conn.commit();

    // Fetch the created request
    const [created] = await pool.query('SELECT * FROM withdraw_requests WHERE id = ?', [requestId]);
    res.status(201).json({ message: 'Withdrawal request created', request: created[0] });
  } catch (error) {
    await conn.rollback();
    console.error('Error creating withdrawal:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Duplicate request number. Please try again.' });
    }
    res.status(500).json({ error: 'Failed to create withdrawal request' });
  } finally {
    conn.release();
  }
});

// ─── PUT update items (edit quantities in PENDING state) ──
router.put('/:id/items', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { items } = req.body; // [{ id: withdraw_item_id, quantity_mc: newQty }]

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }

    // Verify request exists and is PENDING
    const [requests] = await conn.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    if (requests.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Request not found' });
    }
    if (requests[0].status !== 'PENDING') {
      await conn.rollback();
      return res.status(400).json({ error: 'Items can only be edited in PENDING status' });
    }

    for (const item of items) {
      if (!item.id || item.quantity_mc === undefined || item.quantity_mc < 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Each item must have id and quantity_mc >= 0' });
      }

      // If quantity is 0, remove the item
      if (item.quantity_mc === 0) {
        await conn.query('DELETE FROM withdraw_items WHERE id = ? AND request_id = ?', [item.id, req.params.id]);
        continue;
      }

      // Check current balance for the item
      const [wiRows] = await conn.query('SELECT * FROM withdraw_items WHERE id = ? AND request_id = ?', [item.id, req.params.id]);
      if (wiRows.length === 0) continue;

      const wi = wiRows[0];
      const [balance] = await conn.query(`
        SELECT
          COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity_mc ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN quantity_mc ELSE 0 END), 0) AS hand_on
        FROM movements WHERE lot_id = ? AND location_id = ?
      `, [wi.lot_id, wi.location_id]);

      if (item.quantity_mc > balance[0].hand_on) {
        await conn.rollback();
        return res.status(400).json({
          error: `Cannot set ${item.quantity_mc} MC — only ${balance[0].hand_on} MC available in stock`
        });
      }

      // Get bulk weight for recalculating weight_kg
      const [prodRows] = await conn.query(`
        SELECT p.bulk_weight_kg FROM lots l JOIN products p ON l.product_id = p.id WHERE l.id = ?
      `, [wi.lot_id]);
      const bulkKg = prodRows.length > 0 ? Number(prodRows[0].bulk_weight_kg) : 0;

      await conn.query(
        'UPDATE withdraw_items SET quantity_mc = ?, weight_kg = ? WHERE id = ?',
        [item.quantity_mc, item.quantity_mc * bulkKg, item.id]
      );
    }

    await conn.commit();
    res.json({ message: 'Items updated successfully' });
  } catch (error) {
    await conn.rollback();
    console.error('Error updating withdrawal items:', error);
    res.status(500).json({ error: 'Failed to update items' });
  } finally {
    conn.release();
  }
});

// ─── PUT update status (used by Manage page) ─────────
router.put('/:id/status', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { status, managed_by } = req.body;
    const validStatuses = ['PENDING', 'TAKING_OUT', 'READY', 'FINISHED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const [requests] = await conn.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    if (requests.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Request not found' });
    }

    const request = requests[0];

    // When finishing, perform the actual stock OUT movements
    if (status === 'FINISHED' && request.status !== 'FINISHED') {
      const [items] = await conn.query(`
        SELECT wi.*, p.bulk_weight_kg
        FROM withdraw_items wi
        JOIN lots l ON wi.lot_id = l.id
        JOIN products p ON l.product_id = p.id
        WHERE wi.request_id = ?
      `, [req.params.id]);

      for (const item of items) {
        // Verify balance again before finalizing
        const [balance] = await conn.query(`
          SELECT
            COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity_mc ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN quantity_mc ELSE 0 END), 0) AS hand_on
          FROM movements WHERE lot_id = ? AND location_id = ?
        `, [item.lot_id, item.location_id]);

        if (item.quantity_mc > balance[0].hand_on) {
          await conn.rollback();
          return res.status(400).json({
            error: `Insufficient stock for item. Requested ${item.quantity_mc} MC but only ${balance[0].hand_on} MC available.`
          });
        }

        // Create the stock OUT movement
        const [movResult] = await conn.query(
          `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, notes, created_by)
           VALUES (?, ?, ?, ?, 'OUT', ?, ?, ?)`,
          [
            item.lot_id, item.location_id, item.quantity_mc,
            item.quantity_mc * item.bulk_weight_kg,
            request.request_no,
            `Withdrawal for ${request.department} dept`,
            managed_by || 'system'
          ]
        );

        // Link movement to withdraw item
        await conn.query('UPDATE withdraw_items SET movement_id = ? WHERE id = ?', [movResult.insertId, item.id]);
      }
    }

    // Record finished_at timestamp when marking as FINISHED
    const finishedAt = (status === 'FINISHED' && request.status !== 'FINISHED') ? new Date() : request.finished_at;

    await conn.query(
      'UPDATE withdraw_requests SET status = ?, managed_by = ?, finished_at = ?, updated_at = NOW() WHERE id = ?',
      [status, managed_by || request.managed_by, finishedAt, req.params.id]
    );

    await conn.commit();

    const [updated] = await pool.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    res.json({ message: `Status updated to ${status}`, request: updated[0] });
  } catch (error) {
    await conn.rollback();
    console.error('Error updating withdrawal status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  } finally {
    conn.release();
  }
});

// ─── DELETE cancel a withdrawal ──────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [requests] = await pool.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    if (requests.length === 0) return res.status(404).json({ error: 'Request not found' });
    if (requests[0].status === 'FINISHED') {
      return res.status(400).json({ error: 'Cannot delete a finished withdrawal' });
    }
    await pool.query('UPDATE withdraw_requests SET status = "CANCELLED" WHERE id = ?', [req.params.id]);
    res.json({ message: 'Withdrawal cancelled' });
  } catch (error) {
    console.error('Error cancelling withdrawal:', error);
    res.status(500).json({ error: 'Failed to cancel withdrawal' });
  }
});

module.exports = router;
