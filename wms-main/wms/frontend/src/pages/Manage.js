import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiSettings, FiSearch, FiCheck, FiClock, FiTruck, FiPackage,
  FiCheckCircle, FiXCircle, FiChevronDown, FiChevronUp, FiRefreshCw, FiPrinter, FiFileText, FiTrash2,
  FiMapPin, FiCalendar, FiRotateCcw, FiSave, FiPlus
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import {
  getWithdrawals, getWithdrawal, getInventory, updateWithdrawalStatus, updateWithdrawalItems,
  saveWithdrawalPickRoute, undoWithdrawalPickRoute, cancelWithdrawal, permanentlyDeleteWithdrawal, sendLineNotification,
  addWithdrawalItem
} from '../services/api';
import { useAuth } from '../context/AuthContext';
import {
  bangkokYYYYMMDD,
  bangkokYMDYesterday,
  bangkokLocaleDateString,
  bangkokLocaleString,
  dateToYYYYMMDDInBangkok,
} from '../utils/bangkokTime';
import {
  groupWithdrawItems,
  withdrawFishNameLabel,
  withdrawDisplayLineKey,
  getManageDisplayItems,
  linesToPickRoutePayload,
} from '../utils/withdrawItemGrouping';

const MANAGER_NAME_STORAGE_KEY = 'wms_manager_preparer_name';

function managerNameStorageKey(userId) {
  return userId ? `${MANAGER_NAME_STORAGE_KEY}_${userId}` : MANAGER_NAME_STORAGE_KEY;
}

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
function buildWithdrawalQtyChangeLineMessage(displayItems, editedQty) {
  const rows = displayItems || [];
  const lines = [];
  for (const it of rows) {
    const edited = editedQty[withdrawDisplayLineKey(it)];
    if (edited === undefined) continue;
    const newQty = Number(edited);
    const oldActual = Number(it.quantity_mc);
    if (newQty === oldActual) continue;
    const requested = Number(it.requested_mc ?? it.quantity_mc);
    const label = `${it.fish_name || ''} ${it.size || ''} @ ${it.line_place || '—'}`.replace(/\s+/g, ' ').trim();
    lines.push(`• ${label}${withdrawalItemRefSuffix(it)}\n  Requested (MC): ${requested} → Actual (MC): ${newQty}`);
  }
  if (lines.length === 0) return null;
  return lines;
}

function formatWithdrawalQtyChangeLineMessage(expandedData, displayItems, editedQty) {
  const lines = buildWithdrawalQtyChangeLineMessage(displayItems, editedQty);
  if (!lines?.length) return null;
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

function lineQtyKey(item) {
  return item._lineKey || withdrawDisplayLineKey(item);
}

function currentItemQty(item, editedQty) {
  const key = lineQtyKey(item);
  return editedQty[key] !== undefined
    ? Number(editedQty[key])
    : Number(item.quantity_mc);
}

function ManageWithdrawItemRow({ item, rowNum, isEditable, editedQty, setEditedQty }) {
  const balance = Number(item.hand_on_balance || 0);
  const requestedMc = Number(item.requested_mc || item.quantity_mc);
  const currentQty = currentItemQty(item, editedQty);
  const isInsufficient = balance < requestedMc;
  const qtyKey = lineQtyKey(item);
  const isEdited = editedQty[qtyKey] !== undefined;
  const weightKg = currentQty * Number(item.bulk_weight_kg);
  const actualDiffers = currentQty !== requestedMc;

  return (
    <tr className={`mg-group-detail-row ${isInsufficient && isEditable ? 'mg-row-warn' : ''}`}>
      <td>{rowNum}</td>
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
        {isEditable ? (
          <div className="mg-qty-edit">
            <input
              type="number"
              className={`mg-qty-input ${isEdited ? 'edited' : ''} ${isInsufficient && editedQty[qtyKey] === undefined ? 'warn' : ''}`}
              min={0}
              max={balance}
              value={currentQty}
              onChange={(e) => {
                const val = Math.max(0, Math.min(balance, Number(e.target.value) || 0));
                setEditedQty((prev) => ({ ...prev, [qtyKey]: val }));
              }}
            />
            {isInsufficient && editedQty[qtyKey] === undefined && (
              <button
                type="button"
                className="mg-qty-fix-btn"
                title="Set to max available balance"
                onClick={() => setEditedQty((prev) => ({ ...prev, [qtyKey]: Math.min(balance, requestedMc) }))}
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
        {isInsufficient && isEditable && editedQty[qtyKey] === undefined ? (
          <span className="mg-stock-warn">Low Stock</span>
        ) : (
          <span className="mg-stock-ok">
            <FiCheck size={12} /> OK
          </span>
        )}
      </td>
    </tr>
  );
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
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
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
  const [savingPickRoute, setSavingPickRoute] = useState(false);
  const [inventory, setInventory] = useState([]);
  const [pickRouteTab, setPickRouteTab] = useState('nearest');
  const [managerName, setManagerName] = useState('');
  const [managerNameSaved, setManagerNameSaved] = useState(false);
  const [dispatcherName, setDispatcherName] = useState('');

  const [showAddItem, setShowAddItem] = useState(false);
  const [addItemSearch, setAddItemSearch] = useState({ fish_name: '', location: '', stack_no: '' });
  const [addItemResults, setAddItemResults] = useState([]);
  const [addItemLoading, setAddItemLoading] = useState(false);
  const [addItemQty, setAddItemQty] = useState({});
  const [addingItem, setAddingItem] = useState(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(managerNameStorageKey(user?.id));
      if (saved?.trim()) {
        setManagerName(saved.trim());
        setManagerNameSaved(true);
      }
    } catch {
      /* ignore */
    }
  }, [user?.id]);

  const persistManagerName = useCallback((name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    try {
      localStorage.setItem(managerNameStorageKey(user?.id), trimmed);
      setManagerNameSaved(true);
    } catch {
      /* ignore */
    }
  }, [user?.id]);

  const handleManagerNameChange = (e) => {
    const v = e.target.value;
    setManagerName(v);
    if (!v.trim()) setManagerNameSaved(false);
  };

  const handleManagerNameBlur = () => {
    persistManagerName(managerName);
  };

  /** Name is entered once at Receive Request; later steps use the saved name (read-only on card). */
  const applyManagerNameFromRequest = useCallback((data) => {
    const fromReq = (data?.managed_by || '').trim();
    if (fromReq && fromReq !== 'system' && fromReq !== 'admin') {
      setManagerName(fromReq);
      setManagerNameSaved(true);
      persistManagerName(fromReq);
    }
  }, [persistManagerName]);

  const resolveManagerNameForAdvance = useCallback((req, detail) => {
    const fromState = (managerName || '').trim();
    if (fromState) return fromState;
    const fromReq = (detail?.managed_by || req?.managed_by || '').trim();
    if (fromReq && fromReq !== 'system' && fromReq !== 'admin') return fromReq;
    return '';
  }, [managerName]);

  const applyDispatcherFromRequest = useCallback((data) => {
    const fromReq = (data?.dispatcher || '').trim();
    setDispatcherName(fromReq);
  }, []);

  const resolveDispatcherForAdvance = useCallback((req, detail) => {
    const fromState = (dispatcherName || '').trim();
    if (fromState) return fromState;
    return (detail?.dispatcher || req?.dispatcher || '').trim();
  }, [dispatcherName]);

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
      setInventory([]);
      setShowAddItem(false);
      setAddItemResults([]);
      setDispatcherName('');
      return;
    }
    try {
      const [wRes, invRes] = await Promise.all([
        getWithdrawal(id),
        getInventory({ merge_import_shipments: 1 }),
      ]);
      setExpandedData(wRes.data);
      setExpandedId(id);
      applyManagerNameFromRequest(wRes.data);
      applyDispatcherFromRequest(wRes.data);
      setEditedQty({});
      setInventory(invRes.data || []);
      const savedMode = wRes.data.pick_route_saved
        ? (wRes.data.pick_route_mode || 'nearest')
        : 'nearest';
      setPickRouteTab(savedMode);
    } catch (err) {
      toast.error('Failed to load details');
    }
  };

  const savedPickMode = expandedData?.pick_route_saved
    ? (expandedData.pick_route_mode || 'nearest')
    : 'nearest';
  const pickRouteSortMode = pickRouteTab === 'fifo' ? 'cs_in_date' : 'nearest';
  const pickRouteDirty = pickRouteTab !== savedPickMode;
  const canUndoPickRoute = Boolean(expandedData?.pick_route_saved);

  const useSavedPickLines = !pickRouteDirty && expandedData?.pick_route_saved;

  const displayItems = useMemo(() => {
    if (!expandedData?.items) return [];
    return getManageDisplayItems(expandedData.items, inventory, pickRouteSortMode, editedQty, {
      useSavedLines: useSavedPickLines,
    });
  }, [expandedData, inventory, pickRouteSortMode, useSavedPickLines, editedQty]);

  const baselineQtyByKey = useMemo(() => {
    if (!expandedData?.items) return {};
    const baseline = getManageDisplayItems(expandedData.items, inventory, pickRouteSortMode, {}, {
      useSavedLines: useSavedPickLines,
    });
    const map = {};
    baseline.forEach((line) => {
      map[lineQtyKey(line)] = Number(line.quantity_mc);
    });
    return map;
  }, [expandedData, inventory, pickRouteSortMode, useSavedPickLines]);

  const itemGroups = useMemo(
    () => groupWithdrawItems(displayItems, pickRouteSortMode),
    [displayItems, pickRouteSortMode]
  );

  const hasQtyChanges = useMemo(
    () => Object.entries(editedQty).some(([key, val]) => {
      const baseline = baselineQtyByKey[key];
      return baseline !== undefined && Number(val) !== baseline;
    }),
    [editedQty, baselineQtyByKey]
  );

  const handleSaveQty = async (requestId) => {
    if (!hasQtyChanges) return;
    setSaving(true);
    try {
      const items = displayItems
        .filter((it) => it.id != null && Number.isFinite(Number(it.id)))
        .map((it) => {
          const key = lineQtyKey(it);
          const qty = editedQty[key] !== undefined ? Number(editedQty[key]) : Number(it.quantity_mc);
          return { id: Number(it.id), quantity_mc: qty };
        })
        .filter(({ id, quantity_mc }) => {
          const original = expandedData.items.find((it) => it.id === id);
          return original && quantity_mc !== Number(original.quantity_mc);
        });

      if (items.length === 0) return;
      const lineMessage = formatWithdrawalQtyChangeLineMessage(expandedData, displayItems, editedQty);
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

  const reloadExpanded = async (requestId) => {
    const [wRes, invRes] = await Promise.all([
      getWithdrawal(requestId),
      getInventory({ merge_import_shipments: 1 }),
    ]);
    setExpandedData(wRes.data);
    setInventory(invRes.data || []);
    applyDispatcherFromRequest(wRes.data);
    const savedMode = wRes.data.pick_route_saved
      ? (wRes.data.pick_route_mode || 'nearest')
      : 'nearest';
    setPickRouteTab(savedMode);
    setEditedQty({});
    fetchRequests();
  };

  const handleSearchAddItem = async () => {
    const { fish_name, location, stack_no } = addItemSearch;
    if (!fish_name.trim() && !location.trim() && !stack_no.trim()) {
      toast.error('Enter at least one search criterion');
      return;
    }
    setAddItemLoading(true);
    try {
      const params = { merge_import_shipments: 1 };
      if (fish_name.trim()) params.fish_name = fish_name.trim();
      if (location.trim()) params.location = location.trim();
      const res = await getInventory(params);
      let results = res.data || [];
      if (stack_no.trim()) {
        const sn = stack_no.trim().toLowerCase();
        results = results.filter(r => String(r.stack_no || '').toLowerCase().includes(sn));
      }
      if (location.trim()) {
        const loc = location.trim().toUpperCase();
        results = results.filter(r => String(r.line_place || '').toUpperCase().includes(loc));
      }
      results = results.filter(r => Number(r.hand_on_balance_mc || 0) > 0);
      setAddItemResults(results);
      setAddItemQty({});
      if (results.length === 0) toast.info('No matching stock found');
    } catch {
      toast.error('Failed to search inventory');
    } finally {
      setAddItemLoading(false);
    }
  };

  const addItemRowKey = (r) => r._imp_item_id ? `imp_${r._imp_item_id}` : `${r.lot_id}_${r.location_id}`;

  const handleAddItemToRequest = async (invItem) => {
    const rk = addItemRowKey(invItem);
    const qty = Number(addItemQty[rk] || 0);
    if (qty <= 0) {
      toast.error('Enter a quantity > 0');
      return;
    }
    if (qty > Number(invItem.hand_on_balance_mc || 0)) {
      toast.error(`Maximum available is ${invItem.hand_on_balance_mc} MC`);
      return;
    }
    setAddingItem(rk);
    try {
      await addWithdrawalItem(expandedId, {
        lot_id: invItem.lot_id,
        location_id: invItem.location_id,
        quantity_mc: qty,
      });
      toast.success('Item added to withdrawal');
      await reloadExpanded(expandedId);
      setAddItemResults(prev => prev.filter(r => addItemRowKey(r) !== rk));
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add item');
    } finally {
      setAddingItem(null);
    }
  };

  const applyCurrentPickRoute = async (requestId, mode = pickRouteTab, lines = null) => {
    let payloadLines = lines;
    if (!payloadLines) {
      const [wRes, invRes] = await Promise.all([
        getWithdrawal(requestId),
        getInventory({ merge_import_shipments: 1 }),
      ]);
      const sortMode = mode === 'fifo' ? 'cs_in_date' : 'nearest';
      payloadLines = getManageDisplayItems(wRes.data.items, invRes.data || [], sortMode, {});
    }
    await saveWithdrawalPickRoute(requestId, {
      mode,
      items: linesToPickRoutePayload(payloadLines),
    });
  };

  const handleSavePickRoute = async (requestId) => {
    if (!pickRouteDirty && expandedData?.pick_route_saved) {
      toast.info('Pick route is already saved for this tab');
      return;
    }
    if (!window.confirm(
      pickRouteTab === 'fifo'
        ? 'Save FIFO pick route? Item locations will be replaced with oldest stock from Stock Summary (same request totals).'
        : 'Save nearest-line pick route? Item locations will match the original nearest allocation.'
    )) return;
    setSavingPickRoute(true);
    try {
      const payload = linesToPickRoutePayload(displayItems);
      await saveWithdrawalPickRoute(requestId, {
        mode: pickRouteTab,
        items: payload,
      });
      toast.success(pickRouteTab === 'fifo' ? 'FIFO pick route saved' : 'Nearest pick route saved');
      await reloadExpanded(requestId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save pick route');
    } finally {
      setSavingPickRoute(false);
    }
  };

  const handleUndoPickRoute = async (requestId) => {
    if (!canUndoPickRoute) return;
    if (!window.confirm('Undo saved pick route and restore the previous allocation?')) return;
    setSavingPickRoute(true);
    try {
      await undoWithdrawalPickRoute(requestId);
      toast.success('Pick route undone');
      await reloadExpanded(requestId);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to undo pick route');
    } finally {
      setSavingPickRoute(false);
    }
  };

  const handleAdvanceStatus = async (req) => {
    const config = STATUS_CONFIG[req.status];
    if (!config?.next) return;

    const name = resolveManagerNameForAdvance(req, expandedData);
    if (!name) {
      toast.error('Please enter your name (Manager / Preparer) on Receive Request before proceeding');
      return;
    }

    if (req.status === 'READY') {
      const dispatcher = resolveDispatcherForAdvance(req, expandedData);
      if (!dispatcher) {
        toast.error('Please enter Dispatcher name before finishing');
        return;
      }
    }

    const confirmMsg = config.next === 'FINISHED'
      ? `This will perform Stock OUT for all items. Continue?`
      : `Advance to "${STATUS_CONFIG[config.next].label}"?`;

    if (!window.confirm(confirmMsg)) return;

    setProcessing(req.id);
    try {
      if (req.status === 'PENDING' && config.next === 'TAKING_OUT') {
        const routeLines = getManageDisplayItems(
          expandedData.items,
          inventory,
          pickRouteSortMode,
          editedQty
        );
        if (hasQtyChanges) {
          await handleSaveQty(req.id);
        }
        await applyCurrentPickRoute(req.id, pickRouteTab, routeLines);
      }

      persistManagerName(name);
      const payload = { status: config.next, managed_by: name };
      if (req.status === 'READY') {
        payload.dispatcher = resolveDispatcherForAdvance(req, expandedData);
      }
      await updateWithdrawalStatus(req.id, payload);
      toast.success(`Status updated to ${STATUS_CONFIG[config.next].label}`);
      fetchRequests();
      if (expandedId === req.id) {
        const res = await getWithdrawal(req.id);
        setExpandedData(res.data);
        applyManagerNameFromRequest(res.data);
        applyDispatcherFromRequest(res.data);
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

  const handlePermanentlyDelete = async (req) => {
    if (!isSuperadmin) return;
    const msg =
      `Permanently delete ${req.request_no}?\n\n` +
      'This removes the request from the Withdraw page and Manage, and deletes all linked stock OUT / import stock records for this request. ' +
      'It cannot be undone.';
    if (!window.confirm(msg)) return;
    setProcessing(req.id);
    try {
      await permanentlyDeleteWithdrawal(req.id);
      toast.success('Withdrawal fully removed from all sections');
      setExpandedId(null);
      setExpandedData(null);
      setEditedQty({});
      fetchRequests();
    } catch (err) {
      const code = err.response?.status;
      if (code === 401 || code === 403) {
        toast.error('Only the superadmin can delete requested data from here');
      } else {
        toast.error(err.response?.data?.error || 'Failed to delete request');
      }
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
                        <div className="mg-pick-route-bar">
                          <h5>Items</h5>
                          <div className="mg-pick-route-controls">
                            <div className="wr-sort-switch" role="tablist" aria-label="Pick route">
                              <button
                                type="button"
                                role="tab"
                                aria-selected={pickRouteTab === 'nearest'}
                                className={`wr-sort-switch-option ${pickRouteTab === 'nearest' ? 'active' : ''}`}
                                onClick={() => setPickRouteTab('nearest')}
                              >
                                <FiMapPin aria-hidden />
                                <span>Nearest line</span>
                              </button>
                              <button
                                type="button"
                                role="tab"
                                aria-selected={pickRouteTab === 'fifo'}
                                className={`wr-sort-switch-option ${pickRouteTab === 'fifo' ? 'active' : ''}`}
                                onClick={() => setPickRouteTab('fifo')}
                              >
                                <FiCalendar aria-hidden />
                                <span>Oldest lot (FIFO)</span>
                              </button>
                            </div>
                            {req.status === 'PENDING' && (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  disabled={savingPickRoute || (!pickRouteDirty && expandedData.pick_route_saved)}
                                  onClick={() => handleSavePickRoute(req.id)}
                                >
                                  <FiSave /> {savingPickRoute ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-outline btn-sm"
                                  disabled={savingPickRoute || !canUndoPickRoute}
                                  onClick={() => handleUndoPickRoute(req.id)}
                                >
                                  <FiRotateCcw /> Undo
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                        {pickRouteDirty && req.status === 'PENDING' && (
                          <p className="mg-pick-route-hint">
                            Preview — click Save to apply early, or choose a tab and click <strong>Start Taking Out</strong> to apply{' '}
                            {pickRouteTab === 'fifo' ? 'FIFO (oldest stock from Stock Summary)' : 'nearest line'} using your edited carton amounts.
                            {expandedData.pick_route_saved ? ' Undo restores the allocation before the first save.' : ''}
                          </p>
                        )}
                        {expandedData.pick_route_saved && !pickRouteDirty && (
                          <p className="mg-pick-route-saved">
                            Saved pick route: <strong>{savedPickMode === 'fifo' ? 'Oldest lot (FIFO)' : 'Nearest line'}</strong>
                            {' '}— stock will be deducted from these locations when finished.
                          </p>
                        )}
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
                            {(() => {
                              let rowNum = 0;
                              const isEditable = req.status === 'PENDING' || req.status === 'TAKING_OUT';
                              return itemGroups.flatMap((group) => {
                                const multiLine = group.lines.length > 1;
                                const groupActualTotal = group.lines.reduce(
                                  (s, item) => s + currentItemQty(item, editedQty),
                                  0
                                );
                                const groupWeightKg = group.lines.reduce(
                                  (s, item) => s + currentItemQty(item, editedQty) * Number(item.bulk_weight_kg),
                                  0
                                );
                                const groupHasLowStock = isEditable && group.lines.some((item) => {
                                  const balance = Number(item.hand_on_balance || 0);
                                  const requestedMc = Number(item.requested_mc || item.quantity_mc);
                                  return balance < requestedMc && editedQty[lineQtyKey(item)] === undefined;
                                });
                                const groupActualDiffers = groupActualTotal !== group.totalReqMc;

                                const rows = [];
                                if (multiLine) {
                                  rows.push(
                                    <tr key={`${group.key}-header`} className="mg-group-row">
                                      <td className="mg-group-num">—</td>
                                      <td>
                                        <strong>{withdrawFishNameLabel(group)}</strong>
                                        <span className="mg-group-badge">{group.lines.length} loc</span>
                                      </td>
                                      <td>{group.size}</td>
                                      <td colSpan={2} className="mg-group-loc-summary">
                                        {group.lines.length} locations
                                      </td>
                                      <td className="num-cell">—</td>
                                      <td className="num-cell">
                                        <span className="mg-requested-val">{group.totalReqMc}</span>
                                      </td>
                                      <td className="num-cell">
                                        <strong className={groupActualDiffers ? 'mg-actual-changed' : ''}>
                                          {groupActualTotal}
                                        </strong>
                                      </td>
                                      <td className="num-cell">{groupWeightKg.toFixed(0)}</td>
                                      <td>
                                        {groupHasLowStock ? (
                                          <span className="mg-stock-warn">Low Stock</span>
                                        ) : (
                                          <span className="mg-stock-ok">
                                            <FiCheck size={12} /> OK
                                          </span>
                                        )}
                                      </td>
                                    </tr>
                                  );
                                }

                                group.lines.forEach((item) => {
                                  rowNum += 1;
                                  if (multiLine) {
                                    rows.push(
                                      <tr
                                        key={item.id}
                                        className={`mg-group-detail-row ${isEditable && Number(item.hand_on_balance || 0) < Number(item.requested_mc || item.quantity_mc) ? 'mg-row-warn' : ''}`}
                                      >
                                        <td>{rowNum}</td>
                                        <td colSpan={2} className="mg-group-detail-spacer" aria-hidden="true" />
                                        <td>{item.line_place}</td>
                                        <td className="mg-lot-cell">{item.lot_no || item.order_code || '—'}</td>
                                        <td className="num-cell">
                                          <span className={`mg-balance-badge ${
                                            Number(item.hand_on_balance || 0) <= 0 ? 'empty'
                                              : Number(item.hand_on_balance || 0) < Number(item.requested_mc || item.quantity_mc) ? 'low' : 'ok'
                                          }`}>
                                            {Number(item.hand_on_balance || 0)}
                                          </span>
                                        </td>
                                        <td className="num-cell">
                                          <span className="mg-requested-val">{Number(item.requested_mc || item.quantity_mc)}</span>
                                        </td>
                                        <td className="num-cell">
                                          {isEditable ? (
                                            <div className="mg-qty-edit">
                                              <input
                                                type="number"
                                                className={`mg-qty-input ${
                                                  editedQty[lineQtyKey(item)] !== undefined && editedQty[lineQtyKey(item)] !== item.quantity_mc ? 'edited' : ''
                                                } ${
                                                  Number(item.hand_on_balance || 0) < Number(item.requested_mc || item.quantity_mc) && editedQty[lineQtyKey(item)] === undefined ? 'warn' : ''
                                                }`}
                                                min={0}
                                                max={Number(item.hand_on_balance || 0)}
                                                value={currentItemQty(item, editedQty)}
                                                onChange={(e) => {
                                                  const balance = Number(item.hand_on_balance || 0);
                                                  const val = Math.max(0, Math.min(balance, Number(e.target.value) || 0));
                                                  setEditedQty((prev) => ({ ...prev, [lineQtyKey(item)]: val }));
                                                }}
                                              />
                                              {Number(item.hand_on_balance || 0) < Number(item.requested_mc || item.quantity_mc) && editedQty[lineQtyKey(item)] === undefined && (
                                                <button
                                                  type="button"
                                                  className="mg-qty-fix-btn"
                                                  title="Set to max available balance"
                                                  onClick={() => setEditedQty((prev) => ({
                                                    ...prev,
                                                    [lineQtyKey(item)]: Math.min(
                                                      Number(item.hand_on_balance || 0),
                                                      Number(item.requested_mc || item.quantity_mc)
                                                    ),
                                                  }))}
                                                >
                                                  Fix
                                                </button>
                                              )}
                                            </div>
                                          ) : (
                                            <span className={currentItemQty(item, editedQty) !== Number(item.requested_mc || item.quantity_mc) ? 'mg-actual-changed' : ''}>
                                              <strong>{item.quantity_mc}</strong>
                                            </span>
                                          )}
                                        </td>
                                        <td className="num-cell">
                                          {(currentItemQty(item, editedQty) * Number(item.bulk_weight_kg)).toFixed(0)}
                                        </td>
                                        <td>
                                          {isEditable && Number(item.hand_on_balance || 0) < Number(item.requested_mc || item.quantity_mc) && editedQty[lineQtyKey(item)] === undefined ? (
                                            <span className="mg-stock-warn">Low Stock</span>
                                          ) : (
                                            <span className="mg-stock-ok"><FiCheck size={12} /> OK</span>
                                          )}
                                        </td>
                                      </tr>
                                    );
                                  } else {
                                    rows.push(
                                      <ManageWithdrawItemRow
                                        key={item.id}
                                        item={item}
                                        rowNum={rowNum}
                                        isEditable={isEditable}
                                        editedQty={editedQty}
                                        setEditedQty={setEditedQty}
                                      />
                                    );
                                  }
                                });
                                return rows;
                              });
                            })()}
                          </tbody>
                        </table>
                        {expandedData.notes && (
                          <div className="mg-notes">
                            <strong>Notes:</strong> {expandedData.notes}
                          </div>
                        )}
                      </div>

                      {/* Superadmin: Add item during TAKING_OUT */}
                      {isSuperadmin && req.status === 'TAKING_OUT' && (
                        <div className="mg-add-item-section">
                          <button
                            type="button"
                            className="btn btn-outline btn-sm mg-add-item-toggle"
                            onClick={() => { setShowAddItem(v => !v); setAddItemResults([]); setAddItemSearch({ fish_name: '', location: '', stack_no: '' }); setAddItemQty({}); }}
                          >
                            <FiPlus /> {showAddItem ? 'Close Add Item' : 'Add Item (Superadmin)'}
                          </button>
                          {showAddItem && (
                            <div className="mg-add-item-panel">
                              <div className="mg-add-item-filters">
                                <div className="mg-add-item-field">
                                  <label>Fish Name</label>
                                  <input
                                    type="text"
                                    className="form-control"
                                    placeholder="Search fish name..."
                                    value={addItemSearch.fish_name}
                                    onChange={e => setAddItemSearch(s => ({ ...s, fish_name: e.target.value }))}
                                    onKeyDown={e => e.key === 'Enter' && handleSearchAddItem()}
                                  />
                                </div>
                                <div className="mg-add-item-field">
                                  <label>Location</label>
                                  <input
                                    type="text"
                                    className="form-control"
                                    placeholder="e.g. H01R-1"
                                    value={addItemSearch.location}
                                    onChange={e => setAddItemSearch(s => ({ ...s, location: e.target.value }))}
                                    onKeyDown={e => e.key === 'Enter' && handleSearchAddItem()}
                                  />
                                </div>
                                <div className="mg-add-item-field">
                                  <label>Stack No</label>
                                  <input
                                    type="text"
                                    className="form-control"
                                    placeholder="e.g. 111"
                                    value={addItemSearch.stack_no}
                                    onChange={e => setAddItemSearch(s => ({ ...s, stack_no: e.target.value }))}
                                    onKeyDown={e => e.key === 'Enter' && handleSearchAddItem()}
                                  />
                                </div>
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={handleSearchAddItem}
                                  disabled={addItemLoading}
                                >
                                  <FiSearch /> {addItemLoading ? 'Searching...' : 'Search'}
                                </button>
                              </div>
                              {addItemResults.length > 0 && (
                                <table className="table mg-add-item-table">
                                  <thead>
                                    <tr>
                                      <th>Fish Name</th>
                                      <th>Size</th>
                                      <th>Location</th>
                                      <th>Stack No</th>
                                      <th>Lot</th>
                                      <th>Balance (MC)</th>
                                      <th>Qty (MC)</th>
                                      <th>Action</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {addItemResults.map(r => {
                                      const rk = addItemRowKey(r);
                                      return (
                                        <tr key={rk}>
                                          <td><strong>{r.fish_name}</strong></td>
                                          <td>{r.size}</td>
                                          <td>{r.line_place}</td>
                                          <td>{r.stack_no || '—'}</td>
                                          <td>{r.lot_no || '—'}</td>
                                          <td className="num-cell">{r.hand_on_balance_mc}</td>
                                          <td className="num-cell" style={{ width: 100 }}>
                                            <input
                                              type="number"
                                              className="mg-qty-input"
                                              min={1}
                                              max={Number(r.hand_on_balance_mc || 0)}
                                              value={addItemQty[rk] || ''}
                                              onChange={e => setAddItemQty(prev => ({ ...prev, [rk]: e.target.value }))}
                                            />
                                          </td>
                                          <td>
                                            <button
                                              type="button"
                                              className="btn btn-success btn-sm"
                                              disabled={addingItem === rk}
                                              onClick={() => handleAddItemToRequest(r)}
                                            >
                                              {addingItem === rk ? 'Adding...' : <><FiPlus /> Add</>}
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {canAdvance && (() => {
                        const displayName = resolveManagerNameForAdvance(req, expandedData);
                        const nameLocked = req.status !== 'PENDING' && Boolean(displayName);
                        return (
                          <>
                            <div className="mg-manager-field mg-card-manager-field">
                              <label>Manager / Preparer Name</label>
                              {nameLocked ? (
                                <>
                                  <div className="mg-manager-readonly" title="Set at Receive Request">
                                    {displayName}
                                  </div>
                                  <p className="mg-manager-hint">
                                    Shown as <strong>Approver</strong> on print form
                                    {req.status === 'PENDING' ? (
                                      <> — used for <strong>{config.nextLabel}</strong></>
                                    ) : null}
                                  </p>
                                </>
                              ) : (
                                <>
                                  <input
                                    type="text"
                                    className="form-control"
                                    placeholder="Enter your name once — saved for later steps"
                                    value={managerName}
                                    onChange={handleManagerNameChange}
                                    onBlur={handleManagerNameBlur}
                                    autoComplete="name"
                                  />
                                  {managerNameSaved && managerName.trim() && (
                                    <p className="mg-manager-hint">
                                      Saved — shown as <strong>Approver</strong> on print form
                                    </p>
                                  )}
                                </>
                              )}
                            </div>
                            {req.status === 'READY' && (
                              <div className="mg-manager-field mg-card-manager-field mg-dispatcher-field">
                                <label>Dispatcher Name</label>
                                <input
                                  type="text"
                                  className="form-control"
                                  placeholder="Enter dispatcher name for print form"
                                  value={dispatcherName}
                                  onChange={(e) => setDispatcherName(e.target.value)}
                                  autoComplete="name"
                                />
                                <p className="mg-manager-hint">
                                  Required before <strong>{config.nextLabel}</strong> — shown as <strong>Dispatcher</strong> on print form
                                </p>
                              </div>
                            )}
                          </>
                        );
                      })()}

                      {/* Action buttons */}
                      <div className="mg-actions">
                        <button
                          className="btn btn-outline"
                          onClick={() => navigate(`/withdraw/${req.id}/form`)}
                        >
                          <FiPrinter /> Print Form
                        </button>
                        {(req.status === 'PENDING' || req.status === 'TAKING_OUT') && hasQtyChanges && (
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
                        {isSuperadmin && (
                          <button
                            type="button"
                            className="btn btn-danger"
                            style={{ borderStyle: 'dashed' }}
                            onClick={() => handlePermanentlyDelete(req)}
                            disabled={isProcessing}
                            title="Remove this request and all linked stock records (superadmin only)"
                          >
                            <FiTrash2 /> Delete from all (superadmin)
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
