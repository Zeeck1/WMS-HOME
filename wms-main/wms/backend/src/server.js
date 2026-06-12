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

app.listen(PORT, async () => {
  console.log(`
  ╔═══════════════════════════════════════════╗
  ║   WMS Backend Server                      ║
  ║   Running on http://localhost:${PORT}        ║
  ║   Environment: ${process.env.NODE_ENV || 'development'}            ║
  ╚═══════════════════════════════════════════╝
  `);

  // Self-healing migration: ensure employee auth columns exist even if db:init was skipped
  try {
    const pool = require('./config/db');
    const conn = await pool.getConnection();
    try {
      const [cols] = await conn.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
           AND COLUMN_NAME IN ('employee_id','approval_status')`
      );
      const have = new Set(cols.map(c => c.COLUMN_NAME));
      if (!have.has('employee_id')) {
        await conn.query('ALTER TABLE users ADD COLUMN employee_id VARCHAR(50) DEFAULT NULL');
        console.log('  [startup] Added employee_id to users');
      }
      if (!have.has('approval_status')) {
        await conn.query("ALTER TABLE users ADD COLUMN approval_status ENUM('pending','approved') DEFAULT NULL");
        console.log('  [startup] Added approval_status to users');
      }
      // Backfill any rows that have employee_id but no approval_status set
      await conn.query(`
        UPDATE users SET approval_status = 'approved'
        WHERE employee_id IS NOT NULL AND employee_id != '' AND is_active = 1
          AND (approval_status IS NULL OR approval_status = '')
      `);
      await conn.query(`
        UPDATE users SET approval_status = 'pending'
        WHERE employee_id IS NOT NULL AND employee_id != '' AND is_active = 0
          AND (approval_status IS NULL OR approval_status = '')
      `);
    } finally {
      conn.release();
    }
  } catch (e) {
    console.error('  [startup] Employee auth column check failed:', e.message);
  }
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is busy, retrying in 2 seconds...`);
    setTimeout(() => app.listen(PORT), 2000);
  }
});
