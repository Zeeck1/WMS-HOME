const FORM_COLUMNS = [
  ['form_timeout_date', 'DATE NULL DEFAULT NULL'],
  ['form_timeout_start', 'TIME NULL DEFAULT NULL'],
  ['form_timeout_end', 'TIME NULL DEFAULT NULL'],
  ['form_notice', 'TEXT NULL'],
];

const ITEM_FORM_COLUMNS = [
  ['form_timeout_date', 'DATE NULL DEFAULT NULL'],
  ['form_timeout_start', 'TIME NULL DEFAULT NULL'],
  ['form_timeout_end', 'TIME NULL DEFAULT NULL'],
];

async function ensureWithdrawFormColumns(conn) {
  const [rows] = await conn.query('SHOW COLUMNS FROM withdraw_requests');
  const existing = new Set(rows.map((row) => String(row.Field).toLowerCase()));
  let changed = false;

  for (const [name, definition] of FORM_COLUMNS) {
    if (existing.has(name)) continue;
    await conn.query(`ALTER TABLE withdraw_requests ADD COLUMN \`${name}\` ${definition}`);
    changed = true;
  }
  const [itemRows] = await conn.query('SHOW COLUMNS FROM withdraw_items');
  const existingItemColumns = new Set(itemRows.map((row) => String(row.Field).toLowerCase()));
  for (const [name, definition] of ITEM_FORM_COLUMNS) {
    if (existingItemColumns.has(name)) continue;
    await conn.query(`ALTER TABLE withdraw_items ADD COLUMN \`${name}\` ${definition}`);
    changed = true;
  }
  return changed;
}

module.exports = { ensureWithdrawFormColumns };
