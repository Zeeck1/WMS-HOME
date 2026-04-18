import React, { useState, useEffect, useRef } from 'react';
import { FiArrowDownCircle, FiPlus, FiUpload, FiFile, FiCheckCircle, FiAlertCircle } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getProducts, getLocations, getLots, createLot, stockIn, uploadExcel } from '../services/api';
import { bangkokYYYYMMDD } from '../utils/bangkokTime';

function getLotLabel(lot) {
  if (!lot) return '';
  const parts = [lot.lot_no, lot.fish_name || 'N/A'];
  const attrs = [];
  if (lot.order_code) attrs.push(`Order: ${lot.order_code}`);
  if (lot.size) attrs.push(`Size: ${lot.size}`);
  if (lot.type) attrs.push(`Type: ${lot.type}`);
  if (lot.glazing) attrs.push(`Glazing: ${lot.glazing}`);
  if (attrs.length) parts.push(attrs.join(' · '));
  parts.push(`(${lot.cs_in_date})`);
  return parts.join(' | ');
}

function StockIn() {
  const [products, setProducts] = useState([]);
  const [locations, setLocations] = useState([]);
  const [lots, setLots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState({
    lot_id: '',
    location_id: '',
    quantity_mc: '',
    weight_kg: '',
    reference_no: '',
    notes: ''
  });

  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const uploadFileRef = useRef(null);

  const [lotFilters, setLotFilters] = useState({
    fish_name: '',
    size: '',
    type: '',
    glazing: '',
    order_code: ''
  });
  const [lotSearch, setLotSearch] = useState('');
  const [lotDropdownOpen, setLotDropdownOpen] = useState(false);
  const lotDropdownRef = useRef(null);

  const [showNewLot, setShowNewLot] = useState(false);
  const [newLot, setNewLot] = useState({
    lot_no: '',
    lot_no_numeric: '',
    cs_in_date: bangkokYYYYMMDD(),
    sticker: '',
    product_id: '',
    notes: '',
    production_date: '',
    expiration_date: '',
    st_no: '',
    remark: ''
  });

  useEffect(() => {
    setLoading(true);
    Promise.all([
      getProducts(),
      getLocations(),
      getLots()
    ])
      .then(([pRes, lRes, lotRes]) => {
        setProducts(pRes.data);
        setLocations(lRes.data);
        setLots(lotRes.data);
      })
      .catch(() => toast.error('Failed to load data'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    function handleClickOutside(e) {
      if (lotDropdownRef.current && !lotDropdownRef.current.contains(e.target)) {
        setLotDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filterMatch = (l) => {
    const fish = (l.fish_name || '').toLowerCase();
    const sz = (l.size || '').toLowerCase();
    const ty = (l.type || '').toLowerCase();
    const gl = (l.glazing || '').toLowerCase();
    const oc = (l.order_code || '').toLowerCase();
    const fFish = (lotFilters.fish_name || '').toLowerCase().trim();
    const fSize = (lotFilters.size || '').toLowerCase().trim();
    const fType = (lotFilters.type || '').toLowerCase().trim();
    const fGlazing = (lotFilters.glazing || '').toLowerCase().trim();
    const fOC = (lotFilters.order_code || '').toLowerCase().trim();
    if (fFish && !fish.includes(fFish)) return false;
    if (fSize && !sz.includes(fSize)) return false;
    if (fType && !ty.includes(fType)) return false;
    if (fGlazing && !gl.includes(fGlazing)) return false;
    if (fOC && !oc.includes(fOC)) return false;
    return true;
  };

  const lotSearchLower = (lotSearch || '').toLowerCase().trim();
  const filteredByAttrs = lots.filter(filterMatch);
  const filteredLots = lotSearchLower
    ? filteredByAttrs.filter(l => {
        const lotNo = (l.lot_no || '').toLowerCase();
        const date = (l.cs_in_date || '').toString();
        const numLot = String(l.lot_no_numeric ?? '').toLowerCase();
        return lotNo.includes(lotSearchLower) || date.includes(lotSearchLower) || numLot.includes(lotSearchLower);
      })
    : filteredByAttrs;

  const selectedLot = form.lot_id ? lots.find(l => l.id === parseInt(form.lot_id, 10)) : null;

  const handleCreateLot = async (e) => {
    e.preventDefault();
    if (!newLot.lot_no || !newLot.cs_in_date || !newLot.product_id) {
      toast.warning('Lot No, Date, and Product are required');
      return;
    }
    const lnn = String(newLot.lot_no_numeric || '').trim();
    if (lnn && !/^\d+$/.test(lnn)) {
      toast.warning('Lot No (numeric) must contain only digits');
      return;
    }
    try {
      const payload = { ...newLot, lot_no_numeric: lnn || null };
      const res = await createLot(payload);
      toast.success('Lot created');
      const lotRes = await getLots();
      setLots(lotRes.data);
      const newLotWithProduct = lotRes.data.find(l => l.id === res.data.id) || res.data;
      setForm({ ...form, lot_id: String(res.data.id) });
      setLotFilters({
        fish_name: newLotWithProduct.fish_name || '',
        size: newLotWithProduct.size || '',
        type: newLotWithProduct.type || '',
        glazing: newLotWithProduct.glazing || '',
        order_code: newLotWithProduct.order_code || ''
      });
      setLotSearch(getLotLabel(newLotWithProduct));
      setShowNewLot(false);
      setNewLot({ lot_no: '', lot_no_numeric: '', cs_in_date: bangkokYYYYMMDD(), sticker: '', product_id: '', notes: '', production_date: '', expiration_date: '', st_no: '', remark: '' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create lot');
    }
  };

  const handleStockIn = async (e) => {
    e.preventDefault();
    if (!form.lot_id || !form.location_id || !form.quantity_mc) {
      toast.warning('Lot, Location, and Quantity are required');
      return;
    }
    setSubmitting(true);
    try {
      const res = await stockIn({
        ...form,
        quantity_mc: parseInt(form.quantity_mc),
        weight_kg: parseFloat(form.weight_kg) || 0
      });
      toast.success(`Stock IN recorded: ${res.data.movement.quantity_mc} MC`);
      setForm({ lot_id: '', location_id: '', quantity_mc: '', weight_kg: '', reference_no: '', notes: '' });
      setLotSearch('');
      setLotFilters({ fish_name: '', size: '', type: '', glazing: '', order_code: '' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to record stock in');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQtyChange = (qty) => {
    setForm(prev => {
      const lot = lots.find(l => l.id === parseInt(prev.lot_id, 10));
      const bulkKg = lot ? Number(lot.bulk_weight_kg) : 0;
      const qtyNum = parseInt(qty, 10) || 0;
      const autoWeight = bulkKg && qtyNum ? (bulkKg * qtyNum).toFixed(2) : '';
      return { ...prev, quantity_mc: qty, weight_kg: autoWeight };
    });
  };

  const handleUploadFile = async () => {
    if (!uploadFile) { toast.warning('Please select a file first'); return; }
    setUploading(true);
    setUploadResult(null);
    try {
      const res = await uploadExcel(uploadFile);
      setUploadResult(res.data);
      toast.success(`Import completed: ${res.data.imported} rows imported`);
      const lotRes = await getLots();
      setLots(lotRes.data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Upload failed');
      setUploadResult({ error: err.response?.data?.error || 'Upload failed' });
    } finally { setUploading(false); }
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Loading...</div>;

  return (
    <>
      <div className="page-header">
        <h2><FiArrowDownCircle style={{ color: 'var(--success)' }} /> Stock IN (CS Receive)</h2>
      </div>
      <div className="page-body">
        <div className="card" style={{ maxWidth: 1200, width: '100%' }}>
          <div className="card-header">
            <h3>Receive Stock Into Location</h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={() => { setShowUpload(!showUpload); setShowNewLot(false); }}>
                <FiUpload /> Excel Upload
              </button>
              <button className="btn btn-outline btn-sm" onClick={() => { setShowNewLot(!showNewLot); setShowUpload(false); }}>
                <FiPlus /> New Lot
              </button>
            </div>
          </div>
          <div className="card-body">
            {showUpload && (
              <div style={{ background: '#eff6ff', borderRadius: 8, padding: 16, marginBottom: 20, border: '1px solid #bfdbfe' }}>
                <h4 style={{ marginBottom: 8, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: 6 }}><FiUpload /> Upload Bulk Stock Excel</h4>
                <div className="alert alert-info" style={{ margin: '0 0 12px', fontSize: '0.82rem' }}>
                  Excel columns: <strong>Fish Name, Size, Bulk Weight, Type, Glazing, Sticker, CS-INDATE, Lines / Place, Stack No, Stack Total, Hand - on Balance</strong>
                </div>
                <div
                  className={`upload-area ${dragOver ? 'drag-over' : ''}`}
                  onClick={() => uploadFileRef.current.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) setUploadFile(f); }}
                  style={{ padding: '20px 16px', minHeight: 'auto' }}
                >
                  <input type="file" ref={uploadFileRef} onChange={e => { if (e.target.files[0]) setUploadFile(e.target.files[0]); }} accept=".xlsx,.xls,.csv" style={{ display: 'none' }} />
                  {uploadFile ? (
                    <><FiFile style={{ fontSize: '1.8rem', color: 'var(--success)' }} /><h4 style={{ margin: '4px 0 0', fontSize: '0.88rem' }}>{uploadFile.name}</h4><p style={{ fontSize: '0.78rem' }}>{(uploadFile.size / 1024).toFixed(1)} KB</p></>
                  ) : (
                    <><FiUpload style={{ fontSize: '1.8rem' }} /><h4 style={{ margin: '4px 0 0', fontSize: '0.88rem' }}>Click or drag Excel file here</h4><p style={{ fontSize: '0.78rem' }}>.xlsx, .xls, .csv (max 10MB)</p></>
                  )}
                </div>
                <div style={{ marginTop: 12, display: 'flex', gap: 10 }}>
                  <button className="btn btn-primary btn-sm" onClick={handleUploadFile} disabled={!uploadFile || uploading}>
                    <FiUpload /> {uploading ? 'Uploading...' : 'Upload & Import'}
                  </button>
                  {uploadFile && <button className="btn btn-outline btn-sm" onClick={() => { setUploadFile(null); setUploadResult(null); }}>Clear</button>}
                </div>
                {uploadResult && !uploadResult.error && (
                  <div className="alert alert-success" style={{ marginTop: 12 }}>
                    <FiCheckCircle />
                    <div>
                      <strong>Import Successful!</strong><br />
                      Total: {uploadResult.total_rows} | Imported: {uploadResult.imported} | Skipped: {uploadResult.skipped}
                      {(uploadResult.products_created > 0 || uploadResult.products_reused > 0) && <><br />Products — New: {uploadResult.products_created}, Reused: {uploadResult.products_reused}</>}
                      {(uploadResult.locations_created > 0 || uploadResult.locations_reused > 0) && <><br />Locations — New: {uploadResult.locations_created}, Reused: {uploadResult.locations_reused}</>}
                    </div>
                  </div>
                )}
                {uploadResult && uploadResult.error && (
                  <div className="alert alert-error" style={{ marginTop: 12 }}><FiAlertCircle /><div><strong>Error:</strong> {uploadResult.error}</div></div>
                )}
                {uploadResult && uploadResult.errors && uploadResult.errors.length > 0 && (
                  <div className="alert alert-warning" style={{ marginTop: 8 }}>
                    <FiAlertCircle />
                    <div><strong>Row issues:</strong><ul style={{ margin: '4px 0 0 16px', fontSize: '0.8rem' }}>{uploadResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
                  </div>
                )}
              </div>
            )}

            {showNewLot && (
              <div style={{ background: '#f0fdf4', borderRadius: 8, padding: 16, marginBottom: 20, border: '1px solid #bbf7d0' }}>
                <h4 style={{ marginBottom: 12, fontSize: '0.9rem' }}>Create New Lot</h4>
                <form onSubmit={handleCreateLot}>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Lot No *</label>
                      <input className="form-control" value={newLot.lot_no} onChange={e => setNewLot({ ...newLot, lot_no: e.target.value })} placeholder="e.g. LOT-2026-001" required />
                    </div>
                    <div className="form-group">
                      <label>Lot No (numbers only)</label>
                      <input
                        className="form-control"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={newLot.lot_no_numeric}
                        onChange={e => setNewLot({ ...newLot, lot_no_numeric: e.target.value.replace(/\D/g, '') })}
                        placeholder="Optional, digits only"
                      />
                    </div>
                    <div className="form-group">
                      <label>CS In Date *</label>
                      <input className="form-control" type="date" value={newLot.cs_in_date} onChange={e => setNewLot({ ...newLot, cs_in_date: e.target.value })} required />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Product *</label>
                      <select className="form-control" value={newLot.product_id} onChange={e => setNewLot({ ...newLot, product_id: e.target.value })} required>
                        <option value="">Select Product</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.order_code ? `[${p.order_code}] ` : ''}{p.fish_name} - {p.size} {p.type ? `(${p.type})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="form-group">
                      <label>Sticker</label>
                      <input className="form-control" value={newLot.sticker} onChange={e => setNewLot({ ...newLot, sticker: e.target.value })} placeholder="Sticker info" />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>Production Date</label>
                      <input className="form-control" type="date" value={newLot.production_date} onChange={e => setNewLot({ ...newLot, production_date: e.target.value })} />
                    </div>
                    <div className="form-group">
                      <label>Expiration Date</label>
                      <input className="form-control" type="date" value={newLot.expiration_date} onChange={e => setNewLot({ ...newLot, expiration_date: e.target.value })} />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-group">
                      <label>St No</label>
                      <input className="form-control" value={newLot.st_no} onChange={e => setNewLot({ ...newLot, st_no: e.target.value })} placeholder="Stock number" />
                    </div>
                    <div className="form-group">
                      <label>Remark</label>
                      <input className="form-control" value={newLot.remark} onChange={e => setNewLot({ ...newLot, remark: e.target.value })} placeholder="Remark" />
                    </div>
                  </div>
                  <button type="submit" className="btn btn-success btn-sm">Create Lot</button>
                </form>
              </div>
            )}

            <form onSubmit={handleStockIn}>
              <div className="form-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                <div className="form-group">
                  <label>Fish name</label>
                  <input type="text" className="form-control" placeholder="Filter by fish name"
                    value={lotFilters.fish_name}
                    onChange={e => { setLotFilters(f => ({ ...f, fish_name: e.target.value })); if (form.lot_id) setForm({ ...form, lot_id: '' }); }} />
                </div>
                <div className="form-group">
                  <label>Size</label>
                  <input type="text" className="form-control" placeholder="Filter by size"
                    value={lotFilters.size}
                    onChange={e => { setLotFilters(f => ({ ...f, size: e.target.value })); if (form.lot_id) setForm({ ...form, lot_id: '' }); }} />
                </div>
                <div className="form-group">
                  <label>Type</label>
                  <input type="text" className="form-control" placeholder="Filter by type"
                    value={lotFilters.type}
                    onChange={e => { setLotFilters(f => ({ ...f, type: e.target.value })); if (form.lot_id) setForm({ ...form, lot_id: '' }); }} />
                </div>
                <div className="form-group">
                  <label>Glazing</label>
                  <input type="text" className="form-control" placeholder="Filter by glazing"
                    value={lotFilters.glazing}
                    onChange={e => { setLotFilters(f => ({ ...f, glazing: e.target.value })); if (form.lot_id) setForm({ ...form, lot_id: '' }); }} />
                </div>
                <div className="form-group">
                  <label>Order Code</label>
                  <input type="text" className="form-control" placeholder="Filter by order code"
                    value={lotFilters.order_code}
                    onChange={e => { setLotFilters(f => ({ ...f, order_code: e.target.value })); if (form.lot_id) setForm({ ...form, lot_id: '' }); }} />
                </div>
              </div>

              {/* Lot selector + Location */}
              <div className="form-row">
                <div className="form-group" ref={lotDropdownRef} style={{ position: 'relative', flex: 1 }}>
                  <label>Lot *</label>
                  <input
                    type="text"
                    className="form-control"
                    placeholder="Type to search lot (lot no, date)..."
                    value={lotDropdownOpen ? lotSearch : (selectedLot ? getLotLabel(selectedLot) : lotSearch)}
                    onChange={e => {
                      setLotSearch(e.target.value);
                      setLotDropdownOpen(true);
                      if (form.lot_id) setForm({ ...form, lot_id: '' });
                    }}
                    onFocus={() => setLotDropdownOpen(true)}
                    autoComplete="off"
                  />
                  {lotDropdownOpen && (
                    <ul className="lot-dropdown" style={{
                      position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4,
                      maxHeight: 220, overflowY: 'auto', background: 'white',
                      border: '1px solid var(--gray-200)', borderRadius: 8,
                      boxShadow: 'var(--shadow-lg)', zIndex: 100, listStyle: 'none', padding: 4
                    }}>
                      {filteredLots.length === 0 ? (
                        <li style={{ padding: '10px 12px', color: 'var(--gray-500)', fontSize: '0.9rem' }}>No lots match (adjust filters or search)</li>
                      ) : (
                        filteredLots.map(l => (
                          <li key={l.id}
                            onClick={() => {
                              const bulkKg = Number(l.bulk_weight_kg) || 0;
                              const qty = parseInt(form.quantity_mc, 10) || 0;
                              const autoWeight = bulkKg && qty ? (bulkKg * qty).toFixed(2) : '';
                              setForm(prev => ({ ...prev, lot_id: String(l.id), weight_kg: autoWeight }));
                              setLotFilters({
                                fish_name: l.fish_name || '', size: l.size || '',
                                type: l.type || '', glazing: l.glazing || '',
                                order_code: l.order_code || ''
                              });
                              setLotSearch(getLotLabel(l));
                              setLotDropdownOpen(false);
                            }}
                            style={{ padding: '10px 12px', cursor: 'pointer', borderRadius: 6, fontSize: '0.9rem' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--gray-100)'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                          >
                            <strong>{l.lot_no}</strong> · {l.fish_name || 'N/A'}
                            <span style={{ color: 'var(--gray-600)', fontSize: '0.85rem' }}>
                              {l.order_code ? ` | Order: ${l.order_code}` : ''}
                              {l.size ? ` · Size: ${l.size}` : ''}
                              {l.type ? ` · Type: ${l.type}` : ''}
                              {l.glazing ? ` · Glazing: ${l.glazing}` : ''}
                            </span>
                            <span style={{ color: 'var(--gray-500)', fontSize: '0.85rem' }}> ({l.cs_in_date})</span>
                          </li>
                        ))
                      )}
                    </ul>
                  )}
                  {form.lot_id && <input type="hidden" name="lot_id" value={form.lot_id} />}
                </div>
                <div className="form-group">
                  <label>Location *</label>
                  <select className="form-control" value={form.location_id} onChange={e => setForm({ ...form, location_id: e.target.value })} required>
                    <option value="">Select Location</option>
                    {locations.map(loc => (
                      <option key={loc.id} value={loc.id}>
                        {loc.line_place} (Stack {loc.stack_no})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Quantity (MC) *</label>
                  <input className="form-control" type="number" min="1" value={form.quantity_mc} onChange={e => handleQtyChange(e.target.value)} placeholder="Number of cartons" required />
                </div>
                <div className="form-group">
                  <label>Weight (KG)</label>
                  <input className="form-control" type="number" step="0.01" value={form.weight_kg} readOnly placeholder="Auto-calculated" style={{ backgroundColor: 'var(--gray-50)', cursor: 'default' }} />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Reference No</label>
                  <input className="form-control" value={form.reference_no} onChange={e => setForm({ ...form, reference_no: e.target.value })} placeholder="PO or Invoice number" />
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <input className="form-control" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" />
                </div>
              </div>

              <button type="submit" className="btn btn-success" disabled={submitting} style={{ marginTop: 8 }}>
                <FiArrowDownCircle /> {submitting ? 'Recording...' : 'Record Stock IN'}
              </button>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

export default StockIn;
