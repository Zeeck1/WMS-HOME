const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { bangkokYYYYMMDD } = require('../utils/bangkokTime');
const {
  hardDeleteLocationIfUnused,
  purgeDuplicateLocationsForLineStack,
  pruneLocationMasterAfterStockRemoved,
} = require('../utils/locationMaster');

const PRODUCT_FIELDS = ['fish_name', 'size', 'bulk_weight_kg', 'type', 'glazing', 'order_code'];
const LOT_FIELDS = ['cs_in_date', 'sticker', 'remark', 'st_no', 'production_date', 'expiration_date'];

function parseLotNoNumeric(raw) {
  if (raw == null || raw === '') return { value: null };
  const s = String(raw).trim();
  if (!s) return { value: null };
  if (!/^\d+$/.test(s)) return { error: 'Lot No (numeric) must contain only digits' };
  return { value: s };
}

function parsePositiveInt(raw, label) {
  const n = parseInt(String(raw ?? '').trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return { error: `${label} must be a positive whole number (1 or greater)` };
  }
  return { value: n };
}

/**
 * One location row per (line_place, stack_no).
 * Same line with different stacks = separate locations; same stack = shared location (many lots OK).
 * Location Master page still shows one row per line (latest stack) — see locations route.
 */
async function syncLocationForLine(conn, linePlace, stackNo, stackTotal, preferLocationId = null) {
  const code = (linePlace || '').toString().toUpperCase().trim();
  if (!code) return { error: 'Line / Place is required' };

  const stackParsed = parsePositiveInt(stackNo, 'Stack No');
  if (stackParsed.error) return { error: stackParsed.error };
  const totalParsed = parsePositiveInt(stackTotal ?? stackParsed.value, 'Stack Total');
  if (totalParsed.error) return { error: totalParsed.error };

  if (preferLocationId) {
    const [pref] = await conn.query(
      'SELECT id, line_place, stack_no FROM locations WHERE id = ?',
      [preferLocationId]
    );
    if (
      pref[0]
      && String(pref[0].line_place || '').toUpperCase().trim() === code
      && Number(pref[0].stack_no) === stackParsed.value
    ) {
      await conn.query(
        `UPDATE locations SET line_place = ?, stack_total = ?, is_active = 1, updated_at = NOW()
         WHERE id = ?`,
        [code, totalParsed.value, preferLocationId]
      );
      await purgeDuplicateLocationsForLineStack(conn, preferLocationId, code, stackParsed.value);
      return {
        locationId: preferLocationId,
        stack_no: stackParsed.value,
        stack_total: totalParsed.value,
        line_place: code,
      };
    }
  }

  const [exact] = await conn.query(
    `SELECT id FROM locations
     WHERE UPPER(TRIM(line_place)) = ? AND stack_no = ?
     ORDER BY is_active DESC, updated_at DESC, id ASC`,
    [code, stackParsed.value]
  );

  if (exact.length > 0) {
    const keeperId = exact[0].id;
    await conn.query(
      `UPDATE locations SET line_place = ?, stack_total = ?, is_active = 1, updated_at = NOW()
       WHERE id = ?`,
      [code, totalParsed.value, keeperId]
    );
    await purgeDuplicateLocationsForLineStack(conn, keeperId, code, stackParsed.value);
    return {
      locationId: keeperId,
      stack_no: stackParsed.value,
      stack_total: totalParsed.value,
      line_place: code,
    };
  }

  try {
    const [ins] = await conn.query(
      'INSERT INTO locations (line_place, stack_no, stack_total, is_active) VALUES (?, ?, ?, 1)',
      [code, stackParsed.value, totalParsed.value]
    );
    return {
      locationId: ins.insertId,
      stack_no: stackParsed.value,
      stack_total: totalParsed.value,
      line_place: code,
    };
  } catch (e) {
    // DB still has the old line-only unique key (migration pending) — overwrite that line's row
    if (e.code === 'ER_DUP_ENTRY') {
      const [row] = await conn.query(
        `SELECT id FROM locations WHERE UPPER(TRIM(line_place)) = ?
         ORDER BY is_active DESC, updated_at DESC, id ASC LIMIT 1`,
        [code]
      );
      if (row.length > 0) {
        await conn.query(
          `UPDATE locations SET stack_no = ?, stack_total = ?, is_active = 1, updated_at = NOW()
           WHERE id = ?`,
          [stackParsed.value, totalParsed.value, row[0].id]
        );
        return {
          locationId: row[0].id,
          stack_no: stackParsed.value,
          stack_total: totalParsed.value,
          line_place: code,
        };
      }
    }
    throw e;
  }
}

/** Sync Location Master row for this line; move lot only if location id changes. */
async function moveLotToStackLocation(conn, lotId, fromLocationId, linePlace, stackNo, stackTotal) {
  const resolved = await syncLocationForLine(conn, linePlace, stackNo, stackTotal, fromLocationId);
  if (resolved.error) return resolved;

  const targetId = resolved.locationId;
  if (targetId !== fromLocationId) {
    await conn.query(
      'UPDATE movements SET location_id = ? WHERE lot_id = ? AND location_id = ?',
      [targetId, lotId, fromLocationId]
    );
    await hardDeleteLocationIfUnused(conn, fromLocationId);
  }
  return {
    ...resolved,
    new_location_id: targetId !== fromLocationId ? targetId : null,
  };
}

/**
 * Prevent cross-row data flips when editing product fields from Manual page.
 * If this lot shares a product row with other lots, clone the product and
 * re-point only this lot before applying the edit.
 */
async function ensureLotOwnsEditableProduct(conn, lotId, productId) {
  if (!lotId || !productId) return productId;
  const [shared] = await conn.query(
    'SELECT id FROM lots WHERE product_id = ? AND id != ? LIMIT 1',
    [productId, lotId]
  );
  if (shared.length === 0) return productId;

  const [ins] = await conn.query(
    `INSERT INTO products (fish_name, size, bulk_weight_kg, type, glazing, stock_type, order_code)
     SELECT fish_name, size, bulk_weight_kg, type, glazing, stock_type, order_code
     FROM products WHERE id = ?`,
    [productId]
  );
  const newProductId = ins.insertId;
  await conn.query('UPDATE lots SET product_id = ? WHERE id = ?', [newProductId, lotId]);
  return newProductId;
}

// ── PATCH /cell — update a single cell value ─────────────────────────
router.patch('/cell', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { lot_id, location_id, import_item_id, field, value } = req.body;
    if (!field) return res.status(400).json({ error: 'field required' });

    // Import shipment rows (no lot/location)
    if (import_item_id) {
      const impId = parseInt(import_item_id, 10);
      if (!impId) return res.status(400).json({ error: 'Invalid import_item_id' });
      const [items] = await conn.query('SELECT id FROM import_items WHERE id = ?', [impId]);
      if (!items.length) return res.status(404).json({ error: 'Import item not found' });

      if (field === 'stack_no') {
        const stackVal = String(value ?? '').trim();
        if (!stackVal) return res.status(400).json({ error: 'Stack No cannot be empty' });
        await conn.query('UPDATE import_items SET lines = ? WHERE id = ?', [stackVal, impId]);
        return res.json({ ok: true });
      }
      if (field === 'line_place') {
        const lineVal = String(value ?? '').trim();
        if (!lineVal) return res.status(400).json({ error: 'Line cannot be empty' });
        await conn.query('UPDATE import_items SET lines = ? WHERE id = ?', [lineVal, impId]);
        return res.json({ ok: true });
      }
      if (['fish_name', 'size', 'remark'].includes(field)) {
        const col = field === 'fish_name' ? 'item_name' : field;
        await conn.query(`UPDATE import_items SET \`${col}\` = ? WHERE id = ?`, [value === '' ? null : value, impId]);
        return res.json({ ok: true });
      }
      if (field === 'hand_on_balance_mc') {
        return res.status(400).json({ error: 'Adjust import balance from Import Shipment detail' });
      }
      return res.status(400).json({ error: `Field not editable for import rows: ${field}` });
    }

    if (!lot_id) return res.status(400).json({ error: 'lot_id required' });

    const [inv] = await conn.query(
      'SELECT * FROM inventory_view WHERE lot_id = ? AND location_id = ?',
      [lot_id, location_id]
    );
    let row = inv[0];
    if (!row) {
      const [lr] = await conn.query(
        `SELECT l.product_id, p.bulk_weight_kg FROM lots l JOIN products p ON l.product_id = p.id WHERE l.id = ?`,
        [lot_id]
      );
      if (!lr[0]) return res.status(404).json({ error: 'Row not found' });
      row = { product_id: lr[0].product_id, lot_id, location_id, bulk_weight_kg: lr[0].bulk_weight_kg, hand_on_balance_mc: 0 };
    }

    if (PRODUCT_FIELDS.includes(field)) {
      await conn.beginTransaction();
      try {
        const editableProductId = await ensureLotOwnsEditableProduct(conn, lot_id, row.product_id);
        await conn.query(
          `UPDATE products SET \`${field}\` = ? WHERE id = ?`,
          [value === '' ? null : value, editableProductId]
        );
        await conn.commit();
        return res.json({ ok: true, product_id: editableProductId });
      } catch (e) {
        await conn.rollback();
        throw e;
      }
    }

    if (field === 'lot_no_numeric') {
      const parsed = parseLotNoNumeric(value);
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      await conn.query('UPDATE lots SET lot_no_numeric = ? WHERE id = ?', [parsed.value, lot_id]);
      return res.json({ ok: true });
    }

    if (LOT_FIELDS.includes(field)) {
      await conn.query(`UPDATE lots SET \`${field}\` = ? WHERE id = ?`,
        [value === '' ? null : value, lot_id]);
      return res.json({ ok: true });
    }

    if (field === 'line_place') {
      const code = (value || '').toString().toUpperCase().trim();
      if (!code) return res.status(400).json({ error: 'Location cannot be empty' });
      const [locRow] = await conn.query(
        'SELECT line_place, stack_no, stack_total FROM locations WHERE id = ?',
        [location_id]
      );
      if (!locRow.length) return res.status(404).json({ error: 'Location not found' });
      const moved = await moveLotToStackLocation(
        conn,
        lot_id,
        location_id,
        code,
        locRow[0].stack_no,
        locRow[0].stack_total
      );
      if (moved.error) return res.status(400).json({ error: moved.error });
      return res.json({
        ok: true,
        new_location_id: moved.new_location_id,
        stack_no: moved.stack_no,
        stack_total: moved.stack_total,
        line_place: moved.line_place,
      });
    }

    if (field === 'stack_no') {
      if (!location_id) return res.status(400).json({ error: 'location_id required to update stack' });
      const parsed = parsePositiveInt(value, 'Stack No');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const [locRow] = await conn.query(
        'SELECT line_place, stack_total FROM locations WHERE id = ?',
        [location_id]
      );
      if (!locRow.length) return res.status(404).json({ error: 'Location not found' });
      const moved = await moveLotToStackLocation(
        conn,
        lot_id,
        location_id,
        locRow[0].line_place,
        parsed.value,
        locRow[0].stack_total
      );
      if (moved.error) return res.status(400).json({ error: moved.error });
      return res.json({
        ok: true,
        new_location_id: moved.new_location_id,
        stack_no: moved.stack_no,
        stack_total: moved.stack_total,
      });
    }

    if (field === 'stack_total') {
      if (!location_id) return res.status(400).json({ error: 'location_id required to update stack total' });
      const parsed = parsePositiveInt(value, 'Stack Total');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const [locRow] = await conn.query(
        'SELECT line_place, stack_no FROM locations WHERE id = ?',
        [location_id]
      );
      if (!locRow.length) return res.status(404).json({ error: 'Location not found' });
      const synced = await syncLocationForLine(
        conn,
        locRow[0].line_place,
        locRow[0].stack_no,
        parsed.value,
        location_id
      );
      if (synced.error) return res.status(400).json({ error: synced.error });
      const moved = await moveLotToStackLocation(
        conn,
        lot_id,
        location_id,
        synced.line_place,
        synced.stack_no,
        synced.stack_total
      );
      if (moved.error) return res.status(400).json({ error: moved.error });
      return res.json({
        ok: true,
        new_location_id: moved.new_location_id,
        stack_no: synced.stack_no,
        stack_total: synced.stack_total,
      });
    }

    if (field === 'hand_on_balance_mc') {
      const newMc = parseInt(value) || 0;
      const curMc = Number(row.hand_on_balance_mc) || 0;
      const diff = newMc - curMc;
      if (diff !== 0) {
        const kg = Number(row.bulk_weight_kg) || 0;
        await conn.query(
          `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, created_by)
           VALUES (?, ?, ?, ?, ?, 'MANUAL-ADJUST', 'manual')`,
          [lot_id, location_id, Math.abs(diff), Math.abs(diff) * kg, diff > 0 ? 'IN' : 'OUT']);
      }
      if (newMc <= 0) {
        await pruneLocationMasterAfterStockRemoved(conn, location_id);
      }
      return res.json({ ok: true });
    }

    res.status(400).json({ error: `Unknown field: ${field}` });
  } catch (err) {
    console.error('Manual cell error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── DELETE /row — delete a row ───────────────────────────────────────
router.delete('/row', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const lot_id = parseInt(req.query.lot_id);
    const location_id = parseInt(req.query.location_id);
    if (!lot_id || !location_id) return res.status(400).json({ error: 'lot_id and location_id required' });

    await conn.beginTransaction();
    await conn.query('DELETE FROM movements WHERE lot_id = ? AND location_id = ?', [lot_id, location_id]);

    const [rem] = await conn.query('SELECT COUNT(*) as c FROM movements WHERE lot_id = ?', [lot_id]);
    if (rem[0].c === 0) {
      const { deleteWithdrawItemsForLotExcludingFinished } = require('../utils/withdrawItemSnapshot');
      await deleteWithdrawItemsForLotExcludingFinished(conn, lot_id);
      await conn.query('DELETE FROM lots WHERE id = ?', [lot_id]);
    }

    await pruneLocationMasterAfterStockRemoved(conn, location_id);

    await conn.commit();
    res.json({ ok: true });
  } catch (err) {
    await conn.rollback();
    console.error('Manual row delete error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── POST /row — add a new blank row (or duplicate with initial data) ─
router.post('/row', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { stock_type = 'BULK', initial = {} } = req.body;
    const lnn = parseLotNoNumeric(initial.lot_no_numeric);
    if (lnn.error) return res.status(400).json({ error: lnn.error });
    await conn.beginTransaction();

    const [pr] = await conn.query(
      'INSERT INTO products (fish_name, size, bulk_weight_kg, type, glazing, stock_type, order_code) VALUES (?,?,?,?,?,?,?)',
      [initial.fish_name || '(new)', initial.size || '-', initial.bulk_weight_kg || 0,
       initial.type || null, initial.glazing || null, stock_type, initial.order_code || null]);
    const productId = pr.insertId;

    const locResolved = await syncLocationForLine(
      conn,
      initial.line_place || `NEW-${Date.now()}`,
      initial.stack_no ?? 1,
      initial.stack_total ?? 1
    );
    if (locResolved.error) {
      await conn.rollback();
      return res.status(400).json({ error: locResolved.error });
    }
    const locationId = locResolved.locationId;

    const lotNo = `MAN-${Date.now()}`;
    const csIn = initial.cs_in_date || bangkokYYYYMMDD();
    const productionDate = initial.production_date || csIn;
    const expirationDate = initial.expiration_date || null;
    const [lt] = await conn.query(
      'INSERT INTO lots (lot_no, lot_no_numeric, cs_in_date, sticker, product_id, remark, st_no, production_date, expiration_date) VALUES (?,?,?,?,?,?,?,?,?)',
      [lotNo, lnn.value, csIn, initial.sticker || null, productId, initial.remark || null, initial.st_no || null, productionDate, expirationDate]);
    const lotId = lt.insertId;

    const mc = initial.hand_on_balance_mc != null ? (parseInt(initial.hand_on_balance_mc) || 1) : 1;
    await conn.query(
      `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, created_by)
       VALUES (?,?,?,?, 'IN', 'MANUAL-NEW', 'manual')`,
      [lotId, locationId, mc, mc * (initial.bulk_weight_kg || 0)]);

    await conn.commit();

    const [nr] = await conn.query(
      'SELECT * FROM inventory_view WHERE lot_id = ? AND location_id = ?', [lotId, locationId]
    );
    const row = nr[0] || null;
    if (row) {
      const [loc] = await conn.query(
        'SELECT stack_no, stack_total, line_place FROM locations WHERE id = ?',
        [locationId]
      );
      if (loc[0]) {
        row.stack_no = loc[0].stack_no;
        row.stack_total = loc[0].stack_total;
        row.line_place = loc[0].line_place;
      }
    }
    res.json({ ok: true, row, stack_no: row?.stack_no, stack_total: row?.stack_total });
  } catch (err) {
    await conn.rollback();
    console.error('Manual row create error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── PUT /reformat — bulk reassign locations within a line ────────────
router.put('/reformat', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { changes } = req.body;
    if (!Array.isArray(changes) || changes.length === 0)
      return res.status(400).json({ error: 'changes array required' });

    await conn.beginTransaction();
    let updated = 0;

    for (const { lot_id, old_location_id, new_line_place } of changes) {
      if (!lot_id || !old_location_id || !new_line_place) continue;
      const code = new_line_place.toUpperCase().trim();
      const [locRow] = await conn.query(
        'SELECT stack_no, stack_total FROM locations WHERE id = ?',
        [old_location_id]
      );
      if (!locRow.length) continue;
      const moved = await moveLotToStackLocation(
        conn,
        lot_id,
        old_location_id,
        code,
        locRow[0].stack_no,
        locRow[0].stack_total
      );
      if (!moved.error) updated++;
    }

    await conn.commit();
    res.json({ ok: true, updated });
  } catch (err) {
    await conn.rollback();
    console.error('Reformat error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
