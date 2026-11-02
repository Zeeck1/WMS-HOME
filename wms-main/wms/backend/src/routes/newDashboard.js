const express = require('express');
const router = express.Router();
const pool = require('../config/db');

/**
 * New Dashboard — one aggregated payload for the "New Dashboard" page.
 *
 * Sources:
 *  - inventory_view            (BULK / CONTAINER_EXTRA / IMPORT lots held in locations)
 *  - import_items / shipments  (Import Stock module balances)
 *  - movements                 (daily IN / OUT, excluding opening Excel loads + manual corrections)
 *  - import_stock_outs         (import dispatches)
 *  - locations                 (capacity)
 *  - withdraw_requests/items   (status summary + request-form day list)
 */

/** Opening loads + manual corrections are not real flow — keep them out of trend numbers. */
const NON_FLOW_REFS = ['EXCEL-IMPORT', 'CE-EXCEL-IMPORT', 'IMP-EXCEL-IMPORT', 'MANUAL-ADJUST', 'Manual adjustment'];

const AGE_BUCKETS = [
  { key: '0-30d', label: '0–30d', min: 0, max: 30 },
  { key: '31-60d', label: '31–60d', min: 31, max: 60 },
  { key: '61-90d', label: '61–90d', min: 61, max: 90 },
  { key: '91-180d', label: '91–180d', min: 91, max: 180 },
  { key: '181-365d', label: '181–365d', min: 181, max: 365 },
  { key: '365d+', label: '365d+', min: 366, max: Infinity },
];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (n) => Math.round(n * 10) / 10;

/** expiration_date is stored as YYYY-MM-DD or YYYY-MM (month-only → end of month). */
function parseExpiry(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{4})-(\d{2})$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2], 0));
  return null;
}

async function safeQuery(sql, params = []) {
  try {
    const [rows] = await pool.query(sql, params);
    return rows;
  } catch (e) {
    console.error('[new-dashboard] query failed:', e.message);
    return [];
  }
}

// GET /api/new-dashboard?days=90
router.get('/', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 90, 7), 730);

    const [[todayRow]] = await pool.query('SELECT CURDATE() AS today');
    const today = String(todayRow.today).slice(0, 10);
    const todayUtc = new Date(`${today}T00:00:00Z`);

    // ── 1. Stock on hand (lot × location rows) ──────────────────────────
    const invRows = await safeQuery(`
      SELECT fish_name, size, stock_type, lot_no, location_id, line_place,
             cs_in_date, expiration_date,
             hand_on_balance_mc AS mc, hand_on_balance_kg AS kg,
             DATEDIFF(CURDATE(), cs_in_date) AS age_days
      FROM inventory_view
    `);

    const impRows = await safeQuery(`
      SELECT * FROM (
        SELECT ii.item_name AS fish_name, ii.size, 'IMPORT' AS stock_type,
               s.inv_no AS lot_no, NULL AS location_id,
               NULLIF(TRIM(ii.lines), '') AS line_place,
               s.eta AS cs_in_date, s.expiry_date AS expiration_date,
               ii.factory_mc - COALESCE((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS mc,
               ii.factory_nw_kgs - COALESCE((SELECT SUM(o.nw_kgs) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS kg,
               DATEDIFF(CURDATE(), s.eta) AS age_days
        FROM import_items ii
        JOIN import_shipments s ON ii.shipment_id = s.id
        WHERE ii.item_name IS NOT NULL AND ii.item_name != ''
      ) x WHERE x.mc > 0
    `);

    const stock = [...invRows, ...impRows].map((r) => ({
      fish_name: r.fish_name || '(unnamed)',
      size: r.size && String(r.size).trim() ? String(r.size).trim() : '',
      stock_type: r.stock_type || 'BULK',
      lot_no: r.lot_no || '',
      location_id: r.location_id,
      line_place: r.line_place || '',
      cs_in_date: r.cs_in_date ? String(r.cs_in_date).slice(0, 10) : null,
      expiration_date: r.expiration_date ? String(r.expiration_date).slice(0, 10) : null,
      mc: num(r.mc),
      kg: num(r.kg),
      age_days: r.age_days == null ? null : num(r.age_days),
    }));

    const totalKg = stock.reduce((s, r) => s + r.kg, 0);
    const totalMc = stock.reduce((s, r) => s + r.mc, 0);
    const lotCount = stock.length;
    const distinctProducts = new Set(stock.map((r) => `${r.fish_name}|${r.size}`)).size;
    const usedLocationIds = new Set(stock.filter((r) => r.location_id != null).map((r) => r.location_id));

    const locRows = await safeQuery('SELECT COUNT(*) AS total FROM locations WHERE is_active = 1');
    const totalLocations = num(locRows[0]?.total);
    const usedLocations = usedLocationIds.size;

    // ── 2. Composition ──────────────────────────────────────────────────
    const groupBy = (keyFn) => {
      const map = new Map();
      for (const r of stock) {
        const k = keyFn(r);
        const g = map.get(k) || { name: k, mc: 0, kg: 0, lots: 0 };
        g.mc += r.mc;
        g.kg += r.kg;
        g.lots += 1;
        map.set(k, g);
      }
      return [...map.values()]
        .map((g) => ({ ...g, kg: round1(g.kg), pct: totalKg ? round1((g.kg / totalKg) * 100) : 0 }))
        .sort((a, b) => b.kg - a.kg);
    };

    const TYPE_ORDER = ['BULK', 'IMPORT', 'CONTAINER_EXTRA'];
    const byType = groupBy((r) => r.stock_type).sort(
      (a, b) => (TYPE_ORDER.indexOf(a.name) + 1 || 99) - (TYPE_ORDER.indexOf(b.name) + 1 || 99)
    );
    const byProduct = groupBy((r) => r.fish_name);
    const bySize = groupBy((r) => r.size || '(not set)');

    // ── 3. Aging & expiry ───────────────────────────────────────────────
    const aging = AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, mc: 0, kg: 0, lots: 0 }));
    const over = { d90: { kg: 0, lots: 0 }, d180: { kg: 0, lots: 0 }, d365: { kg: 0, lots: 0 } };
    let noInDate = 0;
    for (const r of stock) {
      if (r.age_days == null) { noInDate += 1; continue; }
      const age = Math.max(0, r.age_days);
      const i = AGE_BUCKETS.findIndex((b) => age >= b.min && age <= b.max);
      if (i >= 0) {
        aging[i].mc += r.mc;
        aging[i].kg += r.kg;
        aging[i].lots += 1;
      }
      if (age > 90) { over.d90.kg += r.kg; over.d90.lots += 1; }
      if (age > 180) { over.d180.kg += r.kg; over.d180.lots += 1; }
      if (age > 365) { over.d365.kg += r.kg; over.d365.lots += 1; }
    }
    aging.forEach((a) => { a.kg = round1(a.kg); });
    Object.values(over).forEach((o) => { o.kg = round1(o.kg); o.pct = totalKg ? round1((o.kg / totalKg) * 100) : 0; });

    const in30 = new Date(todayUtc.getTime() + 30 * 86400000);
    const expiry = { with_date: 0, expired_lots: 0, expired_kg: 0, expired_mc: 0, soon_lots: 0, soon_kg: 0 };
    for (const r of stock) {
      const d = parseExpiry(r.expiration_date);
      if (!d) continue;
      expiry.with_date += 1;
      if (d < todayUtc) {
        expiry.expired_lots += 1;
        expiry.expired_kg += r.kg;
        expiry.expired_mc += r.mc;
      } else if (d <= in30) {
        expiry.soon_lots += 1;
        expiry.soon_kg += r.kg;
      }
    }
    expiry.expired_kg = round1(expiry.expired_kg);
    expiry.soon_kg = round1(expiry.soon_kg);
    expiry.coverage_pct = lotCount ? round1((expiry.with_date / lotCount) * 100) : 0;

    const oldest = stock
      .filter((r) => r.age_days != null)
      .sort((a, b) => b.age_days - a.age_days)
      .slice(0, 15)
      .map((r) => ({
        fish_name: r.fish_name,
        size: r.size,
        lot_no: r.lot_no,
        line_place: r.line_place,
        stock_type: r.stock_type,
        cs_in_date: r.cs_in_date,
        age_days: r.age_days,
        mc: r.mc,
        kg: round1(r.kg),
      }));

    // ── 4. Movement trends (window) ─────────────────────────────────────
    const refPh = NON_FLOW_REFS.map(() => '?').join(',');
    const mvRows = await safeQuery(
      `SELECT DATE(m.created_at) AS d,
              SUM(CASE WHEN m.movement_type = 'IN'  THEN m.weight_kg ELSE 0 END) AS in_kg,
              SUM(CASE WHEN m.movement_type = 'OUT' THEN m.weight_kg ELSE 0 END) AS out_kg,
              SUM(CASE WHEN m.movement_type = 'IN'  THEN m.quantity_mc ELSE 0 END) AS in_mc,
              SUM(CASE WHEN m.movement_type = 'OUT' THEN m.quantity_mc ELSE 0 END) AS out_mc
       FROM movements m
       WHERE m.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND (m.reference_no IS NULL OR m.reference_no NOT IN (${refPh}))
       GROUP BY DATE(m.created_at)`,
      [days - 1, ...NON_FLOW_REFS]
    );
    const impInRows = await safeQuery(
      `SELECT s.eta AS d, SUM(ii.factory_nw_kgs) AS in_kg, SUM(ii.factory_mc) AS in_mc
       FROM import_items ii JOIN import_shipments s ON ii.shipment_id = s.id
       WHERE s.eta >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND s.eta <= CURDATE()
       GROUP BY s.eta`,
      [days - 1]
    );
    const impOutRows = await safeQuery(
      `SELECT o.date_out AS d, SUM(o.nw_kgs) AS out_kg, SUM(o.mc) AS out_mc
       FROM import_stock_outs o
       WHERE o.date_out >= DATE_SUB(CURDATE(), INTERVAL ? DAY) AND o.date_out <= CURDATE()
       GROUP BY o.date_out`,
      [days - 1]
    );

    const dayMap = new Map();
    const addDay = (d, inKg, outKg, inMc, outMc) => {
      const k = String(d).slice(0, 10);
      const e = dayMap.get(k) || { date: k, in_kg: 0, out_kg: 0, in_mc: 0, out_mc: 0 };
      e.in_kg += num(inKg);
      e.out_kg += num(outKg);
      e.in_mc += num(inMc);
      e.out_mc += num(outMc);
      dayMap.set(k, e);
    };
    mvRows.forEach((r) => addDay(r.d, r.in_kg, r.out_kg, r.in_mc, r.out_mc));
    impInRows.forEach((r) => addDay(r.d, r.in_kg, 0, r.in_mc, 0));
    impOutRows.forEach((r) => addDay(r.d, 0, r.out_kg, 0, r.out_mc));
    const daily = [...dayMap.values()]
      .filter((e) => e.in_kg || e.out_kg || e.in_mc || e.out_mc)
      .map((e) => ({ ...e, in_kg: round1(e.in_kg), out_kg: round1(e.out_kg) }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const inKg = daily.reduce((s, e) => s + e.in_kg, 0);
    const outKg = daily.reduce((s, e) => s + e.out_kg, 0);
    const monthlyOut = outKg / (days / 30.4);
    const movement = {
      days,
      from: new Date(todayUtc.getTime() - (days - 1) * 86400000).toISOString().slice(0, 10),
      to: today,
      in_kg: round1(inKg),
      out_kg: round1(outKg),
      net_kg: round1(inKg - outKg),
      ratio: outKg > 0 ? Math.round((inKg / outKg) * 10) / 10 : null,
      months_cover: monthlyOut > 0 ? Math.round((totalKg / monthlyOut) * 10) / 10 : null,
      daily,
    };

    // Top dispatched products in window
    const outProdRows = await safeQuery(
      `SELECT p.fish_name AS name, SUM(m.weight_kg) AS kg, SUM(m.quantity_mc) AS mc
       FROM movements m
       JOIN lots l ON m.lot_id = l.id
       JOIN products p ON l.product_id = p.id
       WHERE m.movement_type = 'OUT'
         AND m.created_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         AND (m.reference_no IS NULL OR m.reference_no NOT IN (${refPh}))
       GROUP BY p.fish_name`,
      [days - 1, ...NON_FLOW_REFS]
    );
    const outImpRows = await safeQuery(
      `SELECT ii.item_name AS name, SUM(o.nw_kgs) AS kg, SUM(o.mc) AS mc
       FROM import_stock_outs o JOIN import_items ii ON o.item_id = ii.id
       WHERE o.date_out >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       GROUP BY ii.item_name`,
      [days - 1]
    );
    const outMap = new Map();
    [...outProdRows, ...outImpRows].forEach((r) => {
      const k = r.name || '(unnamed)';
      const e = outMap.get(k) || { name: k, kg: 0, mc: 0 };
      e.kg += num(r.kg);
      e.mc += num(r.mc);
      outMap.set(k, e);
    });
    movement.top_dispatched = [...outMap.values()]
      .map((e) => ({ ...e, kg: round1(e.kg) }))
      .sort((a, b) => b.kg - a.kg)
      .slice(0, 10);

    // ── 5. Withdrawals ──────────────────────────────────────────────────
    const wdStatus = await safeQuery(`
      SELECT wr.status, COUNT(*) AS requests,
             COALESCE(SUM((SELECT COALESCE(SUM(wi.requested_mc), 0) FROM withdraw_items wi WHERE wi.request_id = wr.id)), 0) AS requested_mc
      FROM withdraw_requests wr
      GROUP BY wr.status
    `);
    const STATUS_ORDER = ['PENDING', 'TAKING_OUT', 'READY', 'FINISHED', 'CANCELLED', 'REJECTED'];
    const withdrawalStatus = wdStatus
      .map((r) => ({ status: r.status, requests: num(r.requests), requested_mc: num(r.requested_mc) }))
      .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status));
    const st = (s) => withdrawalStatus.find((r) => r.status === s) || { requests: 0, requested_mc: 0 };

    const activeDates = await safeQuery(`
      SELECT DISTINCT DATE(COALESCE(withdraw_date, created_at)) AS d
      FROM withdraw_requests
      ORDER BY d DESC
      LIMIT 10
    `);

    res.json({
      generated_at: new Date().toISOString(),
      today,
      overview: {
        total_kg: round1(totalKg),
        total_mc: totalMc,
        lots: lotCount,
        distinct_products: distinctProducts,
        avg_lot_kg: lotCount ? Math.round(totalKg / lotCount) : 0,
        avg_lot_mc: lotCount ? Math.round(totalMc / lotCount) : 0,
        locations_used: usedLocations,
        locations_total: totalLocations,
        occupancy_pct: totalLocations ? round1((usedLocations / totalLocations) * 100) : null,
        open_withdrawals: {
          total: st('PENDING').requests + st('TAKING_OUT').requests + st('READY').requests,
          pending: st('PENDING').requests,
          taking_out: st('TAKING_OUT').requests,
          ready: st('READY').requests,
        },
      },
      composition: {
        by_type: byType,
        by_product: byProduct.slice(0, 20),
        by_size: bySize.slice(0, 10),
        product_count: byProduct.length,
        top2_pct: round1(byProduct.slice(0, 2).reduce((s, g) => s + g.pct, 0)),
        top5_pct: round1(byProduct.slice(0, 5).reduce((s, g) => s + g.pct, 0)),
        top10_pct: round1(byProduct.slice(0, 10).reduce((s, g) => s + g.pct, 0)),
      },
      aging: {
        buckets: aging,
        over_90: over.d90,
        over_180: over.d180,
        over_365: over.d365,
        no_in_date: noInDate,
        oldest,
      },
      expiry,
      movement,
      withdrawals: {
        by_status: withdrawalStatus,
        total: withdrawalStatus.reduce((s, r) => s + r.requests, 0),
        active_dates: activeDates.map((r) => String(r.d).slice(0, 10)).filter(Boolean),
      },
    });
  } catch (error) {
    console.error('Error building new dashboard:', error);
    res.status(500).json({ error: 'Failed to build dashboard data' });
  }
});

module.exports = router;

