import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiShield, FiUser, FiEye, FiEyeOff } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getUsers, createUser, updateUser, deleteUser } from '../services/api';
import { ALL_PAGES } from '../context/AuthContext';

function UserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ username: '', password: '', display_name: '', permissions: [] });
  const [showPw, setShowPw] = useState(false);

  useEffect(() => { fetchUsers(); }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await getUsers();
      setUsers(Array.isArray(res.data) ? res.data : []);
    } catch {
      toast.error('Failed to load users');
    } finally {
      setLoading(false);
    }
  };

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
      fetchUsers();
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
      fetchUsers();
    } catch {
      toast.error('Failed to delete user');
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Loading users...</div>;

  return (
    <>
      <div className="page-header">
        <h2><FiShield style={{ marginRight: 8 }} /> User & Permission Management</h2>
        <button className="btn btn-primary" onClick={openAdd}><FiPlus /> Add User</button>
      </div>

      <div className="page-body">
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

export default UserManagement;
