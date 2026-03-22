const express = require('express');
const router = express.Router();
const pool = require('../config/db');

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
