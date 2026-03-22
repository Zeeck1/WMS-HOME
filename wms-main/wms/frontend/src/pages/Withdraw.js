import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiShoppingCart, FiPlus, FiTrash2, FiSend, FiSearch,
  FiPackage, FiCheck, FiChevronRight, FiClock, FiCheckCircle, FiXCircle, FiRefreshCw, FiBox, FiAnchor
} from 'react-icons/fi';
import { TbForklift } from 'react-icons/tb';
import { toast } from 'react-toastify';
import { getInventory, createWithdrawal, getWithdrawals, getWithdrawal } from '../services/api';
import { sortLocationsNearestFirst } from '../config/warehouseConfig';

const DEPARTMENTS = [
  { id: 'PK', label: 'PK', desc: 'Packing Department', color: '#6366f1', icon: '📦' },
  { id: 'RM', label: 'RM', desc: 'Raw Material Department', color: '#f97316', icon: '🏭' }
];

const STOCK_TYPE_TABS = [
  { id: 'BULK', label: 'Bulk', icon: <FiPackage /> },
  { id: 'CONTAINER_EXTRA', label: 'Extra', icon: <FiBox /> },
  { id: 'IMPORT', label: 'Import', icon: <FiAnchor /> }
];

const STATUS_CONFIG = {
  PENDING: { label: 'Pending', color: '#f59e0b', bg: '#fffbeb', icon: FiClock },
  TAKING_OUT: { label: 'Taking Out', color: '#3b82f6', bg: '#eff6ff', icon: TbForklift },
  READY: { label: 'Ready to Take', color: '#8b5cf6', bg: '#f5f3ff', icon: FiPackage },
  FINISHED: { label: 'Finished', color: '#22c55e', bg: '#f0fdf4', icon: FiCheckCircle },
  CANCELLED: { label: 'Cancelled', color: '#ef4444', bg: '#fef2f2', icon: FiXCircle }
};

const STATUS_ORDER = ['PENDING', 'TAKING_OUT', 'READY', 'FINISHED'];

function Withdraw() {
  const navigate = useNavigate();
  const [step, setStep] = useState('dept');
  const [department, setDepartment] = useState(null);
  const [inventory, setInventory] = useState([]);
  const [cart, setCart] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [myRequests, setMyRequests] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [notes, setNotes] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [withdrawDate, setWithdrawDate] = useState(new Date().toISOString().slice(0, 10));
  const [requestTime, setRequestTime] = useState(new Date().toTimeString().slice(0, 5));
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [dateFilter, setDateFilter] = useState('');
  const [expandedRequest, setExpandedRequest] = useState(null);
  const [requestDetails, setRequestDetails] = useState(null);
  const [stockTypeTab, setStockTypeTab] = useState(null);

  useEffect(() => {
    if (department) {
      fetchInventory();
      fetchMyRequests();
    }
    // eslint-disable-next-line
  }, [department, statusFilter, dateFilter, stockTypeTab]);

  const fetchInventory = async () => {
    setLoading(true);
    try {
      const params = stockTypeTab ? { stock_type: stockTypeTab } : {};
      const res = await getInventory(params);
      setInventory(res.data);
    } catch (err) {
      toast.error('Failed to load stock');
    } finally {
      setLoading(false);
    }
  };

  const fetchMyRequests = async () => {
    try {
      const params = { department };
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (dateFilter) params.date = dateFilter;
      const res = await getWithdrawals(params);
      setMyRequests(res.data);
      setExpandedRequest(null);
      setRequestDetails(null);
    } catch (err) { /* ignore */ }
  };

  const handleExpandRequest = async (req) => {
    if (expandedRequest === req.id) {
      setExpandedRequest(null);
      setRequestDetails(null);
      return;
    }
    setExpandedRequest(req.id);
    try {
      const res = await getWithdrawal(req.id);
      setRequestDetails(res.data);
    } catch (err) {
      toast.error('Failed to load details');
    }
  };

  // Group withdrawal requests by day (for day-by-day display)
  const requestsByDay = useMemo(() => {
    const groups = {};
    myRequests.forEach(req => {
      const raw = req.withdraw_date || req.created_at;
      const d = raw ? new Date(raw) : new Date();
      const dateKey = d.toISOString().slice(0, 10);
      const dateLabel = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      if (!groups[dateKey]) groups[dateKey] = { dateKey, dateLabel, requests: [] };
      groups[dateKey].requests.push(req);
    });
    return Object.values(groups).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [myRequests]);

  // Group inventory by product (fish_name + size + bulk_weight + type + glazing)
  const groupedInventory = useMemo(() => {
    // Filter first (search against combined label: fish/size/type/glazing + sticker + other fields)
    let filtered = inventory;
    if (search.trim()) {
      const q = search.toLowerCase();
      filtered = inventory.filter(item => {
        const typeOrGlazing = [item.type, item.glazing].filter(Boolean).join(' ');
        const baseLabel = typeOrGlazing
          ? `${item.fish_name}/${item.size}/${typeOrGlazing}`
          : `${item.fish_name}/${item.size}`;
        const stickerText = item.sticker ? ` (${item.sticker})` : '';
        const label = (baseLabel + stickerText).toLowerCase();
        return (
          label.includes(q) ||
          (item.line_place && item.line_place.toLowerCase().includes(q)) ||
          (item.lot_no && item.lot_no.toLowerCase().includes(q)) ||
          (item.order_code && item.order_code.toLowerCase().includes(q))
        );
      });
    }
    // Group by product identity + sticker so each sticker variant is its own group (matches Stock Table rows)
    const groups = {};
    filtered.forEach(item => {
      const st = item.stock_type || 'BULK';
      const oc = item.order_code || '';
      const stk = item.sticker || '';
      const key = `${item.fish_name}||${item.size}||${item.bulk_weight_kg}||${item.type || ''}||${item.glazing || ''}||${st}||${oc}||${stk}`;
      if (!groups[key]) {
        groups[key] = {
          key,
          fish_name: item.fish_name,
          size: item.size,
          bulk_weight_kg: item.bulk_weight_kg,
          type: item.type || '',
          glazing: item.glazing || '',
          stock_type: st,
          order_code: oc,
          sticker: stk,
          total_mc: 0,
          total_kg: 0,
          subItems: []
        };
      }
      const mc = Number(item.hand_on_balance_mc) || 0;
      groups[key].total_mc += mc;
      groups[key].total_kg += Number(item.hand_on_balance_kg) || 0;
      groups[key].subItems.push(item);
    });
    // Sort sub-items by nearest location first (04, 08 = nearest; 01 = far; then by line A–DD)
    Object.values(groups).forEach(g => {
      g.subItems = sortLocationsNearestFirst(g.subItems, 'line_place');
    });
    return Object.values(groups);
  }, [inventory, search]);

  const addToCart = (group) => {
    const exists = cart.find(c => c.groupKey === group.key);
    if (exists) {
      toast.warning('Item already in cart');
      return;
    }
    setCart(prev => [...prev, {
      groupKey: group.key,
      fish_name: group.fish_name,
      size: group.size,
      bulk_weight_kg: group.bulk_weight_kg,
      type: group.type,
      glazing: group.glazing,
      stock_type: group.stock_type,
      order_code: group.order_code,
      request_qty: 1,
      max_qty: group.total_mc,
      total_kg: group.total_kg,
      subItems: group.subItems,
      production_process: ''
    }]);
    toast.success(`Added ${group.fish_name} to cart`);
  };

  const updateCartQty = (index, qty) => {
    setCart(prev => prev.map((c, i) => i === index ? { ...c, request_qty: Math.max(1, Math.min(qty, c.max_qty)) } : c));
  };

  const updateCartProcess = (index, val) => {
    setCart(prev => prev.map((c, i) => i === index ? { ...c, production_process: val } : c));
  };

  const removeFromCart = (index) => {
    setCart(prev => prev.filter((_, i) => i !== index));
  };

  // Distribute requested qty across sub-items (nearest line first)
  const distributeItems = (cartItem) => {
    const distributed = [];
    let remaining = cartItem.request_qty;
    // subItems already sorted by nearest line
    for (const sub of cartItem.subItems) {
      if (remaining <= 0) break;
      const available = Number(sub.hand_on_balance_mc) || 0;
      if (available <= 0) continue;
      const take = Math.min(remaining, available);
      distributed.push({
        lot_id: sub.lot_id,
        location_id: sub.location_id,
        quantity_mc: take,
        weight_kg: take * Number(cartItem.bulk_weight_kg),
        production_process: cartItem.production_process || null
      });
      remaining -= take;
    }
    return distributed;
  };

  const handleSubmit = async () => {
    if (cart.length === 0) { toast.error('Cart is empty'); return; }
    if (!requesterName.trim()) { toast.error('Please enter your name (Requester Name)'); return; }
    if (!withdrawDate) { toast.error('Please select a withdraw date'); return; }
    if (!requestTime) { toast.error('Please select a request time'); return; }
    setSubmitting(true);
    try {
      // Distribute cart items across specific lots/locations
      const items = [];
      for (const c of cart) {
        const dist = distributeItems(c);
        items.push(...dist);
      }
      if (items.length === 0) {
        toast.error('Could not allocate stock for the requested items');
        setSubmitting(false);
        return;
      }
      const res = await createWithdrawal({
        department,
        items,
        notes,
        requested_by: requesterName.trim() || 'system',
        withdraw_date: withdrawDate,
        request_time: requestTime
      });
      toast.success('Withdrawal request submitted!');
      // Navigate to the printable form page
      const requestId = res.data.request?.id;
      if (requestId) {
        navigate(`/withdraw/${requestId}/form`);
      }
      setCart([]);
      setNotes('');
      setRequesterName('');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to submit');
    } finally {
      setSubmitting(false);
    }
  };

  const totalCartMC = cart.reduce((s, c) => s + c.request_qty, 0);
  const totalCartKG = cart.reduce((s, c) => s + (c.request_qty * Number(c.bulk_weight_kg)), 0);

  // ─── Department Selection ──────────────────────────
  if (step === 'dept') {
    return (
      <>
        <div className="page-header">
          <h2><FiShoppingCart /> Withdraw</h2>
        </div>
        <div className="page-body">
          <div className="wd-dept-title">Select Your Department</div>
          <div className="wd-dept-grid">
            {DEPARTMENTS.map(dept => (
              <div
                key={dept.id}
                className="wd-dept-card"
                style={{ '--dept-color': dept.color }}
                onClick={() => { setDepartment(dept.id); setStep('select'); }}
              >
                <div className="wd-dept-icon">{dept.icon}</div>
                <div className="wd-dept-info">
                  <h3>{dept.label}</h3>
                  <p>{dept.desc}</p>
                </div>
                <FiChevronRight className="wd-dept-arrow" />
              </div>
            ))}
          </div>
        </div>
      </>
    );
  }

  // ─── Item Selection + Cart ─────────────────────────
  return (
    <>
      <div className="page-header">
        <h2>
          <FiShoppingCart /> Withdraw — <span style={{ color: DEPARTMENTS.find(d => d.id === department)?.color }}>{department}</span>
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-outline" onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? 'Back to Select' : `My Requests (${myRequests.length})`}
          </button>
          <button className="btn btn-outline" onClick={() => { setStep('dept'); setDepartment(null); setCart([]); }}>
            Change Dept
          </button>
        </div>
      </div>
      <div className="page-body">

        {/* ─── My Withdrawal Requests — Food Ordering Style ─── */}
        {showHistory ? (
          <div className="wd-my-orders">
            {/* Hero Header */}
            <div className="wd-orders-hero">
              <div className="wd-orders-hero-content">
                <h1 className="wd-orders-title">My Withdrawal Requests</h1>
                <p className="wd-orders-subtitle">Track and manage your stock withdrawal orders</p>
              </div>
              <div className="wd-orders-hero-right">
                <button className="wd-orders-refresh" onClick={fetchMyRequests} title="Refresh">
                  <FiRefreshCw size={18} />
                </button>
                <div className="wd-orders-stats">
                <div className="wd-order-stat">
                  <span className="wd-order-stat-value">{myRequests.length}</span>
                  <span className="wd-order-stat-label">Total</span>
                </div>
                <div className="wd-order-stat">
                  <span className="wd-order-stat-value">{myRequests.filter(r => r.status === 'PENDING' || r.status === 'TAKING_OUT').length}</span>
                  <span className="wd-order-stat-label">Active</span>
                </div>
                <div className="wd-order-stat">
                  <span className="wd-order-stat-value">{myRequests.filter(r => r.status === 'READY').length}</span>
                  <span className="wd-order-stat-label">Ready</span>
                </div>
                </div>
              </div>
            </div>

            {/* Date filter — find by date */}
            {(() => {
              const todayStr = new Date().toISOString().slice(0, 10);
              const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
              const yesterdayStr = yesterday.toISOString().slice(0, 10);
              return (
                <div className="wd-orders-date-bar">
                  <label className="wd-orders-date-label">Date:</label>
                  <input
                    type="date"
                    className="form-control wd-orders-date-input"
                    value={dateFilter}
                    onChange={e => setDateFilter(e.target.value)}
                    title="Filter by request date"
                  />
                  <div className="wd-orders-date-quick">
                    <button type="button" className={`wd-orders-date-btn ${!dateFilter ? 'active' : ''}`} onClick={() => setDateFilter('')}>All</button>
                    <button type="button" className={`wd-orders-date-btn ${dateFilter === todayStr ? 'active' : ''}`} onClick={() => setDateFilter(todayStr)}>Today</button>
                    <button type="button" className={`wd-orders-date-btn ${dateFilter === yesterdayStr ? 'active' : ''}`} onClick={() => setDateFilter(yesterdayStr)}>Yesterday</button>
                  </div>
                </div>
              );
            })()}

            {/* Status Tabs */}
            <div className="wd-orders-tabs">
              {['ALL', 'PENDING', 'TAKING_OUT', 'READY', 'FINISHED', 'CANCELLED'].map(s => (
                <button
                  key={s}
                  className={`wd-order-tab ${statusFilter === s ? 'active' : ''}`}
                  onClick={() => setStatusFilter(s)}
                >
                  {s === 'ALL' ? 'All Orders' : STATUS_CONFIG[s]?.label || s}
                </button>
              ))}
            </div>

            {/* Order Cards — day by day */}
            {myRequests.length === 0 ? (
              <div className="wd-orders-empty">
                <div className="wd-orders-empty-icon">📦</div>
                <h3>No withdrawal requests</h3>
                <p>
                  {dateFilter
                    ? `No requests found for ${new Date(dateFilter + 'T12:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' })}`
                    : statusFilter !== 'ALL'
                      ? `No ${STATUS_CONFIG[statusFilter]?.label?.toLowerCase() || statusFilter.toLowerCase()} requests found`
                      : 'Submit a withdrawal request to see it here'}
                </p>
                <button className="btn btn-primary" onClick={() => setShowHistory(false)}>
                  <FiShoppingCart /> Start New Request
                </button>
              </div>
            ) : (
              <div className="wd-orders-by-day">
                {requestsByDay.map(dayGroup => (
                  <div key={dayGroup.dateKey} className="wd-orders-day-section">
                    <h3 className="wd-orders-day-heading">{dayGroup.dateLabel}</h3>
                    <div className="wd-orders-grid">
                      {dayGroup.requests.map(req => {
                  const StatusIcon = STATUS_CONFIG[req.status]?.icon || FiClock;
                  const isCancelled = req.status === 'CANCELLED';
                  return (
                    <div
                      key={req.id}
                      className={`wd-order-card wd-order-card--${(req.status || '').toLowerCase().replace(' ', '-')} ${expandedRequest === req.id ? 'expanded' : ''}`}
                      style={{ '--status-color': STATUS_CONFIG[req.status]?.color }}
                    >
                      <div className="wd-order-card-header" onClick={() => !isCancelled && handleExpandRequest(req)}>
                        <div className="wd-order-card-accent" />
                        <div className="wd-order-card-main">
                          <div className="wd-order-card-top">
                            <span className="wd-order-dept-badge" style={{ background: DEPARTMENTS.find(d => d.id === req.department)?.color }}>
                              {req.department}
                            </span>
                            <span className="wd-order-no">{req.request_no}</span>
                          </div>
                          <div className="wd-order-card-meta">
                            <span className="wd-order-summary">
                              {req.item_count} items · {Number(req.total_mc)} MC · {Number(req.total_kg || 0).toFixed(0)} KG
                            </span>
                            <span className="wd-order-date">{new Date(req.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}</span>
                          </div>
                          <div className="wd-order-status-row">
                            <span className="wd-order-status-badge" style={{ background: STATUS_CONFIG[req.status]?.bg, color: STATUS_CONFIG[req.status]?.color }}>
                              <StatusIcon size={12} />
                              {STATUS_CONFIG[req.status]?.label}
                            </span>
                            {!isCancelled && (
                              <FiChevronRight className={`wd-order-expand-icon ${expandedRequest === req.id ? 'rotated' : ''}`} />
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Progress Tracker + Forklift drive (when Taking Out) */}
                      {!isCancelled && (
                        <div className="wd-order-progress-wrap">
                          {req.status === 'TAKING_OUT' && (
                            <div className="wd-order-forklift-track" aria-hidden="true">
                              <div className="wd-order-forklift-road" />
                              <div className="wd-order-forklift-drive">
                                <TbForklift className="wd-order-forklift-icon" size={22} />
                              </div>
                            </div>
                          )}
                          <div className="wd-order-progress">
                            {STATUS_ORDER.map((s, i) => {
                              const currentIdx = STATUS_ORDER.indexOf(req.status);
                              const isDone = i <= currentIdx;
                              const isCurrent = i === currentIdx;
                              const StepIcon = STATUS_CONFIG[s]?.icon || FiCheck;
                              return (
                                <React.Fragment key={s}>
                                  <div className={`wd-order-progress-step ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}>
                                    <div className="wd-order-progress-dot">
                                      {isDone ? <StepIcon size={10} /> : <span>{i + 1}</span>}
                                    </div>
                                    <span className="wd-order-progress-label">{STATUS_CONFIG[s]?.label}</span>
                                  </div>
                                  {i < STATUS_ORDER.length - 1 && (
                                    <div className={`wd-order-progress-line ${isDone ? 'done' : ''}`} />
                                  )}
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Expanded Details */}
                      {expandedRequest === req.id && requestDetails?.id === req.id && requestDetails?.items && (
                        <div className="wd-order-detail">
                          <h5>Items</h5>
                          <div className="wd-order-detail-list">
                            {requestDetails.items.map((it, idx) => (
                              <div key={idx} className="wd-order-detail-item">
                                <span className="wd-order-detail-fish">{it.fish_name}</span>
                                <span className="wd-order-detail-size">{it.size}</span>
                                <span className="wd-order-detail-meta">{it.line_place} · {it.lot_no}</span>
                                <span className="wd-order-detail-qty">{it.quantity_mc} MC</span>
                              </div>
                            ))}
                          </div>
                          {requestDetails.notes && (
                            <p className="wd-order-notes"><strong>Notes:</strong> {requestDetails.notes}</p>
                          )}
                          <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} onClick={() => navigate(`/withdraw/${req.id}/form`)}>
                            View / Print Form
                          </button>
                        </div>
                      )}
                    </div>
                  );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="wd-layout">
            {/* ─── Left: Stock browser ─── */}
            <div className="wd-stock-panel">
              <div className="wd-stock-header">
                <h3><FiPackage /> Available Stock</h3>
                <div className="wd-search">
                  <FiSearch />
                  <input
                    placeholder="Search fish, size, location, lot..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="stock-type-tabs wd-stock-tabs">
                {STOCK_TYPE_TABS.map(tab => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`stock-type-tab ${stockTypeTab === tab.id ? 'active' : ''}`}
                    onClick={() => setStockTypeTab(prev => prev === tab.id ? null : tab.id)}
                  >
                    {tab.icon} {tab.label}
                  </button>
                ))}
              </div>

              {loading ? (
                <div className="loading"><div className="spinner"></div></div>
              ) : groupedInventory.length === 0 ? (
                <div className="empty-state">No stock found</div>
              ) : (
                <div className="wd-stock-list">
                  {groupedInventory.map((group) => {
                    const inCart = cart.some(c => c.groupKey === group.key);
                    const typeOrGlazing = [group.type, group.glazing].filter(Boolean).join(' ');
                    const baseLabel = typeOrGlazing
                      ? `${group.fish_name}/${group.size}/${typeOrGlazing}`
                      : `${group.fish_name}/${group.size}`;
                    const stickerText = group.sticker ? ` (${group.sticker})` : '';
                    const totalKg = Number(group.total_kg) || (group.total_mc * Number(group.bulk_weight_kg));
                    const stockLabel = `${baseLabel}${stickerText} = ${group.total_mc} MC. [${totalKg.toLocaleString(undefined)} KG]`;
                    const st = group.stock_type || 'BULK';
                    const remark = st === 'CONTAINER_EXTRA'
                      ? (group.order_code ? `[EXTRA] Order: ${group.order_code}` : '[EXTRA]')
                      : st === 'IMPORT'
                        ? (group.order_code ? `[IMPORT] Invoice: ${group.order_code}` : '[IMPORT]')
                        : '[BULK]';
                    return (
                      <div key={group.key} className={`wd-stock-item ${inCart ? 'in-cart' : ''}`}>
                        <div className="wd-stock-item-info">
                          <div className="wd-stock-item-name">{stockLabel}</div>
                          <div className="wd-stock-item-remark">{remark}</div>
                        </div>
                        <button
                          className={`btn btn-sm ${inCart ? 'btn-success' : 'btn-primary'}`}
                          onClick={() => addToCart(group)}
                          disabled={inCart}
                        >
                          {inCart ? <><FiCheck /> Added</> : <><FiPlus /> Add</>}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ─── Right: Cart ─── */}
            <div className="wd-cart-panel">
              <div className="wd-cart-header">
                <h3><FiShoppingCart /> Cart ({cart.length})</h3>
                {cart.length > 0 && (
                  <div className="wd-cart-totals">
                    <span>{totalCartMC} MC</span>
                    <span>{totalCartKG.toFixed(0)} KG</span>
                  </div>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="wd-cart-empty">
                  <FiShoppingCart style={{ fontSize: '2rem', opacity: 0.3 }} />
                  <p>Add items from stock to withdraw</p>
                </div>
              ) : (
                <>
                  <div className="wd-cart-list">
                    {cart.map((item, i) => (
                      <div key={i} className="wd-cart-item">
                        <div className="wd-cart-item-info">
                          <div className="wd-cart-item-name">{item.fish_name}</div>
                          <div className="wd-cart-item-loc">
                            {item.size} · {Number(item.bulk_weight_kg)} KG
                            {item.type ? ` · ${item.type}` : ''}
                            {item.glazing ? ` · ${item.glazing}` : ''}
                          </div>
                          <div className="wd-cart-item-remark">
                            {(item.stock_type || 'BULK') === 'CONTAINER_EXTRA'
                              ? (item.order_code ? `[EXTRA] Order: ${item.order_code}` : '[EXTRA]')
                              : (item.stock_type || 'BULK') === 'IMPORT'
                                ? (item.order_code ? `[IMPORT] Invoice: ${item.order_code}` : '[IMPORT]')
                                : '[BULK]'}
                          </div>
                          <div className="wd-cart-item-loc" style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 }}>
                            Auto-picks from {item.subItems.length} location{item.subItems.length > 1 ? 's' : ''} (nearest first)
                          </div>
                        </div>
                        <div className="wd-cart-item-controls">
                          <div className="wd-qty-input">
                            <button onClick={() => updateCartQty(i, item.request_qty - 1)}>−</button>
                            <input
                              type="number"
                              value={item.request_qty}
                              min={1}
                              max={item.max_qty}
                              onChange={e => updateCartQty(i, parseInt(e.target.value) || 1)}
                            />
                            <button onClick={() => updateCartQty(i, item.request_qty + 1)}>+</button>
                          </div>
                          <button
                            className="wd-cart-max-btn"
                            onClick={() => updateCartQty(i, item.max_qty)}
                            title="Set to maximum available"
                          >
                            MAX
                          </button>
                          <span className="wd-cart-item-max">/ {item.max_qty} MC</span>
                          <button className="btn btn-sm btn-danger" onClick={() => removeFromCart(i)}>
                            <FiTrash2 />
                          </button>
                        </div>
                        <div className="wd-field wd-cart-item-process">
                          <label>Production Process</label>
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Production Process (e.g. MEX-001)"
                            value={item.production_process}
                            onChange={e => updateCartProcess(i, e.target.value)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="wd-cart-footer">
                    <div className="wd-cart-fields">
                      <div className="wd-field-row">
                        <div className="wd-field">
                          <label>Withdraw Date</label>
                          <input
                            type="date"
                            className="form-control"
                            value={withdrawDate}
                            onChange={e => setWithdrawDate(e.target.value)}
                          />
                        </div>
                        <div className="wd-field">
                          <label>Request Time</label>
                          <input
                            type="time"
                            className="form-control"
                            value={requestTime}
                            onChange={e => setRequestTime(e.target.value)}
                          />
                        </div>
                      </div>
                      <div className="wd-field">
                        <label>Requester Name</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Enter your name..."
                          value={requesterName}
                          onChange={e => setRequesterName(e.target.value)}
                        />
                      </div>
                      <div className="wd-field">
                        <label>Remark (optional)</label>
                        <textarea
                          className="form-control"
                          placeholder="Notes / Remark..."
                          value={notes}
                          onChange={e => setNotes(e.target.value)}
                          rows={2}
                        />
                      </div>
                    </div>
                    <button
                      className="btn btn-primary btn-lg wd-submit-btn"
                      onClick={handleSubmit}
                      disabled={submitting}
                    >
                      {submitting ? 'Submitting...' : <><FiSend /> Submit Request</>}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default Withdraw;
