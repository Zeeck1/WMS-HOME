const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const { bangkokYYYYMMDDCompact } = require('../utils/bangkokTime');
const { authMiddleware, superadminOnly } = require('../middleware/auth');

const WITHDRAW_DEPARTMENTS = ['PK', 'RM', 'Branch.05 (SM)'];

/** Compact segment for request_no (avoids spaces/special chars in WD-... codes). */
function departmentRequestCode(department) {
  if (department === 'Branch.05 (SM)') return 'B05SM';
  return department;
}

async function getImportItemBalanceMc(conn, importItemId) {
  const [rows] = await conn.query(
    `SELECT ii.id, ii.factory_mc, ii.wet_mc, ii.shipment_id,
            (IFNULL(ii.factory_mc, 0) - IFNULL((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ii.id), 0)) AS balance_mc
     FROM import_items ii WHERE ii.id = ?`,
    [importItemId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    balance_mc: Math.max(0, Number(r.balance_mc) || 0),
    wet_mc: Number(r.wet_mc) || 0,
    shipment_id: r.shipment_id
  };
}

// ─── GET all withdrawal requests ─────────────────────
router.get('/', async (req, res) => {
  try {
    const { department, status, date } = req.query;
    let sql = `
      SELECT wr.*,
        (SELECT COUNT(*) FROM withdraw_items wi WHERE wi.request_id = wr.id) AS item_count,
        (SELECT COALESCE(SUM(wi.requested_mc), 0) FROM withdraw_items wi WHERE wi.request_id = wr.id) AS total_requested_mc,
        (SELECT COALESCE(SUM(wi.quantity_mc), 0) FROM withdraw_items wi WHERE wi.request_id = wr.id) AS total_mc,
        (SELECT COALESCE(SUM(
          CASE
            WHEN wi.lot_id IS NOT NULL THEN wi.quantity_mc * IFNULL(p.bulk_weight_kg, 0)
            WHEN wi.import_item_id IS NOT NULL THEN wi.quantity_mc * IFNULL(imp.wet_mc, 0)
            ELSE 0
          END
        ), 0)
         FROM withdraw_items wi
         LEFT JOIN lots l ON wi.lot_id = l.id
         LEFT JOIN products p ON l.product_id = p.id
         LEFT JOIN import_items imp ON wi.import_item_id = imp.id
         WHERE wi.request_id = wr.id) AS total_kg
      FROM withdraw_requests wr
      WHERE 1=1
    `;
    const params = [];
    if (department) { sql += ' AND wr.department = ?'; params.push(department); }
    if (status) { sql += ' AND wr.status = ?'; params.push(status); }
    if (date) { sql += ' AND DATE(COALESCE(wr.withdraw_date, wr.created_at)) = ?'; params.push(date); }
    sql += ' ORDER BY wr.created_at DESC';
    const [rows] = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching withdrawals:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawals' });
  }
});

// ─── GET single withdrawal with items ────────────────
router.get('/:id', async (req, res) => {
  try {
    const [requests] = await pool.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    if (requests.length === 0) return res.status(404).json({ error: 'Request not found' });

    const [items] = await pool.query(`
      SELECT wi.*,
        COALESCE(p.fish_name, ii.item_name) AS fish_name,
        COALESCE(p.size, ii.size) AS size,
        COALESCE(p.bulk_weight_kg, ii.wet_mc) AS bulk_weight_kg,
        p.type,
        p.glazing,
        COALESCE(p.stock_type, IF(wi.import_item_id IS NULL, 'BULK', 'IMPORT')) AS stock_type,
        COALESCE(p.order_code, s.inv_no) AS order_code,
        l.lot_no, l.cs_in_date, l.sticker,
        COALESCE(loc.line_place, NULLIF(TRIM(ii.lines), '')) AS line_place,
        loc.stack_no, loc.stack_total,
        s.inv_no AS import_inv_no,
        CASE
          WHEN wi.lot_id IS NOT NULL THEN (
            SELECT
              COALESCE(SUM(CASE WHEN m2.movement_type = 'IN' THEN m2.quantity_mc ELSE 0 END), 0) -
              COALESCE(SUM(CASE WHEN m2.movement_type = 'OUT' THEN m2.quantity_mc ELSE 0 END), 0)
            FROM movements m2
            WHERE m2.lot_id = wi.lot_id AND m2.location_id = wi.location_id
          )
          WHEN wi.import_item_id IS NOT NULL THEN (
            SELECT IFNULL(ifi.factory_mc, 0) - IFNULL((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ifi.id), 0)
            FROM import_items ifi
            WHERE ifi.id = wi.import_item_id
          )
          ELSE NULL
        END AS hand_on_balance
      FROM withdraw_items wi
      LEFT JOIN lots l ON wi.lot_id = l.id
      LEFT JOIN products p ON l.product_id = p.id
      LEFT JOIN locations loc ON wi.location_id = loc.id
      LEFT JOIN import_items ii ON wi.import_item_id = ii.id
      LEFT JOIN import_shipments s ON ii.shipment_id = s.id
      WHERE wi.request_id = ?
    `, [req.params.id]);

    res.json({ ...requests[0], items });
  } catch (error) {
    console.error('Error fetching withdrawal:', error);
    res.status(500).json({ error: 'Failed to fetch withdrawal' });
  }
});

// ─── POST create a new withdrawal request ────────────
router.post('/', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { department, items, notes, requested_by, withdraw_date, request_time } = req.body;

    if (!department || !WITHDRAW_DEPARTMENTS.includes(department)) {
      await conn.rollback();
      return res.status(400).json({ error: 'Invalid department' });
    }
    if (!items || items.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'At least one item is required' });
    }

    const today = bangkokYYYYMMDDCompact();
    const [countRows] = await conn.query(
      `SELECT COUNT(*) AS cnt FROM withdraw_requests WHERE DATE(created_at) = CURDATE() AND department = ?`,
      [department]
    );
    const seq = String((countRows[0].cnt || 0) + 1).padStart(3, '0');
    const requestNo = `WD-${departmentRequestCode(department)}-${today}-${seq}`;

    const [result] = await conn.query(
      `INSERT INTO withdraw_requests (request_no, department, status, withdraw_date, request_time, notes, requested_by)
       VALUES (?, ?, 'PENDING', ?, ?, ?, ?)`,
      [requestNo, department, withdraw_date || null, request_time || null, notes || null, requested_by || 'system']
    );
    const requestId = result.insertId;

    for (const item of items) {
      const isImport = item.import_item_id != null;
      if (!isImport) {
        if (!item.lot_id || !item.location_id || !item.quantity_mc || item.quantity_mc <= 0) {
          await conn.rollback();
          return res.status(400).json({ error: 'Each item must have lot_id, location_id, and quantity_mc > 0' });
        }
        const [balance] = await conn.query(`
          SELECT
            COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity_mc ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN quantity_mc ELSE 0 END), 0) AS hand_on
          FROM movements WHERE lot_id = ? AND location_id = ?
        `, [item.lot_id, item.location_id]);

        if (item.quantity_mc > balance[0].hand_on) {
          await conn.rollback();
          return res.status(400).json({
            error: `Insufficient stock: requested ${item.quantity_mc} MC but only ${balance[0].hand_on} MC available`
          });
        }

        await conn.query(
          `INSERT INTO withdraw_items (request_id, import_item_id, lot_id, location_id, requested_mc, quantity_mc, weight_kg, production_process)
           VALUES (?, NULL, ?, ?, ?, ?, ?, ?)`,
          [requestId, item.lot_id, item.location_id, item.quantity_mc, item.quantity_mc, item.weight_kg || 0, item.production_process || null]
        );
        continue;
      }

      if (!item.import_item_id || !item.quantity_mc || item.quantity_mc <= 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Each import item must have import_item_id and quantity_mc > 0' });
      }

      const imp = await getImportItemBalanceMc(conn, item.import_item_id);
      if (!imp) {
        await conn.rollback();
        return res.status(400).json({ error: `Import item ${item.import_item_id} not found` });
      }
      if (item.quantity_mc > imp.balance_mc) {
        await conn.rollback();
        return res.status(400).json({
          error: `Insufficient import stock: requested ${item.quantity_mc} MC but only ${imp.balance_mc} MC available`
        });
      }

      const wKg = item.weight_kg != null && item.weight_kg !== ''
        ? Number(item.weight_kg)
        : item.quantity_mc * imp.wet_mc;

      await conn.query(
        `INSERT INTO withdraw_items (request_id, import_item_id, lot_id, location_id, requested_mc, quantity_mc, weight_kg, production_process)
         VALUES (?, ?, NULL, NULL, ?, ?, ?, ?)`,
        [requestId, item.import_item_id, item.quantity_mc, item.quantity_mc, wKg, item.production_process || null]
      );
    }

    await conn.commit();

    const [created] = await pool.query('SELECT * FROM withdraw_requests WHERE id = ?', [requestId]);
    res.status(201).json({ message: 'Withdrawal request created', request: created[0] });
  } catch (error) {
    await conn.rollback();
    console.error('Error creating withdrawal:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Duplicate request number. Please try again.' });
    }
    if (error.code === 'ER_NO_SUCH_COLUMN' || (error.message && error.message.includes('import_item_id'))) {
      return res.status(500).json({
        error: 'Database is missing import columns on withdraw_items. Restart the server to run migrations, or run init/migrate.'
      });
    }
    res.status(500).json({ error: 'Failed to create withdrawal request' });
  } finally {
    conn.release();
  }
});

// ─── PUT update items (edit quantities in PENDING state) ──
router.put('/:id/items', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      await conn.rollback();
      return res.status(400).json({ error: 'Items array is required' });
    }

    const [requests] = await conn.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    if (requests.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Request not found' });
    }
    if (requests[0].status !== 'PENDING') {
      await conn.rollback();
      return res.status(400).json({ error: 'Items can only be edited in PENDING status' });
    }

    for (const item of items) {
      if (!item.id || item.quantity_mc === undefined || item.quantity_mc < 0) {
        await conn.rollback();
        return res.status(400).json({ error: 'Each item must have id and quantity_mc >= 0' });
      }

      const [wiRows] = await conn.query('SELECT * FROM withdraw_items WHERE id = ? AND request_id = ?', [item.id, req.params.id]);
      if (wiRows.length === 0) continue;

      const wi = wiRows[0];
      const oldActual = Number(wi.quantity_mc);
      const newQty = Number(item.quantity_mc);

      if (item.quantity_mc === 0) {
        await conn.query('DELETE FROM withdraw_items WHERE id = ? AND request_id = ?', [item.id, req.params.id]);
        continue;
      }

      if (oldActual === newQty) continue;

      if (wi.import_item_id) {
        const imp = await getImportItemBalanceMc(conn, wi.import_item_id);
        if (!imp) {
          await conn.rollback();
          return res.status(400).json({ error: 'Import item not found' });
        }
        if (newQty > imp.balance_mc) {
          await conn.rollback();
          return res.status(400).json({
            error: `Cannot set ${newQty} MC — only ${imp.balance_mc} MC available in import stock`
          });
        }
        const weightKg = newQty * imp.wet_mc;
        await conn.query(
          'UPDATE withdraw_items SET quantity_mc = ?, weight_kg = ? WHERE id = ?',
          [newQty, weightKg, item.id]
        );
        continue;
      }

      const [balance] = await conn.query(`
        SELECT
          COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity_mc ELSE 0 END), 0) -
          COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN quantity_mc ELSE 0 END), 0) AS hand_on
        FROM movements WHERE lot_id = ? AND location_id = ?
      `, [wi.lot_id, wi.location_id]);

      if (item.quantity_mc > balance[0].hand_on) {
        await conn.rollback();
        return res.status(400).json({
          error: `Cannot set ${item.quantity_mc} MC — only ${balance[0].hand_on} MC available in stock`
        });
      }

      const [prodRows] = await conn.query(`
        SELECT p.bulk_weight_kg FROM lots l JOIN products p ON l.product_id = p.id WHERE l.id = ?
      `, [wi.lot_id]);
      const bulkKg = prodRows.length > 0 ? Number(prodRows[0].bulk_weight_kg) : 0;

      await conn.query(
        'UPDATE withdraw_items SET quantity_mc = ?, weight_kg = ? WHERE id = ?',
        [item.quantity_mc, item.quantity_mc * bulkKg, item.id]
      );
    }

    await conn.commit();

    res.json({ message: 'Items updated successfully' });
  } catch (error) {
    await conn.rollback();
    console.error('Error updating withdrawal items:', error);
    res.status(500).json({ error: 'Failed to update items' });
  } finally {
    conn.release();
  }
});

// ─── PUT update status (used by Manage page) ─────────
router.put('/:id/status', async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const { status, managed_by } = req.body;
    const validStatuses = ['PENDING', 'TAKING_OUT', 'READY', 'FINISHED', 'CANCELLED'];
    if (!validStatuses.includes(status)) {
      await conn.rollback();
      return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
    }

    const [requests] = await conn.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    if (requests.length === 0) {
      await conn.rollback();
      return res.status(404).json({ error: 'Request not found' });
    }

    const request = requests[0];

    if (status === 'FINISHED' && request.status !== 'FINISHED') {
      const [items] = await conn.query(`
        SELECT wi.*, p.bulk_weight_kg, ii.wet_mc AS import_wet_mc, ii.shipment_id
        FROM withdraw_items wi
        LEFT JOIN lots l ON wi.lot_id = l.id
        LEFT JOIN products p ON l.product_id = p.id
        LEFT JOIN import_items ii ON wi.import_item_id = ii.id
        WHERE wi.request_id = ?
      `, [req.params.id]);

      for (const item of items) {
        if (item.import_item_id) {
          const imp = await getImportItemBalanceMc(conn, item.import_item_id);
          if (!imp) {
            await conn.rollback();
            return res.status(400).json({ error: 'Import item not found' });
          }
          if (item.quantity_mc > imp.balance_mc) {
            await conn.rollback();
            return res.status(400).json({
              error: `Insufficient import stock. Requested ${item.quantity_mc} MC but only ${imp.balance_mc} MC available.`
            });
          }

          const wd = request.withdraw_date;
          const dateOut = wd
            ? (wd instanceof Date ? wd.toISOString().slice(0, 10) : String(wd).slice(0, 10))
            : new Date().toISOString().slice(0, 10);
          const nwKgs = Number(item.weight_kg) || (item.quantity_mc * (Number(item.import_wet_mc) || imp.wet_mc));

          // ORDER column on the Import Stock detail page:
          //   - Production Process from the withdraw line when provided
          //   - otherwise fall back to the department (PK / RM)
          const processText = (item.production_process || '').trim();
          const orderRef = processText || request.department || '';

          const [insOut] = await conn.query(
            `INSERT INTO import_stock_outs (item_id, date_out, order_ref, mc, nw_kgs) VALUES (?,?,?,?,?)`,
            [item.import_item_id, dateOut, orderRef, item.quantity_mc, nwKgs]
          );
          if (item.shipment_id) {
            await conn.query('UPDATE import_shipments SET last_update_stock = NOW() WHERE id = ?', [item.shipment_id]);
          }
          await conn.query('UPDATE withdraw_items SET import_stock_out_id = ? WHERE id = ?', [insOut.insertId, item.id]);
          continue;
        }

        if (!item.lot_id || !item.location_id) {
          await conn.rollback();
          return res.status(500).json({ error: 'Withdraw line has no lot/location and is not an import line' });
        }

        const [balance] = await conn.query(`
          SELECT
            COALESCE(SUM(CASE WHEN movement_type = 'IN' THEN quantity_mc ELSE 0 END), 0) -
            COALESCE(SUM(CASE WHEN movement_type = 'OUT' THEN quantity_mc ELSE 0 END), 0) AS hand_on
          FROM movements WHERE lot_id = ? AND location_id = ?
        `, [item.lot_id, item.location_id]);

        if (item.quantity_mc > balance[0].hand_on) {
          await conn.rollback();
          return res.status(400).json({
            error: `Insufficient stock for item. Requested ${item.quantity_mc} MC but only ${balance[0].hand_on} MC available.`
          });
        }

        const [movResult] = await conn.query(
          `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, notes, created_by)
           VALUES (?, ?, ?, ?, 'OUT', ?, ?, ?)`,
          [
            item.lot_id, item.location_id, item.quantity_mc,
            item.quantity_mc * Number(item.bulk_weight_kg),
            request.request_no,
            `Withdrawal for ${request.department} dept`,
            managed_by || 'system'
          ]
        );

        await conn.query('UPDATE withdraw_items SET movement_id = ? WHERE id = ?', [movResult.insertId, item.id]);
      }
    }

    const finishedAt = (status === 'FINISHED' && request.status !== 'FINISHED') ? new Date() : request.finished_at;

    await conn.query(
      'UPDATE withdraw_requests SET status = ?, managed_by = ?, finished_at = ?, updated_at = NOW() WHERE id = ?',
      [status, managed_by || request.managed_by, finishedAt, req.params.id]
    );

    await conn.commit();

    const [updated] = await pool.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    res.json({ message: `Status updated to ${status}`, request: updated[0] });
  } catch (error) {
    await conn.rollback();
    console.error('Error updating withdrawal status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  } finally {
    conn.release();
  }
});

// ─── DELETE permanently remove a withdrawal (superadmin) — stock outs + import outs + request ──
// Must be registered before `DELETE /:id` (soft cancel) so path `/:id/erase` matches.
router.delete('/:id/erase', authMiddleware, superadminOnly, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }

  const [exists] = await pool.query('SELECT id, request_no FROM withdraw_requests WHERE id = ?', [id]);
  if (exists.length === 0) {
    return res.status(404).json({ error: 'Request not found' });
  }
  const requestNo = exists[0].request_no;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [items] = await conn.query(
      'SELECT id, movement_id, import_stock_out_id, import_item_id FROM withdraw_items WHERE request_id = ?',
      [id]
    );

    const movementIds = [...new Set(items.map((i) => i.movement_id).filter(Boolean))];
    const importOutIds = [...new Set(items.map((i) => i.import_stock_out_id).filter(Boolean))];

    if (movementIds.length) {
      const ph = movementIds.map(() => '?').join(',');
      await conn.query(`DELETE FROM movements WHERE id IN (${ph})`, movementIds);
    }

    if (importOutIds.length) {
      const phOut = importOutIds.map(() => '?').join(',');
      const [shipRows] = await conn.query(
        `SELECT DISTINCT ii.shipment_id
         FROM withdraw_items wi
         JOIN import_items ii ON ii.id = wi.import_item_id
         WHERE wi.request_id = ? AND wi.import_item_id IS NOT NULL`,
        [id]
      );
      await conn.query(`DELETE FROM import_stock_outs WHERE id IN (${phOut})`, importOutIds);
      for (const row of shipRows) {
        if (row.shipment_id) {
          await conn.query('UPDATE import_shipments SET last_update_stock = NOW() WHERE id = ?', [row.shipment_id]);
        }
      }
    }

    await conn.query('DELETE FROM withdraw_requests WHERE id = ?', [id]);
    await conn.commit();

    res.json({
      message: 'Withdrawal permanently removed from Manage, Withdraw, and stock records',
      request_no: requestNo
    });
  } catch (error) {
    await conn.rollback();
    console.error('Error permanently deleting withdrawal:', error);
    res.status(500).json({ error: 'Failed to remove withdrawal' });
  } finally {
    conn.release();
  }
});

// ─── DELETE cancel a withdrawal ──────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const [requests] = await pool.query('SELECT * FROM withdraw_requests WHERE id = ?', [req.params.id]);
    if (requests.length === 0) return res.status(404).json({ error: 'Request not found' });
    if (requests[0].status === 'FINISHED') {
      return res.status(400).json({ error: 'Cannot delete a finished withdrawal' });
    }
    await pool.query('UPDATE withdraw_requests SET status = "CANCELLED" WHERE id = ?', [req.params.id]);
    res.json({ message: 'Withdrawal cancelled' });
  } catch (error) {
    console.error('Error cancelling withdrawal:', error);
    res.status(500).json({ error: 'Failed to cancel withdrawal' });
  }
});

module.exports = router;
