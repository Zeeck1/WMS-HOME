const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET all lots with product info (optional ?stock_type= filter)
router.get('/', async (req, res) => {
  try {
    const { stock_type } = req.query;
    let sql = `
      SELECT l.*, p.fish_name, p.size, p.type, p.glazing, p.bulk_weight_kg,
             p.stock_type, p.order_code
      FROM lots l
      JOIN products p ON l.product_id = p.id
      WHERE 1=1
    `;
    const params = [];
    if (stock_type) {
      sql += ' AND p.stock_type = ?';
      params.push(stock_type);
    }
    sql += ' ORDER BY l.cs_in_date DESC, l.lot_no';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching lots:', error);
    res.status(500).json({ error: 'Failed to fetch lots' });
  }
});

// GET single lot
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT l.*, p.fish_name, p.size, p.type, p.glazing, p.bulk_weight_kg
      FROM lots l
      JOIN products p ON l.product_id = p.id
      WHERE l.id = ?
    `, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Lot not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching lot:', error);
    res.status(500).json({ error: 'Failed to fetch lot' });
  }
});

// POST create lot
router.post('/', async (req, res) => {
  try {
    const { lot_no, cs_in_date, sticker, product_id, notes, production_date, expiration_date, st_no, remark } = req.body;
    if (!lot_no || !cs_in_date || !product_id) {
      return res.status(400).json({ error: 'Lot number, CS In Date, and product are required' });
    }
    const [result] = await pool.query(
      'INSERT INTO lots (lot_no, cs_in_date, sticker, product_id, notes, production_date, expiration_date, st_no, remark) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [lot_no, cs_in_date, sticker || null, product_id, notes || null, production_date || null, expiration_date || null, st_no || null, remark || null]
    );
    const [newLot] = await pool.query('SELECT * FROM lots WHERE id = ?', [result.insertId]);
    res.status(201).json(newLot[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Lot number already exists' });
    }
    console.error('Error creating lot:', error);
    res.status(500).json({ error: 'Failed to create lot' });
  }
});

// PUT update lot
router.put('/:id', async (req, res) => {
  try {
    const { lot_no, cs_in_date, sticker, product_id, notes } = req.body;
    await pool.query(
      'UPDATE lots SET lot_no=?, cs_in_date=?, sticker=?, product_id=?, notes=? WHERE id=?',
      [lot_no, cs_in_date, sticker || null, product_id, notes || null, req.params.id]
    );
    const [updated] = await pool.query('SELECT * FROM lots WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    console.error('Error updating lot:', error);
    res.status(500).json({ error: 'Failed to update lot' });
  }
});

// PATCH update only cs_in_date (e.g. from Manual page)
router.patch('/:id', async (req, res) => {
  try {
    const { cs_in_date } = req.body;
    if (cs_in_date == null || cs_in_date === '') {
      return res.status(400).json({ error: 'cs_in_date is required' });
    }
    await pool.query('UPDATE lots SET cs_in_date = ? WHERE id = ?', [cs_in_date, req.params.id]);
    const [updated] = await pool.query('SELECT * FROM lots WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    console.error('Error updating lot cs_in_date:', error);
    res.status(500).json({ error: 'Failed to update lot' });
  }
});

module.exports = router;
