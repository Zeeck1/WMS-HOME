import React, { useState, useEffect, useRef, useCallback } from 'react';
import { toast } from 'react-toastify';
import {
  FiSettings, FiSave, FiMail, FiMessageSquare, FiDownload, FiUploadCloud, FiDatabase, FiShield, FiFile,
  FiCheckCircle, FiAlertTriangle, FiFolder, FiTrash2, FiRefreshCw,
} from 'react-icons/fi';
import { getSettings, saveSettings, exportBackup, importBackup, getSettingsUploads, deleteSettingsUploads } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { bangkokYYYYMMDD, bangkokHHMM, bangkokLocaleString } from '../utils/bangkokTime';

function formatUploadBytes(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  const v = Number(n);
  if (v < 1024) return `${v} B`;
  const u = ['KB', 'MB', 'GB'];
  let x = v;
  let i = -1;
  do {
    x /= 1024;
    i++;
  } while (x >= 1024 && i < u.length - 1);
  return `${x.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export default function Settings() {
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';

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

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importFile, setImportFile] = useState(null);
  const [importResult, setImportResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const [uploadList, setUploadList] = useState([]);
  const [uploadTotalBytes, setUploadTotalBytes] = useState(0);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [uploadsDeleting, setUploadsDeleting] = useState(false);
  const [selectedUploads, setSelectedUploads] = useState(() => new Set());

  const loadUploads = useCallback(async () => {
    setUploadsLoading(true);
    try {
      const { data } = await getSettingsUploads();
      setUploadList(data.files || []);
      setUploadTotalBytes(data.totalBytes || 0);
      setSelectedUploads(new Set());
    } catch (err) {
      const status = err.response?.status;
      const raw = err.response?.data;
      const serverMsg =
        typeof raw === 'string'
          ? raw
          : raw?.error || raw?.message || err.message || 'Unknown error';
      if (status === 401) {
        toast.error('Session expired — please sign in again.');
      } else if (status === 403) {
        toast.error('Superadmin access is required to manage server upload files.');
      } else if (status === 404) {
        toast.error(
          'Upload list API not found (404). Restart or redeploy the backend so /api/settings/uploads exists.'
        );
      } else {
        toast.error(
          `Failed to load uploads folder${status ? ` (${status})` : ''}: ${serverMsg}`
        );
      }
    } finally {
      setUploadsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isSuperadmin) loadUploads();
  }, [isSuperadmin, loadUploads]);

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

  const handleExport = async () => {
    setExporting(true);
    try {
      const response = await exportBackup();
      const blob = new Blob([response.data], { type: 'application/sql' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const timestamp = `${bangkokYYYYMMDD()}_${bangkokHHMM().replace(':', '')}`;
      a.href = url;
      a.download = `wms_backup_${timestamp}.sql`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success('Backup file downloaded successfully!');
    } catch {
      toast.error('Failed to export backup');
    } finally {
      setExporting(false);
    }
  };

  const handleFileSelect = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.sql')) {
      toast.error('Only .sql files are accepted');
      return;
    }
    setImportFile(file);
    setImportResult(null);
  };

  const handleImport = async () => {
    if (!importFile) return;

    if (!window.confirm(
      'WARNING: This will overwrite ALL existing data with the backup file contents.\n\n' +
      'This action cannot be undone. Are you sure you want to proceed?'
    )) return;

    setImporting(true);
    setImportResult(null);
    try {
      const { data } = await importBackup(importFile);
      setImportResult({
        success: true,
        executed: data.statements_executed,
        errors: data.error_count || 0,
      });
      toast.success(`Backup restored! ${data.statements_executed} statements executed.`);
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to restore backup';
      setImportResult({ success: false, message: msg });
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFileSelect(file);
  };

  const toggleUploadSelect = (name) => {
    setSelectedUploads((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const allUploadsSelected = uploadList.length > 0 && uploadList.every((f) => selectedUploads.has(f.name));

  const toggleSelectAllUploads = () => {
    if (allUploadsSelected) setSelectedUploads(new Set());
    else setSelectedUploads(new Set(uploadList.map((f) => f.name)));
  };

  const handleDeleteUploads = async (names) => {
    if (!names.length) return;
    const referenced = names.filter((n) => uploadList.find((f) => f.name === n)?.referenced);
    let msg = `Permanently delete ${names.length} file(s) from the server uploads folder?`;
    if (referenced.length > 0) {
      msg += `\n\n${referenced.length} file(s) match a filename recorded in saved Order Checker (OAC) history. Removing the file on disk does not delete OAC results; it only frees disk space.`;
    }
    if (!window.confirm(msg)) return;

    setUploadsDeleting(true);
    try {
      const { data } = await deleteSettingsUploads(names);
      (data.errors || []).forEach((e) => toast.error(`${e.name}: ${e.error}`));
      if ((data.deleted || []).length) toast.success(data.message || 'Files deleted');
      await loadUploads();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    } finally {
      setUploadsDeleting(false);
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

        {isSuperadmin && (
          <div className="settings-backup-wrapper">
            {/* Backup Export Section */}
            <div className="settings-section backup-section">
              <div className="settings-section-header">
                <FiDatabase className="settings-section-icon settings-icon-backup" />
                <div>
                  <h3>Database Backup</h3>
                  <p>Export all data as a downloadable SQL file</p>
                </div>
              </div>
              <div className="backup-export-body">
                <div className="backup-info-card">
                  <FiShield className="backup-info-icon" />
                  <div>
                    <strong>Full Database Export</strong>
                    <p>Downloads a complete .sql backup of all tables including products, locations, lots, movements, withdrawals, customers, imports, users, and settings.</p>
                  </div>
                </div>
                <button
                  className="backup-export-btn"
                  onClick={handleExport}
                  disabled={exporting}
                >
                  <FiDownload />
                  {exporting ? 'Generating backup...' : 'Download Backup (.sql)'}
                </button>
              </div>
            </div>

            {/* Backup Import Section */}
            <div className="settings-section backup-section">
              <div className="settings-section-header">
                <FiUploadCloud className="settings-section-icon settings-icon-restore" />
                <div>
                  <h3>Restore from Backup</h3>
                  <p>Upload a .sql backup file to restore your database</p>
                </div>
              </div>
              <div className="backup-import-body">
                <div className="backup-warning-card">
                  <FiAlertTriangle className="backup-warning-icon" />
                  <div>
                    <strong>Caution</strong>
                    <p>Restoring a backup will <strong>overwrite all existing data</strong>. Make sure to export a current backup first if you want to preserve the current state.</p>
                  </div>
                </div>

                <div
                  className={`backup-dropzone${dragOver ? ' backup-dropzone-active' : ''}${importFile ? ' backup-dropzone-has-file' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".sql"
                    style={{ display: 'none' }}
                    onChange={(e) => handleFileSelect(e.target.files?.[0])}
                  />
                  {importFile ? (
                    <div className="backup-file-selected">
                      <FiFile className="backup-file-icon" />
                      <div>
                        <strong>{importFile.name}</strong>
                        <span>{(importFile.size / 1024).toFixed(1)} KB</span>
                      </div>
                    </div>
                  ) : (
                    <div className="backup-dropzone-placeholder">
                      <FiUploadCloud className="backup-dropzone-icon" />
                      <strong>Drop .sql file here or click to browse</strong>
                      <span>Only .sql backup files are accepted</span>
                    </div>
                  )}
                </div>

                {importFile && (
                  <button
                    className="backup-import-btn"
                    onClick={handleImport}
                    disabled={importing}
                  >
                    <FiUploadCloud />
                    {importing ? 'Restoring backup...' : 'Restore Backup'}
                  </button>
                )}

                {importResult && (
                  <div className={`backup-result ${importResult.success ? 'backup-result-success' : 'backup-result-error'}`}>
                    {importResult.success ? (
                      <>
                        <FiCheckCircle />
                        <span>Restore complete — {importResult.executed} statements executed{importResult.errors > 0 ? `, ${importResult.errors} errors` : ''}</span>
                      </>
                    ) : (
                      <>
                        <FiAlertTriangle />
                        <span>{importResult.message}</span>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Uploads folder — free disk space */}
            <div className="settings-section backup-section">
              <div className="settings-section-header">
                <FiFolder className="settings-section-icon settings-icon-uploads" />
                <div>
                  <h3>Server upload files</h3>
                  <p>Excel and CSV files stay in <code className="settings-inline-code">backend/uploads</code> after processing and can fill the disk</p>
                </div>
              </div>
              <div className="settings-uploads-body">
                <div className="backup-info-card settings-uploads-info">
                  <FiShield className="backup-info-icon" />
                  <div>
                    <strong>How “in use” works</strong>
                    <p>
                      Files whose original name appears in a saved Order Checker (OAC) run are tagged
                      <span className="settings-uploads-badge settings-uploads-badge-ref"> In OAC history</span>.
                      Other uploads are
                      <span className="settings-uploads-badge settings-uploads-badge-ok"> Not in database</span>
                      (typical for stock/Excel import). You can delete either kind to free space; removing an OAC-tagged file does not remove past check results.
                    </p>
                  </div>
                </div>

                <div className="settings-uploads-toolbar">
                  <div className="settings-uploads-meta">
                    {uploadsLoading ? (
                      <span>Loading…</span>
                    ) : (
                      <>
                        <strong>{uploadList.length}</strong> file(s) · <strong>{formatUploadBytes(uploadTotalBytes)}</strong> total
                      </>
                    )}
                  </div>
                  <div className="settings-uploads-actions">
                    <button
                      type="button"
                      className="settings-uploads-refresh"
                      onClick={() => loadUploads()}
                      disabled={uploadsLoading}
                    >
                      <FiRefreshCw />
                      Refresh
                    </button>
                    <button
                      type="button"
                      className="settings-uploads-delete-selected"
                      onClick={() => handleDeleteUploads([...selectedUploads])}
                      disabled={uploadsDeleting || selectedUploads.size === 0}
                    >
                      <FiTrash2 />
                      {uploadsDeleting ? 'Deleting…' : `Delete selected (${selectedUploads.size})`}
                    </button>
                  </div>
                </div>

                <div className="settings-uploads-table-wrap">
                  {uploadList.length === 0 && !uploadsLoading ? (
                    <p className="settings-uploads-empty">No files in the uploads folder.</p>
                  ) : (
                    <table className="settings-uploads-table">
                      <thead>
                        <tr>
                          <th className="settings-uploads-col-check">
                            <input
                              type="checkbox"
                              checked={allUploadsSelected}
                              onChange={toggleSelectAllUploads}
                              disabled={uploadsLoading || uploadList.length === 0}
                              title="Select all"
                            />
                          </th>
                          <th>File</th>
                          <th>Status</th>
                          <th>Size</th>
                          <th>Modified</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {uploadList.map((f) => (
                          <tr key={f.name}>
                            <td>
                              <input
                                type="checkbox"
                                checked={selectedUploads.has(f.name)}
                                onChange={() => toggleUploadSelect(f.name)}
                              />
                            </td>
                            <td className="settings-uploads-name" title={f.referenceDetail}>
                              {f.name}
                            </td>
                            <td>
                              {f.referenced ? (
                                <span className="settings-uploads-badge settings-uploads-badge-ref">In OAC history</span>
                              ) : (
                                <span className="settings-uploads-badge settings-uploads-badge-ok">Not in database</span>
                              )}
                            </td>
                            <td>{formatUploadBytes(f.size)}</td>
                            <td className="settings-uploads-date">
                              {f.modifiedAt ? bangkokLocaleString(new Date(f.modifiedAt)) : '—'}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="settings-uploads-row-delete"
                                onClick={() => handleDeleteUploads([f.name])}
                                disabled={uploadsDeleting}
                                title="Delete this file"
                              >
                                <FiTrash2 />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <form onSubmit={handleSave} className="settings-form">
          {/* LINE Messaging API Section */}
          <div className="settings-section">
            <div className="settings-section-header">
              <FiMessageSquare className="settings-section-icon settings-icon-line" />
              <div>
                <h3>LINE Messaging API</h3>
                <p>Send no-movement stock reports to LINE, live alerts when Manage changes withdrawal quantities, and a text summary when users submit a withdrawal — same Channel Access Token and destination User/Group ID.</p>
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
