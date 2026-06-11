const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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

// POST /api/auth/employee-login — login by employee ID only (no password)
router.post('/employee-login', async (req, res) => {
  try {
    const { employee_id } = req.body;
    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    const empId = String(employee_id).trim();

    // Must exist in employee directory
    const [empRows] = await pool.query(
      'SELECT * FROM employees WHERE employee_id = ?',
      [empId]
    );
    if (empRows.length === 0) {
      return res.status(404).json({ error: 'Employee ID not found. Please contact your administrator.' });
    }
    const emp = empRows[0];

    // Check if a user account already exists for this employee_id
    const [userRows] = await pool.query(
      'SELECT * FROM users WHERE employee_id = ?',
      [empId]
    );

    let user;
    if (userRows.length === 0) {
      // First login — create a pending user account
      const randomHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      const username = `emp_${empId}`;
      const [result] = await pool.query(
        `INSERT INTO users (username, password_hash, display_name, role, is_active, employee_id, approval_status)
         VALUES (?, ?, ?, 'user', 0, ?, 'pending')`,
        [username, randomHash, emp.full_name, empId]
      );
      user = {
        id: result.insertId,
        username,
        display_name: emp.full_name,
        role: 'user',
        is_active: 0,
        employee_id: empId,
        approval_status: 'pending',
      };
    } else {
      user = userRows[0];
    }

    const awaitingApproval =
      user.approval_status === 'pending'
      || Number(user.is_active) === 0
      || (user.employee_id && user.approval_status == null && Number(user.is_active) !== 1);

    if (awaitingApproval) {
      return res.status(403).json({
        error: 'PENDING_APPROVAL',
        display_name: user.display_name,
        employee_id: empId,
      });
    }

    // Approved — issue token
    const [perms] = await pool.query(
      'SELECT page_key FROM user_permissions WHERE user_id = ? AND can_access = 1',
      [user.id]
    );
    const permissions = perms.map((p) => p.page_key);

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
        permissions,
      },
    });
  } catch (error) {
    console.error('Employee login error:', error);
    if (error.code === 'ER_BAD_FIELD_ERROR') {
      return res.status(503).json({
        error: 'Employee login is not ready yet. Please restart the server after database migration completes.',
      });
    }
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
