const express = require('express');
const pool = require('../config/db');
const { authMiddleware, superadminOnly } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware, superadminOnly);

// GET /api/employees — list all employees
router.get('/', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT * FROM employees ORDER BY employee_id ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error('Error fetching employees:', err);
    res.status(500).json({ error: 'Failed to fetch employees' });
  }
});

// POST /api/employees/upload — upsert array of employee records from parsed Excel/CSV
router.post('/upload', async (req, res) => {
  const { employees, replace } = req.body; // replace=true clears table first
  if (!Array.isArray(employees) || employees.length === 0) {
    return res.status(400).json({ error: 'employees array is required' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (replace) {
      await conn.query('DELETE FROM employees');
    }

    let inserted = 0;
    let updated = 0;

    for (const emp of employees) {
      const empId = String(emp.employee_id || '').trim();
      const fullName = String(emp.full_name || '').trim();
      if (!empId || !fullName) continue;

      const [existing] = await conn.query(
        'SELECT id FROM employees WHERE employee_id = ?',
        [empId]
      );

      if (existing.length > 0) {
        await conn.query(
          `UPDATE employees SET full_name=?, position=?, division=?, department=?, work_location=?, updated_at=NOW()
           WHERE employee_id=?`,
          [fullName, emp.position || null, emp.division || null, emp.department || null, emp.work_location || null, empId]
        );
        updated++;
      } else {
        await conn.query(
          `INSERT INTO employees (employee_id, full_name, position, division, department, work_location)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [empId, fullName, emp.position || null, emp.division || null, emp.department || null, emp.work_location || null]
        );
        inserted++;
      }
    }

    await conn.commit();
    res.json({ message: `Upload complete: ${inserted} inserted, ${updated} updated`, inserted, updated });
  } catch (err) {
    await conn.rollback();
    console.error('Error uploading employees:', err);
    res.status(500).json({ error: 'Failed to upload employees' });
  } finally {
    conn.release();
  }
});

// DELETE /api/employees — remove all employee records
router.delete('/', async (req, res) => {
  try {
    await pool.query('DELETE FROM employees');
    res.json({ message: 'All employee records deleted' });
  } catch (err) {
    console.error('Error deleting employees:', err);
    res.status(500).json({ error: 'Failed to delete employees' });
  }
});

module.exports = router;
