import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiSearch, FiPackage, FiBox, FiAnchor } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getProducts, createProduct, updateProduct, deleteProduct, deleteAllProducts } from '../services/api';

const TABS = [
  { id: 'BULK', label: 'Bulk', icon: <FiPackage /> },
  { id: 'CONTAINER_EXTRA', label: 'Container Extra', icon: <FiBox /> },
  { id: 'IMPORT', label: 'Import', icon: <FiAnchor /> }
];

const EMPTY_BULK = { fish_name: '', size: '', bulk_weight_kg: '', type: '', glazing: '' };
const EMPTY_CE = { fish_name: '', size: '', bulk_weight_kg: '', order_code: '' };

function Products() {
  const [activeTab, setActiveTab] = useState('BULK');
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(EMPTY_BULK);

  useEffect(() => { fetchProducts(); }, [activeTab]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const res = await getProducts({ stock_type: activeTab });
      setProducts(Array.isArray(res.data) ? res.data : []);
      if (!Array.isArray(res.data)) {
        toast.error('Backend response is invalid. Check API URL configuration.');
      }
    } catch (err) {
      toast.error('Failed to load products');
      setProducts([]);
    } finally {
      setLoading(false);
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSearch('');
  };

  const isCE = activeTab === 'CONTAINER_EXTRA';
  const isImport = activeTab === 'IMPORT';
  const isNonBulk = isCE || isImport;

  const openAdd = () => {
    setEditing(null);
    setForm(isNonBulk ? { ...EMPTY_CE } : { ...EMPTY_BULK });
    setShowModal(true);
  };

  const openEdit = (p) => {
    setEditing(p);
    if (isNonBulk) {
      setForm({
        fish_name: p.fish_name,
        size: p.size,
        bulk_weight_kg: p.bulk_weight_kg || '',
        order_code: p.order_code || ''
      });
    } else {
      setForm({
        fish_name: p.fish_name,
        size: p.size,
        bulk_weight_kg: p.bulk_weight_kg || '',
        type: p.type || '',
        glazing: p.glazing || ''
      });
    }
    setShowModal(true);
  };

  const isDuplicate = (formData, editingId) => {
    return products.find(p => {
      if (editingId && p.id === editingId) return false;
      if (isNonBulk) {
        return (
          p.fish_name.toLowerCase() === formData.fish_name.trim().toLowerCase() &&
          p.size.toLowerCase() === formData.size.trim().toLowerCase() &&
          (p.order_code || '').toLowerCase() === (formData.order_code || '').trim().toLowerCase()
        );
      }
      return (
        p.fish_name.toLowerCase() === formData.fish_name.trim().toLowerCase() &&
        p.size.toLowerCase() === formData.size.trim().toLowerCase() &&
        (p.type || '').toLowerCase() === (formData.type || '').trim().toLowerCase() &&
        (p.glazing || '').toLowerCase() === (formData.glazing || '').trim().toLowerCase()
      );
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.fish_name || !form.size) {
      toast.warning('Fish name and size are required');
      return;
    }

    const dup = isDuplicate(form, editing?.id);
    if (dup) {
      toast.error(`This product already exists: "${dup.fish_name} - ${dup.size}"`);
      return;
    }

    try {
      const payload = { ...form, stock_type: activeTab };
      if (isNonBulk) {
        payload.type = null;
        payload.glazing = null;
      } else {
        payload.order_code = null;
      }

      if (editing) {
        await updateProduct(editing.id, payload);
        toast.success('Product updated');
      } else {
        await createProduct(payload);
        toast.success('Product created');
      }
      setShowModal(false);
      fetchProducts();
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to save product';
      toast.error(msg);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Deactivate this product?')) return;
    try {
      await deleteProduct(id);
      toast.success('Product deactivated');
      fetchProducts();
    } catch (err) {
      toast.error('Failed to delete product');
    }
  };

  const handleDeleteAll = async () => {
    const label = isCE ? 'Container Extra' : isImport ? 'Import' : 'Bulk';
    if (!window.confirm(`Are you sure you want to delete ALL ${products.length} ${label} products?\n\nThis action will deactivate every product.`)) return;
    if (!window.confirm('This is irreversible. Confirm again to proceed.')) return;
    try {
      const res = await deleteAllProducts({ stock_type: activeTab });
      toast.success(res.data.message || 'All products deleted');
      fetchProducts();
    } catch (err) {
      toast.error('Failed to delete all products');
    }
  };

  const filtered = products.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      p.fish_name.toLowerCase().includes(q) ||
      p.size.toLowerCase().includes(q) ||
      (p.type || '').toLowerCase().includes(q) ||
      (p.glazing || '').toLowerCase().includes(q) ||
      (p.order_code || '').toLowerCase().includes(q)
    );
  });

  if (loading) return <div className="loading"><div className="spinner"></div>Loading products...</div>;

  return (
    <>
      <div className="page-header">
        <h2>Product Master</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          {products.length > 0 && (
            <button className="btn btn-danger" onClick={handleDeleteAll}><FiTrash2 /> Delete All</button>
          )}
          <button className="btn btn-primary" onClick={openAdd}><FiPlus /> Add Product</button>
        </div>
      </div>
      <div className="page-body">
        <div className="stock-type-tabs">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`stock-type-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => handleTabChange(tab.id)}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div className="filter-bar">
          <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
            <FiSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
            <input
              className="form-control"
              style={{ paddingLeft: 36 }}
              placeholder={isNonBulk ? 'Search by order/invoice, fish name, size...' : 'Search by fish name, size, type, glazing...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span style={{ color: 'var(--gray-400)', fontSize: '0.82rem' }}>
            {filtered.length} of {products.length} products
          </span>
        </div>

        <div className="table-container">
          <table className="excel-table">
            <thead>
              <tr>
                <th>#</th>
                {isNonBulk && <th>{isImport ? 'Invoice No' : 'Order'}</th>}
                <th>Fish Name</th>
                <th>Size</th>
                <th>{isNonBulk ? 'Packed Size (KG)' : 'Bulk Weight (KG)'}</th>
                {!isNonBulk && <th>Type</th>}
                {!isNonBulk && <th>Glazing</th>}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={isNonBulk ? 6 : 7} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                  {search ? 'No products match your search.' : 'No products found. Click "Add Product" to create one.'}
                </td></tr>
              ) : filtered.map((p, i) => (
                <tr key={p.id}>
                  <td className="text-center">{i + 1}</td>
                  {isNonBulk && <td><strong>{p.order_code || '-'}</strong></td>}
                  <td><strong>{p.fish_name}</strong></td>
                  <td>{p.size}</td>
                  <td className="num-cell">{Number(p.bulk_weight_kg).toFixed(2)}</td>
                  {!isNonBulk && <td>{p.type || '-'}</td>}
                  {!isNonBulk && <td>{p.glazing || '-'}</td>}
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => openEdit(p)}><FiEdit2 /></button>
                    {' '}
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(p.id)}><FiTrash2 /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? 'Edit Product' : 'Add Product'} ({isCE ? 'Container Extra' : isImport ? 'Import' : 'Bulk'})</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                {isNonBulk && (
                  <div className="form-group">
                    <label>{isImport ? 'Invoice No' : 'Order Code'}</label>
                    <input className="form-control" value={form.order_code || ''} onChange={e => setForm({ ...form, order_code: e.target.value })} placeholder={isImport ? 'e.g. CK25/027/AS-2324' : 'e.g. ADV-01'} />
                  </div>
                )}
                <div className="form-row">
                  <div className="form-group">
                    <label>Fish Name *</label>
                    <input className="form-control" value={form.fish_name} onChange={e => setForm({ ...form, fish_name: e.target.value })} placeholder="e.g. TILAPIA/WR" required />
                  </div>
                  <div className="form-group">
                    <label>Size *</label>
                    <input className="form-control" value={form.size} onChange={e => setForm({ ...form, size: e.target.value })} placeholder="e.g. 800 GM UP" required />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>{isNonBulk ? 'KG per unit' : 'Bulk Weight (KG)'}</label>
                    <input className="form-control" type="number" step="0.01" value={form.bulk_weight_kg} onChange={e => setForm({ ...form, bulk_weight_kg: e.target.value })} placeholder="0.00" />
                  </div>
                  {!isNonBulk && (
                    <div className="form-group">
                      <label>Type</label>
                      <input className="form-control" value={form.type || ''} onChange={e => setForm({ ...form, type: e.target.value })} placeholder="e.g. Frozen" />
                    </div>
                  )}
                </div>
                {!isNonBulk && (
                  <div className="form-group">
                    <label>Glazing</label>
                    <input className="form-control" value={form.glazing || ''} onChange={e => setForm({ ...form, glazing: e.target.value })} placeholder="e.g. 20%" />
                  </div>
                )}
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

export default Products;
