// Server-side recovery: reset the Superadmin password when it has been forgotten.
// Usage: npm run reset:superadmin            -> password becomes 123
//        npm run reset:superadmin -- MyPass  -> password becomes MyPass
const bcrypt = require('bcryptjs');
const pool = require('../config/db');

const USERNAME = 'Superadmin';

async function main() {
  const newPassword = process.argv[2] || '123';
  const hash = await bcrypt.hash(newPassword, 10);

  const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [USERNAME]);
  if (rows.length === 0) {
    await pool.query(
      "INSERT INTO users (username, password_hash, display_name, role, is_active) VALUES (?, ?, 'Super Admin', 'superadmin', 1)",
      [USERNAME, hash]
    );
    console.log(`Created ${USERNAME} account.`);
  } else {
    await pool.query(
      "UPDATE users SET password_hash = ?, role = 'superadmin', is_active = 1, updated_at = NOW() WHERE id = ?",
      [hash, rows[0].id]
    );
    console.log(`Reset ${USERNAME} password.`);
  }

  console.log(`Login with username "${USERNAME}" and password "${newPassword}", then change it on the permission page.`);
}

main()
  .catch((err) => {
    console.error('Failed to reset Superadmin password:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
