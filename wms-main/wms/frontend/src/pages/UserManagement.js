import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  FiPlus, FiEdit2, FiTrash2, FiShield, FiUser, FiEye, FiEyeOff,
  FiUpload, FiUsers, FiClock, FiCheck, FiX, FiDownload, FiRefreshCw,
  FiHash, FiBriefcase, FiMapPin
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import {
  getUsers, createUser, updateUser, deleteUser,
  getPendingUsers, approveUser,
  getEmployees, uploadEmployees, deleteAllEmployees,
} from '../services/api';
import { ALL_PAGES } from '../context/AuthContext';

// ─── Utility: parse xlsx/csv ──────────────────────────────
const EXCEL_COL_MAP = {
  'รหัสพนักงาน': 'employee_id',
  'ชื่อ - สกุล': 'full_name',
  'ชื่อ-สกุล': 'full_name',
  'ชื่อ_สกุล': 'full_name',
  'ตำแหน่ง(ไทย)': 'position',
  'ตำแหน่ง': 'position',
  '(ไทย) ฝ่าย': 'division',
  'ฝ่าย': 'division',
  '(ไทย) แผนก': 'department',
  'แผนก': 'department',
  '(ไทย) สถานที่ทำงาน': 'work_location',
  'สถานที่ทำงาน': 'work_location',
};

function parseEmployeeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

        const mapped = rows
          .map((row) => {
            const obj = {};
            for (const [header, val] of Object.entries(row)) {
              const key = EXCEL_COL_MAP[header.trim()] || null;
              if (key) obj[key] = String(val).trim();
            }
            return obj;
          })
          .filter((r) => r.employee_id && r.full_name);

        resolve(mapped);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// ─── Sub-components ───────────────────────────────────────

function UsersTab({ users, loading, onRefresh }) {
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', display_name: '', permissions: [] });
  const [showPw, setShowPw] = useState(false);

  const openAdd = () => {
    setEditing(null);
    setForm({ username: '', password: '', display_name: '', permissions: ALL_PAGES.map(p => p.key) });
    setShowPw(false);
    setShowModal(true);
  };

  const openEdit = (u) => {
    setEditing(u);
    setForm({ username: u.username, password: '', display_name: u.display_name || '', permissions: u.permissions || [] });
    setShowPw(false);
    setShowModal(true);
  };

  const togglePermission = (key) => {
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(key)
        ? prev.permissions.filter(k => k !== key)
        : [...prev.permissions, key]
    }));
  };

  const selectAll = () => setForm(prev => ({ ...prev, permissions: ALL_PAGES.map(p => p.key) }));
  const clearAll = () => setForm(prev => ({ ...prev, permissions: [] }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.username) { toast.warning('Username is required'); return; }
    if (!editing && !form.password) { toast.warning('Password is required for new users'); return; }
    try {
      const payload = {
        username: form.username,
        display_name: form.display_name || form.username,
        permissions: form.permissions
      };
      if (form.password) payload.password = form.password;
      if (editing) {
        await updateUser(editing.id, payload);
        toast.success('User updated');
      } else {
        payload.password = form.password;
        await createUser(payload);
        toast.success('User created');
      }
      setShowModal(false);
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save user');
    }
  };

  const handleDelete = async (u) => {
    if (u.role === 'superadmin') { toast.error('Cannot delete superadmin'); return; }
    if (!window.confirm(`Deactivate user "${u.username}"?`)) return;
    try {
      await deleteUser(u.id);
      toast.success('User deactivated');
      onRefresh();
    } catch {
      toast.error('Failed to delete user');
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />Loading users...</div>;

  return (
    <>
      <div className="um-tab-actions">
        <button className="btn btn-primary" onClick={openAdd}><FiPlus /> Add User</button>
      </div>

      <div className="table-container">
        <table className="excel-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Username</th>
              <th>Display Name</th>
              <th>Role</th>
              <th>Pages Allowed</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No users found.</td></tr>
            ) : users.map((u, i) => (
              <tr key={u.id}>
                <td className="text-center">{i + 1}</td>
                <td><strong>{u.username}</strong></td>
                <td>{u.display_name || '-'}</td>
                <td>
                  <span className={`um-role-badge ${u.role === 'superadmin' ? 'um-role-super' : 'um-role-user'}`}>
                    {u.role === 'superadmin' ? 'Superadmin' : 'User'}
                  </span>
                </td>
                <td>
                  {u.role === 'superadmin'
                    ? <span style={{ color: 'var(--success)', fontWeight: 500 }}>All Pages</span>
                    : <span>{u.permissions?.length || 0} / {ALL_PAGES.length}</span>
                  }
                </td>
                <td>
                  <span className={`um-status-badge ${u.is_active ? 'um-active' : 'um-inactive'}`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td>
                  {u.role !== 'superadmin' && (
                    <>
                      <button className="btn btn-outline btn-sm" onClick={() => openEdit(u)}><FiEdit2 /></button>
                      {' '}
                      <button className="btn btn-danger btn-sm" onClick={() => handleDelete(u)}><FiTrash2 /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal um-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? 'Edit User' : 'Create User'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-row">
                  <div className="form-group">
                    <label><FiUser style={{ marginRight: 4 }} /> Username *</label>
                    <input className="form-control" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Display Name</label>
                    <input className="form-control" value={form.display_name} onChange={e => setForm({ ...form, display_name: e.target.value })} />
                  </div>
                </div>
                <div className="form-group" style={{ position: 'relative' }}>
                  <label>{editing ? 'New Password (leave blank to keep current)' : 'Password *'}</label>
                  <input
                    className="form-control"
                    type={showPw ? 'text' : 'password'}
                    value={form.password}
                    onChange={e => setForm({ ...form, password: e.target.value })}
                    required={!editing}
                  />
                  <button type="button" className="um-eye-btn" onClick={() => setShowPw(!showPw)}>
                    {showPw ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
                <div className="um-perm-section">
                  <div className="um-perm-header">
                    <label><FiShield style={{ marginRight: 4 }} /> Page Permissions</label>
                    <div>
                      <button type="button" className="btn btn-outline btn-sm" onClick={selectAll}>Select All</button>
                      {' '}
                      <button type="button" className="btn btn-outline btn-sm" onClick={clearAll}>Clear All</button>
                    </div>
                  </div>
                  <div className="um-perm-grid">
                    {ALL_PAGES.map(page => (
                      <label key={page.key} className={`um-perm-item ${form.permissions.includes(page.key) ? 'um-perm-on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={form.permissions.includes(page.key)}
                          onChange={() => togglePermission(page.key)}
                        />
                        <span>{page.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function EmployeesTab({ employees, loading, onRefresh }) {
  const fileRef = useRef();
  const [preview, setPreview] = useState(null); // parsed rows before upload
  const [uploading, setUploading] = useState(false);
  const [replaceAll, setReplaceAll] = useState(false);
  const [search, setSearch] = useState('');

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const rows = await parseEmployeeFile(file);
      if (rows.length === 0) {
        toast.error('No valid rows found. Check column headers match the expected format.');
        return;
      }
      setPreview(rows);
      toast.info(`Parsed ${rows.length} employee records. Review and confirm upload.`);
    } catch (err) {
      toast.error('Failed to parse file: ' + err.message);
    }
    e.target.value = '';
  };

  const handleUpload = async () => {
    if (!preview || preview.length === 0) return;
    setUploading(true);
    try {
      const res = await uploadEmployees({ employees: preview, replace: replaceAll });
      toast.success(res.data.message);
      setPreview(null);
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleClearAll = async () => {
    if (!window.confirm('Delete ALL employee records? This will not affect existing user accounts.')) return;
    try {
      await deleteAllEmployees();
      toast.success('All employee records deleted');
      onRefresh();
    } catch {
      toast.error('Failed to delete employees');
    }
  };

  const displayed = (preview || employees || []).filter(e =>
    !search ||
    String(e.employee_id || '').toLowerCase().includes(search.toLowerCase()) ||
    String(e.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
    String(e.department || '').toLowerCase().includes(search.toLowerCase())
  );

  return (
    <>
      {/* Upload section */}
      <div className="um-emp-upload-bar">
        <div className="um-emp-upload-left">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
          <button className="btn btn-primary" onClick={() => fileRef.current.click()}>
            <FiUpload /> Upload Excel / CSV
          </button>

          <label className="um-replace-toggle">
            <input type="checkbox" checked={replaceAll} onChange={e => setReplaceAll(e.target.checked)} />
            Replace all existing records
          </label>

          {preview && (
            <>
              <span className="um-preview-badge">{preview.length} rows ready</span>
              <button className="btn btn-success btn-sm" onClick={handleUpload} disabled={uploading}>
                {uploading ? <span className="login-spinner" /> : <FiCheck />}
                {uploading ? 'Uploading...' : 'Confirm Upload'}
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => setPreview(null)}>
                <FiX /> Cancel
              </button>
            </>
          )}
        </div>
        <div className="um-emp-upload-right">
          <button className="btn btn-outline btn-sm" onClick={onRefresh}><FiRefreshCw /></button>
          <button className="btn btn-danger btn-sm" onClick={handleClearAll}><FiTrash2 /> Clear All</button>
        </div>
      </div>

      {/* Expected format hint */}
      <div className="um-emp-hint">
        <strong>Expected columns:</strong> รหัสพนักงาน &nbsp;|&nbsp; ชื่อ - สกุล &nbsp;|&nbsp; ตำแหน่ง(ไทย) &nbsp;|&nbsp; (ไทย) ฝ่าย &nbsp;|&nbsp; (ไทย) แผนก &nbsp;|&nbsp; (ไทย) สถานที่ทำงาน
      </div>

      {/* Search */}
      <div className="um-emp-search">
        <input
          className="form-control"
          placeholder="Search by ID, name, or department..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 320 }}
        />
        <span className="um-emp-count">
          {preview ? `Preview: ${displayed.length} rows` : `${employees.length} employees in database`}
        </span>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner" />Loading...</div>
      ) : (
        <div className="table-container">
          <table className="excel-table">
            <thead>
              <tr>
                <th>#</th>
                <th><FiHash style={{ marginRight: 4 }} />รหัสพนักงาน</th>
                <th><FiUser style={{ marginRight: 4 }} />ชื่อ - สกุล</th>
                <th><FiBriefcase style={{ marginRight: 4 }} />ตำแหน่ง</th>
                <th>ฝ่าย</th>
                <th>แผนก</th>
                <th><FiMapPin style={{ marginRight: 4 }} />สถานที่ทำงาน</th>
              </tr>
            </thead>
            <tbody>
              {displayed.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                    {preview ? 'No matching rows in preview.' : 'No employee data. Upload an Excel or CSV file.'}
                  </td>
                </tr>
              ) : displayed.map((e, i) => (
                <tr key={e.employee_id || i}>
                  <td className="text-center">{i + 1}</td>
                  <td><strong>{e.employee_id}</strong></td>
                  <td>{e.full_name}</td>
                  <td>{e.position || '-'}</td>
                  <td>{e.division || '-'}</td>
                  <td>{e.department || '-'}</td>
                  <td>{e.work_location || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function PendingTab({ pending, loading, onRefresh }) {
  const [approveModal, setApproveModal] = useState(null); // user object
  const [permissions, setPermissions] = useState([]);

  const openApprove = (u) => {
    setApproveModal(u);
    setPermissions([]);
  };

  const togglePerm = (key) => {
    setPermissions(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const selectAll = () => setPermissions(ALL_PAGES.map(p => p.key));
  const clearAll = () => setPermissions([]);

  const handleApprove = async () => {
    if (!approveModal) return;
    try {
      await approveUser(approveModal.id, { permissions });
      toast.success(`${approveModal.display_name} approved and activated`);
      setApproveModal(null);
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to approve user');
    }
  };

  const handleReject = async (u) => {
    if (!window.confirm(`Reject and deactivate "${u.display_name}"?`)) return;
    try {
      await updateUser(u.id, { is_active: 0 });
      toast.success('User rejected');
      onRefresh();
    } catch {
      toast.error('Failed to reject user');
    }
  };

  if (loading) return <div className="loading"><div className="spinner" />Loading...</div>;

  return (
    <>
      <div className="um-tab-actions">
        <button className="btn btn-outline btn-sm" onClick={onRefresh}><FiRefreshCw /> Refresh</button>
      </div>

      {pending.length === 0 ? (
        <div className="um-empty-pending">
          <FiCheck style={{ fontSize: 40, color: 'var(--success)', marginBottom: 12 }} />
          <p>No pending approvals. All employee logins have been processed.</p>
        </div>
      ) : (
        <div className="table-container">
          <table className="excel-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Employee ID</th>
                <th>Display Name</th>
                <th>ตำแหน่ง / Position</th>
                <th>แผนก / Dept</th>
                <th>Registered</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pending.map((u, i) => (
                <tr key={u.id}>
                  <td className="text-center">{i + 1}</td>
                  <td><strong>{u.employee_id}</strong></td>
                  <td>{u.display_name}</td>
                  <td>{u.position || '-'}</td>
                  <td>{u.department || '-'}</td>
                  <td style={{ fontSize: '0.8rem', color: '#888' }}>
                    {u.created_at ? new Date(u.created_at).toLocaleDateString('th-TH') : '-'}
                  </td>
                  <td>
                    <button className="btn btn-success btn-sm" onClick={() => openApprove(u)} style={{ marginRight: 6 }}>
                      <FiCheck /> Approve
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => handleReject(u)}>
                      <FiX /> Reject
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approveModal && (
        <div className="modal-overlay" onClick={() => setApproveModal(null)}>
          <div className="modal um-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3><FiCheck style={{ marginRight: 6, color: 'var(--success)' }} /> Approve User</h3>
              <button className="modal-close" onClick={() => setApproveModal(null)}>&times;</button>
            </div>
            <div className="modal-body">
              <div className="um-approve-info">
                <div><strong>Employee ID:</strong> {approveModal.employee_id}</div>
                <div><strong>Name:</strong> {approveModal.display_name}</div>
                {approveModal.position && <div><strong>Position:</strong> {approveModal.position}</div>}
                {approveModal.department && <div><strong>Department:</strong> {approveModal.department}</div>}
              </div>
              <div className="um-perm-section" style={{ marginTop: 16 }}>
                <div className="um-perm-header">
                  <label><FiShield style={{ marginRight: 4 }} /> Assign Page Permissions</label>
                  <div>
                    <button type="button" className="btn btn-outline btn-sm" onClick={selectAll}>Select All</button>
                    {' '}
                    <button type="button" className="btn btn-outline btn-sm" onClick={clearAll}>Clear All</button>
                  </div>
                </div>
                <div className="um-perm-grid">
                  {ALL_PAGES.map(page => (
                    <label key={page.key} className={`um-perm-item ${permissions.includes(page.key) ? 'um-perm-on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={permissions.includes(page.key)}
                        onChange={() => togglePerm(page.key)}
                      />
                      <span>{page.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-outline" onClick={() => setApproveModal(null)}>Cancel</button>
              <button className="btn btn-success" onClick={handleApprove}>
                <FiCheck /> Approve & Activate
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Main page ────────────────────────────────────────────

function UserManagement() {
  const [tab, setTab] = useState('users'); // 'users' | 'employees' | 'pending'
  const [users, setUsers] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [pending, setPending] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [loadingPending, setLoadingPending] = useState(false);

  useEffect(() => { fetchAll(); }, []);

  const fetchAll = () => {
    fetchUsers();
    fetchEmployees();
    fetchPending();
  };

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const res = await getUsers();
      setUsers(Array.isArray(res.data) ? res.data : []);
    } catch { toast.error('Failed to load users'); }
    finally { setLoadingUsers(false); }
  };

  const fetchEmployees = async () => {
    setLoadingEmployees(true);
    try {
      const res = await getEmployees();
      setEmployees(Array.isArray(res.data) ? res.data : []);
    } catch { /* silent */ }
    finally { setLoadingEmployees(false); }
  };

  const fetchPending = async () => {
    setLoadingPending(true);
    try {
      const res = await getPendingUsers();
      setPending(Array.isArray(res.data) ? res.data : []);
    } catch { /* silent */ }
    finally { setLoadingPending(false); }
  };

  const TABS = [
    { key: 'users',     label: 'Users',              icon: FiUser,    badge: null },
    { key: 'employees', label: 'Employee Directory',  icon: FiUsers,   badge: null },
    { key: 'pending',   label: 'Pending Approvals',   icon: FiClock,   badge: pending.length || null },
  ];

  return (
    <>
      <div className="page-header">
        <h2><FiShield style={{ marginRight: 8 }} /> User & Permission Management</h2>
      </div>

      <div className="page-body">
        {/* Tab nav */}
        <div className="um-main-tabs">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                className={`um-main-tab ${tab === t.key ? 'um-main-tab--active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <Icon style={{ marginRight: 6 }} />
                {t.label}
                {t.badge != null && t.badge > 0 && (
                  <span className="um-tab-badge">{t.badge}</span>
                )}
              </button>
            );
          })}
        </div>

        <div className="um-tab-content">
          {tab === 'users' && (
            <UsersTab users={users} loading={loadingUsers} onRefresh={fetchUsers} />
          )}
          {tab === 'employees' && (
            <EmployeesTab employees={employees} loading={loadingEmployees} onRefresh={fetchEmployees} />
          )}
          {tab === 'pending' && (
            <PendingTab pending={pending} loading={loadingPending} onRefresh={fetchAll} />
          )}
        </div>
      </div>
    </>
  );
}

export default UserManagement;
