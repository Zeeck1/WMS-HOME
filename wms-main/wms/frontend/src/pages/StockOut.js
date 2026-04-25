import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { FiArrowUpCircle, FiPackage, FiBox, FiAnchor } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getInventory, stockOut, createImportStockOut } from '../services/api';
import { bangkokYYYYMMDD } from '../utils/bangkokTime';

const TABS = [
  { id: 'BULK', label: 'Bulk', icon: <FiPackage /> },
  { id: 'CONTAINER_EXTRA', label: 'Container Extra', icon: <FiBox /> },
  { id: 'IMPORT', label: 'Import', icon: <FiAnchor /> }
];

function isImportShipmentRow(item) {
  return String(item?.stock_type || '').toUpperCase() === 'IMPORT' &&
    item?.lot_id == null &&
    (item?._source === '_shipment' || item?._imp_item_id != null);
}

function stockOutRowKey(item) {
  if (item?._imp_item_id != null) return `imp-${item._imp_item_id}`;
  if (item?.lot_id != null && item?.location_id != null) {
    return `loc-${item.lot_id}-${item.location_id}`;
  }
  return `row-${item?.fish_name}-${item?.line_place}`;
}

function StockOut() {
  const [activeTab, setActiveTab] = useState('BULK');
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);

  const [form, setForm] = useState({
    quantity_mc: '',
    weight_kg: '',
    reference_no: '',
    notes: '',
    date_out: ''
  });
  const [searchQuery, setSearchQuery] = useState('');

  const isCE = activeTab === 'CONTAINER_EXTRA';
  const isImport = activeTab === 'IMPORT';
  const isNonBulk = isCE || isImport;

  const fetchInventory = useCallback(async () => {
    try {
      const res = await getInventory({ stock_type: activeTab });
      const rows = res.data || [];
      setInventory(rows.filter((item) => {
        if (item.lot_id != null && item.location_id != null) return true;
        if (activeTab === 'IMPORT') {
          return isImportShipmentRow(item);
        }
        return false;
      }));
    } catch (err) {
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { setLoading(true); fetchInventory(); }, [activeTab, fetchInventory]);

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setSelectedRow(null);
    setSearchQuery('');
    setForm({ quantity_mc: '', weight_kg: '', reference_no: '', notes: '', date_out: '' });
  };

  const filteredInventory = useMemo(() => {
    if (!searchQuery.trim()) return inventory;
    const q = searchQuery.trim().toLowerCase();
    const lc = (v) => String(v ?? '').toLowerCase();
    return inventory.filter(item => {
      const fish = lc(item.fish_name);
      const size = lc(item.size);
      const lot = lc(item.lot_no);
      const location = lc(item.line_place);
      const order = lc(item.order_code);
      const handMc = String(item.hand_on_balance_mc ?? '');
      const handKg = String(item.hand_on_balance_kg ?? '');
      const country = lc(item.country);
      const stack = lc(item.stack_no);
      const remark = lc(item.remark);
      return fish.includes(q) || size.includes(q) || lot.includes(q) ||
        location.includes(q) || order.includes(q) || handMc.includes(q) || handKg.includes(q) ||
        country.includes(q) || stack.includes(q) || remark.includes(q);
    });
  }, [inventory, searchQuery]);

  const selectItem = (item) => {
    setSelectedRow(item);
    setForm({
      quantity_mc: '', weight_kg: '', reference_no: '', notes: '', date_out: bangkokYYYYMMDD()
    });
  };

  const handleQtyChange = (qty) => {
    const autoWeight = selectedRow ? (parseInt(qty, 10) || 0) * Number(selectedRow.bulk_weight_kg) : '';
    setForm(f => ({ ...f, quantity_mc: qty, weight_kg: autoWeight ? autoWeight.toFixed(2) : '' }));
  };

  const clearForm = () => {
    setForm({ quantity_mc: '', weight_kg: '', reference_no: '', notes: '', date_out: '' });
  };

  const handleStockOut = async (e) => {
    e.preventDefault();
    if (!selectedRow || !form.quantity_mc) {
      toast.warning('Select an item and enter quantity');
      return;
    }
    const qty = parseInt(form.quantity_mc, 10) || 0;
    if (qty > selectedRow.hand_on_balance_mc) {
      toast.error(`Cannot stock out more than Hand On balance (${selectedRow.hand_on_balance_mc} MC)`);
      return;
    }

    if (isImportShipmentRow(selectedRow)) {
      if (!form.date_out) {
        toast.warning('Select date out');
        return;
      }
      if (selectedRow._imp_shipment_id == null || selectedRow._imp_item_id == null) {
        toast.error('Invalid import line (missing shipment link)');
        return;
      }
    }

    setSubmitting(true);
    try {
      if (isImportShipmentRow(selectedRow)) {
        await createImportStockOut(selectedRow._imp_shipment_id, {
          item_id: selectedRow._imp_item_id,
          date_out: form.date_out,
          order_ref: form.reference_no || '',
          mc: qty,
          nw_kgs: parseFloat(form.weight_kg) || 0
        });
      } else {
        await stockOut({
          lot_id: selectedRow.lot_id,
          location_id: selectedRow.location_id,
          quantity_mc: qty,
          weight_kg: parseFloat(form.weight_kg) || 0,
          reference_no: form.reference_no,
          notes: form.notes
        });
      }
      toast.success(`Stock OUT recorded: ${form.quantity_mc} MC`);
      setSelectedRow(null);
      clearForm();
      fetchInventory();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to record stock out');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Loading...</div>;

  const tableColSpan = 7;
  const selectedKey = selectedRow ? stockOutRowKey(selectedRow) : null;
  const selectedIsImportShipment = selectedRow && isImportShipmentRow(selectedRow);

  return (
    <>
      <div className="page-header">
        <h2><FiArrowUpCircle style={{ color: 'var(--danger)' }} /> Stock OUT (Loading)</h2>
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

        {selectedRow && (
          <div className="card" style={{ marginBottom: 20, maxWidth: 720 }}>
            <div className="card-header">
              <h3>{selectedIsImportShipment ? 'Record Import Stock Out' : 'Remove Stock From Location'}</h3>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => { setSelectedRow(null); clearForm(); }}
              >
                Cancel
              </button>
            </div>
            <div className="card-body">
              <div className="alert alert-warning">
                {isNonBulk && selectedRow.order_code && <><strong>{selectedRow.order_code}</strong> — </>}
                <strong>{selectedRow.fish_name}</strong> ({selectedRow.size}) |
                {!isNonBulk && <> Lot: {selectedRow.lot_no} |</>}
                {' '}
                {selectedIsImportShipment
                  ? <>Line: {selectedRow.line_place || selectedRow.stack_no || '—'} {selectedRow.country ? `| From: ${selectedRow.country}` : ''} |</>
                  : <>Location: {selectedRow.line_place} |</>}
                <strong> Hand On: {selectedRow.hand_on_balance_mc} MC</strong>
              </div>
              <form onSubmit={handleStockOut}>
                {selectedIsImportShipment && (
                  <div className="form-row">
                    <div className="form-group">
                      <label>Date out *</label>
                      <input
                        className="form-control"
                        type="date"
                        value={form.date_out}
                        onChange={e => setForm(f => ({ ...f, date_out: e.target.value }))}
                        required
                      />
                    </div>
                  </div>
                )}
                <div className="form-row">
                  <div className="form-group">
                    <label>Quantity OUT (MC) *</label>
                    <input className="form-control" type="number" min="1" max={selectedRow.hand_on_balance_mc} value={form.quantity_mc} onChange={e => handleQtyChange(e.target.value)} placeholder={`Max: ${selectedRow.hand_on_balance_mc}`} required />
                  </div>
                  <div className="form-group">
                    <label>Weight (KG)</label>
                    <input className="form-control" type="number" step="0.01" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>{selectedIsImportShipment ? 'Order ref' : 'Reference No'}</label>
                    <input
                      className="form-control"
                      value={form.reference_no}
                      onChange={e => setForm(f => ({ ...f, reference_no: e.target.value }))}
                      placeholder={selectedIsImportShipment ? 'e.g. RAT.01' : 'Reference'}
                    />
                  </div>
                  <div className="form-group">
                    <label>Notes</label>
                    <input className="form-control" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes" />
                  </div>
                </div>
                <button type="submit" className="btn btn-danger" disabled={submitting}>
                  <FiArrowUpCircle /> {submitting ? 'Recording...' : 'Record Stock OUT'}
                </button>
              </form>
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header">
            <h3>Select Item to Stock Out ({isCE ? 'Container Extra' : isImport ? 'Import' : 'Bulk'})</h3>
            <div className="search-inline" style={{ minWidth: 260 }}>
              <input
                type="text"
                className="form-control"
                placeholder={isImport ? 'Search fish, invoice, line, country, remark...' : 'Search fish, size, lot, location, order...'}
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ maxWidth: 320 }}
              />
            </div>
          </div>
          <div className="table-container">
            <table className="excel-table">
              <thead>
                <tr>
                  {isNonBulk && <th>{isImport ? 'Invoice No' : 'Order'}</th>}
                  <th>Fish Name</th>
                  <th>Size</th>
                  {!isNonBulk && <th>Lot No</th>}
                  <th>Location</th>
                  <th>Hand On (MC)</th>
                  <th>Hand On (KG)</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {inventory.length === 0 ? (
                  <tr><td colSpan={tableColSpan} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No stock available</td></tr>
                ) : filteredInventory.length === 0 ? (
                  <tr><td colSpan={tableColSpan} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No matches for &quot;{searchQuery}&quot;</td></tr>
                ) : filteredInventory.map((item) => {
                  const k = stockOutRowKey(item);
                  return (
                  <tr key={k} style={{ background: selectedKey === k ? '#dbeafe' : undefined, cursor: 'pointer' }} onClick={() => selectItem(item)}>
                    {isNonBulk && <td><strong>{item.order_code || '-'}</strong></td>}
                    <td><strong>{item.fish_name}</strong></td>
                    <td>{item.size}</td>
                    {!isNonBulk && <td>{item.lot_no}</td>}
                    <td>{isImport && isImportShipmentRow(item) ? (item.line_place || item.stack_no || '—') : (item.line_place || '—')}</td>
                    <td className="num-cell"><strong>{item.hand_on_balance_mc}</strong></td>
                    <td className="num-cell">{(Number(item.hand_on_balance_kg) || 0).toFixed(2)}</td>
                    <td>
                      <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); selectItem(item); }}>
                        <FiArrowUpCircle /> OUT
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}

export default StockOut;
