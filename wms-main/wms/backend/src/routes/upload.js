const express = require('express');
const router = express.Router();
const multer = require('multer');
const crypto = require('crypto');
const XLSX = require('xlsx');
const path = require('path');
const pool = require('../config/db');
const {
  bangkokYYYYMMDD,
  dateToYYYYMMDDInBangkok,
  excelSerialToBangkokYYYYMMDD,
} = require('../utils/bangkokTime');

/**
 * Parse MC / integer quantities from Excel. Fixes "1,277" → 1277 (parseInt alone yields 1).
 */
function parseExcelInt(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
  let s = String(raw).trim();
  if (!s) return 0;
  s = s.replace(/[\s\u00a0]/g, '').replace(/,/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

/**
 * Parse KG / decimals from Excel (commas as thousands or decimal depending on pattern).
 */
function parseExcelFloat(raw) {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  let s = String(raw).trim();
  if (!s) return 0;
  s = s.replace(/[\s\u00a0]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else {
    s = s.replace(/,/g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function makeUniqueLotNo(prefix, rowIndex) {
  const suffix = crypto.randomBytes(3).toString('hex');
  return `${prefix}-${Date.now()}-${rowIndex}-${suffix}`;
}

/** Normalize warehouse line codes from Excel (trim, unicode, case) so lookup matches DB rows */
function normalizeLocationCode(linePlace) {
  if (linePlace == null || linePlace === '') return '';
  let s = String(linePlace).normalize('NFKC').trim();
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, '');
  s = s.replace(/[\u2013\u2014\u2212]/g, '-');
  s = s.replace(/\s+/g, ' ').trim();
  return s.toUpperCase();
}

// Configure multer for file upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
      cb(null, true);
    } else {
      cb(new Error('Only Excel files (.xlsx, .xls) and CSV files are allowed'));
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max
});

// Helper: find or create product (match inactive rows too — avoids duplicate key on unique index)
async function findOrCreateProduct(conn, fishName, size, bulkWeight, type, glazing, stockType = 'BULK', orderCode = null) {
  const [existing] = await conn.query(
    `SELECT id, is_active FROM products WHERE fish_name = ? AND size = ? AND COALESCE(type,'') = COALESCE(?,'') AND COALESCE(glazing,'') = COALESCE(?,'') AND stock_type = ? AND COALESCE(order_code,'') = COALESCE(?,'') LIMIT 1`,
    [fishName, size, type || '', glazing || '', stockType, orderCode || '']
  );
  if (existing.length > 0) {
    const row = existing[0];
    if (!row.is_active) {
      await conn.query(
        'UPDATE products SET is_active = 1, bulk_weight_kg = ? WHERE id = ?',
        [bulkWeight, row.id]
      );
    }
    return { id: row.id, isNew: false };
  }
  const [result] = await conn.query(
    'INSERT INTO products (fish_name, size, bulk_weight_kg, type, glazing, stock_type, order_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [fishName, size, bulkWeight, type || null, glazing || null, stockType, orderCode || null]
  );
  return { id: result.insertId, isNew: true };
}

// Helper: find or create location by line_place only (one code = one location).
// Must not filter is_active: inactive rows still hold UNIQUE(line_place); skipping them caused INSERT duplicate errors.
async function findOrCreateLocation(conn, linePlace, stackNo, stackTotal) {
  const code = normalizeLocationCode(linePlace);
  const stack = parseExcelInt(stackNo) || 1;
  const total = parseExcelInt(stackTotal) || 1;
  if (!code) {
    throw new Error('Missing location / Lines-Place');
  }
  const [existing] = await conn.query(
    'SELECT id, is_active FROM locations WHERE line_place = ? LIMIT 1',
    [code]
  );
  if (existing.length > 0) {
    const loc = existing[0];
    if (!loc.is_active) {
      await conn.query(
        'UPDATE locations SET is_active = 1, stack_no = ?, stack_total = ? WHERE id = ?',
        [stack, total, loc.id]
      );
    }
    return { id: loc.id, isNew: false };
  }
  const [result] = await conn.query(
    'INSERT INTO locations (line_place, stack_no, stack_total, is_active) VALUES (?, ?, ?, 1)',
    [code, stack, total]
  );
  return { id: result.insertId, isNew: true };
}

// POST upload Excel file
router.post('/', upload.single('file'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    await conn.beginTransaction();

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    // raw: true preserves numeric cells as numbers (avoids losing precision); dates may be serial numbers
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });

    if (data.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    let imported = 0;
    let skipped = 0;
    let productsCreated = 0;
    let productsReused = 0;
    let locationsCreated = 0;
    let locationsReused = 0;
    let totalMcImported = 0;
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        // Map Excel columns to our fields (flexible column name matching)
        const fishName = (row['Fish Name'] || row['fish_name'] || row['Fish'] || '').toString().trim();
        const size = (row['Size'] || row['size'] || '').toString().trim() || '-';
        const bulkWeightRaw = row['Bulk Weight (KG)'] ?? row['Bulk weight'] ?? row['bulk_weight_kg'] ?? row['Bulk Weight'] ?? '';
        const bulkWeight = parseExcelFloat(bulkWeightRaw);
        const type = (row['Type'] || row['type'] || '').toString().trim();
        const glazing = (row['Glazing'] || row['glazing'] || '').toString().trim();
        const csInDate = row['CS-INDATE'] ?? row['CS In Date'] ?? row['CS-IN DATE'] ?? row['CSINDATE'] ?? row['cs_in_date'] ?? row['Date'] ?? '';
        const sticker = (row['Sticker'] || row['sticker'] || '').toString().trim();
        const linePlace = (row['Lines / Place'] || row['Lines/Place'] || row['line_place'] || row['Location'] || '').toString().trim();
        const stackNo = parseExcelInt(row['Stack No'] ?? row['stack_no'] ?? 1) || 1;
        const stackTotal = parseExcelInt(row['Stack Total'] ?? row['stack_total'] ?? 1) || 1;
        const hobRaw =
          row['Hand - on Balance'] ??
          row['Hand On Balance'] ??
          row['Hand-on Balance'] ??
          row['HAND ON BALANCE'] ??
          row['hand_on_balance'] ??
          row['Hand on Balance'] ??
          row['Balance MC'] ??
          row['Balance'] ??
          row['MC'] ??
          row['Qty'] ??
          row['Qty MC'] ??
          row['QTY'] ??
          0;
        const handOnBalance = parseExcelInt(hobRaw);

        if (!fishName) {
          skipped++;
          errors.push(`Row ${i + 2}: Skipped — missing Fish Name`);
          continue;
        }

        // 1. Find or create product (no duplicate error)
        const product = await findOrCreateProduct(conn, fishName, size, bulkWeight, type, glazing);
        if (product.isNew) productsCreated++;
        else productsReused++;

        // 2. Find or create location (no duplicate error)
        const locCode = linePlace || `IMPORT-${i + 1}`;
        const location = await findOrCreateLocation(conn, locCode, stackNo, stackTotal);
        if (location.isNew) locationsCreated++;
        else locationsReused++;

        // 3. Create lot (unique lot_no — avoids collisions if many rows share same millisecond)
        const lotNo = makeUniqueLotNo('IMP-BULK', i);
        let parsedDate = null;
        if (csInDate !== '' && csInDate != null) {
          if (csInDate instanceof Date && !Number.isNaN(csInDate.getTime())) {
            parsedDate = dateToYYYYMMDDInBangkok(csInDate);
          } else if (typeof csInDate === 'number') {
            parsedDate = excelSerialToBangkokYYYYMMDD(csInDate);
          } else {
            const ds = csInDate.toString().trim();
            const ddmm = ds.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (ddmm) {
              const [, dd, mm, yyyy] = ddmm;
              parsedDate = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
            } else {
              const d = new Date(ds);
              if (!Number.isNaN(d.getTime())) parsedDate = dateToYYYYMMDDInBangkok(d);
            }
          }
        }
        if (!parsedDate) parsedDate = bangkokYYYYMMDD();

        const [lotResult] = await conn.query(
          'INSERT INTO lots (lot_no, cs_in_date, sticker, product_id) VALUES (?, ?, ?, ?)',
          [lotNo, parsedDate, sticker || null, product.id]
        );
        const lotId = lotResult.insertId;

        // 4. Create IN movement for existing balance
        if (handOnBalance > 0) {
          await conn.query(
            `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, created_by)
             VALUES (?, ?, ?, ?, 'IN', 'EXCEL-IMPORT', 'excel-import')`,
            [lotId, location.id, handOnBalance, handOnBalance * bulkWeight]
          );
          totalMcImported += handOnBalance;
        }

        imported++;
      } catch (rowError) {
        errors.push(`Row ${i + 2}: ${rowError.message}`);
        skipped++;
      }
    }

    await conn.commit();

    res.json({
      message: 'Import completed',
      total_rows: data.length,
      imported,
      skipped,
      total_mc_imported: totalMcImported,
      products_created: productsCreated,
      products_reused: productsReused,
      locations_created: locationsCreated,
      locations_reused: locationsReused,
      errors: errors.slice(0, 20) // Return first 20 errors max
    });

  } catch (error) {
    await conn.rollback();
    console.error('Error processing upload:', error);
    res.status(500).json({ error: 'Failed to process Excel file: ' + error.message });
  } finally {
    conn.release();
  }
});

// POST upload Container Extra Excel file
router.post('/container-extra', upload.single('file'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    await conn.beginTransaction();

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (data.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    let imported = 0;
    let skipped = 0;
    let productsCreated = 0;
    let productsReused = 0;
    let locationsCreated = 0;
    let locationsReused = 0;
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        const orderCode = (row['Order'] || row['order'] || row['Order Code'] || '').toString().trim();
        const fishName = (row['Fish Name'] || row['fish_name'] || row['Fish'] || '').toString().trim();
        const size = (row['Size'] || row['size'] || '').toString().trim() || '-';
        const packedSize = parseExcelFloat(row['Packed size'] || row['Packed Size'] || row['packed_size'] || row['Packed size (KG)'] || 0);
        const productionDateRaw = row['Production/Packed Date'] || row['Production Date'] || row['production_date'] || '';
        const expirationDateRaw = row['Expiration Date'] || row['expiration_date'] || row['Exp Date'] || '';
        const balanceMC = parseExcelInt(row['Balance MC'] || row['Balance'] || row['Hand On Balance'] || row['Qty'] || row['MC'] || 0);
        const stNo = (row['St No'] || row['st_no'] || row['Stock No'] || '').toString().trim();
        const linePlace = (row['Line'] || row['Lines / Place'] || row['line_place'] || row['Location'] || '').toString().trim();
        const remark = (row['Remark'] || row['remark'] || row['Remarks'] || '').toString().trim();

        if (!fishName) {
          skipped++;
          errors.push(`Row ${i + 2}: Skipped — missing Fish Name`);
          continue;
        }

        // 1. Find or create product as CONTAINER_EXTRA
        const product = await findOrCreateProduct(conn, fishName, size, packedSize, null, null, 'CONTAINER_EXTRA', orderCode || null);
        if (product.isNew) productsCreated++;
        else productsReused++;

        // 2. Find or create location
        const locCode = linePlace || `CE-IMPORT-${i + 1}`;
        const location = await findOrCreateLocation(conn, locCode, 1, 1);
        if (location.isNew) locationsCreated++;
        else locationsReused++;

        // 3. Parse dates
        let productionDate = null;
        if (productionDateRaw) {
          const raw = productionDateRaw;
          if (raw instanceof Date && !isNaN(raw.getTime())) {
            productionDate = dateToYYYYMMDDInBangkok(raw);
          } else {
            const s = raw.toString().trim();
            const mmY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
            if (mmY) {
              const mm = mmY[1].padStart(2, '0');
              const yyyy = mmY[2];
              productionDate = `${yyyy}-${mm}-01`;
            } else {
              const d = new Date(s);
              if (!isNaN(d.getTime())) productionDate = dateToYYYYMMDDInBangkok(d);
            }
          }
        }
        let expirationDate = null;
        if (expirationDateRaw) {
          const raw = expirationDateRaw;
          if (raw instanceof Date && !isNaN(raw.getTime())) {
            expirationDate = dateToYYYYMMDDInBangkok(raw);
          } else {
            const s = raw.toString().trim();
            const mmY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
            if (mmY) {
              const mm = mmY[1].padStart(2, '0');
              const yyyy = mmY[2];
              expirationDate = `${yyyy}-${mm}-01`;
            } else {
              const d = new Date(s);
              if (!isNaN(d.getTime())) expirationDate = dateToYYYYMMDDInBangkok(d);
            }
          }
        }

        // 4. Create lot with extra fields
        const lotNo = makeUniqueLotNo('CE', i);
        const csInDate = productionDate || bangkokYYYYMMDD();

        const [lotResult] = await conn.query(
          'INSERT INTO lots (lot_no, cs_in_date, product_id, production_date, expiration_date, st_no, remark) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [lotNo, csInDate, product.id, productionDate, expirationDate, stNo || null, remark || null]
        );
        const lotId = lotResult.insertId;

        // 5. Create IN movement for balance
        if (balanceMC > 0) {
          await conn.query(
            `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, created_by)
             VALUES (?, ?, ?, ?, 'IN', 'CE-EXCEL-IMPORT', 'excel-import')`,
            [lotId, location.id, balanceMC, balanceMC * packedSize]
          );
        }

        imported++;
      } catch (rowError) {
        errors.push(`Row ${i + 2}: ${rowError.message}`);
        skipped++;
      }
    }

    await conn.commit();

    res.json({
      message: 'Container Extra import completed',
      total_rows: data.length,
      imported,
      skipped,
      products_created: productsCreated,
      products_reused: productsReused,
      locations_created: locationsCreated,
      locations_reused: locationsReused,
      errors: errors.slice(0, 20)
    });

  } catch (error) {
    await conn.rollback();
    console.error('Error processing container extra upload:', error);
    res.status(500).json({ error: 'Failed to process Excel file: ' + error.message });
  } finally {
    conn.release();
  }
});

// POST upload Import Excel file
router.post('/import', upload.single('file'), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    await conn.beginTransaction();

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    if (data.length === 0) {
      return res.status(400).json({ error: 'Excel file is empty' });
    }

    let imported = 0;
    let skipped = 0;
    let productsCreated = 0;
    let productsReused = 0;
    let locationsCreated = 0;
    let locationsReused = 0;
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        const fishName = (row['Fish Name'] || row['fish_name'] || row['Fish'] || '').toString().trim();
        const size = (row['Size'] || row['size'] || '').toString().trim() || '-';
        const kgWeight = parseExcelFloat(row['KG'] || row['Bulk Weight (KG)'] || row['bulk_weight_kg'] || 0);
        const mc = parseExcelInt(row['MC'] || row['Balance MC'] || row['Balance'] || row['Hand On Balance'] || row['Qty'] || 0);
        const invoiceNo = (row['Invoice No'] || row['Invoice'] || row['invoice_no'] || row['Order'] || '').toString().trim();
        const arrivalDateRaw = row['Arrival Date'] || row['CS In Date'] || row['Date'] || row['arrival_date'] || '';
        const country = (row['Country'] || row['country'] || '').toString().trim() || null;
        const remark = (row['Remark'] || row['remark'] || row['Remarks'] || '').toString().trim();
        const linePlace = (row['LINE'] || row['Line'] || row['Lines / Place'] || row['line_place'] || row['Location'] || '').toString().trim();

        if (!fishName) {
          skipped++;
          errors.push(`Row ${i + 2}: Skipped — missing Fish Name`);
          continue;
        }

        const product = await findOrCreateProduct(conn, fishName, size, kgWeight, null, null, 'IMPORT', invoiceNo || null);
        if (product.isNew) productsCreated++;
        else productsReused++;

        const locCode = linePlace || `IMP-LOC-${i + 1}`;
        const location = await findOrCreateLocation(conn, locCode, 1, 1);
        if (location.isNew) locationsCreated++;
        else locationsReused++;

        let arrivalDate = null;
        if (arrivalDateRaw) {
          const raw = arrivalDateRaw;
          if (raw instanceof Date && !isNaN(raw.getTime())) {
            arrivalDate = dateToYYYYMMDDInBangkok(raw);
          } else if (typeof raw === 'number') {
            arrivalDate = excelSerialToBangkokYYYYMMDD(raw);
          } else {
            const s = raw.toString().trim();
            // Expect Excel format: DD/MM/YYYY
            const ddmmyyyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (ddmmyyyy) {
              const dd = ddmmyyyy[1].padStart(2, '0');
              const mm = ddmmyyyy[2].padStart(2, '0');
              const yyyy = ddmmyyyy[3];
              arrivalDate = `${yyyy}-${mm}-${dd}`;
            } else {
              const d = new Date(s);
              if (!isNaN(d.getTime())) arrivalDate = dateToYYYYMMDDInBangkok(d);
            }
          }
        }
        if (!arrivalDate) arrivalDate = bangkokYYYYMMDD();

        const lotNo = makeUniqueLotNo('IMP', i);
        const [lotResult] = await conn.query(
          'INSERT INTO lots (lot_no, cs_in_date, product_id, remark, country) VALUES (?, ?, ?, ?, ?)',
          [lotNo, arrivalDate, product.id, remark || null, country]
        );
        const lotId = lotResult.insertId;

        if (mc > 0) {
          await conn.query(
            `INSERT INTO movements (lot_id, location_id, quantity_mc, weight_kg, movement_type, reference_no, created_by)
             VALUES (?, ?, ?, ?, 'IN', 'IMP-EXCEL-IMPORT', 'excel-import')`,
            [lotId, location.id, mc, mc * kgWeight]
          );
        }

        imported++;
      } catch (rowError) {
        errors.push(`Row ${i + 2}: ${rowError.message}`);
        skipped++;
      }
    }

    await conn.commit();

    res.json({
      message: 'Import stock upload completed',
      total_rows: data.length,
      imported,
      skipped,
      products_created: productsCreated,
      products_reused: productsReused,
      locations_created: locationsCreated,
      locations_reused: locationsReused,
      errors: errors.slice(0, 20)
    });

  } catch (error) {
    await conn.rollback();
    console.error('Error processing import upload:', error);
    res.status(500).json({ error: 'Failed to process Excel file: ' + error.message });
  } finally {
    conn.release();
  }
});

module.exports = router;
