const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET all movements with details
router.get('/', async (req, res) => {
  try {
    const { type, lot_id, location_id, from_date, to_date, limit } = req.query;
    let sql = `
      SELECT m.*, 
        l.lot_no, l.cs_in_date, l.sticker,
        p.fish_name, p.size, p.type AS product_type, p.glazing, p.bulk_weight_kg,
        loc.line_place, loc.stack_no
      FROM movements m
      JOIN lots l ON m.lot_id = l.id
      JOIN products p ON l.product_id = p.id
      JOIN locations loc ON m.location_id = loc.id
      WHERE 1=1
    `;
    const params = [];

    if (type) { sql += ' AND m.movement_type = ?'; params.push(type); }
    if (lot_id) { sql += ' AND m.lot_id = ?'; params.push(lot_id); }
    if (location_id) { sql += ' AND m.location_id = ?'; params.push(location_id); }
    if (from_date) { sql += ' AND DATE(m.created_at) >= ?'; params.push(from_date); }
    if (to_date) { sql += ' AND DATE(m.created_at) <= ?'; params.push(to_date); }

    sql += ' ORDER BY m.created_at DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }

    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching movements:', error);
    res.status(500).json({ error: 'Failed to fetch movements' });
  }
});

// POST Stock IN
router.post('/stock-in', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { lot_id, location_id, quantity_mc, weight_kg, reference_no, notes, created_by } = req.body;

    if (!lot_id || !location_id || !quantity_mc) {
      return res.status(400).json({ error: 'Lot, location, and quantity are required' });
    }
    if (quantity_mc <= 0) {
      return res.status(400).json({ error: 'Quantity must be greater than 0' });
    }

    const [result] = await conn.query(
      `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, notes, created_by)
       VALUES (?, ?, ?, ?, 'IN', ?, ?, ?)`,
      [lot_id, location_id, quantity_mc, weight_kg || 0, reference_no || null, notes || null, created_by || 'system']
    );

    await conn.commit();

    const [newMovement] = await pool.query(`
      SELECT m.*, l.lot_no, loc.line_place, p.fish_name
      FROM movements m
      JOIN lots l ON m.lot_id = l.id
      JOIN products p ON l.product_id = p.id
      JOIN locations loc ON m.location_id = loc.id
      WHERE m.id = ?
    `, [result.insertId]);

    res.status(201).json({ message: 'Stock IN recorded', movement: newMovement[0] });
  } catch (error) {
    await conn.rollback();
    console.error('Error recording stock in:', error);
    res.status(500).json({ error: 'Failed to record stock in' });
  } finally {
    conn.release();
  }
});

// POST Stock OUT
router.post('/stock-out', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { lot_id, location_id, quantity_mc, weight_kg, reference_no, notes, created_by } = req.body;

    if (!lot_id || !location_id || !quantity_mc) {
      return res.status(400).json({ error: 'Lot, location, and quantity are required' });
    }
    if (quantity_mc <= 0) {
      return res.status(400).json({ error: 'Quantity must be greater than 0' });
    }

    // Check available balance
    const [balance] = await conn.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity_mc ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN quantity_mc ELSE 0 END), 0) AS hand_on
      FROM movements
      WHERE lot_id = ? AND location_id = ?
    `, [lot_id, location_id]);

    const handOn = balance[0].hand_on;
    if (quantity_mc > handOn) {
      return res.status(400).json({
        error: `Cannot stock out ${quantity_mc} MC. Hand On balance is only ${handOn} MC.`
      });
    }

    const [result] = await conn.query(
      `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, notes, created_by)
       VALUES (?, ?, ?, ?, 'OUT', ?, ?, ?)`,
      [lot_id, location_id, quantity_mc, weight_kg || 0, reference_no || null, notes || null, created_by || 'system']
    );

    await conn.commit();

    const [newMovement] = await pool.query(`
      SELECT m.*, l.lot_no, loc.line_place, p.fish_name
      FROM movements m
      JOIN lots l ON m.lot_id = l.id
      JOIN products p ON l.product_id = p.id
      JOIN locations loc ON m.location_id = loc.id
      WHERE m.id = ?
    `, [result.insertId]);

    res.status(201).json({ message: 'Stock OUT recorded', movement: newMovement[0] });
  } catch (error) {
    await conn.rollback();
    console.error('Error recording stock out:', error);
    res.status(500).json({ error: 'Failed to record stock out' });
  } finally {
    conn.release();
  }
});

// POST Manual adjustment: set balance for a lot+location (creates IN/OUT so it becomes primary data everywhere)
router.post('/adjust', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { lot_id, location_id, new_balance_mc, notes } = req.body;

    if (!lot_id || !location_id || new_balance_mc === undefined || new_balance_mc === null) {
      return res.status(400).json({ error: 'lot_id, location_id, and new_balance_mc are required' });
    }

    const newBalance = parseInt(new_balance_mc, 10);
    if (isNaN(newBalance) || newBalance < 0) {
      return res.status(400).json({ error: 'new_balance_mc must be a non-negative number' });
    }

    const [balanceRows] = await conn.query(`
      SELECT
        COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity_mc ELSE 0 END), 0) -
        COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN quantity_mc ELSE 0 END), 0) AS hand_on
      FROM movements
      WHERE lot_id = ? AND location_id = ?
    `, [lot_id, location_id]);

    const currentBalance = balanceRows[0].hand_on || 0;

    if (newBalance === currentBalance) {
      await conn.commit();
      return res.status(200).json({ message: 'No change', current_balance: currentBalance });
    }

    const [productRows] = await conn.query(
      'SELECT p.bulk_weight_kg FROM lots l JOIN products p ON l.product_id = p.id WHERE l.id = ?',
      [lot_id]
    );
    const bulkWeightKg = productRows[0]?.bulk_weight_kg || 0;

    const ref = 'Manual adjustment';
    const note = notes || 'Corrected from Manual page';

    if (newBalance > currentBalance) {
      const qty = newBalance - currentBalance;
      const weightKg = qty * bulkWeightKg;
      await conn.query(
        `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, notes, created_by)
         VALUES (?, ?, ?, ?, 'IN', ?, ?, 'manual')`,
        [lot_id, location_id, qty, weightKg, ref, note]
      );
    } else {
      const qty = currentBalance - newBalance;
      const weightKg = qty * bulkWeightKg;
      await conn.query(
        `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, notes, created_by)
         VALUES (?, ?, ?, ?, 'OUT', ?, ?, 'manual')`,
        [lot_id, location_id, qty, weightKg, ref, note]
      );
    }

    await conn.commit();

    res.status(200).json({
      message: 'Balance adjusted',
      previous_balance: currentBalance,
      new_balance: newBalance
    });
  } catch (error) {
    await conn.rollback();
    console.error('Error adjusting balance:', error);
    res.status(500).json({ error: 'Failed to adjust balance' });
  } finally {
    conn.release();
  }
});

module.exports = router;
