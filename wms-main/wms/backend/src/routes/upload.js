const express = require('express');
const router = express.Router();
const multer = require('multer');
const XLSX = require('xlsx');
const path = require('path');
const pool = require('../config/db');

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

// Helper: find or create product (skip if duplicate)
async function findOrCreateProduct(conn, fishName, size, bulkWeight, type, glazing, stockType = 'BULK', orderCode = null) {
  const [existing] = await conn.query(
    `SELECT id FROM products WHERE fish_name = ? AND size = ? AND COALESCE(type,'') = COALESCE(?,'') AND COALESCE(glazing,'') = COALESCE(?,'') AND stock_type = ? AND COALESCE(order_code,'') = COALESCE(?,'') AND is_active = 1`,
    [fishName, size, type || '', glazing || '', stockType, orderCode || '']
  );
  if (existing.length > 0) {
    return { id: existing[0].id, isNew: false };
  }
  const [result] = await conn.query(
    'INSERT INTO products (fish_name, size, bulk_weight_kg, type, glazing, stock_type, order_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [fishName, size, bulkWeight, type || null, glazing || null, stockType, orderCode || null]
  );
  return { id: result.insertId, isNew: true };
}

// Helper: find or create location by line_place only (one location code = one location)
// e.g. A03r-2 appears 5 times in Excel for different products, but is ONE location
async function findOrCreateLocation(conn, linePlace, stackNo, stackTotal) {
  const code = linePlace.toUpperCase().trim();
  const [existing] = await conn.query(
    'SELECT id FROM locations WHERE line_place = ? AND is_active = 1',
    [code]
  );
  if (existing.length > 0) {
    return { id: existing[0].id, isNew: false };
  }
  const [result] = await conn.query(
    'INSERT INTO locations (line_place, stack_no, stack_total) VALUES (?, ?, ?)',
    [code, stackNo, stackTotal]
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
        // Map Excel columns to our fields (flexible column name matching)
        const fishName = (row['Fish Name'] || row['fish_name'] || row['Fish'] || '').toString().trim();
        const size = (row['Size'] || row['size'] || '').toString().trim();
        const bulkWeightRaw = (row['Bulk Weight (KG)'] || row['Bulk weight'] || row['bulk_weight_kg'] || row['Bulk Weight'] || '').toString().trim();
        const bulkWeight = parseFloat(bulkWeightRaw) || 0;
        const type = (row['Type'] || row['type'] || '').toString().trim();
        const glazing = (row['Glazing'] || row['glazing'] || '').toString().trim();
        const csInDate = row['CS-INDATE'] || row['CS In Date'] || row['CS-IN DATE'] || row['CSINDATE'] || row['cs_in_date'] || row['Date'] || '';
        const sticker = (row['Sticker'] || row['sticker'] || '').toString().trim();
        const linePlace = (row['Lines / Place'] || row['Lines/Place'] || row['line_place'] || row['Location'] || '').toString().trim();
        const stackNo = parseInt(row['Stack No'] || row['stack_no'] || 1) || 1;
        const stackTotal = parseInt(row['Stack Total'] || row['stack_total'] || 1) || 1;
        const hobRaw = (row['Hand - on Balance'] || row['Hand On Balance'] || row['Hand-on Balance'] || row['hand_on_balance'] || row['Balance'] || row['Qty'] || '0').toString().trim();
        const handOnBalance = parseInt(hobRaw) || 0;

        if (!fishName || !size) {
          skipped++;
          errors.push(`Row ${i + 2}: Skipped — missing Fish Name or Size`);
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

        // 3. Create lot (LOT prefix: IMP-BULK for bulk Excel import)
        const lotNo = `IMP-BULK-${Date.now()}-${i}`;
        let parsedDate = null;
        if (csInDate) {
          if (csInDate instanceof Date) {
            parsedDate = csInDate.toISOString().split('T')[0];
          } else {
            const ds = csInDate.toString().trim();
            const ddmm = ds.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
            if (ddmm) {
              const [, dd, mm, yyyy] = ddmm;
              parsedDate = `${yyyy}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
            } else {
              const d = new Date(ds);
              if (!isNaN(d.getTime())) parsedDate = d.toISOString().split('T')[0];
            }
          }
        }
        if (!parsedDate) parsedDate = new Date().toISOString().split('T')[0];

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
        const packedSize = parseFloat(row['Packed size'] || row['Packed Size'] || row['packed_size'] || row['Packed size (KG)'] || 0);
        const productionDateRaw = row['Production/Packed Date'] || row['Production Date'] || row['production_date'] || '';
        const expirationDateRaw = row['Expiration Date'] || row['expiration_date'] || row['Exp Date'] || '';
        const balanceMC = parseInt(row['Balance MC'] || row['Balance'] || row['Hand On Balance'] || row['Qty'] || 0) || 0;
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
            productionDate = raw.toISOString().split('T')[0];
          } else {
            const s = raw.toString().trim();
            const mmY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
            if (mmY) {
              const mm = mmY[1].padStart(2, '0');
              const yyyy = mmY[2];
              productionDate = `${yyyy}-${mm}-01`;
            } else {
              const d = new Date(s);
              if (!isNaN(d.getTime())) productionDate = d.toISOString().split('T')[0];
            }
          }
        }
        let expirationDate = null;
        if (expirationDateRaw) {
          const raw = expirationDateRaw;
          if (raw instanceof Date && !isNaN(raw.getTime())) {
            expirationDate = raw.toISOString().split('T')[0];
          } else {
            const s = raw.toString().trim();
            const mmY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
            if (mmY) {
              const mm = mmY[1].padStart(2, '0');
              const yyyy = mmY[2];
              expirationDate = `${yyyy}-${mm}-01`;
            } else {
              const d = new Date(s);
              if (!isNaN(d.getTime())) expirationDate = d.toISOString().split('T')[0];
            }
          }
        }

        // 4. Create lot with extra fields
        const lotNo = `CE-${Date.now()}-${i}`;
        const csInDate = productionDate || new Date().toISOString().split('T')[0];

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
        const kgWeight = parseFloat(row['KG'] || row['Bulk Weight (KG)'] || row['bulk_weight_kg'] || 0);
        const mc = parseInt(row['MC'] || row['Balance MC'] || row['Balance'] || row['Hand On Balance'] || row['Qty'] || 0) || 0;
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
            arrivalDate = raw.toISOString().split('T')[0];
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
              if (!isNaN(d.getTime())) arrivalDate = d.toISOString().split('T')[0];
            }
          }
        }
        if (!arrivalDate) arrivalDate = new Date().toISOString().split('T')[0];

        const lotNo = `IMP-${Date.now()}-${i}`;
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
