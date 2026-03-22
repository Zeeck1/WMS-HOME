import React, { useState, useEffect } from 'react';
import { toast } from 'react-toastify';
import { FiSettings, FiSave, FiMail, FiMessageSquare } from 'react-icons/fi';
import { getSettings, saveSettings } from '../services/api';

export default function Settings() {
  const [form, setForm] = useState({
    line_channel_access_token: '',
    line_user_id: '',
    email_to: '',
    email_webhook_url: '',
    smtp_host: '',
    smtp_port: '587',
    smtp_secure: '0',
    smtp_user: '',
    smtp_pass: '',
    email_from: ''
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await getSettings();
        setForm(prev => ({
          ...prev,
          line_channel_access_token: data.line_channel_access_token || '',
          line_user_id: data.line_user_id || '',
          email_to: data.email_to || '',
          email_webhook_url: data.email_webhook_url || '',
          smtp_host: data.smtp_host || '',
          smtp_port: data.smtp_port || '587',
          smtp_secure: data.smtp_secure || '0',
          smtp_user: data.smtp_user || '',
          smtp_pass: data.smtp_pass || '',
          email_from: data.email_from || ''
        }));
      } catch {
        toast.error('Failed to load settings');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleChange = (key, value) => {
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveSettings(form);
      toast.success('Settings saved successfully!');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="page-container"><div className="settings-page"><p>Loading settings...</p></div></div>;

  return (
    <div className="page-container">
      <div className="settings-page">
        <div className="settings-header">
          <FiSettings className="settings-header-icon" />
          <div>
            <h2>Settings</h2>
            <p>Configure messaging and notification integrations</p>
          </div>
        </div>

        <form onSubmit={handleSave} className="settings-form">
          {/* LINE Messaging API Section */}
          <div className="settings-section">
            <div className="settings-section-header">
              <FiMessageSquare className="settings-section-icon settings-icon-line" />
              <div>
                <h3>LINE Messaging API</h3>
                <p>Send no-movement stock reports to LINE (uses your bot Channel Access Token)</p>
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="line_token">Channel Access Token</label>
              <input
                id="line_token"
                type="password"
                placeholder="Paste your Channel Access Token from LINE Developers"
                value={form.line_channel_access_token}
                onChange={e => handleChange('line_channel_access_token', e.target.value)}
              />
              <span className="settings-hint">
                From <a href="https://developers.line.biz/console/" target="_blank" rel="noreferrer">LINE Developers Console</a> — your channel - Messaging API tab - Channel access token (long-term).
              </span>
            </div>
            <div className="settings-field">
              <label htmlFor="line_user_id">User ID or Group ID (destination)</label>
              <input
                id="line_user_id"
                type="text"
                placeholder="e.g. U1234567890abcdef..."
                value={form.line_user_id}
                onChange={e => handleChange('line_user_id', e.target.value)}
              />
              <span className="settings-hint">
                Add your bot as a friend (or to a group), then get the User/Group ID from your webhook when they send a message, or from LINE Developers Console (Insight / Audience).
              </span>
            </div>
          </div>

          {/* Email Section */}
          <div className="settings-section">
            <div className="settings-section-header">
              <FiMail className="settings-section-icon settings-icon-email" />
              <div>
                <h3>Email (No-Movement +3M report)</h3>
                <p>Send report as PDF — use either <strong>SMTP</strong> (recommended) or an optional Webhook URL</p>
              </div>
            </div>
            <div className="settings-field">
              <label htmlFor="email_to">Recipient Email Address</label>
              <input
                id="email_to"
                type="email"
                placeholder="e.g. manager@company.com"
                value={form.email_to}
                onChange={e => handleChange('email_to', e.target.value)}
              />
              <span className="settings-hint">Where the report will be sent</span>
            </div>

            <div className="settings-subsection">
              <h4>Option 1: Built-in SMTP (no webhook needed)</h4>
              <p className="settings-hint" style={{ marginBottom: 12 }}>Use your Gmail, Outlook, or company mail server. For Gmail: enable 2-Step Verification, then create an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">App Password</a> and use it as SMTP password.</p>
              <div className="settings-field-row">
                <div className="settings-field">
                  <label htmlFor="smtp_host">SMTP Host</label>
                  <input
                    id="smtp_host"
                    type="text"
                    placeholder="e.g. smtp.gmail.com"
                    value={form.smtp_host}
                    onChange={e => handleChange('smtp_host', e.target.value)}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="smtp_port">Port</label>
                  <input
                    id="smtp_port"
                    type="text"
                    placeholder="587"
                    value={form.smtp_port}
                    onChange={e => handleChange('smtp_port', e.target.value)}
                  />
                </div>
                <div className="settings-field settings-field-check">
                  <label>
                    <input
                      type="checkbox"
                      checked={form.smtp_secure === '1'}
                      onChange={e => handleChange('smtp_secure', e.target.checked ? '1' : '0')}
                    />
                    <span>Use TLS/SSL (port 465)</span>
                  </label>
                </div>
              </div>
              <div className="settings-field-row">
                <div className="settings-field">
                  <label htmlFor="smtp_user">SMTP User (email)</label>
                  <input
                    id="smtp_user"
                    type="text"
                    placeholder="your@gmail.com"
                    value={form.smtp_user}
                    onChange={e => handleChange('smtp_user', e.target.value)}
                  />
                </div>
                <div className="settings-field">
                  <label htmlFor="smtp_pass">SMTP Password</label>
                  <input
                    id="smtp_pass"
                    type="password"
                    placeholder="App password for Gmail"
                    value={form.smtp_pass}
                    onChange={e => handleChange('smtp_pass', e.target.value)}
                  />
                </div>
              </div>
              <div className="settings-field">
                <label htmlFor="email_from">From address (optional)</label>
                <input
                  id="email_from"
                  type="text"
                  placeholder="Leave blank to use SMTP user"
                  value={form.email_from}
                  onChange={e => handleChange('email_from', e.target.value)}
                />
              </div>
            </div>

            <div className="settings-subsection">
              <h4>Option 2: Email Webhook URL (advanced)</h4>
              <p className="settings-hint" style={{ marginBottom: 8 }}>If you use an external service (e.g. Zapier, Make, or your own server) that accepts POST with JSON: to, subject, body, attachment_base64, attachment_name. Leave blank if using SMTP above.</p>
              <div className="settings-field">
                <label htmlFor="email_webhook">Webhook URL</label>
                <input
                  id="email_webhook"
                  type="url"
                  placeholder="https://your-service.com/send-email"
                  value={form.email_webhook_url}
                  onChange={e => handleChange('email_webhook_url', e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="settings-actions">
            <button type="submit" className="settings-save-btn" disabled={saving}>
              <FiSave /> {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
