const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const router = express.Router();
const pool = require('../config/db');
const { authMiddleware, superadminOnly } = require('../middleware/auth');

const UPLOADS_DIR = path.join(__dirname, '..', '..', 'uploads');

/** Reject path traversal; return basename only */
function assertSafeUploadFilename(name) {
  if (typeof name !== 'string' || !name.trim()) return null;
  const t = name.trim();
  if (t.includes('..') || t.includes('/') || t.includes('\\')) return null;
  const base = path.basename(t);
  if (base !== t) return null;
  return base;
}

/** Map original upload names → how many saved OAC checks reference them (via file_summaries). */
async function loadOacOriginalNameRefs() {
  const counts = new Map();
  try {
    const [rows] = await pool.query(
      'SELECT file_summaries FROM oac_checks WHERE file_summaries IS NOT NULL'
    );
    for (const row of rows) {
      let summaries = row.file_summaries;
      if (typeof summaries === 'string') {
        try {
          summaries = JSON.parse(summaries);
        } catch {
          continue;
        }
      }
      if (!Array.isArray(summaries)) continue;
      for (const s of summaries) {
        const on = s && s.originalName;
        if (on && typeof on === 'string') {
          counts.set(on, (counts.get(on) || 0) + 1);
        }
      }
    }
  } catch {
    /* oac_checks may be missing on very old DBs */
  }
  return counts;
}

/**
 * Disk name patterns: upload.js uses `${Date.now()}-${original}`, oac uses `oac-${Date.now()}-${original}`.
 * If the suffix matches an originalName stored in OAC checks, mark as referenced.
 */
function classifyUploadFile(filename, oacRefs) {
  let logicalOriginal = null;
  const oacMatch = filename.match(/^oac-\d+-(.+)$/);
  const plainMatch = filename.match(/^\d+-(.+)$/);
  if (oacMatch) logicalOriginal = oacMatch[1];
  else if (plainMatch) logicalOriginal = plainMatch[1];

  const oacRefCount = logicalOriginal && oacRefs.has(logicalOriginal) ? oacRefs.get(logicalOriginal) : 0;
  if (oacRefCount > 0) {
    return {
      referenceKind: 'oac',
      referenced: true,
      detail: `Original name appears in ${oacRefCount} saved OAC order check(s). Deleting removes the file only; DB rows still mention this name.`,
    };
  }
  return {
    referenceKind: 'none',
    referenced: false,
    detail: 'Not linked in the database (Excel was processed in memory). Safe to delete to free space.',
  };
}

// Ensure settings table exists
async function ensureTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key VARCHAR(100) PRIMARY KEY,
      setting_value TEXT DEFAULT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
}

// Register authenticated upload routes before '/' so they are never shadowed by generic handlers.
// GET server uploads folder listing (superadmin) — frees disk space; shows DB reference hints
router.get('/uploads', authMiddleware, superadminOnly, async (req, res) => {
  try {
    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const names = await fs.readdir(UPLOADS_DIR);
    const oacRefs = await loadOacOriginalNameRefs();
    const files = [];
    let totalBytes = 0;

    for (const name of names) {
      const full = path.join(UPLOADS_DIR, name);
      let st;
      try {
        st = await fs.stat(full);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;

      totalBytes += st.size;
      const meta = classifyUploadFile(name, oacRefs);
      files.push({
        name,
        size: st.size,
        modifiedAt: st.mtime.toISOString(),
        referenced: meta.referenced,
        referenceKind: meta.referenceKind,
        referenceDetail: meta.detail,
      });
    }

    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    res.json({ path: 'backend/uploads', totalBytes, files });
  } catch (error) {
    console.error('Error listing uploads:', error);
    res.status(500).json({ error: 'Failed to list uploads' });
  }
});

// DELETE one or more files from uploads (superadmin)
router.delete('/uploads', authMiddleware, superadminOnly, async (req, res) => {
  try {
    const { filenames } = req.body || {};
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return res.status(400).json({ error: 'Provide filenames: string[]' });
    }
    const deleted = [];
    const errors = [];

    for (const raw of filenames) {
      const safe = assertSafeUploadFilename(raw);
      if (!safe) {
        errors.push({ name: raw, error: 'Invalid filename' });
        continue;
      }
      const full = path.join(UPLOADS_DIR, safe);
      const resolved = path.resolve(full);
      if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) {
        errors.push({ name: safe, error: 'Invalid path' });
        continue;
      }
      try {
        await fs.unlink(resolved);
        deleted.push(safe);
      } catch (e) {
        errors.push({ name: safe, error: e.code === 'ENOENT' ? 'Not found' : e.message });
      }
    }

    res.json({
      deleted,
      errors,
      message: deleted.length ? `Removed ${deleted.length} file(s)` : 'No files deleted',
    });
  } catch (error) {
    console.error('Error deleting uploads:', error);
    res.status(500).json({ error: 'Failed to delete uploads' });
  }
});

// GET all settings
router.get('/', async (req, res) => {
  try {
    await ensureTable();
    const [rows] = await pool.query('SELECT * FROM app_settings');
    const settings = {};
    rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// PUT update settings (body: { key: value, ... })
router.put('/', async (req, res) => {
  try {
    await ensureTable();
    const entries = Object.entries(req.body);
    if (entries.length === 0) return res.status(400).json({ error: 'No settings provided' });

    for (const [key, value] of entries) {
      await pool.query(
        'INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
        [key, value || null, value || null]
      );
    }
    res.json({ message: 'Settings saved', count: entries.length });
  } catch (error) {
    console.error('Error saving settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

module.exports = router;
