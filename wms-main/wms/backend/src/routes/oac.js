const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const pool = require('../config/db');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, `oac-${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) and CSV files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }
});

// Ensure OAC tables exist on first load
let tablesReady = false;
async function ensureTables() {
  if (tablesReady) return;
  const conn = await pool.getConnection();
  try {
    // Migrate: if oac_checks exists but is missing expected columns, recreate both tables
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oac_checks' AND COLUMN_NAME = 'checked_at'`
    );
    if (cols.length === 0) {
      // Old table exists without proper schema — drop and recreate
      await conn.query('DROP TABLE IF EXISTS oac_check_items');
      await conn.query('DROP TABLE IF EXISTS oac_checks');
    }

    await conn.query(`
      CREATE TABLE IF NOT EXISTS oac_checks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        total_files INT NOT NULL DEFAULT 0,
        total_items INT NOT NULL DEFAULT 0,
        full_count INT NOT NULL DEFAULT 0,
        not_full_count INT NOT NULL DEFAULT 0,
        not_have_count INT NOT NULL DEFAULT 0,
        file_summaries JSON
      ) ENGINE=InnoDB
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS oac_check_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        check_id INT NOT NULL,
        order_file VARCHAR(255),
        order_sheet VARCHAR(255),
        product VARCHAR(500),
        pack VARCHAR(500),
        weight_mc DECIMAL(10,2) DEFAULT 0,
        ordered_ctn INT DEFAULT 0,
        ordered_kg DECIMAL(12,2) DEFAULT 0,
        gross_weight_kg DECIMAL(12,2) DEFAULT 0,
        stock_mc INT DEFAULT 0,
        stock_kg DECIMAL(12,2) DEFAULT 0,
        available_ctn INT DEFAULT 0,
        available_kg DECIMAL(12,2) DEFAULT 0,
        shortage_ctn INT DEFAULT 0,
        shortage_kg DECIMAL(12,2) DEFAULT 0,
        status ENUM('FULL','NOT_FULL','NOT_HAVE') NOT NULL,
        matched_product VARCHAR(500),
        remark TEXT,
        origin TEXT,
        FOREIGN KEY (check_id) REFERENCES oac_checks(id) ON DELETE CASCADE,
        INDEX idx_check (check_id)
      ) ENGINE=InnoDB
    `);

    // Migration: add origin column if missing from an older schema
    const [originCol] = await conn.query(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'oac_check_items' AND COLUMN_NAME = 'origin'`
    );
    if (originCol.length === 0) {
      await conn.query('ALTER TABLE oac_check_items ADD COLUMN origin TEXT AFTER remark');
    }

    tablesReady = true;
  } finally {
    conn.release();
  }
}

function normalize(str) {
  return (str || '').toString().toUpperCase().replace(/\s+/g, ' ').trim();
}

/**
 * Lenient CSV line splitter.
 * Treats each physical line as one row — stray/unmatched quotes
 * cannot swallow subsequent lines.
 */
function splitCSVLine(line) {
  const fields = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes) {
        if (i + 1 < line.length && line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (field === '') {
        inQuotes = true;
      } else {
        field += ch;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Read a workbook, using a lenient CSV parser for .csv files
 * so stray quotes can't swallow entire rows.
 */
function readWorkbook(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.csv') {
    let content = fs.readFileSync(filePath, 'utf-8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);

    const lines = content.split(/\r?\n/);
    const rows = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      rows.push(splitCSVLine(line));
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    const sheetName = path.basename(filePath, ext).replace(/^oac-\d+-/, '');
    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Sheet1');
    return wb;
  }

  return XLSX.readFile(filePath);
}

/**
 * Robust order-file parser.
 * Auto-detects the header row, then maps columns by pattern matching.
 */
function parseOrderFile(filePath) {
  const workbook = readWorkbook(filePath);
  const items = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

    if (rawRows.length < 2) continue;

    // Flatten each cell to a lower-case string with no spaces/underscores for matching
    const norm = (v) => String(v).toLowerCase().replace(/[\s_\-\/\.\(\)]+/g, '').replace(/\n/g, '');

    // --- Auto-detect the header row (scan first 15 rows) ---
    let headerIdx = -1;
    for (let i = 0; i < Math.min(15, rawRows.length); i++) {
      const cells = rawRows[i].map(norm);
      const joined = cells.join('|');
      // A header row should contain at least "product" or ("no" AND some quantity column)
      const hasProduct = cells.some(c => c === 'product' || c === 'fishname' || c === 'item');
      const hasQty = cells.some(c =>
        c.includes('totalctn') || c.includes('ctn') || c.includes('qty') ||
        c.includes('quantity') || c.includes('mc') || c.includes('carton')
      );
      const hasNo = cells.some(c => c === 'no');

      if (hasProduct || (hasNo && hasQty) || joined.includes('product')) {
        headerIdx = i;
        break;
      }
    }

    if (headerIdx === -1) {
      // Fallback: if the first row has >= 3 non-empty cells that look like text headers, use it
      const firstRowNonEmpty = rawRows[0].filter(c => String(c).trim() !== '').length;
      if (firstRowNonEmpty >= 3) {
        headerIdx = 0;
      } else {
        // Skip sheets with no recognizable data
        continue;
      }
    }

    const headers = rawRows[headerIdx].map(norm);

    // --- Map column indices by pattern matching ---
    const findCol = (...patterns) => {
      for (const p of patterns) {
        for (let ci = 0; ci < headers.length; ci++) {
          if (headers[ci].includes(p)) return ci;
        }
      }
      return -1;
    };

    let productCol = findCol('product', 'fishname', 'item');
    const noCol = findCol('no');
    const packCol = findCol('pack');
    const weightMcCol = findCol('weightmc', 'weightpermc', 'kgctn', 'bulkweight');
    const grossWeightCol = (() => {
      // "grossweight" but NOT "grossweightkg"
      for (let ci = 0; ci < headers.length; ci++) {
        if (headers[ci].includes('grossweight') && !headers[ci].includes('kg')) return ci;
      }
      return -1;
    })();
    let totalCtnCol = findCol('totalctn', 'ctn');
    if (totalCtnCol === -1) totalCtnCol = findCol('qty', 'quantity', 'carton');
    if (totalCtnCol === -1) totalCtnCol = findCol('mc');
    const netWeightKgCol = findCol('netweightkg', 'netweight', 'totalkg');
    const grossWeightKgCol = findCol('grossweightkg');
    const remarkCol = findCol('remark');

    // If no explicit "product" column, try column B (index 1) as a common fallback
    if (productCol === -1) {
      // Use the column after "no" if we found it, otherwise index 1
      productCol = noCol >= 0 ? noCol + 1 : 1;
    }

    // --- Parse data rows (everything after the header) ---
    for (let ri = headerIdx + 1; ri < rawRows.length; ri++) {
      const row = rawRows[ri];
      if (!row || row.length === 0) continue;

      // Skip rows that are completely empty or just have a number in col A
      const nonEmptyCells = row.filter((c, ci) => ci > 0 && String(c).trim() !== '').length;
      if (nonEmptyCells === 0) continue;

      const product = String(row[productCol] || '').trim();
      if (!product) continue;

      // Skip if product looks like a header repeat
      if (norm(product) === 'product' || norm(product) === 'fishname' || norm(product) === 'item') continue;

      const pack = packCol >= 0 ? String(row[packCol] || '').trim() : '';
      const weightMc = weightMcCol >= 0 ? parseFloat(row[weightMcCol]) || 0 : 0;
      const grossWeight = grossWeightCol >= 0 ? parseFloat(row[grossWeightCol]) || 0 : 0;
      const totalCtn = totalCtnCol >= 0 ? parseInt(row[totalCtnCol]) || 0 : 0;
      const netWeightKg = netWeightKgCol >= 0 ? parseFloat(row[netWeightKgCol]) || 0 : 0;
      const grossWeightKg = grossWeightKgCol >= 0 ? parseFloat(row[grossWeightKgCol]) || 0 : 0;
      const remark = remarkCol >= 0 ? String(row[remarkCol] || '').trim() : '';

      const computedNetKg = netWeightKg || (totalCtn * weightMc) || 0;

      items.push({
        orderSheet: sheetName,
        rowIndex: ri + 1,
        product,
        pack,
        weightMc,
        grossWeight,
        totalCtn,
        netWeightKg: computedNetKg,
        grossWeightKg,
        remark
      });
    }
  }

  return items;
}

/**
 * Split an order product name into fish_name + size.
 * e.g. "ROHU/G - 1 KG.UP" → { fish: "ROHU/G", size: "1 KG.UP" }
 *      "DRY KESKI"         → { fish: "DRY KESKI", size: "" }
 */
function splitProduct(name) {
  const n = normalize(name);
  // Match "FISH_PART - SIZE_PART" (dash surrounded by spaces)
  const m = n.match(/^(.+?)\s+-\s+(.+)$/);
  if (m) return { fish: m[1].trim(), size: m[2].trim() };
  return { fish: n, size: '' };
}

/**
 * Among candidates with the same fish_name, pick the one whose
 * size best matches the order size. Requires ALL significant
 * numbers from the order size to appear in the stock size.
 */
function findBestSizeMatch(orderSize, candidates) {
  const ns = normalize(orderSize);

  // Exact size match
  for (const e of candidates) {
    if (normalize(e.size) === ns) return e;
  }

  // Number-based comparison
  const orderNums = (ns.match(/\d+/g) || []).map(Number);
  if (orderNums.length === 0) {
    return candidates.length === 1 ? candidates[0] : null;
  }

  let best = null;
  let bestMatched = -1;

  for (const e of candidates) {
    const stockNums = (normalize(e.size).match(/\d+/g) || []).map(Number);
    let matched = 0;
    for (const n of orderNums) {
      if (stockNums.includes(n)) matched++;
    }
    // ALL numbers from the order must be present in the stock size
    if (matched === orderNums.length && matched > bestMatched) {
      bestMatched = matched;
      best = e;
    }
  }

  return best;
}

/**
 * Strict matching: order product → stock entry.
 * 1. Exact full-string match
 * 2. Exact fish_name match + best size match
 * 3. No match → null  (never returns a wrong product)
 */
function matchOrderToStock(orderProduct, stockEntries) {
  const normOrder = normalize(orderProduct);
  if (!normOrder) return null;
  const { fish: orderFish, size: orderSize } = splitProduct(orderProduct);

  // Phase 1: exact full-string match against "fish_name - size"
  for (const e of stockEntries) {
    const full1 = normalize(`${e.fish_name} - ${e.size}`);
    const full2 = normalize(`${e.fish_name} ${e.size}`);
    if (normOrder === full1 || normOrder === full2) return e;
  }

  // Phase 2: exact fish_name match, then pick by size
  const fishExact = stockEntries.filter(e => normalize(e.fish_name) === orderFish);
  if (fishExact.length > 0) {
    if (!orderSize) {
      // No size in order name — only accept if there's exactly one product
      return fishExact.length === 1 ? fishExact[0] : null;
    }
    const sizeMatch = findBestSizeMatch(orderSize, fishExact);
    if (sizeMatch) return sizeMatch;
  }

  // Phase 3: try fish_name without the /SUFFIX  (e.g. "PANGASH/G" → "PANGASH")
  const orderBase = orderFish.replace(/\/[A-Z]{0,3}$/, '').trim();
  if (orderBase !== orderFish && orderBase.length >= 3) {
    const baseMatches = stockEntries.filter(e => {
      const stockBase = normalize(e.fish_name).replace(/\/[A-Z]{0,3}$/, '').trim();
      return stockBase === orderBase && normalize(e.fish_name).startsWith(orderFish.split('/')[0]);
    });
    // Only use base-match if the /SUFFIX also matches
    const suffixMatch = baseMatches.filter(e => normalize(e.fish_name) === orderFish);
    if (suffixMatch.length > 0 && orderSize) {
      const sm = findBestSizeMatch(orderSize, suffixMatch);
      if (sm) return sm;
    }
  }

  // No confident match found — return null instead of a wrong match
  return null;
}

// POST /api/oac/check — upload order files, compare with stock, save to DB
router.post('/check', upload.array('files', 32), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await ensureTables();

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const [stockRows] = await conn.query(`
      SELECT
        fish_name, size, bulk_weight_kg, type, glazing, stock_type, order_code,
        SUM(hand_on_balance_mc) AS total_mc,
        SUM(hand_on_balance_kg) AS total_kg
      FROM inventory_view
      GROUP BY fish_name, size, bulk_weight_kg, type, glazing, stock_type, order_code
    `);

    try {
      const [impRows] = await conn.query(`
        SELECT
          ii.item_name AS fish_name, ii.size, ii.wet_mc AS bulk_weight_kg,
          '' AS type, '' AS glazing, 'IMPORT' AS stock_type, s.inv_no AS order_code,
          ii.factory_mc - COALESCE((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS total_mc,
          ii.factory_nw_kgs - COALESCE((SELECT SUM(o.nw_kgs) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS total_kg
        FROM import_items ii
        JOIN import_shipments s ON ii.shipment_id = s.id
        WHERE ii.item_name IS NOT NULL AND ii.item_name != ''
        HAVING total_mc > 0
      `);
      stockRows.push(...impRows);
    } catch (e) {
      console.error('Failed to fetch import items for OAC:', e);
    }

    // Aggregate stock by (fish_name, size), collecting origin info per source
    const stockAgg = new Map();
    for (const row of stockRows) {
      const aggKey = `${normalize(row.fish_name)}|||${normalize(row.size)}`;
      const mc = parseInt(row.total_mc) || 0;
      const kg = parseFloat(row.total_kg) || 0;
      const originEntry = {
        stock_type: row.stock_type || '',
        order_code: row.order_code || '',
        mc, kg
      };
      if (stockAgg.has(aggKey)) {
        const existing = stockAgg.get(aggKey);
        existing.total_mc += mc;
        existing.total_kg += kg;
        existing.origins.push(originEntry);
      } else {
        stockAgg.set(aggKey, {
          fish_name: row.fish_name,
          size: row.size,
          bulk_weight_kg: parseFloat(row.bulk_weight_kg) || 0,
          total_mc: mc,
          total_kg: kg,
          origins: [originEntry]
        });
      }
    }
    const stockEntries = Array.from(stockAgg.values());

    const allResults = [];
    const fileSummaries = [];

    for (const file of req.files) {
      const orderItems = parseOrderFile(file.path);
      const baseName = file.originalname.replace(/\.(xlsx|xls|csv)$/i, '');

      let fullCount = 0, notFullCount = 0, notHaveCount = 0;

      for (const item of orderItems) {
        const stock = matchOrderToStock(item.product, stockEntries);

        const stockMc = stock ? stock.total_mc : 0;
        const stockKg = stock ? stock.total_kg : 0;
        const stockName = stock ? `${stock.fish_name} - ${stock.size}` : null;

        // Build origin string from stock sources
        const origin = stock ? stock.origins
          .filter(o => o.mc > 0 || o.kg > 0)
          .map(o => {
            const st = (o.stock_type || '').toUpperCase();
            if (st === 'BULK') return 'BULK';
            if (st.includes('EXTRA') || st.includes('CONTAINER')) return `Extra (${o.order_code || '-'})`;
            if (st.includes('IMPORT')) return `Import (${o.order_code || '-'})`;
            return o.stock_type || 'Unknown';
          })
          .filter((v, i, a) => a.indexOf(v) === i)
          .join(', ') : '';

        let status;
        if (!stock || stockMc === 0) {
          status = 'NOT_HAVE';
          notHaveCount++;
        } else if (stockMc >= item.totalCtn && (item.netWeightKg <= 0 || stockKg >= item.netWeightKg)) {
          status = 'FULL';
          fullCount++;
        } else {
          status = 'NOT_FULL';
          notFullCount++;
        }

        const shortageCtn = Math.max(0, item.totalCtn - stockMc);
        const shortageKg = Math.max(0, item.netWeightKg - stockKg);
        const availableCtn = Math.min(item.totalCtn, stockMc);
        const availableKg = item.netWeightKg > 0 ? Math.min(item.netWeightKg, stockKg) : stockKg;

        allResults.push({
          orderFile: baseName,
          orderSheet: item.orderSheet,
          product: item.product,
          pack: item.pack,
          weightMc: item.weightMc,
          orderedCtn: item.totalCtn,
          orderedKg: item.netWeightKg,
          grossWeightKg: item.grossWeightKg,
          stockMc,
          stockKg,
          availableCtn,
          availableKg: Math.round(availableKg * 100) / 100,
          shortageCtn,
          shortageKg: Math.round(shortageKg * 100) / 100,
          status,
          matchedProduct: stockName,
          remark: item.remark,
          origin
        });
      }

      fileSummaries.push({
        fileName: baseName,
        originalName: file.originalname,
        totalItems: orderItems.length,
        full: fullCount,
        notFull: notFullCount,
        notHave: notHaveCount
      });
    }

    const totalFull = allResults.filter(r => r.status === 'FULL').length;
    const totalNotFull = allResults.filter(r => r.status === 'NOT_FULL').length;
    const totalNotHave = allResults.filter(r => r.status === 'NOT_HAVE').length;

    // Save to database
    await conn.beginTransaction();

    const [checkResult] = await conn.query(
      `INSERT INTO oac_checks (total_files, total_items, full_count, not_full_count, not_have_count, file_summaries)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.files.length, allResults.length, totalFull, totalNotFull, totalNotHave, JSON.stringify(fileSummaries)]
    );
    const checkId = checkResult.insertId;

    if (allResults.length > 0) {
      const rows = allResults.map(r => [
        checkId, r.orderFile, r.orderSheet, r.product, r.pack,
        r.weightMc, r.orderedCtn, r.orderedKg, r.grossWeightKg,
        r.stockMc, r.stockKg, r.availableCtn, r.availableKg,
        r.shortageCtn, r.shortageKg, r.status, r.matchedProduct, r.remark, r.origin
      ]);
      await conn.query(
        `INSERT INTO oac_check_items
          (check_id, order_file, order_sheet, product, pack,
           weight_mc, ordered_ctn, ordered_kg, gross_weight_kg,
           stock_mc, stock_kg, available_ctn, available_kg,
           shortage_ctn, shortage_kg, status, matched_product, remark, origin)
         VALUES ?`,
        [rows]
      );
    }

    await conn.commit();

    res.json({
      checkId,
      summary: {
        totalFiles: req.files.length,
        totalItems: allResults.length,
        full: totalFull,
        notFull: totalNotFull,
        notHave: totalNotHave
      },
      fileSummaries,
      results: allResults
    });

  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    console.error('OAC check error:', error);
    res.status(500).json({ error: 'Failed to check order availability: ' + error.message });
  } finally {
    conn.release();
  }
});

// GET /api/oac/checks — list recent checks
router.get('/checks', async (req, res) => {
  try {
    await ensureTables();
    const limit = parseInt(req.query.limit) || 20;
    const [rows] = await pool.query(
      `SELECT id, checked_at, total_files, total_items, full_count, not_full_count, not_have_count, file_summaries
       FROM oac_checks ORDER BY checked_at DESC LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (error) {
    console.error('OAC list error:', error);
    res.status(500).json({ error: 'Failed to list checks' });
  }
});

// GET /api/oac/checks/:id — get a saved check result
router.get('/checks/:id', async (req, res) => {
  try {
    await ensureTables();
    const [checks] = await pool.query('SELECT * FROM oac_checks WHERE id = ?', [req.params.id]);
    if (checks.length === 0) return res.status(404).json({ error: 'Check not found' });

    const check = checks[0];
    const [items] = await pool.query('SELECT * FROM oac_check_items WHERE check_id = ? ORDER BY id', [check.id]);

    const fileSummaries = typeof check.file_summaries === 'string'
      ? JSON.parse(check.file_summaries) : check.file_summaries;

    res.json({
      checkId: check.id,
      checkedAt: check.checked_at,
      summary: {
        totalFiles: check.total_files,
        totalItems: check.total_items,
        full: check.full_count,
        notFull: check.not_full_count,
        notHave: check.not_have_count
      },
      fileSummaries: fileSummaries || [],
      results: items.map(r => ({
        orderFile: r.order_file,
        orderSheet: r.order_sheet,
        product: r.product,
        pack: r.pack,
        weightMc: parseFloat(r.weight_mc) || 0,
        orderedCtn: r.ordered_ctn,
        orderedKg: parseFloat(r.ordered_kg) || 0,
        grossWeightKg: parseFloat(r.gross_weight_kg) || 0,
        stockMc: r.stock_mc,
        stockKg: parseFloat(r.stock_kg) || 0,
        availableCtn: r.available_ctn,
        availableKg: parseFloat(r.available_kg) || 0,
        shortageCtn: r.shortage_ctn,
        shortageKg: parseFloat(r.shortage_kg) || 0,
        status: r.status,
        matchedProduct: r.matched_product,
        remark: r.remark,
        origin: r.origin || ''
      }))
    });
  } catch (error) {
    console.error('OAC get check error:', error);
    res.status(500).json({ error: 'Failed to get check' });
  }
});

// DELETE /api/oac/checks/:id — delete a saved check
router.delete('/checks/:id', async (req, res) => {
  try {
    await ensureTables();
    await pool.query('DELETE FROM oac_checks WHERE id = ?', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (error) {
    console.error('OAC delete error:', error);
    res.status(500).json({ error: 'Failed to delete check' });
  }
});

// GET /api/oac/stock-summary
router.get('/stock-summary', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT fish_name, size, bulk_weight_kg, stock_type,
        SUM(hand_on_balance_mc) AS total_mc, SUM(hand_on_balance_kg) AS total_kg
      FROM inventory_view
      GROUP BY fish_name, size, bulk_weight_kg, stock_type
      ORDER BY fish_name, size
    `);

    try {
      const [impRows] = await pool.query(`
        SELECT
          ii.item_name AS fish_name, ii.size, ii.wet_mc AS bulk_weight_kg,
          'IMPORT' AS stock_type,
          ii.factory_mc - COALESCE((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS total_mc,
          ii.factory_nw_kgs - COALESCE((SELECT SUM(o.nw_kgs) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS total_kg
        FROM import_items ii
        JOIN import_shipments s ON ii.shipment_id = s.id
        WHERE ii.item_name IS NOT NULL AND ii.item_name != ''
        HAVING total_mc > 0
        ORDER BY fish_name, size
      `);
      rows.push(...impRows);
    } catch (e) {
      console.error('Failed to fetch import items for stock-summary:', e);
    }

    res.json(rows);
  } catch (error) {
    console.error('Stock summary error:', error);
    res.status(500).json({ error: 'Failed to fetch stock summary' });
  }
});

module.exports = router;
