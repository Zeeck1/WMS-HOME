const express = require('express');
const router = express.Router();
const pool = require('../config/db');

// GET all locations
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM locations WHERE is_active = 1 ORDER BY line_place'
    );
    res.json(rows);
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// GET single location
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM locations WHERE id = ?', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Location not found' });
    res.json(rows[0]);
  } catch (error) {
    console.error('Error fetching location:', error);
    res.status(500).json({ error: 'Failed to fetch location' });
  }
});

// POST create location — unique by line_place only
router.post('/', async (req, res) => {
  try {
    const { line_place, stack_no, stack_total, description } = req.body;
    if (!line_place) {
      return res.status(400).json({ error: 'Line/Place is required' });
    }

    const code = line_place.trim().toUpperCase();

    // Check if this location code already exists
    const [existing] = await pool.query(
      'SELECT id, line_place FROM locations WHERE line_place = ? AND is_active = 1',
      [code]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: `Location "${code}" already exists. Each location code must be unique.` });
    }

    const [result] = await pool.query(
      'INSERT INTO locations (line_place, stack_no, stack_total, description) VALUES (?, ?, ?, ?)',
      [code, stack_no || 1, stack_total || 1, description || null]
    );
    const [newLoc] = await pool.query('SELECT * FROM locations WHERE id = ?', [result.insertId]);
    res.status(201).json(newLoc[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This location code already exists' });
    }
    console.error('Error creating location:', error);
    res.status(500).json({ error: 'Failed to create location' });
  }
});

// PUT update location — unique by line_place only
router.put('/:id', async (req, res) => {
  try {
    const { line_place, stack_no, stack_total, description } = req.body;
    const code = line_place.trim().toUpperCase();

    // Check for duplicate line_place (excluding self)
    const [existing] = await pool.query(
      'SELECT id FROM locations WHERE line_place = ? AND id != ? AND is_active = 1',
      [code, req.params.id]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: `Location "${code}" already exists. Each location code must be unique.` });
    }

    await pool.query(
      'UPDATE locations SET line_place=?, stack_no=?, stack_total=?, description=? WHERE id=?',
      [code, stack_no || 1, stack_total || 1, description || null, req.params.id]
    );
    const [updated] = await pool.query('SELECT * FROM locations WHERE id = ?', [req.params.id]);
    res.json(updated[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This location code already exists' });
    }
    console.error('Error updating location:', error);
    res.status(500).json({ error: 'Failed to update location' });
  }
});

// DELETE (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    await pool.query('UPDATE locations SET is_active = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Location deactivated' });
  } catch (error) {
    console.error('Error deleting location:', error);
    res.status(500).json({ error: 'Failed to delete location' });
  }
});

// DELETE ALL locations (soft delete all)
router.delete('/', async (req, res) => {
  try {
    const [result] = await pool.query('UPDATE locations SET is_active = 0 WHERE is_active = 1');
    res.json({ message: `${result.affectedRows} locations deactivated` });
  } catch (error) {
    console.error('Error deleting all locations:', error);
    res.status(500).json({ error: 'Failed to delete all locations' });
  }
});

module.exports = router;
