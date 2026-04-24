import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiSettings, FiSearch, FiCheck, FiClock, FiTruck, FiPackage,
  FiCheckCircle, FiXCircle, FiChevronDown, FiChevronUp, FiRefreshCw, FiPrinter, FiFileText
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getWithdrawals, getWithdrawal, updateWithdrawalStatus, updateWithdrawalItems, cancelWithdrawal, sendLineNotification } from '../services/api';
import {
  bangkokYYYYMMDD,
  bangkokYMDYesterday,
  bangkokLocaleDateString,
  bangkokLocaleString,
  dateToYYYYMMDDInBangkok,
} from '../utils/bangkokTime';

/** Same labels as withdraw LINE: invoice (import), order no (extra), BULK + lot. */
function withdrawalItemRefSuffix(item) {
  const st = String(item.stock_type || 'BULK').toUpperCase();
  if (st === 'IMPORT') {
    const inv = String(item.order_code || '').trim();
    return inv ? ` · Invoice no: ${inv}` : '';
  }
  if (st === 'CONTAINER_EXTRA') {
    const ord = String(item.order_code || '').trim();
    return ord ? ` · Order no: ${ord}` : '';
  }
  const lot = String(item.lot_no || '').trim();
  return lot ? ` · BULK · Lot ${lot}` : ' · BULK';
}

/** Text for LINE — same endpoint as No Movement page (`/reports/no-movement/send-line`). */
function buildWithdrawalQtyChangeLineMessage(expandedData, editedQty) {
  const rows = expandedData?.items || [];
  const lines = [];
  for (const it of rows) {
    const edited = editedQty[it.id];
    if (edited === undefined) continue;
    const newQty = Number(edited);
    const oldActual = Number(it.quantity_mc);
    if (newQty === oldActual) continue;
    const requested = Number(it.requested_mc ?? it.quantity_mc);
    const label = `${it.fish_name || ''} ${it.size || ''} @ ${it.line_place || '—'}`.replace(/\s+/g, ' ').trim();
    lines.push(`• ${label}${withdrawalItemRefSuffix(it)}\n  Requested (MC): ${requested} → Actual (MC): ${newQty}`);
  }
  if (lines.length === 0) return null;
  let text = '📦 Withdrawal — Actual (MC) updated (Manage)\n';
  text += `Request: ${expandedData.request_no || '—'}\nDept: ${expandedData.department || '—'}\n\n`;
  text += lines.join('\n\n');
  return text;
}

const STATUS_FLOW = ['PENDING', 'TAKING_OUT', 'READY', 'FINISHED'];

function withdrawDeptBadgeClass(department) {
  switch (department) {
    case 'PK': return 'mg-dept-PK';
    case 'RM': return 'mg-dept-RM';
    case 'Branch.05 (SM)': return 'mg-dept-B05SM';
    default: return 'mg-dept-other';
  }
}

const STATUS_CONFIG = {
  PENDING:     { label: 'Receive Request', icon: <FiClock />,       color: '#f59e0b', bg: '#fffbeb', next: 'TAKING_OUT', nextLabel: 'Start Taking Out' },
  TAKING_OUT:  { label: 'Taking Out',      icon: <FiTruck />,       color: '#3b82f6', bg: '#eff6ff', next: 'READY',      nextLabel: 'Mark as Ready' },
  READY:       { label: 'Ready to Take',   icon: <FiPackage />,     color: '#8b5cf6', bg: '#f5f3ff', next: 'FINISHED',   nextLabel: 'Finish Take Out' },
  FINISHED:    { label: 'Finished',         icon: <FiCheckCircle />, color: '#22c55e', bg: '#f0fdf4', next: null,         nextLabel: null },
  CANCELLED:   { label: 'Cancelled',        icon: <FiXCircle />,    color: '#ef4444', bg: '#fef2f2', next: null,         nextLabel: null }
};

function Manage() {
  const navigate = useNavigate();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [expandedData, setExpandedData] = useState(null);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [processing, setProcessing] = useState(null);
  const [editedQty, setEditedQty] = useState({});   // { itemId: newQty }
  const [saving, setSaving] = useState(false);
  const [managerName, setManagerName] = useState('');

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filterStatus) params.status = filterStatus;
      if (filterDept) params.department = filterDept;
      if (dateFilter) params.date = dateFilter;
      const res = await getWithdrawals(params);
      setRequests(res.data);
    } catch (err) {
      toast.error('Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [filterStatus, filterDept, dateFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const toggleExpand = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedData(null);
      setEditedQty({});
      return;
    }
    try {
      const res = await getWithdrawal(id);
      setExpandedData(res.data);
      setExpandedId(id);
      setEditedQty({});
    } catch (err) {
      toast.error('Failed to load details');
    }
  };

  // Check if any quantities have been changed
  const hasQtyChanges = expandedData?.items?.some(item => {
    const edited = editedQty[item.id];
    return edited !== undefined && edited !== item.quantity_mc;
  });

  const handleSaveQty = async (requestId) => {
    if (!hasQtyChanges) return;
    setSaving(true);
    try {
      const items = Object.entries(editedQty)
        .filter(([itemId, qty]) => {
          const original = expandedData.items.find(it => it.id === Number(itemId));
          return original && qty !== original.quantity_mc;
        })
        .map(([itemId, qty]) => ({ id: Number(itemId), quantity_mc: Number(qty) }));

      if (items.length === 0) return;
      const lineMessage = buildWithdrawalQtyChangeLineMessage(expandedData, editedQty);
      await updateWithdrawalItems(requestId, { items });
      toast.success('Quantities updated successfully');

      if (lineMessage) {
        try {
          await sendLineNotification({ message: lineMessage });
          toast.success('Change details sent to LINE');
        } catch (lineErr) {
          toast.error(lineErr.response?.data?.error || 'Failed to send change to LINE (check Settings → LINE)');
        }
      }

      // Refresh data
      const res = await getWithdrawal(requestId);
      setExpandedData(res.data);
      setEditedQty({});
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update quantities');
    } finally {
      setSaving(false);
    }
  };

  const handleAdvanceStatus = async (req) => {
    const config = STATUS_CONFIG[req.status];
    if (!config?.next) return;

    // Manager name is required
    if (!managerName.trim()) {
      toast.error('Please enter your name (Manager / Preparer) before proceeding');
      return;
    }

    // If PENDING and quantities were edited, save first
    if (req.status === 'PENDING' && hasQtyChanges) {
      if (!window.confirm('You have unsaved quantity changes. Save them and then advance?')) return;
      await handleSaveQty(req.id);
    }

    const confirmMsg = config.next === 'FINISHED'
      ? `This will perform Stock OUT for all items. Continue?`
      : `Advance to "${STATUS_CONFIG[config.next].label}"?`;

    if (!window.confirm(confirmMsg)) return;

    setProcessing(req.id);
    try {
      await updateWithdrawalStatus(req.id, { status: config.next, managed_by: managerName.trim() });
      toast.success(`Status updated to ${STATUS_CONFIG[config.next].label}`);
      fetchRequests();
      if (expandedId === req.id) {
        const res = await getWithdrawal(req.id);
        setExpandedData(res.data);
        setEditedQty({});
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update status');
    } finally {
      setProcessing(null);
    }
  };

  const handleCancel = async (req) => {
    if (!window.confirm(`Cancel request ${req.request_no}?`)) return;
    setProcessing(req.id);
    try {
      await cancelWithdrawal(req.id);
      toast.success('Request cancelled');
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to cancel');
    } finally {
      setProcessing(null);
    }
  };

  const filtered = requests.filter(r => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return r.request_no.toLowerCase().includes(q) ||
           r.department.toLowerCase().includes(q) ||
           (r.requested_by && r.requested_by.toLowerCase().includes(q));
  });

  // Group by day for day-by-day display
  const requestsByDay = useMemo(() => {
    const groups = {};
    filtered.forEach(req => {
      const raw = req.withdraw_date || req.created_at;
      const d = raw ? new Date(raw) : new Date();
      const dateKey = dateToYYYYMMDDInBangkok(d);
      const dateLabel = bangkokLocaleDateString(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
      if (!groups[dateKey]) groups[dateKey] = { dateKey, dateLabel, requests: [] };
      groups[dateKey].requests.push(req);
    });
    return Object.values(groups).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [filtered]);

  // Count by status
  const counts = requests.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <>
      <div className="page-header">
        <h2><FiSettings /> Manage Withdrawals</h2>
        <button className="btn btn-outline" onClick={fetchRequests}><FiRefreshCw /> Refresh</button>
      </div>
      <div className="page-body">

        {/* Status summary cards */}
        <div className="mg-status-cards">
          {STATUS_FLOW.map(s => (
            <div
              key={s}
              className={`mg-status-card ${filterStatus === s ? 'active' : ''}`}
              style={{ '--sc-color': STATUS_CONFIG[s].color, '--sc-bg': STATUS_CONFIG[s].bg }}
              onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
            >
              <div className="mg-sc-icon">{STATUS_CONFIG[s].icon}</div>
              <div className="mg-sc-info">
                <div className="mg-sc-count">{counts[s] || 0}</div>
                <div className="mg-sc-label">{STATUS_CONFIG[s].label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="filter-bar" style={{ marginBottom: 16 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 300 }}>
            <FiSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
            <input className="form-control" style={{ paddingLeft: 36 }} placeholder="Search request no..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-control" style={{ width: 'auto' }} value={filterDept} onChange={e => setFilterDept(e.target.value)}>
            <option value="">All Departments</option>
            <option value="PK">PK</option>
            <option value="RM">RM</option>
            <option value="Branch.05 (SM)">Branch.05 (SM)</option>
          </select>
          <select className="form-control" style={{ width: 'auto' }} value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">All Status</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {/* Date filter — find by date */}
        <div className="mg-date-bar">
          <label className="mg-date-label">Date:</label>
          <input
            type="date"
            className="form-control mg-date-input"
            value={dateFilter}
            onChange={e => setDateFilter(e.target.value)}
            title="Filter by request date"
          />
          <div className="mg-date-quick">
            {(() => {
              const todayStr = bangkokYYYYMMDD();
              const yesterdayStr = bangkokYMDYesterday();
              return (
                <>
                  <button type="button" className={`mg-date-btn ${!dateFilter ? 'active' : ''}`} onClick={() => setDateFilter('')}>All</button>
                  <button type="button" className={`mg-date-btn ${dateFilter === todayStr ? 'active' : ''}`} onClick={() => setDateFilter(todayStr)}>Today</button>
                  <button type="button" className={`mg-date-btn ${dateFilter === yesterdayStr ? 'active' : ''}`} onClick={() => setDateFilter(yesterdayStr)}>Yesterday</button>
                </>
              );
            })()}
          </div>
        </div>

        {/* Request list — day by day */}
        {loading ? (
          <div className="loading"><div className="spinner"></div></div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: 60, textAlign: 'center', color: 'var(--gray-400)' }}>
            {dateFilter ? `No requests found for ${new Date(dateFilter + 'T12:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' })}` : 'No withdrawal requests found'}
          </div>
        ) : (
          <div className="mg-requests-by-day">
            {requestsByDay.map(dayGroup => (
              <div key={dayGroup.dateKey} className="mg-day-section">
                <h3 className="mg-day-heading">{dayGroup.dateLabel}</h3>
                <div className="mg-requests">
                  {dayGroup.requests.map(req => {
              const config = STATUS_CONFIG[req.status];
              const isExpanded = expandedId === req.id;
              const isProcessing = processing === req.id;
              const canAdvance = config?.next && req.status !== 'CANCELLED';
              const canCancel = req.status !== 'FINISHED' && req.status !== 'CANCELLED';

              return (
                <div key={req.id} className={`mg-request-card ${isExpanded ? 'expanded' : ''}`}>
                  {/* Card header */}
                  <div className="mg-req-header" onClick={() => toggleExpand(req.id)}>
                    <div className="mg-req-left">
                      <span className={`mg-dept-badge ${withdrawDeptBadgeClass(req.department)}`}>{req.department}</span>
                      <div className="mg-req-info">
                        <span className="mg-req-no">{req.request_no}</span>
                        <span className="mg-req-date">{bangkokLocaleString(new Date(req.created_at))}</span>
                      </div>
                    </div>
                    <div className="mg-req-right">
                      <span className="mg-req-stats">
                        {req.item_count} items · {Number(req.total_requested_mc || req.total_mc)} req · {Number(req.total_mc)} actual MC
                      </span>
                      <span className="mg-status-badge" style={{ background: config.bg, color: config.color }}>
                        {config.icon} {config.label}
                      </span>
                      {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div className="mg-progress">
                    {STATUS_FLOW.map((s, i) => {
                      const currentIdx = STATUS_FLOW.indexOf(req.status);
                      const isDone = i <= currentIdx && req.status !== 'CANCELLED';
                      const isCurrent = i === currentIdx && req.status !== 'CANCELLED';
                      return (
                        <React.Fragment key={s}>
                          <div className={`mg-progress-step ${isDone ? 'done' : ''} ${isCurrent ? 'current' : ''}`}>
                            <div className="mg-progress-dot">
                              {isDone ? <FiCheck /> : <span>{i + 1}</span>}
                            </div>
                            <span className="mg-progress-label">{STATUS_CONFIG[s].label}</span>
                          </div>
                          {i < STATUS_FLOW.length - 1 && (
                            <div className={`mg-progress-line ${i < currentIdx && req.status !== 'CANCELLED' ? 'done' : ''}`} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && expandedData && (
                    <div className="mg-req-detail">
                      <div className="mg-detail-items">
                        <h5>Items</h5>
                        <table className="table mg-items-table">
                          <thead>
                            <tr>
                              <th>#</th>
                              <th>Fish Name</th>
                              <th>Size</th>
                              <th>Location</th>
                              <th>Lot</th>
                              <th className="mg-col-balance">Balance (MC)</th>
                              <th className="mg-col-requested">Requested (MC)</th>
                              <th className="mg-col-qty">Actual (MC)</th>
                              <th>Weight (KG)</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {expandedData.items?.map((item, i) => {
                              const balance = Number(item.hand_on_balance || 0);
                              const requestedMc = Number(item.requested_mc || item.quantity_mc);
                              const isPending = req.status === 'PENDING';
                              const currentQty = editedQty[item.id] !== undefined
                                ? Number(editedQty[item.id])
                                : Number(item.quantity_mc);
                              const isInsufficient = balance < requestedMc;
                              const isEdited = editedQty[item.id] !== undefined && editedQty[item.id] !== item.quantity_mc;
                              const weightKg = currentQty * Number(item.bulk_weight_kg);
                              const actualDiffers = currentQty !== requestedMc;

                              return (
                                <tr key={item.id} className={isInsufficient && isPending ? 'mg-row-warn' : ''}>
                                  <td>{i + 1}</td>
                                  <td><strong>{item.fish_name}</strong></td>
                                  <td>{item.size}</td>
                                  <td>{item.line_place}</td>
                                  <td className="mg-lot-cell">{item.lot_no || item.order_code || '—'}</td>
                                  <td className="num-cell">
                                    <span className={`mg-balance-badge ${balance <= 0 ? 'empty' : isInsufficient ? 'low' : 'ok'}`}>
                                      {balance}
                                    </span>
                                  </td>
                                  <td className="num-cell">
                                    <span className="mg-requested-val">{requestedMc}</span>
                                  </td>
                                  <td className="num-cell">
                                    {isPending ? (
                                      <div className="mg-qty-edit">
                                        <input
                                          type="number"
                                          className={`mg-qty-input ${isEdited ? 'edited' : ''} ${isInsufficient && editedQty[item.id] === undefined ? 'warn' : ''}`}
                                          min={0}
                                          max={balance}
                                          value={currentQty}
                                          onChange={e => {
                                            const val = Math.max(0, Math.min(balance, Number(e.target.value) || 0));
                                            setEditedQty(prev => ({ ...prev, [item.id]: val }));
                                          }}
                                        />
                                        {isInsufficient && editedQty[item.id] === undefined && (
                                          <button
                                            className="mg-qty-fix-btn"
                                            title="Set to max available balance"
                                            onClick={() => setEditedQty(prev => ({ ...prev, [item.id]: Math.min(balance, requestedMc) }))}
                                          >
                                            Fix
                                          </button>
                                        )}
                                      </div>
                                    ) : (
                                      <span className={actualDiffers ? 'mg-actual-changed' : ''}>
                                        <strong>{item.quantity_mc}</strong>
                                        {actualDiffers && <span className="mg-diff-note"> (was {requestedMc})</span>}
                                      </span>
                                    )}
                                  </td>
                                  <td className="num-cell">{weightKg.toFixed(0)}</td>
                                  <td>
                                    {isInsufficient && isPending && editedQty[item.id] === undefined ? (
                                      <span className="mg-stock-warn">
                                        Low Stock
                                      </span>
                                    ) : (
                                      <span className="mg-stock-ok">
                                        <FiCheck size={12} /> OK
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                        {expandedData.notes && (
                          <div className="mg-notes">
                            <strong>Notes:</strong> {expandedData.notes}
                          </div>
                        )}
                      </div>

                      {/* Manager name input */}
                      {canAdvance && (
                        <div className="mg-manager-field">
                          <label>Manager / Preparer Name</label>
                          <input
                            type="text"
                            className="form-control"
                            placeholder="Enter your name..."
                            value={managerName}
                            onChange={e => setManagerName(e.target.value)}
                          />
                        </div>
                      )}

                      {/* Action buttons */}
                      <div className="mg-actions">
                        <button
                          className="btn btn-outline"
                          onClick={() => navigate(`/withdraw/${req.id}/form`)}
                        >
                          <FiPrinter /> Print Form
                        </button>
                        {req.status === 'PENDING' && hasQtyChanges && (
                          <button
                            className="btn btn-warning"
                            onClick={() => handleSaveQty(req.id)}
                            disabled={saving}
                          >
                            {saving ? 'Saving...' : 'Save Quantity Changes'}
                          </button>
                        )}
                        {canAdvance && (
                          <button
                            className="btn btn-primary btn-lg"
                            onClick={() => handleAdvanceStatus(req)}
                            disabled={isProcessing}
                          >
                            {isProcessing ? 'Processing...' : (
                              <>
                                {STATUS_CONFIG[config.next]?.icon} {config.nextLabel}
                              </>
                            )}
                          </button>
                        )}
                        <button
                          className="btn btn-outline"
                          onClick={() => navigate(`/withdraw/${req.id}/report`)}
                        >
                          <FiFileText /> Report
                        </button>
                        {canCancel && (
                          <button
                            className="btn btn-danger"
                            onClick={() => handleCancel(req)}
                            disabled={isProcessing}
                          >
                            <FiXCircle /> Cancel Request
                          </button>
                        )}
                      </div>
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
    </>
  );
}

export default Manage;
