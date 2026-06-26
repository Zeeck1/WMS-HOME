/**
 * Each lot must be able to own its own editable product so that editing one row's
 * fish name / size / glazing / KG never changes another lot that happened to share
 * the same product (see ensureLotOwnsEditableProduct in routes/manual.js).
 *
 * The legacy unique key uq_product (fish_name, size, type, glazing, stock_type, order_code)
 * blocked cloning a shared product (the clone briefly duplicates those exact fields), so
 * product-field edits on shared rows failed with ER_DUP_ENTRY and the row kept the old/other
 * product's values. Dedup on insert is still handled in app code (findOrCreateProduct), so the
 * DB-level unique key is safe to drop. Uses SHOW INDEX (reliable on hosted MySQL like Railway).
 */
async function ensureProductsAllowLotClones(conn) {
  const [idxRows] = await conn.query('SHOW INDEX FROM products');

  const uniqueIndexNames = new Set();
  for (const r of idxRows) {
    if (r.Key_name === 'PRIMARY') continue;
    if (Number(r.Non_unique) === 0) uniqueIndexNames.add(r.Key_name);
  }

  let dropped = false;
  for (const name of uniqueIndexNames) {
    const safeName = String(name).replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeName) continue;
    try {
      await conn.query(`ALTER TABLE products DROP INDEX \`${safeName}\``);
      console.log(`  [products] Dropped unique index ${safeName} (allow per-lot product clones)`);
      dropped = true;
    } catch (e) {
      console.error(`  [products] Could not drop index ${safeName}:`, e.message);
    }
  }
  return dropped;
}

module.exports = { ensureProductsAllowLotClones };
