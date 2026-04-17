const express = require('express');
const router = express.Router();
const pool = require('../config/db');

const PRODUCT_FIELDS = ['fish_name', 'size', 'bulk_weight_kg', 'type', 'glazing', 'order_code'];
const LOT_FIELDS = ['cs_in_date', 'sticker', 'remark', 'st_no', 'production_date', 'expiration_date'];

function parseLotNoNumeric(raw) {
  if (raw == null || raw === '') return { value: null };
  const s = String(raw).trim();
  if (!s) return { value: null };
  if (!/^\d+$/.test(s)) return { error: 'Lot No (numeric) must contain only digits' };
  return { value: s };
}

// ── PATCH /cell — update a single cell value ─────────────────────────
router.patch('/cell', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { lot_id, location_id, field, value } = req.body;
    if (!lot_id || !field) return res.status(400).json({ error: 'lot_id and field required' });

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
      await conn.query(`UPDATE products SET \`${field}\` = ? WHERE id = ?`,
        [value === '' ? null : value, row.product_id]);
      return res.json({ ok: true, product_id: row.product_id });
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
      const [existing] = await conn.query(
        'SELECT id FROM locations WHERE line_place = ? AND id != ?', [code, location_id]);
      if (existing.length > 0) {
        await conn.query(
          'UPDATE movements SET location_id = ? WHERE lot_id = ? AND location_id = ?',
          [existing[0].id, lot_id, location_id]);
        return res.json({ ok: true, new_location_id: existing[0].id });
      }
      await conn.query('UPDATE locations SET line_place = ? WHERE id = ?', [code, location_id]);
      return res.json({ ok: true });
    }

    if (field === 'stack_no' || field === 'stack_total') {
      await conn.query(`UPDATE locations SET \`${field}\` = ? WHERE id = ?`,
        [parseInt(value) || 0, location_id]);
      return res.json({ ok: true });
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
      await conn.query('DELETE FROM withdraw_items WHERE lot_id = ?', [lot_id]);
      await conn.query('DELETE FROM lots WHERE id = ?', [lot_id]);
    }

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

    const locCode = (initial.line_place || `NEW-${Date.now()}`).toUpperCase().trim();
    let locationId;
    const [el] = await conn.query('SELECT id FROM locations WHERE line_place = ?', [locCode]);
    if (el.length) {
      locationId = el[0].id;
    } else {
      const [lr] = await conn.query(
        'INSERT INTO locations (line_place, stack_no, stack_total) VALUES (?,?,?)',
        [locCode, initial.stack_no || 1, initial.stack_total || 1]);
      locationId = lr.insertId;
    }

    const lotNo = `MAN-${Date.now()}`;
    const csIn = initial.cs_in_date || new Date().toISOString().split('T')[0];
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
      'SELECT * FROM inventory_view WHERE lot_id = ? AND location_id = ?', [lotId, locationId]);
    res.json({ ok: true, row: nr[0] || null });
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

      const [existing] = await conn.query(
        'SELECT id FROM locations WHERE line_place = ? AND id != ?', [code, old_location_id]);

      if (existing.length > 0) {
        await conn.query(
          'UPDATE movements SET location_id = ? WHERE lot_id = ? AND location_id = ?',
          [existing[0].id, lot_id, old_location_id]);
      } else {
        const [locCheck] = await conn.query(
          'SELECT COUNT(*) as c FROM movements WHERE location_id = ? AND lot_id != ?',
          [old_location_id, lot_id]);

        if (locCheck[0].c === 0) {
          await conn.query('UPDATE locations SET line_place = ? WHERE id = ?', [code, old_location_id]);
        } else {
          const [nl] = await conn.query(
            'INSERT INTO locations (line_place, stack_no, stack_total) VALUES (?, 1, 1)', [code]);
          await conn.query(
            'UPDATE movements SET location_id = ? WHERE lot_id = ? AND location_id = ?',
            [nl.insertId, lot_id, old_location_id]);
        }
      }
      updated++;
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
