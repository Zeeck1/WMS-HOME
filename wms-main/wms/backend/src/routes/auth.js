const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const [rows] = await pool.query(
      'SELECT * FROM users WHERE username = ? AND is_active = 1',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Fetch permissions
    const [perms] = await pool.query(
      'SELECT page_key FROM user_permissions WHERE user_id = ? AND can_access = 1',
      [user.id]
    );

    const permissions = perms.map(p => p.page_key);

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role, display_name: user.display_name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        display_name: user.display_name,
        role: user.role,
        permissions
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// GET /api/auth/me  — validate token + return fresh user data
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, username, display_name, role FROM users WHERE id = ? AND is_active = 1',
      [req.user.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'User not found' });

    const [perms] = await pool.query(
      'SELECT page_key FROM user_permissions WHERE user_id = ? AND can_access = 1',
      [req.user.id]
    );

    res.json({ ...rows[0], permissions: perms.map(p => p.page_key) });
  } catch (error) {
    console.error('Auth/me error:', error);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

module.exports = router;
