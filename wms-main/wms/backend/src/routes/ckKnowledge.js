const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware } = require('../middleware/auth');

const ALLOWED_CATEGORIES = new Set(['company', 'operations', 'policies', 'products', 'general', 'other']);

function sanitizeCategory(raw) {
  const c = String(raw || 'general').toLowerCase().trim();
  return ALLOWED_CATEGORIES.has(c) ? c : 'general';
}

/** GET /api/ck-intelligence/knowledge */
router.get('/', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, category, title, content, sort_order, created_at, updated_at
       FROM ck_knowledge_entries
       ORDER BY sort_order ASC, id ASC`
    );
    res.json(rows);
  } catch (e) {
    console.error('ck knowledge list:', e);
    res.status(500).json({ error: 'Failed to load knowledge entries' });
  }
});

/** GET /api/ck-intelligence/knowledge/:id */
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const [rows] = await pool.query(
      'SELECT id, category, title, content, sort_order, created_at, updated_at FROM ck_knowledge_entries WHERE id = ?',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) {
    console.error('ck knowledge get:', e);
    res.status(500).json({ error: 'Failed to load entry' });
  }
});

/** POST /api/ck-intelligence/knowledge */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, content, sort_order } = req.body || {};
    const category = sanitizeCategory(req.body?.category);
    if (!title || !String(title).trim()) return res.status(400).json({ error: 'title is required' });
    if (content == null || !String(content).trim()) return res.status(400).json({ error: 'content is required' });
    const sort = Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0;
    const [r] = await pool.query(
      'INSERT INTO ck_knowledge_entries (category, title, content, sort_order) VALUES (?, ?, ?, ?)',
      [category, String(title).trim(), String(content), sort]
    );
    const [rows] = await pool.query(
      'SELECT id, category, title, content, sort_order, created_at, updated_at FROM ck_knowledge_entries WHERE id = ?',
      [r.insertId]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    console.error('ck knowledge create:', e);
    res.status(500).json({ error: 'Failed to create entry' });
  }
});

/** PUT /api/ck-intelligence/knowledge/:id */
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const { title, content, sort_order } = req.body || {};
    const category = req.body?.category != null ? sanitizeCategory(req.body.category) : undefined;

    const [existing] = await pool.query('SELECT id FROM ck_knowledge_entries WHERE id = ?', [id]);
    if (existing.length === 0) return res.status(404).json({ error: 'Not found' });

    if (title != null && !String(title).trim()) return res.status(400).json({ error: 'title cannot be empty' });
    if (content != null && !String(content).trim()) return res.status(400).json({ error: 'content cannot be empty' });

    const fields = [];
    const params = [];
    if (category !== undefined) {
      fields.push('category = ?');
      params.push(category);
    }
    if (title != null) {
      fields.push('title = ?');
      params.push(String(title).trim());
    }
    if (content != null) {
      fields.push('content = ?');
      params.push(String(content));
    }
    if (sort_order !== undefined && sort_order !== null) {
      fields.push('sort_order = ?');
      params.push(Number.isFinite(Number(sort_order)) ? Number(sort_order) : 0);
    }
    if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });

    params.push(id);
    await pool.query(`UPDATE ck_knowledge_entries SET ${fields.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.query(
      'SELECT id, category, title, content, sort_order, created_at, updated_at FROM ck_knowledge_entries WHERE id = ?',
      [id]
    );
    res.json(rows[0]);
  } catch (e) {
    console.error('ck knowledge update:', e);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

/** DELETE /api/ck-intelligence/knowledge/:id */
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Invalid id' });
    const [r] = await pool.query('DELETE FROM ck_knowledge_entries WHERE id = ?', [id]);
    if (r.affectedRows === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    console.error('ck knowledge delete:', e);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

module.exports = router;
