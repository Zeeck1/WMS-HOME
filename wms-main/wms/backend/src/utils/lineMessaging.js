const https = require('https');

async function getLinePushSettings(pool) {
  const [rows] = await pool.query(
    "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('line_channel_access_token', 'line_user_id')"
  );
  const settings = {};
  rows.forEach(r => { settings[r.setting_key] = (r.setting_value != null ? String(r.setting_value) : ''); });
  const token = (settings.line_channel_access_token || '').trim();
  let userId = (settings.line_user_id != null ? String(settings.line_user_id) : '').trim().replace(/[\s\r\n]+/g, '');
  if (userId === 'null' || userId === 'undefined') userId = '';
  return { token, userId };
}

function isValidLineDestination(userId) {
  return userId && /^[UCR][a-fA-F0-9]{32}$/.test(userId);
}

/** LINE text max ~5000; split into multiple text messages in one push payload. */
async function pushLineText(token, userId, text) {
  const MAX_LEN = 4500;
  const chunks = [];
  const body = text != null ? String(text) : '';
  for (let i = 0; i < body.length; i += MAX_LEN) {
    chunks.push(body.slice(i, i + MAX_LEN));
  }
  const messages = chunks.map(t => ({ type: 'text', text: t }));
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
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        if (resp.statusCode === 200) resolve(data);
        else reject(new Error(`LINE Messaging API error: ${resp.statusCode} ${data}`));
      });
    });
    req2.on('error', reject);
    req2.write(payload);
    req2.end();
  });
}

/** Push multiple messages (text + image, etc.) in one request — max 5 per LINE API. */
async function pushLineMessages(token, userId, messages) {
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error('LINE messages array is required');
  }
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
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        if (resp.statusCode === 200) resolve(data);
        else reject(new Error(`LINE Messaging API error: ${resp.statusCode} ${data}`));
      });
    });
    req2.on('error', reject);
    req2.write(payload);
    req2.end();
  });
}

module.exports = {
  getLinePushSettings,
  isValidLineDestination,
  pushLineText,
  pushLineMessages
};
