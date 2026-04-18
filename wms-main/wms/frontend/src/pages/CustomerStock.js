import React, { useState, useEffect, useCallback } from 'react';
import { FiArrowDownCircle, FiArrowUpCircle, FiSearch, FiPlus, FiTrash2, FiPrinter } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  getCustomers, getCustomerDeposits, createDeposit, deleteAllDeposits,
  getCustomerDepositItems, getCustomerWithdrawals, createCustomerWithdrawal, deleteAllWithdrawals
} from '../services/api';
import { bangkokYYYYMMDD, dateToYYYYMMDDInBangkok } from '../utils/bangkokTime';
import { sumKgPartsString } from '../utils/kgParts';

const toDate = (d) => d ? (typeof d === 'string' ? d.split('T')[0] : dateToYYYYMMDDInBangkok(d)) : '';

const EMPTY_ITEM = {
  receive_date: bangkokYYYYMMDD(), item_name: '', lot_no: '', boxes: '', kg_parts: '', weight_kg: '', nw_unit: '', time_str: '', remark: '',
};

function CustomerStock() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = location.state;
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(navState?.customerId ? String(navState.customerId) : '');
  const [activeTab, setActiveTab] = useState(navState?.tab || 'IN');
  const [loading, setLoading] = useState(true);

  // IN state
  const [depositItems, setDepositItems] = useState([{ ...EMPTY_ITEM, seq_no: 1 }]);
  const [depositMeta, setDepositMeta] = useState({ deposit_date: bangkokYYYYMMDD(), doc_ref: '', receiver_name: '', inspector_name: '' });
  const [pastDeposits, setPastDeposits] = useState([]);
  const [savingIn, setSavingIn] = useState(false);

  // OUT state
  const [outLotActive, setOutLotActive] = useState(false);
  const [outLotDate, setOutLotDate] = useState(bangkokYYYYMMDD());
  const [outLotLabel, setOutLotLabel] = useState('');
  const [outSearch, setOutSearch] = useState({ cs_in_date: '', fish_name: '', lot_no: '' });
  const [availableItems, setAvailableItems] = useState([]);
  const [outCart, setOutCart] = useState([]);
  const [outMeta, setOutMeta] = useState({ withdrawer_name: '', inspector_name: '' });
  const [pastWithdrawals, setPastWithdrawals] = useState([]);
  const [savingOut, setSavingOut] = useState(false);
  const [searchedOut, setSearchedOut] = useState(false);

  useEffect(() => {
    (async () => {
      try { const res = await getCustomers(); setCustomers(res.data); }
      catch { toast.error('Failed to load customers'); }
      finally { setLoading(false); }
    })();
  }, []);

  const loadPastDeposits = useCallback(async () => {
    if (!selectedCustomerId) return;
    try { const res = await getCustomerDeposits(selectedCustomerId); setPastDeposits(res.data); }
    catch { /* ignore */ }
  }, [selectedCustomerId]);

  const loadPastWithdrawals = useCallback(async () => {
    if (!selectedCustomerId) return;
    try { const res = await getCustomerWithdrawals(selectedCustomerId); setPastWithdrawals(res.data); }
    catch { /* ignore */ }
  }, [selectedCustomerId]);

  useEffect(() => {
    if (selectedCustomerId) { loadPastDeposits(); loadPastWithdrawals(); }
    setDepositItems([{ ...EMPTY_ITEM, seq_no: 1 }]);
    setDepositMeta(m => ({ ...m, doc_ref: '', receiver_name: '', inspector_name: '' }));
    resetOutLot();
  }, [selectedCustomerId, loadPastDeposits, loadPastWithdrawals]);

  const resetOutLot = () => {
    setOutLotActive(false);
    setOutLotLabel('');
    setOutCart([]);
    setAvailableItems([]);
    setSearchedOut(false);
    setOutMeta({ withdrawer_name: '', inspector_name: '' });
  };

  // ─── IN Handlers ─────────────────────────────────────────────────────
  const addItem = () => setDepositItems(prev => [...prev, { ...EMPTY_ITEM, seq_no: prev.length + 1 }]);
  const removeItem = (i) => setDepositItems(prev => prev.filter((_, idx) => idx !== i).map((it, idx) => ({ ...it, seq_no: idx + 1 })));
  const updateItem = (i, field, val) => setDepositItems(prev => prev.map((it, idx) => {
    if (idx !== i) return it;
    if (field === 'kg_parts') {
      const kgParts = val;
      const sum = sumKgPartsString(kgParts);
      const next = { ...it, kg_parts: kgParts };
      if (String(kgParts).trim()) next.weight_kg = String(sum);
      return next;
    }
    if (field === 'weight_kg' && String(it.kg_parts || '').trim()) return it;
    return { ...it, [field]: val };
  }));

  const handleSaveDeposit = async () => {
    if (!selectedCustomerId) return toast.error('เลือกลูกค้าก่อน');
    const valid = depositItems.filter(it => it.item_name.trim());
    if (valid.length === 0) return toast.error('เพิ่มอย่างน้อย 1 รายการ');
    setSavingIn(true);
    try {
      await createDeposit(selectedCustomerId, { ...depositMeta, items: valid });
      toast.success('บันทึกรายการรับฝากสำเร็จ');
      setDepositItems([{ ...EMPTY_ITEM, seq_no: 1 }]);
      setDepositMeta(m => ({ ...m, doc_ref: '', receiver_name: '', inspector_name: '' }));
      loadPastDeposits();
    } catch (err) { toast.error(err.response?.data?.error || 'บันทึกไม่สำเร็จ'); }
    finally { setSavingIn(false); }
  };

  // ─── Delete All Handlers ────────────────────────────────────────────────
  const handleDeleteAllDeposits = async () => {
    if (!selectedCustomerId) return;
    if (!window.confirm('ลบรายการรับฝากทั้งหมดของลูกค้านี้? (จะลบรายการเบิกที่เกี่ยวข้องด้วย)')) return;
    try {
      await deleteAllDeposits(selectedCustomerId);
      toast.success('ลบรายการรับฝากทั้งหมดสำเร็จ');
      loadPastDeposits();
      loadPastWithdrawals();
    } catch { toast.error('ลบไม่สำเร็จ'); }
  };

  const handleDeleteAllWithdrawals = async () => {
    if (!selectedCustomerId) return;
    if (!window.confirm('ลบรายการเบิกทั้งหมดของลูกค้านี้?')) return;
    try {
      await deleteAllWithdrawals(selectedCustomerId);
      toast.success('ลบรายการเบิกทั้งหมดสำเร็จ');
      loadPastWithdrawals();
    } catch { toast.error('ลบไม่สำเร็จ'); }
  };

  // ─── OUT LOT Handlers ─────────────────────────────────────────────────
  const handleNewOutLot = () => {
    if (!selectedCustomerId) return toast.error('เลือกลูกค้าก่อน');
    setOutLotLabel(outLotDate);
    setOutLotActive(true);
    setOutCart([]);
    setAvailableItems([]);
    setSearchedOut(false);
  };

  const handleCancelOutLot = () => resetOutLot();

  const searchOutItems = async () => {
    if (!selectedCustomerId) return toast.error('เลือกลูกค้าก่อน');
    try {
      const res = await getCustomerDepositItems(selectedCustomerId, outSearch);
      setAvailableItems(res.data);
      setSearchedOut(true);
    } catch { toast.error('ค้นหาไม่สำเร็จ'); }
  };

  const addToOutCart = (item) => {
    if (outCart.find(c => c.deposit_item_id === item.id)) return toast.info('เพิ่มแล้ว');
    setOutCart(prev => [...prev, {
      deposit_item_id: item.id, item_name: item.item_name, lot_no: item.lot_no,
      receive_date: item.receive_date, balance_boxes: item.balance_boxes, balance_kg: item.balance_kg,
      orig_boxes: item.boxes, orig_weight_kg: item.weight_kg, kg_parts: item.kg_parts, nw_unit: item.nw_unit,
      boxes_out: '', weight_kg_out: '', time_str: '', remark: ''
    }]);
  };

  const removeFromCart = (i) => setOutCart(prev => prev.filter((_, idx) => idx !== i));
  const updateCartItem = (i, field, val) => setOutCart(prev => prev.map((it, idx) => idx === i ? { ...it, [field]: val } : it));

  const handleSaveWithdrawal = async () => {
    if (!selectedCustomerId) return toast.error('เลือกลูกค้าก่อน');
    const valid = outCart.filter(it => Number(it.boxes_out) > 0);
    if (valid.length === 0) return toast.error('ระบุจำนวนกล่องที่เบิก');
    for (const it of valid) {
      if (Number(it.boxes_out) > it.balance_boxes) return toast.error(`${it.item_name}: เบิกเกินยอดคงเหลือ`);
    }
    setSavingOut(true);
    try {
      await createCustomerWithdrawal(selectedCustomerId, {
        withdraw_date: outLotDate,
        doc_ref: outLotDate,
        withdrawer_name: outMeta.withdrawer_name,
        inspector_name: outMeta.inspector_name,
        items: valid
      });
      toast.success('บันทึกรายการเบิกสำเร็จ');
      resetOutLot();
      loadPastWithdrawals();
    } catch (err) { toast.error(err.response?.data?.error || 'บันทึกไม่สำเร็จ'); }
    finally { setSavingOut(false); }
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Loading...</div>;

  return (
    <>
      <div className="page-header"><h2>Customer</h2></div>
      <div className="page-body">
        <div className="cs-customer-select">
          <label>เลือกลูกค้า</label>
          <select className="form-control" value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)}>
            <option value="">-- เลือกลูกค้า --</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {selectedCustomerId && (
          <>
            <div className="stock-type-tabs" style={{ marginBottom: 16 }}>
              <button className={`stock-type-tab ${activeTab === 'IN' ? 'active' : ''}`} onClick={() => setActiveTab('IN')}>
                <FiArrowDownCircle /> IN (รับฝาก)
              </button>
              <button className={`stock-type-tab ${activeTab === 'OUT' ? 'active' : ''}`} onClick={() => setActiveTab('OUT')}>
                <FiArrowUpCircle /> OUT (เบิกจ่าย)
              </button>
            </div>

            {/* ═══════════ IN TAB ═══════════ */}
            {activeTab === 'IN' && (
              <div className="cs-section">
                <h3 className="cs-section-title"><FiArrowDownCircle /> รายการรับฝากสินค้า</h3>

                <div className="cs-meta-row">
                  <div className="form-group"><label>วันที่ฝาก</label>
                    <input type="date" className="form-control" value={depositMeta.deposit_date}
                      onChange={e => setDepositMeta(m => ({ ...m, deposit_date: e.target.value }))} /></div>
                  <div className="form-group"><label>เลขที่เอกสาร</label>
                    <input className="form-control" placeholder="DS..." value={depositMeta.doc_ref}
                      onChange={e => setDepositMeta(m => ({ ...m, doc_ref: e.target.value }))} /></div>
                </div>

                <div className="table-container" style={{ overflow: 'auto', marginBottom: 16 }}>
                  <table className="excel-table">
                    <thead>
                      <tr>
                        <th style={{ width: 50 }}>ลำดับ</th>
                        <th style={{ width: 120 }}>วันที่รับ</th>
                        <th>รายการ</th>
                        <th style={{ width: 100 }}>LOT No.</th>
                        <th style={{ width: 70 }}>กล่อง</th>
                        <th style={{ minWidth: 120 }}>Kg รายละเอียด</th>
                        <th style={{ width: 80 }}>Kg. (รวม)</th>
                        <th style={{ width: 90 }}>N/W:UNIT</th>
                        <th style={{ width: 80 }}>เวลา</th>
                        <th style={{ width: 120 }}>หมายเหตุ</th>
                        <th style={{ width: 40 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {depositItems.map((it, i) => (
                        <tr key={i}>
                          <td className="text-center">{it.seq_no}</td>
                          <td><input type="date" className="form-control form-control-sm" value={it.receive_date} onChange={e => updateItem(i, 'receive_date', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm" placeholder="ชื่อสินค้า" value={it.item_name} onChange={e => updateItem(i, 'item_name', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm" value={it.lot_no} onChange={e => updateItem(i, 'lot_no', e.target.value)} /></td>
                          <td><input type="number" className="form-control form-control-sm" value={it.boxes} onChange={e => updateItem(i, 'boxes', e.target.value)} /></td>
                          <td>
                            <input
                              className="form-control form-control-sm"
                              placeholder="15.2, 16.2, 14.3"
                              value={it.kg_parts || ''}
                              onChange={e => updateItem(i, 'kg_parts', e.target.value)}
                              title="คั่นด้วยจุลภาค — ระบบคำนวณ Kg รวมอัตโนมัติ"
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              step="0.01"
                              className="form-control form-control-sm"
                              value={it.weight_kg}
                              onChange={e => updateItem(i, 'weight_kg', e.target.value)}
                              readOnly={!!String(it.kg_parts || '').trim()}
                              title={String(it.kg_parts || '').trim() ? 'ยอดรวมจาก Kg รายละเอียด' : 'กรอก Kg โดยตรงเมื่อไม่ใช้รายละเอียด'}
                              style={String(it.kg_parts || '').trim() ? { background: '#f8fafc' } : {}}
                            />
                          </td>
                          <td><input type="number" step="0.01" className="form-control form-control-sm" value={it.nw_unit} onChange={e => updateItem(i, 'nw_unit', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm" placeholder="13.00น." value={it.time_str} onChange={e => updateItem(i, 'time_str', e.target.value)} /></td>
                          <td><input className="form-control form-control-sm" value={it.remark} onChange={e => updateItem(i, 'remark', e.target.value)} /></td>
                          <td><button className="btn btn-outline btn-sm" onClick={() => removeItem(i)} style={{ color: '#ef4444', padding: '2px 6px' }}><FiTrash2 size={13} /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <button className="btn btn-outline btn-sm" onClick={addItem} style={{ marginBottom: 16 }}><FiPlus /> เพิ่มรายการ</button>

                <div className="cs-meta-row">
                  <div className="form-group"><label>ผู้รับฝากสินค้า</label>
                    <input className="form-control" value={depositMeta.receiver_name}
                      onChange={e => setDepositMeta(m => ({ ...m, receiver_name: e.target.value }))} /></div>
                  <div className="form-group"><label>ผู้ตรวจสอบ</label>
                    <input className="form-control" value={depositMeta.inspector_name}
                      onChange={e => setDepositMeta(m => ({ ...m, inspector_name: e.target.value }))} /></div>
                </div>

                <button className="btn btn-primary" onClick={handleSaveDeposit} disabled={savingIn} style={{ marginBottom: 24 }}>
                  {savingIn ? 'กำลังบันทึก...' : 'บันทึกรายการรับฝาก'}
                </button>

                {pastDeposits.length > 0 && (
                  <div className="cs-past">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 style={{ margin: 0 }}>รายการรับฝากที่ผ่านมา</h4>
                      <button className="btn btn-outline btn-sm" onClick={handleDeleteAllDeposits}
                        style={{ color: '#ef4444', borderColor: '#fca5a5' }}>
                        <FiTrash2 /> ลบทั้งหมด
                      </button>
                    </div>
                    <table className="excel-table">
                      <thead><tr><th>#</th><th>วันที่รับ</th><th>เลขที่เอกสาร</th><th>จำนวนรายการ</th><th>กล่องรวม</th><th></th></tr></thead>
                      <tbody>
                        {pastDeposits.map((d, i) => {
                          const first = toDate(d.first_receive_date);
                          const last = toDate(d.last_receive_date);
                          const dateDisplay = first && last && first !== last ? `${first} ~ ${last}` : (first || toDate(d.deposit_date));
                          return (
                          <tr key={d.id}>
                            <td className="text-center">{i + 1}</td>
                            <td>{dateDisplay}</td>
                            <td>{d.doc_ref || '-'}</td>
                            <td className="num-cell">{d.item_count}</td>
                            <td className="num-cell">{d.total_boxes}</td>
                            <td><button className="btn btn-outline btn-sm" onClick={() => navigate(`/customer/print/${d.id}/0`)}>
                              <FiPrinter /> พิมพ์</button></td>
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ═══════════ OUT TAB ═══════════ */}
            {activeTab === 'OUT' && (
              <div className="cs-section">
                <h3 className="cs-section-title"><FiArrowUpCircle /> รายการเบิกจ่ายสินค้า</h3>

                {/* ── Step 1: Create New Out LOT ── */}
                {!outLotActive && (
                  <div className="cs-new-lot-box">
                    <div className="cs-meta-row" style={{ alignItems: 'flex-end', marginBottom: 12 }}>
                      <div className="form-group">
                        <label>วันที่เบิก</label>
                        <input type="date" className="form-control" value={outLotDate}
                          onChange={e => setOutLotDate(e.target.value)} />
                      </div>
                      <div className="form-group" style={{ flex: 'none' }}>
                        <button className="btn btn-primary" onClick={handleNewOutLot}>
                          <FiPlus /> New Out LOT
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Step 2: Active LOT session ── */}
                {outLotActive && (
                  <>
                    <div className="cs-lot-header">
                      <div className="cs-lot-badge">
                        <span className="cs-lot-label">Out LOT:</span>
                        <span className="cs-lot-name">{outLotLabel}</span>
                      </div>
                      <button className="btn btn-outline btn-sm" onClick={handleCancelOutLot} style={{ color: '#ef4444' }}>ยกเลิก</button>
                    </div>

                    {/* Search deposited items */}
                    <div className="cs-out-search">
                      <h4>ค้นหาสินค้าที่ฝาก</h4>
                      <div className="cs-meta-row">
                        <div className="form-group"><label>วันที่รับ (CS-IN)</label>
                          <input type="date" className="form-control" value={outSearch.cs_in_date}
                            onChange={e => setOutSearch(s => ({ ...s, cs_in_date: e.target.value }))} /></div>
                        <div className="form-group"><label>รายการ (Fish Name)</label>
                          <input className="form-control" value={outSearch.fish_name}
                            onChange={e => setOutSearch(s => ({ ...s, fish_name: e.target.value }))} /></div>
                        <div className="form-group"><label>Lot No.</label>
                          <input className="form-control" value={outSearch.lot_no}
                            onChange={e => setOutSearch(s => ({ ...s, lot_no: e.target.value }))} /></div>
                        <div className="form-group" style={{ alignSelf: 'flex-end' }}>
                          <button className="btn btn-primary" onClick={searchOutItems}><FiSearch /> ค้นหา</button>
                        </div>
                      </div>
                    </div>

                    {/* Available items */}
                    {searchedOut && (
                      <div style={{ marginBottom: 16 }}>
                        <h4 style={{ marginBottom: 8 }}>สินค้าคงเหลือ ({availableItems.length} รายการ)</h4>
                        {availableItems.length === 0 ? (
                          <div style={{ padding: 30, textAlign: 'center', color: '#999' }}>ไม่พบสินค้าคงเหลือ</div>
                        ) : (
                          <div className="table-container" style={{ overflow: 'auto', maxHeight: '30vh' }}>
                            <table className="excel-table">
                              <thead><tr><th>วันที่รับ</th><th>รายการ</th><th>LOT No.</th><th>กล่อง (ฝาก)</th><th>Kg รายละเอียด</th><th>Kg. รวม (ฝาก)</th><th>คงเหลือ กล่อง</th><th>คงเหลือ Kg.</th><th></th></tr></thead>
                              <tbody>
                                {availableItems.map(it => (
                                  <tr key={it.id}>
                                    <td>{toDate(it.receive_date)}</td>
                                    <td><strong>{it.item_name}</strong></td>
                                    <td>{it.lot_no || '-'}</td>
                                    <td className="num-cell">{it.boxes}</td>
                                    <td className="num-cell" style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{it.kg_parts || '—'}</td>
                                    <td className="num-cell">{Number(it.weight_kg).toFixed(2)}</td>
                                    <td className="num-cell" style={{ fontWeight: 700, color: '#16a34a' }}>{it.balance_boxes}</td>
                                    <td className="num-cell" style={{ fontWeight: 700, color: '#16a34a' }}>{Number(it.balance_kg).toFixed(2)}</td>
                                    <td><button className="btn btn-primary btn-sm" onClick={() => addToOutCart(it)}>เลือก</button></td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Cart */}
                    {outCart.length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <h4 style={{ marginBottom: 8 }}>รายการเบิก — {outLotLabel}</h4>
                        <div className="table-container" style={{ overflow: 'auto' }}>
                          <table className="excel-table">
                            <thead>
                              <tr>
                                <th style={{ width: 40 }}>#</th>
                                <th>รายการ</th>
                                <th>LOT No.</th>
                                <th style={{ width: 90 }}>คงเหลือ กล่อง</th>
                                <th style={{ width: 90 }}>เบิก กล่อง</th>
                                <th style={{ width: 90 }}>เบิก KG</th>
                                <th style={{ width: 80 }}>เวลา</th>
                                <th style={{ width: 120 }}>หมายเหตุ</th>
                                <th style={{ width: 40 }}></th>
                              </tr>
                            </thead>
                            <tbody>
                              {outCart.map((it, i) => (
                                <tr key={i}>
                                  <td className="text-center">{i + 1}</td>
                                  <td><strong>{it.item_name}</strong></td>
                                  <td>{it.lot_no || '-'}</td>
                                  <td className="num-cell" style={{ color: '#16a34a' }}>{it.balance_boxes}</td>
                                  <td><input type="number" className="form-control form-control-sm" value={it.boxes_out}
                                    onChange={e => updateCartItem(i, 'boxes_out', e.target.value)} max={it.balance_boxes} /></td>
                                  <td><input type="number" step="0.01" className="form-control form-control-sm" value={it.weight_kg_out}
                                    onChange={e => updateCartItem(i, 'weight_kg_out', e.target.value)} /></td>
                                  <td><input className="form-control form-control-sm" value={it.time_str}
                                    onChange={e => updateCartItem(i, 'time_str', e.target.value)} /></td>
                                  <td><input className="form-control form-control-sm" value={it.remark}
                                    onChange={e => updateCartItem(i, 'remark', e.target.value)} /></td>
                                  <td><button className="btn btn-outline btn-sm" onClick={() => removeFromCart(i)} style={{ color: '#ef4444', padding: '2px 6px' }}><FiTrash2 size={13} /></button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {outCart.length > 0 && (
                      <>
                        <div className="cs-meta-row">
                          <div className="form-group"><label>ผู้เบิกจ่ายสินค้า</label>
                            <input className="form-control" value={outMeta.withdrawer_name}
                              onChange={e => setOutMeta(m => ({ ...m, withdrawer_name: e.target.value }))} /></div>
                          <div className="form-group"><label>ผู้ตรวจสอบ</label>
                            <input className="form-control" value={outMeta.inspector_name}
                              onChange={e => setOutMeta(m => ({ ...m, inspector_name: e.target.value }))} /></div>
                        </div>
                        <button className="btn btn-primary" onClick={handleSaveWithdrawal} disabled={savingOut}>
                          {savingOut ? 'กำลังบันทึก...' : 'บันทึกรายการเบิก'}
                        </button>
                      </>
                    )}
                  </>
                )}

                {/* Past withdrawals */}
                {pastWithdrawals.length > 0 && (
                  <div className="cs-past" style={{ marginTop: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <h4 style={{ margin: 0 }}>รายการเบิกที่ผ่านมา</h4>
                      <button className="btn btn-outline btn-sm" onClick={handleDeleteAllWithdrawals}
                        style={{ color: '#ef4444', borderColor: '#fca5a5' }}>
                        <FiTrash2 /> ลบทั้งหมด
                      </button>
                    </div>
                    <table className="excel-table">
                      <thead><tr><th>#</th><th>Out LOT</th><th>วันที่</th><th>จำนวนรายการ</th><th>กล่องรวม</th><th></th></tr></thead>
                      <tbody>
                        {pastWithdrawals.map((w, i) => (
                          <tr key={w.id}>
                            <td className="text-center">{i + 1}</td>
                            <td><strong>{w.doc_ref || '-'}</strong></td>
                            <td>{toDate(w.withdraw_date)}</td>
                            <td className="num-cell">{w.item_count}</td>
                            <td className="num-cell">{w.total_boxes_out}</td>
                            <td><button className="btn btn-outline btn-sm"
                              onClick={() => {
                                const depId = pastDeposits.length > 0 ? pastDeposits[0].id : 0;
                                navigate(`/customer/print/${depId}/${w.id}`);
                              }}><FiPrinter /> พิมพ์</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default CustomerStock;
