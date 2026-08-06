const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

if (!process.env.TZ) process.env.TZ = 'Asia/Bangkok';

const { bangkokISOWithOffset } = require('./utils/bangkokTime');

const app = express();
const PORT = process.env.PORT || 5000;

app.set('trust proxy', 1);

// Middleware (raise limit for Send Email with PDF base64 - can be ~20MB+)
app.use(cors());
app.use(express.json({ limit: '30mb' }));
app.use(express.urlencoded({ extended: true, limit: '30mb' }));

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Public files (LINE fetches withdraw-form images by HTTPS URL)
app.use('/uploads', express.static(uploadsDir));

// Auth routes (public)
app.use('/api/auth', require('./routes/auth'));

// API Routes
app.use('/api/products', require('./routes/products'));
app.use('/api/locations', require('./routes/locations'));
app.use('/api/lots', require('./routes/lots'));
app.use('/api/movements', require('./routes/movements'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/manual', require('./routes/manual'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/oac', require('./routes/oac'));
app.use('/api/imports', require('./routes/imports'));
app.use('/api/users', require('./routes/users'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/backup', require('./routes/backup'));
app.use('/api/gemini', require('./routes/geminiChat'));
app.use('/api/ck-intelligence/knowledge', require('./routes/ckKnowledge'));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString(), bangkok: bangkokISOWithOffset() });
});

// Serve React frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '..', '..', 'frontend', 'build')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '..', '..', 'frontend', 'build', 'index.html'));
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

async function runStartupMigrations() {
  const pool = require('./config/db');
  const { ensureUsersAuthColumns } = require('./utils/userAuthColumns');
  const { ensureLocationsLineStackUnique } = require('./utils/locationSchema');
  const { ensureUserWithdrawDepartmentsTable } = require('./utils/withdrawDepartments');
  const { ensureProductsAllowLotClones } = require('./utils/productSchema');
  const { ensureWithdrawFormColumns } = require('./utils/withdrawFormSchema');
  const conn = await pool.getConnection();
  try {
    await ensureUsersAuthColumns(conn);
    console.log('  [startup] Employee auth columns OK');
  } catch (e) {
    console.error('  [startup] Employee auth column migration failed:', e.message);
  } finally {
    conn.release();
  }

  const conn2 = await pool.getConnection();
  try {
    await ensureLocationsLineStackUnique(conn2);
    console.log('  [startup] Locations line+stack index OK');
  } catch (e) {
    console.error('  [startup] Locations index migration failed:', e.message);
  } finally {
    conn2.release();
  }

  const conn3 = await pool.getConnection();
  try {
    await ensureUserWithdrawDepartmentsTable(conn3);
    console.log('  [startup] User withdraw department limits table OK');
  } catch (e) {
    console.error('  [startup] User withdraw department migration failed:', e.message);
  } finally {
    conn3.release();
  }

  const conn4 = await pool.getConnection();
  try {
    await ensureProductsAllowLotClones(conn4);
    console.log('  [startup] Products per-lot clone schema OK');
  } catch (e) {
    console.error('  [startup] Products unique-key migration failed:', e.message);
  } finally {
    conn4.release();
  }

  const conn5 = await pool.getConnection();
  try {
    await ensureWithdrawFormColumns(conn5);
    console.log('  [startup] Withdraw form display columns OK');
  } catch (e) {
    console.error('  [startup] Withdraw form column migration failed:', e.message);
  } finally {
    conn5.release();
  }

  const conn6 = await pool.getConnection();
  try {
    const { snapshotWithdrawItems, freezeWithdrawItemsSnapshot } = require('./utils/withdrawItemSnapshot');
    const [needsSnap] = await conn6.query(
      `SELECT DISTINCT wr.id, wr.status
       FROM withdraw_requests wr
       INNER JOIN withdraw_items wi ON wi.request_id = wr.id
       WHERE wi.snap_fish_name IS NULL`
    );
    for (const row of needsSnap) {
      if (row.status === 'FINISHED') {
        await freezeWithdrawItemsSnapshot(conn6, row.id);
      } else {
        await snapshotWithdrawItems(conn6, row.id);
      }
    }
    if (needsSnap.length > 0) {
      console.log(`  [startup] Backfilled withdraw snapshots for ${needsSnap.length} request(s)`);
    } else {
      console.log('  [startup] Withdraw line snapshots OK');
    }
  } catch (e) {
    console.error('  [startup] Withdraw snapshot backfill failed:', e.message);
  } finally {
    conn6.release();
  }
}

async function startServer() {
  // Run migrations before accepting any requests
  try {
    await runStartupMigrations();
  } catch (e) {
    console.error('[startup] Migration error (server will still start):', e.message);
  }

  app.listen(PORT, () => {
    console.log(`
  ╔═══════════════════════════════════════════╗
  ║   WMS Backend Server                      ║
  ║   Running on http://localhost:${PORT}        ║
  ║   Environment: ${process.env.NODE_ENV || 'development'}            ║
  ╚═══════════════════════════════════════════╝
    `);
  }).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} is busy, retrying in 2 seconds...`);
      setTimeout(() => app.listen(PORT), 2000);
    }
  });
}

startServer();
