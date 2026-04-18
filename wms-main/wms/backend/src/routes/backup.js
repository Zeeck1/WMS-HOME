const express = require('express');
const router = express.Router();
const mysql = require('mysql2/promise');
const pool = require('../config/db');
const { bangkokYYYYMMDD, bangkokHHMM, bangkokLocaleString } = require('../utils/bangkokTime');
const multer = require('multer');
const { authMiddleware, superadminOnly } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

const DATA_TABLES = [
  'products',
  'locations',
  'lots',
  'movements',
  'withdraw_requests',
  'withdraw_items',
  'customers',
  'customer_deposits',
  'customer_deposit_items',
  'customer_withdrawals',
  'customer_withdrawal_items',
  'import_shipments',
  'import_items',
  'import_stock_outs',
  'import_expenses',
  'users',
  'user_permissions',
  'app_settings',
  'oac_checks',
  'oac_check_items',
  'ck_knowledge_entries',
];

const NUMERIC_TYPES = new Set([
  0,    // DECIMAL
  1,    // TINY
  2,    // SHORT
  3,    // LONG
  4,    // FLOAT
  5,    // DOUBLE
  8,    // LONGLONG
  9,    // INT24
  246,  // NEWDECIMAL
]);

function getDbConfig() {
  const connectionUrl = process.env.DB_URL || process.env.DATABASE_URL || process.env.MYSQL_URL;
  if (connectionUrl) {
    const parsed = new URL(connectionUrl);
    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username || process.env.DB_USER || process.env.MYSQLUSER || 'root'),
      password: decodeURIComponent(parsed.password || process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || ''),
      database: decodeURIComponent((parsed.pathname || '').replace(/^\//, '')) || process.env.DB_NAME || process.env.MYSQLDATABASE || 'wms_db'
    };
  }
  return {
    host: process.env.DB_HOST || process.env.MYSQLHOST || 'localhost',
    port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),
    user: process.env.DB_USER || process.env.MYSQLUSER || 'root',
    password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || '',
    database: process.env.DB_NAME || process.env.MYSQLDATABASE || 'wms_db'
  };
}

function escapeString(str) {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\x00/g, '\\0')
    .replace(/\x1a/g, '\\Z');
}

function escapeValue(val, isNumericCol) {
  if (val === null || val === undefined) return 'NULL';

  if (isNumericCol) {
    if (val === '' || val === null) return 'NULL';
    return String(val);
  }

  if (typeof val === 'number') return String(val);

  if (Buffer.isBuffer(val)) return `X'${val.toString('hex')}'`;

  // JSON columns: mysql2 returns parsed JS objects/arrays — serialize back to JSON text
  if (typeof val === 'object' && !(val instanceof Date)) {
    return `'${escapeString(JSON.stringify(val))}'`;
  }

  return `'${escapeString(String(val))}'`;
}

// GET /api/backup/export
router.get('/export', authMiddleware, superadminOnly, async (req, res) => {
  let conn;
  try {
    conn = await pool.getConnection();
    const dbName = (await conn.query('SELECT DATABASE() AS db'))[0][0].db;
    const timestamp = `${bangkokYYYYMMDD()}_${bangkokHHMM().replace(':', '')}`;

    const parts = [];
    parts.push(`-- WMS Database Backup`);
    parts.push(`-- Database: ${dbName}`);
    parts.push(`-- Generated: ${bangkokLocaleString()}`);
    parts.push(`-- ═══════════════════════════════════════════════\n`);
    parts.push(`SET FOREIGN_KEY_CHECKS = 0;`);
    parts.push(`SET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n`);

    for (const table of DATA_TABLES) {
      const [tableCheck] = await conn.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [dbName, table]
      );
      if (tableCheck[0].cnt === 0) continue;

      const [createResult] = await conn.query(`SHOW CREATE TABLE \`${table}\``);
      const createStmt = createResult[0]['Create Table'] || createResult[0]['Create View'];
      if (!createStmt) continue;

      parts.push(`DROP TABLE IF EXISTS \`${table}\`;`);
      parts.push(`${createStmt};\n`);

      const [rows, fields] = await conn.query(`SELECT * FROM \`${table}\``);
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      const colList = columns.map(c => `\`${c}\``).join(', ');

      const numericFlags = columns.map(colName => {
        const f = fields.find(fd => fd.name === colName);
        return f ? NUMERIC_TYPES.has(f.columnType) : false;
      });

      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        const valueRows = batch.map(row => {
          const vals = columns.map((c, idx) => escapeValue(row[c], numericFlags[idx])).join(', ');
          return `(${vals})`;
        });
        parts.push(`INSERT INTO \`${table}\` (${colList}) VALUES\n${valueRows.join(',\n')};\n`);
      }
    }

    parts.push(`SET FOREIGN_KEY_CHECKS = 1;`);
    parts.push(`-- End of backup`);

    const sql = parts.join('\n');

    res.setHeader('Content-Type', 'application/sql; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="wms_backup_${timestamp}.sql"`);
    res.send(sql);
  } catch (error) {
    console.error('Backup export error:', error);
    res.status(500).json({ error: 'Failed to create backup', details: error.message });
  } finally {
    if (conn) conn.release();
  }
});

// POST /api/backup/import
router.post('/import', authMiddleware, superadminOnly, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const ext = (req.file.originalname || '').toLowerCase();
  if (!ext.endsWith('.sql')) {
    return res.status(400).json({ error: 'Only .sql files are accepted' });
  }

  let conn;
  try {
    const sqlContent = req.file.buffer.toString('utf-8');

    conn = await mysql.createConnection({
      ...getDbConfig(),
      multipleStatements: true,
      dateStrings: true,
    });

    // Split into per-table sections so one failed table doesn't abort everything.
    // Sections are delimited by "DROP TABLE IF EXISTS" lines.
    const sections = [];
    let current = [];

    for (const line of sqlContent.split('\n')) {
      if (line.startsWith('DROP TABLE IF EXISTS') && current.length > 0) {
        sections.push(current.join('\n'));
        current = [];
      }
      current.push(line);
    }
    if (current.length > 0) {
      sections.push(current.join('\n'));
    }

    let executed = 0;
    let tableErrors = [];

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed || trimmed === '-- End of backup') continue;
      try {
        await conn.query(trimmed);
        executed++;
      } catch (err) {
        const tableMatch = trimmed.match(/DROP TABLE IF EXISTS `(\w+)`/);
        const tableName = tableMatch ? tableMatch[1] : '(header)';
        tableErrors.push({ table: tableName, error: err.sqlMessage || err.message });
        console.error(`Backup import error for ${tableName}:`, err.sqlMessage || err.message);
      }
    }

    try { await conn.query('SET FOREIGN_KEY_CHECKS = 1'); } catch (_) {}

    res.json({
      message: tableErrors.length === 0 ? 'Backup restored successfully' : 'Backup restored with some errors',
      sections_executed: executed,
      errors: tableErrors.length > 0 ? tableErrors : undefined,
      error_count: tableErrors.length,
      file: req.file.originalname,
      size_kb: Math.round(req.file.size / 1024),
    });
  } catch (error) {
    console.error('Backup import error:', error);
    const msg = error.sqlMessage || error.message || 'Unknown error';
    res.status(500).json({ error: 'Failed to restore backup', details: msg });
  } finally {
    if (conn) {
      try { await conn.end(); } catch (_) {}
    }
  }
});

module.exports = router;
