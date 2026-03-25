const express = require('express');
const router = express.Router();
const pool = require('../config/db');
const https = require('https');
const http = require('http');
const nodemailer = require('nodemailer');

// GET low/safety stocks: items where hand_on_balance_kg is below threshold (default 2000)
router.get('/low-stock', async (req, res) => {
  try {
    const thresholdKg = parseFloat(req.query.threshold_kg) || 2000;
    const [rows] = await pool.query(
      'SELECT * FROM inventory_view WHERE hand_on_balance_kg < ? ORDER BY hand_on_balance_kg ASC, fish_name',
      [thresholdKg]
    );

    try {
      const [impRows] = await pool.query(`
        SELECT
          ii.item_name AS fish_name,
          ii.size,
          ii.wet_mc AS bulk_weight_kg,
          s.inv_no AS order_code,
          s.inv_no AS lot_no,
          s.eta AS cs_in_date,
          COALESCE(NULLIF(TRIM(ii.lines), ''), s.origin_country) AS line_place,
          ii.lines AS stack_no,
          ii.remark,
          'IMPORT' AS stock_type,
          NULL AS lot_id,
          NULL AS location_id,
          CONCAT(s.origin_country, ' Import') AS location_code,
          ii.factory_mc - COALESCE((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS hand_on_balance_mc,
          ii.factory_nw_kgs - COALESCE((SELECT SUM(o.nw_kgs) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS hand_on_balance_kg,
          '_shipment' AS _source
        FROM import_items ii
        JOIN import_shipments s ON ii.shipment_id = s.id
        WHERE ii.item_name IS NOT NULL AND ii.item_name != ''
        HAVING hand_on_balance_kg < ?
        ORDER BY hand_on_balance_kg ASC, fish_name
      `, [thresholdKg]);
      rows.push(...impRows);
    } catch (e) {
      console.error('Failed to fetch import items for low-stock:', e);
    }

    rows.sort((a, b) => Number(a.hand_on_balance_kg) - Number(b.hand_on_balance_kg));
    res.json(rows);
  } catch (error) {
    console.error('Error fetching low-stock:', error);
    res.status(500).json({ error: 'Failed to fetch low-stock data' });
  }
});

// GET no-movement stocks: items whose CS-IN Date (from stock table) is 3+ months ago
router.get('/no-movement', async (req, res) => {
  try {
    const months = parseInt(req.query.months) || 3;
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);
    const cutoff = cutoffDate.toISOString().slice(0, 10);

    const [rows] = await pool.query(`
      SELECT
        iv.*,
        last_out.last_out_date,
        DATEDIFF(CURDATE(), iv.cs_in_date) AS days_idle
      FROM inventory_view iv
      LEFT JOIN (
        SELECT lot_id, location_id, MAX(created_at) AS last_out_date
        FROM movements
        WHERE movement_type = 'OUT'
        GROUP BY lot_id, location_id
      ) last_out ON last_out.lot_id = iv.lot_id AND last_out.location_id = iv.location_id
      WHERE iv.cs_in_date <= ?
      ORDER BY days_idle DESC, iv.fish_name
    `, [cutoff]);

    try {
      const [impRows] = await pool.query(`
        SELECT
          ii.item_name AS fish_name,
          ii.size,
          ii.wet_mc AS bulk_weight_kg,
          s.inv_no AS order_code,
          s.inv_no AS lot_no,
          s.eta AS cs_in_date,
          COALESCE(NULLIF(TRIM(ii.lines), ''), s.origin_country) AS line_place,
          ii.lines AS stack_no,
          ii.remark,
          'IMPORT' AS stock_type,
          NULL AS lot_id,
          NULL AS location_id,
          CONCAT(s.origin_country, ' Import') AS location_code,
          ii.factory_mc - COALESCE((SELECT SUM(o.mc) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS hand_on_balance_mc,
          ii.factory_nw_kgs - COALESCE((SELECT SUM(o.nw_kgs) FROM import_stock_outs o WHERE o.item_id = ii.id), 0) AS hand_on_balance_kg,
          (SELECT MAX(o2.created_at) FROM import_stock_outs o2 WHERE o2.item_id = ii.id) AS last_out_date,
          DATEDIFF(CURDATE(), s.eta) AS days_idle,
          '_shipment' AS _source
        FROM import_items ii
        JOIN import_shipments s ON ii.shipment_id = s.id
        WHERE ii.item_name IS NOT NULL AND ii.item_name != ''
          AND s.eta IS NOT NULL AND s.eta <= ?
        HAVING hand_on_balance_mc > 0
        ORDER BY days_idle DESC, fish_name
      `, [cutoff]);
      rows.push(...impRows);
    } catch (e) {
      console.error('Failed to fetch import items for no-movement:', e);
    }

    rows.sort((a, b) => Number(b.days_idle || 0) - Number(a.days_idle || 0));
    res.json(rows);
  } catch (error) {
    console.error('Error fetching no-movement stocks:', error);
    res.status(500).json({ error: 'Failed to fetch no-movement stocks' });
  }
});

// POST send no-movement report via LINE Messaging API (Push Message)
router.post('/no-movement/send-line', async (req, res) => {
  try {
    const { message } = req.body;

    const [rows] = await pool.query(
      "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('line_channel_access_token', 'line_user_id')"
    );
    const settings = {};
    rows.forEach(r => { settings[r.setting_key] = (r.setting_value != null ? String(r.setting_value) : ''); });
    const token = (settings.line_channel_access_token || '').trim();
    // LINE expects user/group ID: non-empty string (e.g. Uxxxxxxxx or Cxxxxxxxx), no control chars
    let userId = (settings.line_user_id != null ? String(settings.line_user_id) : '').trim().replace(/[\s\r\n]+/g, '');
    if (userId === 'null' || userId === 'undefined') userId = '';

    if (!token) return res.status(400).json({ error: 'LINE Channel Access Token not configured. Go to Settings.' });
    if (!userId) return res.status(400).json({ error: 'LINE User/Group ID not configured. Go to Settings and enter the destination User ID or Group ID.' });
    // LINE destination IDs: U (user), C (group), or R (room) + 32 hex chars = 33 total
    if (!/^[UCR][a-fA-F0-9]{32}$/.test(userId)) {
      return res.status(400).json({
        error: 'Invalid LINE User/Group ID. It must be 33 characters: U, C, or R followed by 32 hex digits (e.g. U1234567890abcdef1234567890abcdef). Get it from your webhook or LINE Developers Console.'
      });
    }

    // LINE allows max 5000 chars per message; split into chunks
    const MAX_LEN = 4500;
    const chunks = [];
    for (let i = 0; i < message.length; i += MAX_LEN) {
      chunks.push(message.slice(i, i + MAX_LEN));
    }
    const messages = chunks.map(text => ({ type: 'text', text }));

    const payload = JSON.stringify({ to: userId, messages });

    await new Promise((resolve, reject) => {
      const req2 = https.request({
        hostname: 'api.line.me',
        path: '/v2/bot/message/push',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Content-Length': Buffer.byteLength(payload)
        }
      }, (resp) => {
        let data = '';
        resp.on('data', chunk => data += chunk);
        resp.on('end', () => {
          if (resp.statusCode === 200) resolve(data);
          else reject(new Error(`LINE Messaging API error: ${resp.statusCode} ${data}`));
        });
      });
      req2.on('error', reject);
      req2.write(payload);
      req2.end();
    });

    res.json({ message: 'Sent to LINE successfully' });
  } catch (error) {
    console.error('Error sending LINE notification:', error);
    res.status(500).json({ error: error.message || 'Failed to send LINE notification' });
  }
});

// POST send no-movement report via Email (built-in SMTP or optional webhook URL)
router.post('/no-movement/send-email', async (req, res) => {
  try {
    const { subject, body: emailBody, pdfBase64 } = req.body;

    const [rows] = await pool.query(
      "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('email_to', 'email_webhook_url', 'smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'email_from')"
    );
    const settingsMap = {};
    rows.forEach(r => { settingsMap[r.setting_key] = r.setting_value; });

    const emailTo = settingsMap.email_to;
    const webhookUrl = (settingsMap.email_webhook_url || '').trim();
    const smtpHost = (settingsMap.smtp_host || '').trim();
    const smtpUser = (settingsMap.smtp_user || '').trim();

    if (!emailTo) return res.status(400).json({ error: 'Recipient email not configured. Go to Settings.' });

    const subjectVal = subject || 'No-Movement Stocks Report';
    const bodyVal = emailBody || '';

    // Option A: Use Email Webhook URL (external service)
    if (webhookUrl) {
      const payload = JSON.stringify({
        to: emailTo,
        subject: subjectVal,
        body: bodyVal,
        attachment_base64: pdfBase64 || null,
        attachment_name: 'no-movement-stocks-report.pdf'
      });
      const url = new URL(webhookUrl);
      const lib = url.protocol === 'https:' ? https : http;
      await new Promise((resolve, reject) => {
        const req2 = lib.request({
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload)
          }
        }, (resp) => {
          let data = '';
          resp.on('data', chunk => data += chunk);
          resp.on('end', () => {
            if (resp.statusCode >= 200 && resp.statusCode < 300) resolve(data);
            else reject(new Error(`Webhook error: ${resp.statusCode} ${data}`));
          });
        });
        req2.on('error', reject);
        req2.write(payload);
        req2.end();
      });
      return res.json({ message: 'Email sent successfully (webhook).' });
    }

    // Option B: Use built-in SMTP (Gmail, Outlook, company server)
    if (smtpHost && smtpUser) {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: parseInt(settingsMap.smtp_port || '587', 10),
        secure: settingsMap.smtp_secure === '1' || settingsMap.smtp_secure === 'true',
        auth: {
          user: smtpUser,
          pass: settingsMap.smtp_pass || ''
        }
      });
      const mailOptions = {
        from: settingsMap.email_from || smtpUser,
        to: emailTo,
        subject: subjectVal,
        text: bodyVal
      };
      if (pdfBase64) {
        mailOptions.attachments = [{
          filename: 'no-movement-stocks-report.pdf',
          content: Buffer.from(pdfBase64, 'base64')
        }];
      }
      await transporter.sendMail(mailOptions);
      return res.json({ message: 'Email sent successfully (SMTP).' });
    }

    return res.status(400).json({
      error: 'Configure either "Email Webhook URL" or "SMTP" (host + user) in Settings to send email.'
    });
  } catch (error) {
    console.error('Error sending email:', error);
    res.status(500).json({ error: error.message || 'Failed to send email' });
  }
});

module.exports = router;
