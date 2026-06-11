const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { purgeDuplicateLocationsForLine } = require('../utils/locationMaster');

// GET all locations (active only; Manual creates/updates these rows)
router.get('/', async (req, res) => {
  try {
    // One visible row per line_place (latest stack from Manual wins)
    const [rows] = await pool.query(`
      SELECT l.*
      FROM locations l
      INNER JOIN (
        SELECT UPPER(TRIM(line_place)) AS lp,
          SUBSTRING_INDEX(GROUP_CONCAT(id ORDER BY updated_at DESC, id ASC), ',', 1) AS keeper_id
        FROM locations
        WHERE is_active = 1
        GROUP BY UPPER(TRIM(line_place))
      ) k ON l.id = k.keeper_id
      WHERE l.is_active = 1
      ORDER BY l.line_place ASC
    `);
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

// POST create location — one row per line_place (stack fields overwrite on update)
router.post('/', async (req, res) => {
  try {
    const { line_place, stack_no, stack_total, description } = req.body;
    if (!line_place) {
      return res.status(400).json({ error: 'Line/Place is required' });
    }

    const code = line_place.trim().toUpperCase();
    const stack = parseInt(stack_no, 10) || 1;
    const total = parseInt(stack_total, 10) || 1;

    const [existing] = await pool.query(
      'SELECT id FROM locations WHERE UPPER(TRIM(line_place)) = ? AND is_active = 1 LIMIT 1',
      [code]
    );
    if (existing.length > 0) {
      const keeperId = existing[0].id;
      await pool.query(
        'UPDATE locations SET stack_no=?, stack_total=?, description=?, updated_at=NOW() WHERE id=?',
        [stack, total, description || null, keeperId]
      );
      const conn = await pool.getConnection();
      try {
        await purgeDuplicateLocationsForLine(conn, keeperId, code, stack);
      } finally {
        conn.release();
      }
      const [updated] = await pool.query('SELECT * FROM locations WHERE id = ?', [keeperId]);
      return res.status(200).json(updated[0]);
    }

    const [result] = await pool.query(
      'INSERT INTO locations (line_place, stack_no, stack_total, description) VALUES (?, ?, ?, ?)',
      [code, stack, total, description || null]
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
    const stack = parseInt(stack_no, 10) || 1;
    const total = parseInt(stack_total, 10) || 1;

    const [existing] = await pool.query(
      'SELECT id FROM locations WHERE UPPER(TRIM(line_place)) = ? AND id != ? AND is_active = 1 LIMIT 1',
      [code, req.params.id]
    );
    if (existing.length > 0) {
      return res.status(409).json({
        error: `Location "${code}" already exists. Each location code must be unique.`,
      });
    }

    await pool.query(
      'UPDATE locations SET line_place=?, stack_no=?, stack_total=?, description=?, is_active=1, updated_at=NOW() WHERE id=?',
      [code, stack, total, description || null, req.params.id]
    );
    const conn = await pool.getConnection();
    try {
      await purgeDuplicateLocationsForLine(conn, parseInt(req.params.id, 10), code, stack);
    } finally {
      conn.release();
    }
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
