/**
 * Locations must be unique by (line_place, stack_no) so the Manual page can keep
 * separate stacks on the same line. Uses SHOW INDEX (reliable on hosted MySQL like
 * Railway, where information_schema checks can silently fail).
 */
async function ensureLocationsLineStackUnique(conn) {
  const [idxRows] = await conn.query('SHOW INDEX FROM locations');

  const byName = {};
  for (const r of idxRows) {
    const name = r.Key_name;
    if (!byName[name]) byName[name] = { nonUnique: Number(r.Non_unique), cols: [] };
    byName[name].cols[Number(r.Seq_in_index) - 1] = String(r.Column_name).toLowerCase();
  }

  const hasLineStackUnique = Object.values(byName).some(
    (i) => i.nonUnique === 0 && i.cols.join(',') === 'line_place,stack_no'
  );
  if (hasLineStackUnique) return false;

  // Merge exact duplicates (same line + same stack) before adding the unique key
  const [dupGroups] = await conn.query(`
    SELECT UPPER(TRIM(line_place)) AS lp, stack_no,
      GROUP_CONCAT(id ORDER BY is_active DESC, updated_at DESC, id ASC) AS ids
    FROM locations
    GROUP BY UPPER(TRIM(line_place)), stack_no
    HAVING COUNT(*) > 1
  `);
  for (const g of dupGroups) {
    const ids = String(g.ids).split(',').map((x) => parseInt(x, 10)).filter(Boolean);
    const keeperId = ids[0];
    for (let i = 1; i < ids.length; i++) {
      await conn.query('UPDATE movements SET location_id = ? WHERE location_id = ?', [keeperId, ids[i]]);
      try {
        await conn.query('UPDATE withdraw_items wi INNER JOIN withdraw_requests wr ON wr.id = wi.request_id SET wi.location_id = ? WHERE wi.location_id = ? AND wr.status != \'FINISHED\'', [keeperId, ids[i]]);
      } catch (e) {
        if (e.code !== 'ER_NO_SUCH_TABLE') throw e;
      }
      await conn.query('DELETE FROM locations WHERE id = ?', [ids[i]]);
    }
    console.log(`  [locations] Merged duplicate rows for ${g.lp} stack ${g.stack_no} -> id ${keeperId}`);
  }

  // Drop any unique index on line_place only (uq_line_place, legacy line_place, etc.)
  for (const [name, info] of Object.entries(byName)) {
    if (name === 'PRIMARY') continue;
    if (info.nonUnique === 0 && info.cols.join(',') === 'line_place') {
      const safeName = name.replace(/[^a-zA-Z0-9_]/g, '');
      try {
        await conn.query(`ALTER TABLE locations DROP INDEX \`${safeName}\``);
        console.log(`  [locations] Dropped line-only unique index ${safeName}`);
      } catch (e) {
        console.error(`  [locations] Could not drop index ${safeName}:`, e.message);
      }
    }
  }

  try {
    await conn.query('ALTER TABLE locations ADD UNIQUE KEY uq_line_place_stack (line_place, stack_no)');
    console.log('  [locations] Added uq_line_place_stack (line + stack unique)');
    return true;
  } catch (e) {
    if (e.code === 'ER_DUP_KEYNAME') return false;
    throw e;
  }
}

module.exports = { ensureLocationsLineStackUnique };
