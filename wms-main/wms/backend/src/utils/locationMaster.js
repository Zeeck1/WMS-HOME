/**
 * Remove location rows that are no longer referenced (after Manual sync merges stacks).
 */
async function hardDeleteLocationIfUnused(conn, locationId) {
  if (!locationId) return false;
  const [mov] = await conn.query(
    'SELECT COUNT(*) AS c FROM movements WHERE location_id = ?',
    [locationId]
  );
  if (Number(mov[0].c) > 0) return false;

  const [wi] = await conn.query(
    'SELECT COUNT(*) AS c FROM withdraw_items WHERE location_id = ?',
    [locationId]
  );
  if (Number(wi[0].c) > 0) return false;

  const [del] = await conn.query('DELETE FROM locations WHERE id = ?', [locationId]);
  return del.affectedRows > 0;
}

/** Re-point stock/withdrawals to keeper, then delete extra rows for the same line_place. */
async function purgeDuplicateLocationsForLine(conn, keeperId, linePlace) {
  const code = (linePlace || '').toString().toUpperCase().trim();
  if (!code || !keeperId) return 0;

  const [dupes] = await conn.query(
    'SELECT id FROM locations WHERE UPPER(TRIM(line_place)) = ? AND id != ?',
    [code, keeperId]
  );

  let removed = 0;
  for (const row of dupes) {
    await conn.query('UPDATE movements SET location_id = ? WHERE location_id = ?', [
      keeperId,
      row.id,
    ]);
    await conn.query('UPDATE withdraw_items SET location_id = ? WHERE location_id = ?', [
      keeperId,
      row.id,
    ]);
    if (await hardDeleteLocationIfUnused(conn, row.id)) removed += 1;
  }
  return removed;
}

/** Any lot still has positive MC at this line (Manual / Stock OUT inventory). */
async function linePlaceHasActiveStock(conn, linePlace) {
  const code = (linePlace || '').toString().toUpperCase().trim();
  if (!code) return false;
  const [rows] = await conn.query(
    `SELECT 1
     FROM movements m
     INNER JOIN locations loc ON m.location_id = loc.id
     WHERE UPPER(TRIM(loc.line_place)) = ?
     GROUP BY m.lot_id, m.location_id
     HAVING COALESCE(SUM(CASE WHEN m.movement_type = 'IN' THEN m.quantity_mc ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity_mc ELSE 0 END), 0) > 0
     LIMIT 1`,
    [code]
  );
  return rows.length > 0;
}

/**
 * After Manual delete row or Stock OUT to zero: remove line from Location Master.
 * Hard-delete if no movements left; otherwise hide (is_active=0) until re-added on Manual.
 */
async function pruneLocationMasterAfterStockRemoved(conn, locationId) {
  if (!locationId) return { removed: 0, deactivated: 0 };

  const [loc] = await conn.query(
    'SELECT id, line_place FROM locations WHERE id = ?',
    [locationId]
  );
  if (!loc.length) return { removed: 0, deactivated: 0 };

  if (await linePlaceHasActiveStock(conn, loc[0].line_place)) {
    return { removed: 0, deactivated: 0 };
  }

  const code = loc[0].line_place.toUpperCase().trim();
  const [lineLocs] = await conn.query(
    'SELECT id FROM locations WHERE UPPER(TRIM(line_place)) = ?',
    [code]
  );

  let removed = 0;
  let deactivated = 0;
  for (const row of lineLocs) {
    const [mov] = await conn.query(
      'SELECT COUNT(*) AS c FROM movements WHERE location_id = ?',
      [row.id]
    );
    if (Number(mov[0].c) === 0) {
      if (await hardDeleteLocationIfUnused(conn, row.id)) removed += 1;
    } else {
      await conn.query(
        'UPDATE locations SET is_active = 0, updated_at = NOW() WHERE id = ?',
        [row.id]
      );
      deactivated += 1;
    }
  }
  return { removed, deactivated };
}

/** Delete inactive / duplicate rows with no remaining references. */
async function purgeUnusedLocationRows(conn) {
  const [candidates] = await conn.query(`
    SELECT l.id
    FROM locations l
    LEFT JOIN movements m ON m.location_id = l.id
    LEFT JOIN withdraw_items wi ON wi.location_id = l.id
    WHERE m.id IS NULL AND wi.id IS NULL
  `);
  let removed = 0;
  for (const row of candidates) {
    if (await hardDeleteLocationIfUnused(conn, row.id)) removed += 1;
  }
  return removed;
}

module.exports = {
  hardDeleteLocationIfUnused,
  purgeDuplicateLocationsForLine,
  purgeUnusedLocationRows,
  linePlaceHasActiveStock,
  pruneLocationMasterAfterStockRemoved,
};
