import React, { useState, useEffect, useCallback } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiSearch, FiUsers, FiPhone, FiMapPin, FiFileText } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getCustomers, createCustomer, updateCustomer, deleteCustomer } from '../services/api';

const EMPTY = { name: '', address: '', document_no: '', phone: '' };

function CustomerMaster() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
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

  const openAdd = () => { setEditing(null); setForm({ ...EMPTY }); setModalOpen(true); };
  const openEdit = (c) => { setEditing(c); setForm({ name: c.name, address: c.address || '', document_no: c.document_no || '', phone: c.phone || '' }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) return toast.error('ชื่อลูกค้าจำเป็น');
    try {
      if (editing) {
        await updateCustomer(editing.id, form);
        toast.success('อัปเดตแล้ว');
      } else {
        await createCustomer(form);
        toast.success('เพิ่มลูกค้าแล้ว');
      }
      setModalOpen(false);
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

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

      {modalOpen && (
        <div className="modal-overlay" onClick={() => setModalOpen(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3>{editing ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้าใหม่'}</h3>
            <div className="form-group"><label>ลูกค้า (ชื่อ) *</label>
              <input className="form-control" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} autoFocus /></div>
            <div className="form-group"><label>ที่อยู่</label>
              <textarea className="form-control" rows={2} value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} /></div>
            <div className="form-group"><label>เลขที่เอกสาร</label>
              <input className="form-control" value={form.document_no} onChange={e => setForm(f => ({ ...f, document_no: e.target.value }))} /></div>
            <div className="form-group"><label>เบอร์โทร</label>
              <input className="form-control" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} /></div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-outline" onClick={() => setModalOpen(false)}>ยกเลิก</button>
              <button className="btn btn-primary" onClick={handleSave}>{editing ? 'บันทึก' : 'เพิ่ม'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default CustomerMaster;
