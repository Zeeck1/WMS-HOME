const WITHDRAW_DEPARTMENTS = ['PK', 'RM', 'Branch.05 (SM)'];

function normalizeWithdrawDepartments(input) {
  const arr = Array.isArray(input) ? input : [];
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const d = String(raw || '').trim();
    if (!WITHDRAW_DEPARTMENTS.includes(d)) continue;
    if (seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  return out;
}

async function ensureUserWithdrawDepartmentsTable(conn) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS user_withdraw_departments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      department ENUM('PK','RM','Branch.05 (SM)') NOT NULL,
      UNIQUE KEY uq_user_withdraw_department (user_id, department),
      INDEX idx_withdraw_dept_user (user_id),
      CONSTRAINT fk_user_withdraw_departments_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);
}

/**
 * No rows = unrestricted (all departments), so existing users keep working
 * until a superadmin explicitly applies limits.
 */
async function getUserAllowedWithdrawDepartments(db, userId, role = 'user') {
  if (!userId) return [...WITHDRAW_DEPARTMENTS];
  if (role === 'superadmin') return [...WITHDRAW_DEPARTMENTS];
  const [rows] = await db.query(
    'SELECT department FROM user_withdraw_departments WHERE user_id = ? ORDER BY id ASC',
    [userId]
  );
  if (!rows.length) return [...WITHDRAW_DEPARTMENTS];
  return normalizeWithdrawDepartments(rows.map((r) => r.department));
}

async function setUserAllowedWithdrawDepartments(conn, userId, departments) {
  const normalized = normalizeWithdrawDepartments(departments);
  await conn.query('DELETE FROM user_withdraw_departments WHERE user_id = ?', [userId]);
  if (normalized.length > 0) {
    const values = normalized.map((d) => [Number(userId), d]);
    await conn.query(
      'INSERT INTO user_withdraw_departments (user_id, department) VALUES ?',
      [values]
    );
  }
  return normalized;
}

module.exports = {
  WITHDRAW_DEPARTMENTS,
  normalizeWithdrawDepartments,
  ensureUserWithdrawDepartmentsTable,
  getUserAllowedWithdrawDepartments,
  setUserAllowedWithdrawDepartments,
};
