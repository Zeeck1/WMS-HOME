import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FiSearch, FiPackage, FiBox, FiAnchor, FiPlus, FiTrash2, FiRotateCcw, FiCopy, FiSave, FiAlertTriangle, FiX, FiCheck } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getInventory, manualUpdateCell, manualDeleteRow, manualAddRow } from '../services/api';
import { parseLocationCode } from '../config/warehouseConfig';
import ColumnFilterDropdown from '../components/ColumnFilterDropdown';

const normLotNoNumeric = (v) => String(v ?? '').replace(/\D/g, '');

// ─── Column Definitions ────────────────────────────────────────────────
const BULK_COLS = [
  { key: 'fish_name', field: 'fish_name', label: 'Fish Name', editable: true, type: 'text', w: 140 },
  { key: 'size', field: 'size', label: 'Size', editable: true, type: 'text', w: 90 },
  { key: 'bulk_weight_kg', field: 'bulk_weight_kg', label: 'Bulk Wt (KG)', editable: true, type: 'number', w: 95 },
  { key: 'type', field: 'type', label: 'Type', editable: true, type: 'text', w: 70 },
  { key: 'glazing', field: 'glazing', label: 'Glazing', editable: true, type: 'text', w: 70 },
  { key: 'cs_in_date', field: 'cs_in_date', label: 'CS In Date', editable: true, type: 'date', w: 120 },
  { key: 'sticker', field: 'sticker', label: 'Sticker', editable: true, type: 'text', w: 80 },
  { key: 'lot_no_numeric', field: 'lot_no_numeric', label: 'Lot No', editable: true, type: 'text', w: 85 },
  { key: 'line_place', field: 'line_place', label: 'Lines / Place', editable: true, type: 'text', w: 100 },
  { key: 'stack_no', field: 'stack_no', label: 'Stack No', editable: true, type: 'number', w: 70 },
  { key: 'stack_total', field: 'stack_total', label: 'Stack Total', editable: true, type: 'number', w: 80 },
  { key: 'old_balance_mc', label: 'Old Bal', editable: false, w: 65, headerStyle: { background: '#2d4a1e', color: '#d4edda' } },
  { key: 'new_income_mc', label: 'New Inc', editable: false, w: 65, headerStyle: { background: '#1a3a5c', color: '#cce5ff' } },
  { key: 'hand_on_balance_mc', field: 'hand_on_balance_mc', label: 'Hand On Bal', editable: true, type: 'number', w: 90, headerStyle: { background: '#5c1a1a', color: '#f8d7da' } },
  { key: '_kg_total', label: 'KG', editable: false, formula: true, w: 80 },
];

const nonBulkCols = (isImport) => [
  { key: 'order_code', field: 'order_code', label: isImport ? 'Invoice No' : 'Order', editable: true, type: 'text', w: 130 },
  ...(!isImport ? [{ key: 'lot_no_numeric', field: 'lot_no_numeric', label: 'Lot No', editable: true, type: 'text', w: 85 }] : []),
  { key: 'fish_name', field: 'fish_name', label: 'Fish Name', editable: true, type: 'text', w: 140 },
  { key: 'size', field: 'size', label: 'Size', editable: true, type: 'text', w: 90 },
  { key: 'bulk_weight_kg', field: 'bulk_weight_kg', label: 'KG', editable: true, type: 'number', w: 70 },
  ...(isImport
    ? [
        { key: 'cs_in_date', field: 'cs_in_date', label: 'Arrival Date', editable: true, type: 'date', w: 130 },
      ]
    : [
        { key: 'production_date', field: 'production_date', label: 'Production Date', editable: true, type: 'month_year', w: 130 },
        { key: 'expiration_date', field: 'expiration_date', label: 'Expiration Date', editable: true, type: 'month_year', w: 130 },
        { key: 'st_no', field: 'st_no', label: 'ST NO', editable: true, type: 'text', w: 90 },
      ]),
  { key: '_kg_total', label: 'Total KG', editable: false, formula: true, w: 80 },
  { key: 'hand_on_balance_mc', field: 'hand_on_balance_mc', label: 'Balance MC', editable: true, type: 'number', w: 90, headerStyle: { background: '#5c1a1a', color: '#f8d7da' } },
  { key: 'line_place', field: 'line_place', label: 'Line', editable: true, type: 'text', w: 100 },
  { key: 'stack_no', field: 'stack_no', label: 'Stack No', editable: true, type: 'number', w: 70 },
  { key: 'remark', field: 'remark', label: 'Remark', editable: true, type: 'text', w: 120 },
];

const TABS = [
  { id: 'BULK', label: 'Bulk', icon: <FiPackage /> },
  { id: 'CONTAINER_EXTRA', label: 'Container Extra', icon: <FiBox /> },
  { id: 'IMPORT', label: 'Import', icon: <FiAnchor /> },
];

const LINE_OPTIONS = [
  { value: '', label: 'All (L & R)' },
  { value: 'L', label: 'L (Left)' },
  { value: 'R', label: 'R (Right)' },
];

const rk = (r) => `${r.lot_id}-${r.location_id}`;
const MANUAL_FETCH_LIMIT = 2000;

/** Ensures each tab only shows rows for that stock type (API must match; this guards stale UI or bad responses). */
function filterInventoryRowsByTab(rows, tab) {
  const t = String(tab || '').toUpperCase();
  return (rows || []).filter((r) => String(r.stock_type || '').toUpperCase() === t);
}
const ROW_WINDOW_SIZE = 150;
const toDateOnly = (d) => {
  if (d == null || d === '') return '';
  if (typeof d === 'string') return d.split('T')[0];
  try { return new Date(d).toISOString().split('T')[0]; } catch { return ''; }
};

// For month/year inputs like "12/2024" stored as "YYYY-MM-01" in DB
// Display rules:
// - if only month/year (DB day is "01") => MM/YYYY
// - if day exists => DD/MM/YYYY
const toMonthYearDisplay = (d) => {
  if (d == null || d === '') return '';
  const s = String(d).trim();
  // Already "MM/YYYY"
  const mmY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (mmY) {
    const mm = mmY[1].padStart(2, '0');
    return `${mm}/${mmY[2]}`;
  }
  // "YYYY-MM-DD"
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2];
    const dd = iso[3];
    if (dd === '01') return `${mm}/${yyyy}`;
    return `${dd}/${mm}/${yyyy}`;
  }
  return s;
};

const parseMonthYearInput = (raw) => {
  if (raw == null) return '';
  const s = String(raw).trim();
  if (!s) return '';
  // "MM/YYYY" (or "M/YYYY")
  const mmY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (mmY) {
    const mm = mmY[1].padStart(2, '0');
    const yyyy = mmY[2];
    return `${yyyy}-${mm}-01`;
  }
  // "DD/MM/YYYY" (or "D/M/YYYY")
  const ddmmyyyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const dd = ddmmyyyy[1].padStart(2, '0');
    const mm = ddmmyyyy[2].padStart(2, '0');
    const yyyy = ddmmyyyy[3];
    return `${yyyy}-${mm}-${dd}`;
  }
  // Allow already ISO dates
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return s;
};

const getCellDisplay = (row, col) => {
  if (col.formula) return (Number(row.bulk_weight_kg) || 0) * (Number(row.hand_on_balance_mc) || 0);
  const v = row[col.key];
  if (col.type === 'date') return toDateOnly(v);
  if (col.type === 'month_year') return toMonthYearDisplay(v);
  if (col.field === 'lot_no_numeric') return normLotNoNumeric(v);
  return v ?? '';
};

/** Display string per cell for column filters (matches visible formatting where relevant). */
function manualCellFilterValue(row, col) {
  if (!col?.key || col.formula) return null;
  const v = row[col.key];
  if (col.type === 'date') {
    const d = toDateOnly(v);
    return d || null;
  }
  if (col.type === 'month_year') {
    const d = toMonthYearDisplay(v);
    return d || null;
  }
  if (col.field === 'lot_no_numeric') {
    const n = normLotNoNumeric(v);
    return n || null;
  }
  if (v == null || v === '') return null;
  return String(v);
}

const todayISO = () => new Date().toISOString().split('T')[0];

function buildEmptyDraft(activeTab) {
  const t = todayISO();
  if (activeTab === 'BULK') {
    return {
      fish_name: '', size: '', bulk_weight_kg: '0', type: '', glazing: '',
      cs_in_date: t, sticker: '', lot_no_numeric: '', line_place: '', stack_no: '1', stack_total: '1',
      hand_on_balance_mc: '1', remark: '',
    };
  }
  if (activeTab === 'CONTAINER_EXTRA') {
    return {
      order_code: '', lot_no_numeric: '', fish_name: '', size: '', bulk_weight_kg: '0',
      production_date: '', expiration_date: '', st_no: '', cs_in_date: t, remark: '',
      hand_on_balance_mc: '1', line_place: '', stack_no: '1',
    };
  }
  return {
    order_code: '', fish_name: '', size: '', bulk_weight_kg: '0', cs_in_date: t, remark: '',
    hand_on_balance_mc: '1', line_place: '', stack_no: '1',
  };
}

function buildInitialFromDraft(activeTab, d) {
  const line = (d.line_place || '').toUpperCase().trim();
  const t = todayISO();
  if (activeTab === 'IMPORT') {
    return {
      fish_name: d.fish_name?.trim() || '(new)',
      size: d.size?.trim() || '-',
      bulk_weight_kg: parseFloat(d.bulk_weight_kg) || 0,
      type: null,
      glazing: null,
      order_code: d.order_code?.trim() || null,
      production_date: toDateOnly(d.cs_in_date) || t,
      expiration_date: null,
      st_no: null,
      cs_in_date: toDateOnly(d.cs_in_date) || t,
      sticker: null,
      remark: d.remark?.trim() || null,
      hand_on_balance_mc: parseInt(d.hand_on_balance_mc, 10) || 1,
      line_place: line || undefined,
      stack_no: parseInt(d.stack_no, 10) || 1,
      stack_total: 1,
    };
  }
  if (activeTab === 'CONTAINER_EXTRA') {
    const cs = toDateOnly(d.cs_in_date) || t;
    return {
      fish_name: d.fish_name?.trim() || '(new)',
      size: d.size?.trim() || '-',
      bulk_weight_kg: parseFloat(d.bulk_weight_kg) || 0,
      type: null,
      glazing: null,
      order_code: d.order_code?.trim() || null,
      production_date: toDateOnly(d.production_date) || cs,
      expiration_date: toDateOnly(d.expiration_date) || null,
      st_no: d.st_no?.trim() || null,
      cs_in_date: cs,
      sticker: null,
      remark: d.remark?.trim() || null,
      lot_no_numeric: d.lot_no_numeric || null,
      hand_on_balance_mc: parseInt(d.hand_on_balance_mc, 10) || 1,
      line_place: line || undefined,
      stack_no: parseInt(d.stack_no, 10) || 1,
      stack_total: 1,
    };
  }
  return {
    fish_name: d.fish_name?.trim() || '(new)',
    size: d.size?.trim() || '-',
    bulk_weight_kg: parseFloat(d.bulk_weight_kg) || 0,
    type: d.type?.trim() || null,
    glazing: d.glazing?.trim() || null,
    order_code: null,
    cs_in_date: toDateOnly(d.cs_in_date) || t,
    sticker: d.sticker?.trim() || null,
    remark: d.remark?.trim() || null,
    st_no: null,
    lot_no_numeric: d.lot_no_numeric || null,
    hand_on_balance_mc: parseInt(d.hand_on_balance_mc, 10) || 1,
    line_place: line || undefined,
    stack_no: parseInt(d.stack_no, 10) || 1,
    stack_total: parseInt(d.stack_total, 10) || 1,
  };
}

// ─── Component ─────────────────────────────────────────────────────────
function Manual() {
  const [activeTab, setActiveTab] = useState('BULK');
  const [rows, setRows] = useState([]);
  const [originalRows, setOriginalRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState({ fish_name: '', line: '', line_detail: '', stack_no: '' });
  const [searchQuery, setSearchQuery] = useState('');
  const [columnFilters, setColumnFilters] = useState({});
  /** Staging row at top — fill in, then confirm to create in DB (sorted by Line / Place). */
  const [draftRow, setDraftRow] = useState(null);
  const [draftSaving, setDraftSaving] = useState(false);

  const [selectedCell, setSelectedCell] = useState(null);
  const [undoStack, setUndoStack] = useState([]);
  const [copiedRow, setCopiedRow] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const [pendingEditsMap, setPendingEditsMap] = useState({});
  const [windowStart, setWindowStart] = useState(0);

  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  const tableRef = useRef(null);
  const dragRef = useRef(null);
  const windowStartRef = useRef(0);
  useEffect(() => { windowStartRef.current = windowStart; }, [windowStart]);
  const draftRowRef = useRef(null);
  useEffect(() => { draftRowRef.current = draftRow; }, [draftRow]);

  const isNonBulk = activeTab !== 'BULK';
  const isImport = activeTab === 'IMPORT';
  const columns = useMemo(() => (isNonBulk ? nonBulkCols(isImport) : BULK_COLS), [isNonBulk, isImport]);
  const columnsRef = useRef(columns);
  useEffect(() => { columnsRef.current = columns; }, [columns]);

  const pendingEdits = pendingEditsMap;
  const isDirty = Object.keys(pendingEditsMap).length > 0;

  // ─── Navigation Blocker ──────────────────────────────────────────────
  const dirtyRef = useRef(false);
  useEffect(() => { dirtyRef.current = isDirty; }, [isDirty]);

  useEffect(() => {
    if (!isDirty) return;
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const onClick = (e) => {
      if (!dirtyRef.current) return;
      const anchor = e.target.closest('a[href]');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      if (!href || href.startsWith('http') || href.startsWith('mailto')) return;
      if (!window.confirm('You have unsaved changes. Leave without saving?')) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);

  // ─── Data Loading ────────────────────────────────────────────────────
  const loadData = useCallback(async (params = {}) => {
    setLoading(true);
    setPendingEditsMap({});
    setWindowStart(0);
    try {
      const res = await getInventory({
        ...params,
        limit: MANUAL_FETCH_LIMIT,
        stock_type: activeTab,
      });
      const list = filterInventoryRowsByTab(res.data, activeTab);
      setRows(list);
      setOriginalRows(list.map(r => ({ ...r })));
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  }, [activeTab]);

  useEffect(() => {
    setRows([]);
    setOriginalRows([]);
    setFilters(f => ({ ...f, fish_name: '', line_detail: '' }));
    setSearchQuery('');
    setColumnFilters({});
    setDraftRow(null);
    setUndoStack([]);
    setCopiedRow(null);
    setSelectedCell(null);
    setPendingEditsMap({});
    loadData();
  }, [activeTab, loadData]);

  const handleSearch = (e) => {
    e.preventDefault();
    const p = { limit: MANUAL_FETCH_LIMIT };
    if (filters.fish_name.trim()) p.fish_name = filters.fish_name.trim();
    if (filters.line_detail.trim()) p.location = filters.line_detail.trim();
    setWindowStart(0);
    loadData(p);
  };

  // ─── Client-side filters (L/R, stack) then Stock Summary–style search + column filters ─
  const afterSidebar = useMemo(() => {
    let list = rows;
    if (filters.line) {
      list = list.filter(r => {
        const p = parseLocationCode(r.line_place);
        return p && p.side === filters.line;
      });
    }
    if (filters.stack_no) {
      const sn = filters.stack_no.trim();
      if (sn) list = list.filter(r => String(r.stack_no || '').includes(sn));
    }
    return list;
  }, [rows, filters.line, filters.stack_no]);

  const filterableColumns = useMemo(
    () => columns.filter(c => c.key && !c.formula),
    [columns]
  );

  const rowsAfterSearch = useMemo(() => {
    let list = afterSidebar;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(row =>
        filterableColumns.some((col) => {
          const s = manualCellFilterValue(row, col);
          const str = s != null && s !== '' ? String(s) : '';
          return str.toLowerCase().includes(q);
        })
      );
    }
    return list;
  }, [afterSidebar, filterableColumns, searchQuery]);

  /** Column filters only; skip `excludeColumnKey` so its dropdown lists values allowed by other filters (cascading). */
  const rowMatchesColumnFiltersExcept = useCallback((row, excludeColumnKey) =>
    filterableColumns.every((col) => {
      if (col.key === excludeColumnKey) return true;
      const selected = columnFilters[col.key];
      if (!selected) return true;
      const s = manualCellFilterValue(row, col);
      const str = s != null && s !== '' ? String(s) : '(Blank)';
      return selected.has(str);
    }),
  [filterableColumns, columnFilters]);

  const filteredRows = useMemo(
    () => rowsAfterSearch.filter(row => rowMatchesColumnFiltersExcept(row, null)),
    [rowsAfterSearch, rowMatchesColumnFiltersExcept]
  );

  const allColumnValues = useMemo(() => {
    const map = {};
    filterableColumns.forEach((col) => {
      const subset = rowsAfterSearch.filter(row => rowMatchesColumnFiltersExcept(row, col.key));
      map[col.key] = subset.map(r => manualCellFilterValue(r, col));
    });
    return map;
  }, [filterableColumns, rowsAfterSearch, rowMatchesColumnFiltersExcept]);

  const applyColumnFilter = (key, selected) => {
    const allVals = new Set((allColumnValues[key] || []).map(v => v != null ? v : '(Blank)'));
    if (selected.size === allVals.size) {
      setColumnFilters(prev => { const next = { ...prev }; delete next[key]; return next; });
    } else {
      setColumnFilters(prev => ({ ...prev, [key]: selected }));
    }
  };

  const clearColumnFilter = (key) => {
    setColumnFilters(prev => { const next = { ...prev }; delete next[key]; return next; });
  };

  const handleClearAllFilters = () => {
    setColumnFilters({});
    setSearchQuery('');
  };

  const activeFilterCount = Object.keys(columnFilters).length;

  useEffect(() => {
    setWindowStart(0);
  }, [searchQuery, columnFilters, afterSidebar.length]);

  const useWindow = filteredRows.length > ROW_WINDOW_SIZE;
  const displayRows = useMemo(() => {
    if (!useWindow) return filteredRows;
    return filteredRows.slice(windowStart, windowStart + ROW_WINDOW_SIZE);
  }, [filteredRows, useWindow, windowStart]);
  const totalWindowPages = useWindow ? Math.ceil(filteredRows.length / ROW_WINDOW_SIZE) : 1;
  const currentWindowPage = useWindow ? Math.floor(windowStart / ROW_WINDOW_SIZE) + 1 : 1;

  useEffect(() => {
    if (windowStart >= filteredRows.length && filteredRows.length > 0) setWindowStart(0);
  }, [filteredRows.length, windowStart]);

  // ─── Cell Editing (local only — saved via Save button) ───────────────
  const handleCellChange = (rowIdx, col, newVal) => {
    const row = rows[rowIdx];
    if (!row) return;
    const rowKey = rk(row);
    const orig = originalRows.find(o => rk(o) === rowKey);
    const origVal = orig
      ? (col.type === 'date'
          ? toDateOnly(orig[col.key])
          : col.type === 'month_year'
            ? parseMonthYearInput(orig[col.key])
            : col.field === 'lot_no_numeric'
              ? normLotNoNumeric(orig[col.key])
              : String(orig[col.key] ?? ''))
      : '';
    const normNew = col.type === 'date'
      ? toDateOnly(newVal)
      : col.type === 'month_year'
        ? parseMonthYearInput(newVal)
        : col.field === 'lot_no_numeric'
          ? normLotNoNumeric(newVal)
          : String(newVal ?? '');
    const editKey = `${rowKey}-${col.field}`;
    setRows(prev => prev.map((r, i) => i !== rowIdx ? r : { ...r, [col.key]: normNew }));
    setPendingEditsMap(prev => {
      const next = { ...prev };
      if (normNew === origVal) delete next[editKey];
      else next[editKey] = { lot_id: row.lot_id, location_id: row.location_id, field: col.field, value: normNew };
      return next;
    });
    setUndoStack(prev => [...prev, { type: 'edit', rowKey, colKey: col.key, oldValue: row[col.key], newValue: newVal }]);
  };

  // ─── Save All ────────────────────────────────────────────────────────
  const handleSaveAll = async () => {
    const edits = Object.values(pendingEdits);
    if (edits.length === 0) return;
    setSaving(true);
    let ok = 0;
    let fail = 0;
    for (const edit of edits) {
      try {
        await manualUpdateCell(edit);
        ok++;
      } catch { fail++; }
    }
    setSaving(false);
    if (fail > 0) toast.error(`${fail} edit(s) failed to save`);
    if (ok > 0) toast.success(`${ok} edit(s) saved successfully`);
    setUndoStack([]);
    loadData();
  };

  // ─── Discard All ─────────────────────────────────────────────────────
  const handleDiscardAll = () => {
    if (!isDirty) return;
    if (!window.confirm('Discard all unsaved changes?')) return;
    setRows(originalRows.map(r => ({ ...r })));
    setPendingEditsMap({});
    setUndoStack([]);
    toast.info('Changes discarded');
  };

  // ─── Draft row (staging) + Row Operations ────────────────────────────
  const handleDraftFieldChange = (col, rawVal) => {
    setDraftRow(prev => {
      if (!prev) return prev;
      let v = rawVal;
      if (col.type === 'date') v = toDateOnly(rawVal);
      else if (col.type === 'month_year') v = parseMonthYearInput(rawVal);
      else if (col.field === 'lot_no_numeric') v = normLotNoNumeric(rawVal);
      else if (col.type === 'number') v = String(rawVal ?? '');
      else v = String(rawVal ?? '');
      return { ...prev, [col.key]: v };
    });
  };

  const handleCancelDraft = () => {
    setDraftRow(null);
    toast.info('New row cancelled');
  };

  const handleCommitDraft = async () => {
    if (!draftRow) return;
    if (isDirty) {
      toast.warning('Save or discard edits on other rows before adding this row to the table.');
      return;
    }
    if (!draftRow.fish_name?.trim()) {
      toast.warning('Enter a Fish Name before adding the row.');
      return;
    }
    if (!draftRow.line_place?.trim()) {
      toast.warning('Enter Line / Place (e.g. B01R-1) so the row can be placed in the sorted list.');
      return;
    }
    setDraftSaving(true);
    try {
      const initial = buildInitialFromDraft(activeTab, draftRow);
      const res = await manualAddRow({ stock_type: activeTab, initial });
      setDraftRow(null);
      if (res.data?.row) {
        toast.success('Row added — it appears in the list sorted by Line / Place.');
      } else {
        toast.success('Row added.');
      }
      await loadData();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add row');
    } finally {
      setDraftSaving(false);
    }
  };

  const handleAddRow = () => {
    if (draftRow) {
      toast.info('Finish or cancel the new row at the top first.');
      return;
    }
    setDraftRow(buildEmptyDraft(activeTab));
    setSelectedCell(null);
  };

  const handleDeleteRow = async (rowIdx) => {
    const row = filteredRows[rowIdx];
    if (!row) return;
    if (!window.confirm(`Delete row: ${row.fish_name} / ${row.line_place}?`)) return;
    try {
      await manualDeleteRow(row.lot_id, row.location_id);
      const key = rk(row);
      setRows(prev => prev.filter(r => rk(r) !== key));
      setOriginalRows(prev => prev.filter(r => rk(r) !== key));
      toast.success('Row deleted');
    } catch { toast.error('Delete failed'); }
  };

  const handleDuplicateRow = async (rowIdx) => {
    if (draftRow) {
      toast.info('Finish or cancel the new row at the top first.');
      return;
    }
    const src = filteredRows[rowIdx];
    if (!src) return;
    try {
      const isImportTab = activeTab === 'IMPORT';
      const initial = {
        fish_name: src.fish_name, size: src.size, bulk_weight_kg: src.bulk_weight_kg,
        type: src.type, glazing: src.glazing, order_code: src.order_code,
        production_date: isImportTab ? toDateOnly(src.cs_in_date) : toDateOnly(src.production_date),
        expiration_date: isImportTab ? null : toDateOnly(src.expiration_date),
        st_no: src.st_no,
        // backend manual row creation still requires cs_in_date
        cs_in_date: toDateOnly(src.cs_in_date || src.production_date),
        sticker: src.sticker,
        lot_no_numeric: src.lot_no_numeric,
        remark: src.remark,
        hand_on_balance_mc: src.hand_on_balance_mc,
        line_place: `${src.line_place}-CPY`, stack_no: src.stack_no, stack_total: src.stack_total,
      };
      const res = await manualAddRow({ stock_type: activeTab, initial });
      if (res.data.row) {
        setRows(prev => [...prev, res.data.row]);
        setOriginalRows(prev => [...prev, { ...res.data.row }]);
        toast.success('Row duplicated');
      }
    } catch { toast.error('Duplicate failed'); }
  };

  // ─── Undo (Ctrl+Z) — local only ─────────────────────────────────────
  const handleUndo = useCallback(() => {
    if (undoStack.length === 0) return;
    const action = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    if (action.type === 'edit') {
      setRows(prev => prev.map(r =>
        rk(r) === action.rowKey ? { ...r, [action.colKey]: action.oldValue } : r
      ));
      const col = columnsRef.current.find(c => c.key === action.colKey);
      const origRow = originalRows.find(r => rk(r) === action.rowKey);
      if (col?.field && origRow) {
        const editKey = `${action.rowKey}-${col.field}`;
        const origVal = col.type === 'date'
          ? toDateOnly(origRow[col.key])
          : col.type === 'month_year'
            ? parseMonthYearInput(origRow[col.key])
            : col.field === 'lot_no_numeric'
              ? normLotNoNumeric(origRow[col.key])
              : String(origRow[col.key] ?? '');
        const reverted = col.type === 'date'
          ? toDateOnly(action.oldValue)
          : col.type === 'month_year'
            ? parseMonthYearInput(action.oldValue)
            : col.field === 'lot_no_numeric'
              ? normLotNoNumeric(action.oldValue)
              : String(action.oldValue ?? '');
        setPendingEditsMap(prev => {
          const next = { ...prev };
          if (reverted === origVal) delete next[editKey]; else next[editKey] = { lot_id: origRow.lot_id, location_id: origRow.location_id, field: col.field, value: reverted };
          return next;
        });
      }
      toast.info('Undone');
    }
  }, [undoStack, originalRows]);

  // ─── Drag-down Fill ──────────────────────────────────────────────────
  const filteredRef = useRef(filteredRows);
  useEffect(() => { filteredRef.current = filteredRows; }, [filteredRows]);

  const startDrag = useCallback((e, sourceRowIdx, colKey) => {
    e.preventDefault();
    e.stopPropagation();
    const fRows = filteredRef.current;
    const sourceVal = fRows[sourceRowIdx]?.[colKey];
    dragRef.current = { sourceRowIdx, colKey, value: sourceVal, targetRowIdx: sourceRowIdx };

    const onMove = (me) => {
      if (!dragRef.current || !tableRef.current) return;
      const trs = Array.from(tableRef.current.querySelectorAll('tbody tr'));
      const offset = draftRowRef.current ? 1 : 0;
      for (let i = 0; i < trs.length; i++) {
        const rect = trs[i].getBoundingClientRect();
        if (me.clientY >= rect.top && me.clientY <= rect.bottom) {
          const vi = i - offset;
          if (vi < 0) continue;
          dragRef.current.targetRowIdx = windowStartRef.current + vi;
          setDragTarget(i);
          return;
        }
      }
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (!dragRef.current) return;
      const { sourceRowIdx: sIdx, colKey: cKey, value: val, targetRowIdx: tIdx } = dragRef.current;
      dragRef.current = null;
      setDragTarget(null);
      if (sIdx === tIdx) return;

      const startI = Math.min(sIdx, tIdx);
      const endI = Math.max(sIdx, tIdx);
      const fCurrent = filteredRef.current;
      const col = columnsRef.current.find(c => c.key === cKey);
      if (!col || !col.editable) return;

      const fillVal = col.field === 'lot_no_numeric' ? normLotNoNumeric(val) : val;
      const editsToAdd = {};
      for (let i = startI; i <= endI; i++) {
        if (i === sIdx) continue;
        const r = fCurrent[i];
        if (!r) continue;
        const key = rk(r);
        const oldVal = r[cKey];
        setRows(prev => prev.map(row => rk(row) === key ? { ...row, [cKey]: fillVal } : row));
        setUndoStack(prev => [...prev, { type: 'edit', rowKey: key, colKey: cKey, oldValue: oldVal, newValue: fillVal }]);
        if (col?.field) editsToAdd[`${key}-${col.field}`] = { lot_id: r.lot_id, location_id: r.location_id, field: col.field, value: fillVal };
      }
      if (Object.keys(editsToAdd).length > 0) setPendingEditsMap(prev => ({ ...prev, ...editsToAdd }));
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  // ─── Keyboard Shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.ctrlKey && e.key === 'z') { e.preventDefault(); handleUndo(); }
      if (e.ctrlKey && e.key === 's') { e.preventDefault(); handleSaveAll(); }
      if (e.ctrlKey && e.key === 'c' && selectedCell != null) {
        const row = filteredRows.find(r => rk(r) === selectedCell);
        if (row) { setCopiedRow({ ...row }); toast.info('Row copied'); }
      }
      if (e.ctrlKey && e.key === 'v' && copiedRow) {
        e.preventDefault();
        handlePaste();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  const handlePaste = async () => {
    if (!copiedRow) return;
    if (draftRow) {
      toast.info('Finish or cancel the new row at the top first.');
      return;
    }
    try {
      const src = copiedRow;
      const isImportTab = activeTab === 'IMPORT';
      const res = await manualAddRow({
        stock_type: activeTab,
        initial: {
          fish_name: src.fish_name, size: src.size, bulk_weight_kg: src.bulk_weight_kg,
          type: src.type, glazing: src.glazing, order_code: src.order_code,
          production_date: isImportTab ? toDateOnly(src.cs_in_date) : toDateOnly(src.production_date),
          expiration_date: isImportTab ? null : toDateOnly(src.expiration_date),
          st_no: src.st_no,
          // backend manual row creation still requires cs_in_date
          cs_in_date: toDateOnly(isImportTab ? src.cs_in_date : src.production_date),
          sticker: src.sticker,
          lot_no_numeric: src.lot_no_numeric,
          remark: src.remark,
          hand_on_balance_mc: src.hand_on_balance_mc,
          line_place: `${src.line_place}-CPY`, stack_no: src.stack_no, stack_total: src.stack_total,
        }
      });
      if (res.data.row) {
        setRows(prev => [...prev, res.data.row]);
        setOriginalRows(prev => [...prev, { ...res.data.row }]);
        toast.success('Row pasted');
      }
    } catch { toast.error('Paste failed'); }
  };

  // ─── Summaries ───────────────────────────────────────────────────────
  const totalMC = filteredRows.reduce((s, r) => s + (Number(r.hand_on_balance_mc) || 0), 0);
  const totalKG = filteredRows.reduce((s, r) => s + (Number(r.bulk_weight_kg) || 0) * (Number(r.hand_on_balance_mc) || 0), 0);
  const editCount = Object.keys(pendingEdits).length;

  // ─── Render ──────────────────────────────────────────────────────────
  if (loading && rows.length === 0) return <div className="loading"><div className="spinner"></div>Loading...</div>;

  return (
    <>
      {/* Unsaved changes banner */}
      {isDirty && (
        <div className="ms-dirty-banner">
          <FiAlertTriangle /> You have <b>{editCount}</b> unsaved change(s).
          <button className="btn btn-primary btn-sm" onClick={handleSaveAll} disabled={saving} style={{ marginLeft: 12 }}>
            <FiSave /> {saving ? 'Saving...' : 'Save All'}
          </button>
          <button className="btn btn-outline btn-sm" onClick={handleDiscardAll} style={{ marginLeft: 6 }}>
            Discard
          </button>
        </div>
      )}

      <div className="page-header">
        <h2>Manual</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-outline btn-sm" onClick={handleUndo} disabled={undoStack.length === 0} title="Undo (Ctrl+Z)">
            <FiRotateCcw /> Undo {undoStack.length > 0 && `(${undoStack.length})`}
          </button>
          <button className="btn btn-success btn-sm" onClick={handleSaveAll} disabled={!isDirty || saving} title="Save all (Ctrl+S)">
            <FiSave /> {saving ? 'Saving...' : `Save${editCount > 0 ? ` (${editCount})` : ''}`}
          </button>
          <button className="btn btn-primary btn-sm" onClick={handleAddRow} title="Add blank row">
            <FiPlus /> Add Row
          </button>
        </div>
      </div>
      <div className="page-body">
        <div className="stock-type-tabs">
          {TABS.map(tab => (
            <button key={tab.id} type="button"
              className={`stock-type-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => {
                if (isDirty && !window.confirm('You have unsaved changes. Switch tab? Changes will be lost.')) return;
                setActiveTab(tab.id);
              }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <form className="manual-search-form" onSubmit={handleSearch}>
          <div className="manual-search-row">
            <div className="form-group">
              <label>Fish Name</label>
              <input type="text" className="form-control" placeholder="Search..."
                value={filters.fish_name} onChange={e => setFilters(f => ({ ...f, fish_name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Line (L/R)</label>
              <select className="form-control" value={filters.line}
                onChange={e => setFilters(f => ({ ...f, line: e.target.value }))}>
                {LINE_OPTIONS.map(o => <option key={o.value || 'all'} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Line Detail</label>
              <input type="text" className="form-control" placeholder="e.g. A01, Q01..."
                value={filters.line_detail} onChange={e => setFilters(f => ({ ...f, line_detail: e.target.value }))} />
            </div>
            <div className="form-group">
              <label>Stack No</label>
              <input type="text" className="form-control" placeholder="Stack..."
                value={filters.stack_no} onChange={e => setFilters(f => ({ ...f, stack_no: e.target.value }))} />
            </div>
            <div className="form-group manual-search-actions">
              <button type="submit" className="btn btn-primary"><FiSearch /> Search</button>
              <button type="button" className="btn btn-outline"
                onClick={() => {
                  setFilters({ fish_name: '', line: '', line_detail: '', stack_no: '' });
                  setColumnFilters({});
                  setSearchQuery('');
                }}>Clear</button>
            </div>
          </div>
        </form>

        <div className="filter-bar no-print" style={{ marginBottom: 12 }}>
          <div className="filter-bar-search-single">
            <FiSearch className="filter-bar-search-icon" />
            <input
              type="text"
              className="form-control"
              placeholder="Search all columns (same as Stock Summary)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {(activeFilterCount > 0 || searchQuery.trim()) && (
          <div className="gs-active-filters-bar" style={{ marginBottom: 12 }}>
            {activeFilterCount > 0 && (
              <span>{activeFilterCount} column filter{activeFilterCount > 1 ? 's' : ''} active</span>
            )}
            <span className="gs-filtered-count">{filteredRows.length} of {afterSidebar.length} rows</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={handleClearAllFilters}>
              <FiX /> Clear table filters
            </button>
          </div>
        )}

        <div className="dashboard-grid" style={{ marginBottom: 12 }}>
          <div className="stat-card"><div className="stat-info"><h4>Total MC</h4><div className="stat-value" style={{ fontSize: '1.3rem' }}>{totalMC.toLocaleString()}</div></div></div>
          <div className="stat-card"><div className="stat-info"><h4>Total KG</h4><div className="stat-value" style={{ fontSize: '1.3rem' }}>{totalKG.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div></div>
          <div className="stat-card"><div className="stat-info"><h4>Rows</h4><div className="stat-value" style={{ fontSize: '1.3rem' }}>{filteredRows.length}</div></div></div>
        </div>

        <div className="ms-hint">
          <b>Add Row</b> opens a highlighted row at the top — confirm to insert (sorted by Line / Place). · Click any cell to edit · <b>Ctrl+S</b> Save · <b>Ctrl+Z</b> Undo · <b>Ctrl+C</b> Copy row · <b>Ctrl+V</b> Paste · Drag blue handle to fill down
          {rows.length >= MANUAL_FETCH_LIMIT && (
            <span className="ms-hint-limit"> · Showing up to {MANUAL_FETCH_LIMIT} rows (use Search to narrow)</span>
          )}
        </div>

        {useWindow && (
          <div className="ms-window-nav">
            <span className="ms-window-info">Rows {windowStart + 1}–{Math.min(windowStart + ROW_WINDOW_SIZE, filteredRows.length)} of {filteredRows.length}</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setWindowStart(0)} disabled={windowStart === 0}>First</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setWindowStart(w => Math.max(0, w - ROW_WINDOW_SIZE))} disabled={windowStart === 0}>Prev</button>
            <span className="ms-window-page">Page {currentWindowPage} of {totalWindowPages}</span>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setWindowStart(w => Math.min(filteredRows.length - ROW_WINDOW_SIZE, w + ROW_WINDOW_SIZE))} disabled={windowStart + ROW_WINDOW_SIZE >= filteredRows.length}>Next</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => setWindowStart(Math.max(0, filteredRows.length - ROW_WINDOW_SIZE))} disabled={windowStart + ROW_WINDOW_SIZE >= filteredRows.length}>Last</button>
          </div>
        )}

        <div className="ms-wrap" ref={tableRef}>
          <table className="ms-table">
            <thead>
              <tr>
                <th className="ms-th-num">#</th>
                {columns.map(col => {
                  const isFilterable = filterableColumns.some(c => c.key === col.key);
                  if (!isFilterable) {
                    return (
                      <th key={col.key} style={{ minWidth: col.w, ...(col.headerStyle || {}) }}>
                        {col.label}
                        {col.formula && <span className="ms-fx"> ƒ</span>}
                      </th>
                    );
                  }
                  const allVals = allColumnValues[col.key] || [];
                  const allUnique = [...new Set(allVals.map(v => v != null ? v : '(Blank)'))];
                  const currentSelected = columnFilters[col.key] || new Set(allUnique);
                  return (
                    <th key={col.key} style={{ minWidth: col.w, ...(col.headerStyle || {}) }}>
                      <div className="gs-th-inner">
                        <span>{col.label}</span>
                        <ColumnFilterDropdown
                          allValues={allVals}
                          selected={currentSelected}
                          onApply={(sel) => applyColumnFilter(col.key, sel)}
                          onClear={() => clearColumnFilter(col.key)}
                        />
                      </div>
                    </th>
                  );
                })}
                <th className="ms-th-act"></th>
              </tr>
            </thead>
            <tbody>
              {draftRow && (
                <tr key="__draft__" className="ms-draft-row">
                  <td className="ms-num ms-draft-num">
                    <span className="ms-draft-badge">New</span>
                    <span className="ms-draft-sub">Staging</span>
                  </td>
                  {columns.map(col => {
                    if (!col.editable) {
                      if (col.formula) {
                        const kg = (Number(draftRow.bulk_weight_kg) || 0) * (Number(draftRow.hand_on_balance_mc) || 0);
                        return (
                          <td key={col.key} className="ms-cell ms-cell-ro ms-draft-cell">
                            {kg.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </td>
                        );
                      }
                      return (
                        <td key={col.key} className="ms-cell ms-cell-ro ms-draft-cell">—</td>
                      );
                    }
                    const valNormalized = col.type === 'date'
                      ? toDateOnly(draftRow[col.key])
                      : col.type === 'month_year'
                        ? parseMonthYearInput(draftRow[col.key])
                        : col.field === 'lot_no_numeric'
                          ? normLotNoNumeric(draftRow[col.key])
                          : (draftRow[col.key] ?? '');
                    const inputDisplayVal = col.type === 'month_year'
                      ? toMonthYearDisplay(draftRow[col.key])
                      : col.field === 'lot_no_numeric'
                        ? normLotNoNumeric(draftRow[col.key])
                        : valNormalized;
                    return (
                      <td key={col.key} className="ms-cell ms-cell-ed ms-draft-cell">
                        <input
                          className={`ms-input ${col.type === 'number' || col.field === 'lot_no_numeric' ? 'ms-input-num' : ''}`}
                          type={col.type === 'month_year' ? 'text' : col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text'}
                          inputMode={col.field === 'lot_no_numeric' ? 'numeric' : undefined}
                          value={inputDisplayVal}
                          onChange={e => handleDraftFieldChange(col, e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Tab' || e.key === 'Enter') e.currentTarget.blur();
                          }}
                          placeholder={col.key === 'line_place' ? 'e.g. B01R-1' : undefined}
                        />
                      </td>
                    );
                  })}
                  <td className="ms-act ms-draft-act">
                    <button type="button" className="ms-draft-confirm" onClick={handleCommitDraft} disabled={draftSaving} title="Create row and place in sorted list">
                      <FiCheck size={16} /> {draftSaving ? 'Adding…' : 'Add to table'}
                    </button>
                    <button type="button" className="ms-draft-cancel" onClick={handleCancelDraft} disabled={draftSaving}>
                      Cancel
                    </button>
                  </td>
                </tr>
              )}
              {displayRows.length === 0 && !draftRow ? (
                <tr><td colSpan={columns.length + 2} style={{ textAlign: 'center', padding: 60, color: '#999' }}>
                  No data. Click "Add Row" or upload via Excel Upload.
                </td></tr>
              ) : displayRows.map((row, rowIdx) => {
                const filteredIdx = useWindow ? windowStart + rowIdx : rowIdx;
                const isDragHL = dragTarget != null && dragRef.current &&
                  filteredIdx >= Math.min(dragRef.current.sourceRowIdx, dragRef.current.targetRowIdx) &&
                  filteredIdx <= Math.max(dragRef.current.sourceRowIdx, dragRef.current.targetRowIdx);
                const orig = originalRows.find(o => rk(o) === rk(row));
                const fullIdx = rows.findIndex(r => rk(r) === rk(row));
                const rowNum = useWindow ? windowStart + rowIdx + 1 : rowIdx + 1;
                return (
                  <tr key={rk(row)}
                    className={`${selectedCell === rk(row) ? 'ms-row-sel' : ''} ${isDragHL ? 'ms-drag-hl' : ''}`}>
                    <td className="ms-num" onClick={() => setSelectedCell(rk(row))} title="Select row">{rowNum}</td>
                    {columns.map(col => {
                      const isActive = selectedCell === rk(row);
                      if (!col.editable) {
                        const display = col.formula ? getCellDisplay(row, col) : (row[col.key] ?? '-');
                        return (
                          <td key={col.key} className="ms-cell ms-cell-ro">
                            {col.formula ? Number(display).toLocaleString(undefined, { maximumFractionDigits: 2 }) : display}
                          </td>
                        );
                      }
                      const valNormalized = col.type === 'date'
                        ? toDateOnly(row[col.key])
                        : col.type === 'month_year'
                          ? parseMonthYearInput(row[col.key])
                          : col.field === 'lot_no_numeric'
                            ? normLotNoNumeric(row[col.key])
                            : (row[col.key] ?? '');
                      const origValNormalized = orig
                        ? (col.type === 'date'
                            ? toDateOnly(orig[col.key])
                            : col.type === 'month_year'
                              ? parseMonthYearInput(orig[col.key])
                              : col.field === 'lot_no_numeric'
                                ? normLotNoNumeric(orig[col.key])
                                : String(orig[col.key] ?? ''))
                        : valNormalized;
                      const isChanged = String(valNormalized) !== String(origValNormalized);
                      const inputDisplayVal = col.type === 'month_year'
                        ? toMonthYearDisplay(row[col.key])
                        : col.field === 'lot_no_numeric'
                          ? normLotNoNumeric(row[col.key])
                          : valNormalized;
                      return (
                        <td key={col.key} className={`ms-cell ms-cell-ed ${isActive ? 'ms-cell-active' : ''} ${isChanged ? 'ms-cell-dirty' : ''}`}>
                          <input
                            className={`ms-input ${col.type === 'number' || col.field === 'lot_no_numeric' ? 'ms-input-num' : ''}`}
                            type={col.type === 'month_year' ? 'text' : col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text'}
                            inputMode={col.field === 'lot_no_numeric' ? 'numeric' : undefined}
                            value={inputDisplayVal}
                            onChange={e => handleCellChange(fullIdx, col, e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Tab' || e.key === 'Enter') e.currentTarget.blur();
                            }}
                          />
                          {isActive && (
                            <div className="ms-drag-handle" onMouseDown={e => startDrag(e, filteredIdx, col.key)} title="Drag to fill down" />
                          )}
                        </td>
                      );
                    })}
                    <td className="ms-act">
                      <button className="ms-btn-copy" onClick={() => handleDuplicateRow(filteredIdx)} title="Duplicate"><FiCopy size={13} /></button>
                      <button className="ms-btn-del" onClick={() => handleDeleteRow(filteredIdx)} title="Delete"><FiTrash2 size={13} /></button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {filteredRows.length > 0 && (
              <tfoot>
                <tr>
                  <td className="ms-num"></td>
                  {columns.map(col => {
                    if (col.key === 'hand_on_balance_mc') return <td key={col.key} className="ms-foot-num">{totalMC.toLocaleString()}</td>;
                    if (col.key === '_kg_total') return <td key={col.key} className="ms-foot-num">{totalKG.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>;
                    if (col.key === 'fish_name') return <td key={col.key} style={{ fontWeight: 700, textAlign: 'right', padding: '6px 8px' }}>TOTALS:</td>;
                    return <td key={col.key}></td>;
                  })}
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

export default Manual;
