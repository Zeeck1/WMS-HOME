import React, { useState, useEffect, useCallback } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiSearch, FiUsers, FiPhone, FiMapPin, FiFileText, FiX } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from '../services/api';

const EMPTY = { name: '', address: '', document_no: '', phone: '' };

function BilingualLabel({ en, th, required }) {
  return (
    <label className="cm-bilingual-label">
      <span className="cm-label-en">{en}</span>
      <span className="cm-label-slash"> / </span>
      <span className="cm-label-th">{th}</span>
      {required ? <span className="cm-label-req"> *</span> : null}
    </label>
  );
}

function CustomerMaster() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY });

  const load = useCallback(async () => {
    try {
      const res = await getCustomers();
      setCustomers(res.data);
    } catch { toast.error('Failed to load customers'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = customers.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.document_no || '').toLowerCase().includes(q);
  });

  const closeDrawer = useCallback(() => {
    setDrawerOpen(false);
    setEditing(null);
  }, []);

  const openAdd = () => {
    setEditing(null);
    setForm({ ...EMPTY });
    setDrawerOpen(true);
  };

  const openEdit = (c) => {
    setEditing(c);
    setForm({
      name: c.name,
      address: c.address || '',
      document_no: c.document_no || '',
      phone: c.phone || '',
    });
    setDrawerOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error('Customer name is required / ต้องระบุชื่อลูกค้า');
      return;
    }
    try {
      if (editing) {
        await updateCustomer(editing.id, form);
        toast.success('Updated / อัปเดตแล้ว');
      } else {
        await createCustomer(form);
        toast.success('Customer added / เพิ่มลูกค้าแล้ว');
      }
      closeDrawer();
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed');
    }
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeDrawer();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawerOpen, closeDrawer]);

  const handleDelete = async (c) => {
    if (!window.confirm(`ลบลูกค้า "${c.name}"?`)) return;
    try {
      await deleteCustomer(c.id);
      toast.success('ลบแล้ว');
      load();
    } catch { toast.error('Failed to delete'); }
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Loading...</div>;

  return (
    <>
      <div className="page-header">
        <h2><FiUsers style={{ marginRight: 8 }} /> Customer Stock Master</h2>
        <button className="btn btn-primary" onClick={openAdd}><FiPlus /> เพิ่มลูกค้า</button>
      </div>
      <div className="page-body">
        <div className="filter-bar" style={{ marginBottom: 16 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <FiSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#999' }} />
            <input className="form-control" style={{ paddingLeft: 36 }} placeholder="ค้นหาลูกค้า..."
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="cm-grid">
          {filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: '#999' }}>ไม่พบลูกค้า</div>
          ) : filtered.map(c => (
            <div key={c.id} className="cm-card">
              <div className="cm-card-header">
                <h3>{c.name}</h3>
                <div className="cm-card-actions">
                  <button className="btn btn-outline btn-sm" onClick={() => openEdit(c)}><FiEdit2 /></button>
                  <button className="btn btn-outline btn-sm" onClick={() => handleDelete(c)} style={{ color: '#ef4444' }}><FiTrash2 /></button>
                </div>
              </div>
              <div className="cm-card-body">
                {c.address && <div className="cm-field"><FiMapPin size={14} /> {c.address}</div>}
                {c.document_no && <div className="cm-field"><FiFileText size={14} /> {c.document_no}</div>}
                {c.phone && <div className="cm-field"><FiPhone size={14} /> {c.phone}</div>}
                {!c.address && !c.document_no && !c.phone && <div className="cm-field" style={{ color: '#ccc' }}>ไม่มีข้อมูลเพิ่มเติม</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {drawerOpen && (
        <>
          <button
            type="button"
            className="cm-drawer-backdrop"
            aria-label="Close panel"
            onClick={closeDrawer}
          />
          <aside className="cm-drawer" role="dialog" aria-modal="true" aria-labelledby="cm-drawer-title">
            <div className="cm-drawer-header">
              <div>
                <h3 id="cm-drawer-title" className="cm-drawer-title-en">
                  {editing ? 'Edit customer' : 'Add customer'}
                </h3>
                <p className="cm-drawer-title-th">
                  {editing ? 'แก้ไขข้อมูลลูกค้า' : 'เพิ่มลูกค้าใหม่'}
                </p>
              </div>
              <button type="button" className="cm-drawer-close" onClick={closeDrawer} aria-label="Close">
                <FiX />
              </button>
            </div>
            <div className="cm-drawer-body">
              <div className="form-group">
                <BilingualLabel en="Customer name" th="ชื่อลูกค้า" required />
                <input
                  className="form-control"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <BilingualLabel en="Address" th="ที่อยู่" />
                <textarea
                  className="form-control"
                  rows={3}
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Street, district, province… / บ้านเลขที่ แขวง จังหวัด…"
                />
              </div>
              <div className="form-group">
                <BilingualLabel en="Document no." th="เลขที่เอกสาร" />
                <input
                  className="form-control"
                  value={form.document_no}
                  onChange={(e) => setForm((f) => ({ ...f, document_no: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <BilingualLabel en="Phone" th="เบอร์โทรศัพท์" />
                <input
                  className="form-control"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
            </div>
            <div className="cm-drawer-footer">
              <button type="button" className="btn btn-outline" onClick={closeDrawer}>
                <span className="cm-btn-bi">Cancel</span>
                <span className="cm-btn-bi-sub">ยกเลิก</span>
              </button>
              <button type="button" className="btn btn-primary" onClick={handleSave}>
                <span className="cm-btn-bi">{editing ? 'Save changes' : 'Add customer'}</span>
                <span className="cm-btn-bi-sub">{editing ? 'บันทึก' : 'เพิ่มลูกค้า'}</span>
              </button>
            </div>
          </aside>
        </>
      )}
    </>
  );
}

export default CustomerMaster;
