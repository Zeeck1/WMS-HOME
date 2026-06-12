const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
const { authMiddleware, superadminOnly } = require('../middleware/auth');
const { fetchPendingUsers } = require('../utils/userAuthColumns');

const router = express.Router();

router.use(authMiddleware, superadminOnly);

async function hardDeleteUser(conn, userId) {
  await conn.query('DELETE FROM user_permissions WHERE user_id = ?', [userId]);
  const [result] = await conn.query('DELETE FROM users WHERE id = ?', [userId]);
  return result.affectedRows > 0;
}

// GET /api/users/pending — list users awaiting approval
router.get('/pending', async (req, res) => {
  try {
    const users = await fetchPendingUsers(pool);
    res.json(users);
  } catch (err) {
    console.error('Error fetching pending users:', err.code, err.message);
    res.status(500).json({ error: 'Failed to fetch pending users' });
  }
});

// PUT /api/users/:id/approve — approve employee user and assign permissions
router.put('/:id/approve', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { permissions } = req.body; // array of page_key strings

    const [rows] = await conn.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'User not found' });
    }
    if (rows[0].role === 'superadmin') {
      await conn.rollback();
      return res.status(403).json({ error: 'Cannot modify superadmin' });
    }

    await conn.query(
      `UPDATE users SET is_active = 1, approval_status = 'approved', updated_at = NOW() WHERE id = ?`,
      [req.params.id]
    );

    // Replace permissions
    await conn.query('DELETE FROM user_permissions WHERE user_id = ?', [req.params.id]);
    if (Array.isArray(permissions) && permissions.length > 0) {
      const values = permissions.map((p) => [Number(req.params.id), p, 1]);
      await conn.query(
        'INSERT INTO user_permissions (user_id, page_key, can_access) VALUES ?',
        [values]
      );
    }

    await conn.commit();
    res.json({ message: 'User approved' });
  } catch (err) {
    await conn.rollback();
    console.error('Error approving user:', err);
    res.status(500).json({ error: 'Failed to approve user' });
  } finally {
    conn.release();
  }
});

// PUT /api/users/:id/reject — remove pending employee login request from database
router.put('/:id/reject', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
    if (user.role === 'superadmin') {
      await conn.rollback();
      return res.status(403).json({ error: 'Cannot reject superadmin' });
    }

    const isPendingEmployee =
      user.approval_status === 'pending'
      || (user.employee_id && Number(user.is_active) === 0);

    if (!isPendingEmployee) {
      await conn.rollback();
      return res.status(400).json({ error: 'Only pending employee login requests can be rejected here' });
    }

    const deleted = await hardDeleteUser(conn, user.id);
    if (!deleted) {
      await conn.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    await conn.commit();
    res.json({ message: 'Login request rejected and removed from database' });
  } catch (err) {
    await conn.rollback();
    console.error('Error rejecting user:', err);
    res.status(500).json({ error: 'Failed to reject user' });
  } finally {
    conn.release();
  }
});

// GET /api/users — list all users with their permissions
router.get('/', async (req, res) => {
  try {
    const [users] = await pool.query(
      'SELECT id, username, display_name, role, is_active, created_at FROM users ORDER BY role DESC, username'
    );

    for (const u of users) {
      const [perms] = await pool.query(
        'SELECT page_key FROM user_permissions WHERE user_id = ? AND can_access = 1',
        [u.id]
      );
      u.permissions = perms.map(p => p.page_key);
    }

    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// POST /api/users — create user
router.post('/', async (req, res) => {
  try {
    const { username, password, display_name, permissions } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await pool.query(
      'INSERT INTO users (username, password_hash, display_name, role) VALUES (?, ?, ?, ?)',
      [username, hash, display_name || username, 'user']
    );

    const userId = result.insertId;

    if (Array.isArray(permissions) && permissions.length > 0) {
      const values = permissions.map(p => [userId, p, 1]);
      await pool.query(
        'INSERT INTO user_permissions (user_id, page_key, can_access) VALUES ?',
        [values]
      );
    }

    res.status(201).json({ id: userId, username, display_name: display_name || username, permissions: permissions || [] });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// PUT /api/users/:id — update user (password optional)
router.put('/:id', async (req, res) => {
  try {
    const { username, password, display_name, permissions, is_active } = req.body;

    const updates = [];
    const params = [];

    if (username) { updates.push('username = ?'); params.push(username); }
    if (display_name) { updates.push('display_name = ?'); params.push(display_name); }
    if (typeof is_active === 'number') { updates.push('is_active = ?'); params.push(is_active); }
    if (password) {
      const hash = await bcrypt.hash(password, 10);
      updates.push('password_hash = ?');
      params.push(hash);
    }

    if (updates.length > 0) {
      params.push(req.params.id);
      await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    }

    // Replace permissions
    if (Array.isArray(permissions)) {
      await pool.query('DELETE FROM user_permissions WHERE user_id = ?', [req.params.id]);
      if (permissions.length > 0) {
        const values = permissions.map(p => [Number(req.params.id), p, 1]);
        await pool.query(
          'INSERT INTO user_permissions (user_id, page_key, can_access) VALUES ?',
          [values]
        );
      }
    }

    res.json({ message: 'User updated' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Username already exists' });
    }
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// DELETE /api/users/:id — permanently delete user from database (never delete superadmin)
router.delete('/:id', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query('SELECT id, role FROM users WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'User not found' });
    }
    if (rows[0].role === 'superadmin') {
      await conn.rollback();
      return res.status(403).json({ error: 'Cannot delete the superadmin account' });
    }

    const deleted = await hardDeleteUser(conn, rows[0].id);
    if (!deleted) {
      await conn.rollback();
      return res.status(404).json({ error: 'User not found' });
    }

    await conn.commit();
    res.json({ message: 'User deleted from database' });
  } catch (error) {
    await conn.rollback();
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  } finally {
    conn.release();
  }
});

module.exports = router;
