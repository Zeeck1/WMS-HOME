/**
 * Employee login / Pending Approvals need users.employee_id + users.approval_status.
 * Uses SHOW COLUMNS (works on Railway MySQL where information_schema can be unreliable).
 */

async function usersHasColumn(conn, columnName) {
  const safeCol = String(columnName).replace(/[^a-zA-Z0-9_]/g, '');
  if (!safeCol) return false;
  const [rows] = await conn.query('SHOW COLUMNS FROM users LIKE ?', [safeCol]);
  return rows.length > 0;
}

async function ensureUsersAuthColumns(conn) {
  if (!(await usersHasColumn(conn, 'employee_id'))) {
    const alters = [
      'ALTER TABLE users ADD COLUMN employee_id VARCHAR(50) DEFAULT NULL AFTER display_name',
      'ALTER TABLE users ADD COLUMN employee_id VARCHAR(50) DEFAULT NULL',
    ];
    for (const sql of alters) {
      try {
        await conn.query(sql);
        console.log('  [auth-migration] Added employee_id to users');
        break;
      } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME' || e.errno === 1060) break;
        throw e;
      }
    }
  }

  if (!(await usersHasColumn(conn, 'approval_status'))) {
    const alters = [
      "ALTER TABLE users ADD COLUMN approval_status ENUM('pending','approved') DEFAULT NULL AFTER employee_id",
      "ALTER TABLE users ADD COLUMN approval_status ENUM('pending','approved') DEFAULT NULL",
    ];
    for (const sql of alters) {
      try {
        await conn.query(sql);
        console.log('  [auth-migration] Added approval_status to users');
        break;
      } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME' || e.errno === 1060) break;
        throw e;
      }
    }
  }

  if (!(await usersHasColumn(conn, 'employee_id')) || !(await usersHasColumn(conn, 'approval_status'))) {
    throw new Error('users table still missing employee_id or approval_status after migration');
  }

  await conn.query(`
    UPDATE users SET approval_status = 'approved'
    WHERE employee_id IS NOT NULL AND employee_id != '' AND is_active = 1
      AND (approval_status IS NULL OR approval_status = '')
  `);
  await conn.query(`
    UPDATE users SET approval_status = 'pending'
    WHERE employee_id IS NOT NULL AND employee_id != '' AND is_active = 0
      AND (approval_status IS NULL OR approval_status = '')
  `);
}

function isCollationJoinError(err) {
  const msg = String(err?.message || '').toLowerCase();
  return err?.code === 'ER_CANT_AGGREGATE_2COLLATIONS'
    || err?.errno === 1267
    || msg.includes('illegal mix of collations')
    || msg.includes('collation');
}

/** Pending list — join employees when possible; fallback to users-only on schema/collation issues. */
async function fetchPendingUsers(pool) {
  const joinSql = `
    SELECT u.id, u.username, u.display_name, u.employee_id, u.approval_status, u.created_at,
           e.position, e.division, e.department, e.work_location
    FROM users u
    LEFT JOIN employees e
      ON CONVERT(u.employee_id USING utf8mb4) = CONVERT(e.employee_id USING utf8mb4)
    WHERE u.approval_status = 'pending'
    ORDER BY u.created_at DESC
  `;
  const simpleSql = `
    SELECT id, username, display_name, employee_id, approval_status, created_at,
           NULL AS position, NULL AS division, NULL AS department, NULL AS work_location
    FROM users
    WHERE approval_status = 'pending'
    ORDER BY created_at DESC
  `;

  try {
    const [rows] = await pool.query(joinSql);
    return rows;
  } catch (err) {
    if (err.code === 'ER_BAD_FIELD_ERROR') return [];
    if (isCollationJoinError(err) || err.code === 'ER_NO_SUCH_TABLE') {
      const [rows] = await pool.query(simpleSql);
      return rows;
    }
    throw err;
  }
}

module.exports = {
  ensureUsersAuthColumns,
  fetchPendingUsers,
  usersHasColumn,
};
