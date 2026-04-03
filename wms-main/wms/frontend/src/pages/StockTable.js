import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { FiDownload, FiSearch, FiPackage, FiBox, FiTrash2, FiAnchor, FiChevronDown, FiCheck, FiX, FiCopy, FiPrinter, FiImage } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getInventory, deleteAllStockData } from '../services/api';
import * as XLSX from 'xlsx';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

const TABS = [
  { id: 'BULK', label: 'Bulk', icon: <FiPackage /> },
  { id: 'CONTAINER_EXTRA', label: 'Container Extra', icon: <FiBox /> },
  { id: 'IMPORT', label: 'Import', icon: <FiAnchor /> }
];

const BULK_COLUMNS = [
  { key: 'fish_name', label: 'Fish Name' },
  { key: 'size', label: 'Size' },
  { key: 'bulk_weight_kg', label: 'Bulk Wt (KG)' },
  { key: 'type', label: 'Type' },
  { key: 'glazing', label: 'Glazing' },
  { key: 'cs_in_date', label: 'CS In Date' },
  { key: 'sticker', label: 'Sticker' },
  { key: 'line_place', label: 'Lines / Place' },
  { key: 'stack_no', label: 'Stack No' },
  { key: 'stack_total', label: 'Stack Total' },
  { key: 'old_balance_mc', label: 'Old Balance' },
  { key: 'new_income_mc', label: 'New Income' },
  { key: 'hand_on_balance_mc', label: 'Hand On Balance' },
  { key: 'hand_on_balance_kg', label: 'KG' }
];

const CE_COLUMNS = [
  { key: 'order_code', label: 'Order' },
  { key: 'fish_name', label: 'Fish Name' },
  { key: 'size', label: 'Size' },
  { key: 'bulk_weight_kg', label: 'KG' },
  { key: 'production_date', label: 'Production Date' },
  { key: 'expiration_date', label: 'Expiration Date' },
  { key: 'hand_on_balance_kg', label: 'Total KG' },
  { key: 'hand_on_balance_mc', label: 'Balance MC' },
  { key: 'line_place', label: 'Line' },
  { key: 'st_no', label: 'ST NO' },
  { key: 'remark', label: 'Remark' }
];

const CE_IMPORT_COLUMNS = [
  { key: 'order_code', label: null },
  { key: 'fish_name', label: 'Fish Name' },
  { key: 'size', label: 'Size' },
  { key: 'bulk_weight_kg', label: 'KG' },
  { key: 'cs_in_date', label: 'Arrival Date' },
  { key: 'country', label: 'Country' },
  { key: 'hand_on_balance_kg', label: 'Total KG' },
  { key: 'hand_on_balance_mc', label: 'Balance MC' },
  { key: 'line_place', label: 'Line' },
  { key: 'remark', label: 'Remark' }
];

const BULK_AGGREGATE_KEYS = ['old_balance_mc', 'new_income_mc', 'hand_on_balance_mc', 'hand_on_balance_kg'];

// Month/year dates from Excel like "12/2024" are stored in DB as "YYYY-MM-01".
// Display rules:
// - if only month/year (DB day is "01") => MM/YYYY
// - if day exists => DD/MM/YYYY
const formatMonthYearDisplay = (v) => {
  if (v == null || v === '') return v;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const yyyy = iso[1];
    const mm = iso[2];
    const dd = iso[3];
    if (dd === '01') return `${mm}/${yyyy}`;
    return `${dd}/${mm}/${yyyy}`;
  }
  const mmY = s.match(/^(\d{1,2})[\/\-](\d{4})$/);
  if (mmY) {
    const mm = mmY[1].padStart(2, '0');
    return `${mm}/${mmY[2]}`;
  }
  const ddmmyyyy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (ddmmyyyy) {
    const dd = ddmmyyyy[1].padStart(2, '0');
    const mm = ddmmyyyy[2].padStart(2, '0');
    const yyyy = ddmmyyyy[3];
    return `${dd}/${mm}/${yyyy}`;
  }
  return s;
};

// ISO date YYYY-MM-DD => DD/MM/YYYY (for IMPORT Arrival Date)
const formatISODateToDMY = (v) => {
  if (v == null || v === '') return v;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!iso) return s;
  const yyyy = iso[1];
  const mm = iso[2];
  const dd = iso[3];
  return `${dd}/${mm}/${yyyy}`;
};

// ─── Google Sheets–style column filter dropdown ────────────────────────
function ColumnFilterDropdown({ columnKey, allValues, selected, onApply, onClear }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState(new Set(selected));
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const popupRef = useRef(null);
  const uniqueCount = new Set(allValues.map(v => v != null ? String(v) : '(Blank)')).size;
  const isFiltered = selected.size < uniqueCount;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popupRef.current && popupRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => { if (open) setLocalSelected(new Set(selected)); }, [open, selected]);

  const handleOpen = () => {
    if (open) { setOpen(false); return; }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      let left = rect.left;
      const popW = 300;
      if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
      if (left < 8) left = 8;
      setPos({ top: rect.bottom + 4, left });
    }
    setOpen(true);
  };

  const uniqueValues = useMemo(() => {
    const vals = [...new Set(allValues.map(v => v != null ? String(v) : '(Blank)'))];
    vals.sort((a, b) => a === '(Blank)' ? 1 : b === '(Blank)' ? -1 : a.localeCompare(b, undefined, { numeric: true }));
    return vals;
  }, [allValues]);

  const displayValues = useMemo(() => {
    if (!search.trim()) return uniqueValues;
    const q = search.toLowerCase();
    return uniqueValues.filter(v => v.toLowerCase().includes(q));
  }, [uniqueValues, search]);

  const allDisplaySelected = displayValues.length > 0 && displayValues.every(v => localSelected.has(v));

  const toggleValue = (val) => {
    setLocalSelected(prev => {
      const next = new Set(prev);
      next.has(val) ? next.delete(val) : next.add(val);
      return next;
    });
  };

  const handleSelectAll = () => {
    setLocalSelected(prev => {
      const next = new Set(prev);
      if (allDisplaySelected) { displayValues.forEach(v => next.delete(v)); }
      else { displayValues.forEach(v => next.add(v)); }
      return next;
    });
  };

  const handleApply = () => { onApply(localSelected); setOpen(false); setSearch(''); };
  const handleClearFilter = () => { onClear(); setOpen(false); setSearch(''); };

  const popup = open ? ReactDOM.createPortal(
    <div className="gs-filter-popup" ref={popupRef} style={{ top: pos.top, left: pos.left }}>
      <div className="gs-filter-search">
        <FiSearch size={13} />
        <input type="text" placeholder="Search..." value={search}
          onChange={e => setSearch(e.target.value)} autoFocus />
        {search && <button className="gs-filter-clear-search" onClick={() => setSearch('')}><FiX size={12} /></button>}
      </div>
      <div className="gs-filter-actions-top">
        <button onClick={handleSelectAll}>{allDisplaySelected ? 'Deselect All' : 'Select All'}</button>
        {isFiltered && <button onClick={handleClearFilter} className="gs-filter-clear-btn">Clear Filter</button>}
      </div>
      <div className="gs-filter-list">
        {displayValues.length === 0 ? (
          <div className="gs-filter-empty">No matches</div>
        ) : displayValues.map(val => (
          <div key={val} className="gs-filter-item" onClick={() => toggleValue(val)}>
            <div className={`gs-checkbox ${localSelected.has(val) ? 'gs-checked' : ''}`}>
              {localSelected.has(val) && <FiCheck size={11} />}
            </div>
            <span className="gs-filter-val">{val}</span>
          </div>
        ))}
      </div>
      <div className="gs-filter-footer">
        <button className="gs-filter-cancel" onClick={() => { setOpen(false); setSearch(''); }}>Cancel</button>
        <button className="gs-filter-ok" onClick={handleApply}>OK</button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="gs-filter-wrap">
      <button ref={btnRef}
        className={`gs-filter-btn ${isFiltered ? 'gs-filter-active' : ''}`}
        onClick={handleOpen} title="Filter this column">
        <FiChevronDown size={12} />
      </button>
      {popup}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────
function StockTable() {
  const [activeTab, setActiveTab] = useState('BULK');
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [columnFilters, setColumnFilters] = useState({});
  const [rowLimit, setRowLimit] = useState(50);
  const reportContainerRef = useRef(null);

  const isCE = activeTab === 'CONTAINER_EXTRA';
  const isImport = activeTab === 'IMPORT';
  const isNonBulk = isCE || isImport;
  const columns = isCE ? CE_COLUMNS : (isImport ? CE_IMPORT_COLUMNS : BULK_COLUMNS);

  // BULK: show/hide optional columns (default OFF)
  const [showBulkLinesPlace, setShowBulkLinesPlace] = useState(false);
  const [showBulkStackNo, setShowBulkStackNo] = useState(false);
  const [showBulkStackTotal, setShowBulkStackTotal] = useState(false);
  // BULK: Old Balance / New Income — default OFF (same as Lines/Place, Stack, etc.)
  const [showBulkOldBalance, setShowBulkOldBalance] = useState(false);
  const [showBulkNewIncome, setShowBulkNewIncome] = useState(false);

  // Container Extra: show/hide optional columns (default OFF)
  const [showCElinePlace, setShowCElinePlace] = useState(false);
  const [showCEstNo, setShowCEstNo] = useState(false);

  const bulkTableColumns = useMemo(() => {
    if (activeTab !== 'BULK') return columns;
    return BULK_COLUMNS.filter(col => {
      if (col.key === 'line_place') return showBulkLinesPlace;
      if (col.key === 'stack_no') return showBulkStackNo;
      if (col.key === 'stack_total') return showBulkStackTotal;
      if (col.key === 'old_balance_mc') return showBulkOldBalance;
      if (col.key === 'new_income_mc') return showBulkNewIncome;
      return true;
    });
  }, [activeTab, columns, showBulkLinesPlace, showBulkStackNo, showBulkStackTotal, showBulkOldBalance, showBulkNewIncome]);

  const bulkFirstAggregateIndex = useMemo(() => {
    if (activeTab !== 'BULK') return -1;
    return bulkTableColumns.findIndex(c => BULK_AGGREGATE_KEYS.includes(c.key));
  }, [activeTab, bulkTableColumns]);

  const bulkTotalsColSpan =
    bulkFirstAggregateIndex >= 0 ? 1 + bulkFirstAggregateIndex : 1;

  const visibleColumns = useMemo(() => {
    if (activeTab !== 'CONTAINER_EXTRA') return columns;
    return CE_COLUMNS.filter(col => {
      if (col.key === 'line_place') return showCElinePlace;
      if (col.key === 'st_no') return showCEstNo;
      return true;
    });
  }, [activeTab, columns, showCElinePlace, showCEstNo]);

  useEffect(() => {
    if (activeTab !== 'CONTAINER_EXTRA') {
      setShowCElinePlace(false);
      setShowCEstNo(false);
      return;
    }
    setColumnFilters(prev => {
      const next = { ...prev };
      if (!showCElinePlace) delete next.line_place;
      if (!showCEstNo) delete next.st_no;
      return next;
    });
  }, [activeTab, showCElinePlace, showCEstNo]);

  useEffect(() => {
    if (activeTab !== 'BULK') return;
    setColumnFilters(prev => {
      const next = { ...prev };
      if (!showBulkOldBalance) delete next.old_balance_mc;
      if (!showBulkNewIncome) delete next.new_income_mc;
      return next;
    });
  }, [activeTab, showBulkOldBalance, showBulkNewIncome]);

  const fetchInventory = useCallback(async () => {
    try {
      const res = await getInventory({ stock_type: activeTab });
      const normalized = (res.data || []).map(r => ({
        ...r,
        cs_in_date: isImport ? formatISODateToDMY(r.cs_in_date) : r.cs_in_date,
        production_date: formatMonthYearDisplay(r.production_date),
        expiration_date: formatMonthYearDisplay(r.expiration_date),
      }));
      setInventory(normalized);
    } catch (err) {
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  }, [activeTab, isImport]);

  useEffect(() => {
    setLoading(true);
    setSearchQuery('');
    setColumnFilters({});
    fetchInventory();
  }, [activeTab, fetchInventory]);

  const allColumnValues = useMemo(() => {
    const map = {};
    columns.forEach(({ key }) => {
      map[key] = inventory.map(r => {
        const v = r[key];
        return v != null && v !== '' ? String(v) : null;
      });
    });
    return map;
  }, [inventory, columns]);

  const filteredInventory = useMemo(() => {
    let list = inventory;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter(row =>
        columns.some(({ key }) => {
          const v = row[key];
          const str = v != null && v !== '' ? String(v) : '';
          return str.toLowerCase().includes(q);
        })
      );
    }
    return list.filter(row =>
      columns.every(({ key }) => {
        const selected = columnFilters[key];
        if (!selected) return true;
        const v = row[key];
        const str = v != null && v !== '' ? String(v) : '(Blank)';
        return selected.has(str);
      })
    );
  }, [inventory, columnFilters, columns, searchQuery]);

  const applyColumnFilter = (key, selected) => {
    const allVals = new Set(allColumnValues[key].map(v => v != null ? v : '(Blank)'));
    if (selected.size === allVals.size) {
      setColumnFilters(prev => { const next = { ...prev }; delete next[key]; return next; });
    } else {
      setColumnFilters(prev => ({ ...prev, [key]: selected }));
    }
  };

  const clearColumnFilter = (key) => {
    setColumnFilters(prev => { const next = { ...prev }; delete next[key]; return next; });
  };

  const activeFilterCount = Object.keys(columnFilters).length;


  const handleDeleteAll = async () => {
    const label = isCE ? 'Container Extra' : isImport ? 'Import' : 'Bulk';
    if (!window.confirm(`Delete ALL ${label} stock data? (${inventory.length} items)\n\nThis will remove all movements and lots for ${label} stock. Products will remain.`)) return;
    if (!window.confirm('This is irreversible. Confirm again to proceed.')) return;
    try {
      const res = await deleteAllStockData({ stock_type: activeTab });
      toast.success(res.data.message || 'All stock data deleted');
      setLoading(true);
      fetchInventory();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete stock data');
    }
  };

  const handleClearAllFilters = () => { setColumnFilters({}); };

  const displayRows = useMemo(() => {
    if (!rowLimit || rowLimit <= 0) return filteredInventory;
    return filteredInventory.slice(0, rowLimit);
  }, [filteredInventory, rowLimit]);

  // Upper stat cards: full filtered set (search + column filters), all rows
  const totalMC = filteredInventory.reduce((sum, r) => sum + Number(r.hand_on_balance_mc), 0);
  const totalKG = filteredInventory.reduce((sum, r) => sum + Number(r.hand_on_balance_kg), 0);
  const totalStacks = new Set(filteredInventory.map(r => `${r.line_place}-${r.stack_no}`)).size;

  // Table footer TOTALS row: only rows shown under "Show rows" (displayRows)
  const visibleTotalMC = useMemo(
    () => displayRows.reduce((sum, r) => sum + Number(r.hand_on_balance_mc || 0), 0),
    [displayRows]
  );
  const visibleTotalKG = useMemo(
    () => displayRows.reduce((sum, r) => sum + Number(r.hand_on_balance_kg || 0), 0),
    [displayRows]
  );
  const visibleOldBalanceSum = useMemo(
    () => displayRows.reduce((s, r) => s + Number(r.old_balance_mc || 0), 0),
    [displayRows]
  );
  const visibleNewIncomeSum = useMemo(
    () => displayRows.reduce((s, r) => s + Number(r.new_income_mc || 0), 0),
    [displayRows]
  );

  const exportExcel = () => {
    let data;
    const source = filteredInventory;
    if (isNonBulk) {
      const orderLabel = isImport ? 'Invoice No' : 'Order';
      if (isCE) {
        data = source.map((r, i) => {
          const row = {
            '#': i + 1,
            [orderLabel]: r.order_code || '',
            'Fish Name': r.fish_name,
            'Size': r.size,
            'KG': Number(r.bulk_weight_kg),
            'Production Date': r.production_date || '',
            'Expiration Date': r.expiration_date || '',
            'Balance MC': Number(r.hand_on_balance_mc),
            'Total KG': Number(r.hand_on_balance_kg),
            'Remark': r.remark || ''
          };
          if (showCElinePlace) row['Line'] = r.line_place || '';
          if (showCEstNo) row['ST NO'] = r.st_no || '';
          return row;
        });
        const totalRow = {
          '#': '',
          [orderLabel]: '',
          'Fish Name': 'TOTAL',
          'Size': '',
          'KG': '',
          'Production Date': '',
          'Expiration Date': '',
          'Balance MC': totalMC,
          'Total KG': totalKG,
          'Remark': ''
        };
        if (showCElinePlace) totalRow['Line'] = '';
        if (showCEstNo) totalRow['ST NO'] = '';
        data.push(totalRow);
      } else {
        data = source.map((r, i) => ({
          '#': i + 1, [orderLabel]: r.order_code || '', 'Fish Name': r.fish_name,
          'Size': r.size, 'KG': Number(r.bulk_weight_kg), 'Arrival Date': r.cs_in_date || '',
          'Country': r.country || '',
          'Line': r.line_place, 'Balance MC': Number(r.hand_on_balance_mc),
          'Total KG': Number(r.hand_on_balance_kg), 'Remark': r.remark || ''
        }));
        data.push({ '#': '', [orderLabel]: '', 'Fish Name': 'TOTAL', 'Size': '', 'KG': '',
          'Arrival Date': '', 'Country': '', 'Line': '', 'Balance MC': totalMC, 'Total KG': totalKG, 'Remark': '' });
      }
    } else {
      const bulkExcelKeyToLabel = {
        fish_name: 'Fish Name',
        size: 'Size',
        bulk_weight_kg: 'Bulk Weight (KG)',
        type: 'Type',
        glazing: 'Glazing',
        cs_in_date: 'CS In Date',
        sticker: 'Sticker',
        line_place: 'Lines / Place',
        stack_no: 'Stack No',
        stack_total: 'Stack Total',
        old_balance_mc: 'Old Balance',
        new_income_mc: 'New Income',
        hand_on_balance_mc: 'Hand On Balance',
        hand_on_balance_kg: 'Weight (KG)'
      };
      const rowFromBulkCols = (r, i, isTotal) => {
        const o = {};
        o['#'] = isTotal ? '' : i + 1;
        bulkTableColumns.forEach((col) => {
          const L = bulkExcelKeyToLabel[col.key];
          if (!L) return;
          if (isTotal) {
            if (col.key === 'fish_name') o[L] = 'TOTAL';
            else if (col.key === 'stack_total') o[L] = totalStacks;
            else if (col.key === 'old_balance_mc' || col.key === 'new_income_mc') o[L] = '';
            else if (col.key === 'hand_on_balance_mc') o[L] = totalMC;
            else if (col.key === 'hand_on_balance_kg') o[L] = totalKG;
            else o[L] = '';
            return;
          }
          switch (col.key) {
            case 'bulk_weight_kg':
            case 'old_balance_mc':
            case 'new_income_mc':
            case 'hand_on_balance_mc':
            case 'hand_on_balance_kg':
              o[L] = Number(r[col.key] ?? 0);
              break;
            default:
              o[L] = r[col.key] ?? '';
          }
        });
        return o;
      };
      data = source.map((r, i) => rowFromBulkCols(r, i, false));
      data.push(rowFromBulkCols({}, 0, true));
    }
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    const sheetName = isCE ? 'Container Extra Stock' : isImport ? 'Import Stock' : 'Bulk Stock';
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const prefix = isCE ? 'Container_Extra' : isImport ? 'Import' : 'Bulk';
    XLSX.writeFile(wb, `WMS_${prefix}_Stock_${new Date().toISOString().split('T')[0]}.xlsx`);
    toast.success('Excel file downloaded');
  };

  const exportPDF = async () => {
    if (!reportContainerRef.current) return;
    if (filteredInventory.length === 0) {
      toast.warn('No data to export');
      return;
    }

    const el = reportContainerRef.current;
    const prevMaxHeight = el.style.maxHeight;
    const prevOverflow = el.style.overflow;
    try {
      // Expand the container so the full table is rendered for capture
      el.style.maxHeight = 'none';
      el.style.overflow = 'visible';
      await new Promise(r => setTimeout(r, 100));

      const table = el.querySelector('table');
      if (!table) {
        toast.error('Table not found');
        return;
      }

      const canvas = await html2canvas(table, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      const pdfW = 297; // landscape A4 width in mm
      const pdfH = 210; // landscape A4 height in mm
      const pageHeightPx = Math.floor(canvas.width * (pdfH / pdfW));
      const pageCount = Math.ceil(canvas.height / pageHeightPx);
      const imgWidthMm = pdfW;

      for (let i = 0; i < pageCount; i++) {
        const sy = i * pageHeightPx;
        const sh = Math.min(pageHeightPx, canvas.height - sy);

        const pageCanvas = document.createElement('canvas');
        pageCanvas.width = canvas.width;
        pageCanvas.height = sh;
        const ctx = pageCanvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(canvas, 0, sy, canvas.width, sh, 0, 0, canvas.width, sh);

        const pageImg = pageCanvas.toDataURL('image/png');
        const pageImgH = sh * (imgWidthMm / canvas.width);

        if (i > 0) pdf.addPage();
        pdf.addImage(pageImg, 'PNG', 0, 0, imgWidthMm, pageImgH);
      }

      const prefix = isCE ? 'Container_Extra' : isImport ? 'Import' : 'Bulk';
      const filename = `WMS_${prefix}_Stock_${new Date().toISOString().split('T')[0]}.pdf`;
      pdf.save(filename);
      toast.success('PDF downloaded');
    } catch (err) {
      toast.error('Failed to generate PDF');
    } finally {
      el.style.maxHeight = prevMaxHeight;
      el.style.overflow = prevOverflow;
    }
  };

  const copyTableAsImage = async () => {
    if (!reportContainerRef.current) return;
    if (displayRows.length === 0) {
      toast.warn('No rows to copy');
      return;
    }

    const el = reportContainerRef.current;
    const prevMaxHeight = el.style.maxHeight;
    const prevOverflow = el.style.overflow;
    try {
      toast.info('Copying table as image…');
      el.style.maxHeight = 'none';
      el.style.overflow = 'visible';
      await new Promise((r) => setTimeout(r, 100));

      const table = el.querySelector('table');
      if (!table) {
        toast.error('Table not found');
        return;
      }

      const canvas = await html2canvas(table, {
        backgroundColor: '#ffffff',
        scale: 2,
        useCORS: true,
        logging: false
      });

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png', 0.92);
      });

      const canClipboardImage =
        typeof ClipboardItem !== 'undefined' &&
        navigator.clipboard &&
        typeof navigator.clipboard.write === 'function';

      if (canClipboardImage) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
          toast.success('Table copied as image — paste into Word, Teams, etc.');
          return;
        } catch (clipErr) {
          console.warn('Clipboard image failed:', clipErr);
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const prefix = isCE ? 'Container_Extra' : isImport ? 'Import' : 'Bulk';
      a.href = url;
      a.download = `WMS_${prefix}_Stock_${new Date().toISOString().split('T')[0]}.png`;
      a.click();
      URL.revokeObjectURL(url);
      toast.info('Image copied isn’t supported here — PNG file downloaded instead. You can paste the file where needed.');
    } catch (err) {
      console.error(err);
      toast.error('Failed to copy table as image');
    } finally {
      el.style.maxHeight = prevMaxHeight;
      el.style.overflow = prevOverflow;
    }
  };

  const handlePrint = () => {
    if (displayRows.length === 0) {
      toast.warn('No rows to print for the current tab and filters.');
      return;
    }
    const style = document.createElement('style');
    style.id = 'st-stock-table-print-page';
    style.textContent = '@page { size: A4 landscape; margin: 10mm; }';
    document.head.appendChild(style);
    const onAfterPrint = () => {
      document.getElementById('st-stock-table-print-page')?.remove();
      window.removeEventListener('afterprint', onAfterPrint);
    };
    window.addEventListener('afterprint', onAfterPrint);
    window.print();
  };

  const exportAsText = async () => {
    if (filteredInventory.length === 0) {
      toast.warn('No data to copy');
      return;
    }
    let text;
    if (!isNonBulk) {
      const totalMC = filteredInventory.reduce((s, r) => s + Number(r.hand_on_balance_mc), 0);
      const totalKG = filteredInventory.reduce((s, r) => s + Number(r.hand_on_balance_kg), 0);
      const rows = filteredInventory.map(r => {
        const mc = Number(r.hand_on_balance_mc) || 0;
        const kg = Number(r.hand_on_balance_kg) || 0;
        const type = (r.type || '').trim();
        const glazing = (r.glazing || '').trim();
        const parts = [
          (r.fish_name || '').trim(),
          (r.size || '').trim(),
          `${Number(r.bulk_weight_kg) || 0} KG`,
        ];
        if (type) parts.push(type);
        if (glazing) {
          parts.push(`${glazing} = ${mc} MC [${kg} KG]`);
        } else {
          const suffix = `= ${mc} MC [${kg} KG]`;
          if (type) parts[parts.length - 1] = `${parts[parts.length - 1]} ${suffix}`;
          else parts.push(suffix);
        }
        return parts.join(' / ');
      });
      text = rows.join('\r\n') + '\r\n\r\nTOTAL MC\t' + totalMC + '\r\nTOTAL KG\t' + totalKG;
    } else {
      const getHeaderLabel = (col) => col.label != null ? col.label : (col.key === 'order_code' ? (isImport ? 'Invoice No' : 'Order') : col.key);
      const headerLabels = ['#', ...visibleColumns.map(getHeaderLabel)];
      const rows = filteredInventory.map((r, i) => {
        const cells = [i + 1];
        visibleColumns.forEach(col => {
          const val = r[col.key];
          const isKg = col.key === 'bulk_weight_kg' || col.key === 'hand_on_balance_kg';
          if (isKg) cells.push(Number(val || 0));
          else cells.push(val != null && val !== '' ? String(val) : '');
        });
        return cells.join('\t');
      });
      text = [headerLabels.join('\t'), ...rows].join('\r\n');
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`Copied ${filteredInventory.length} rows as text`);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Loading stock summary...</div>;

  const renderHeaderCell = (col, headerLabel, style = {}) => {
    const allVals = allColumnValues[col.key] || [];
    const allUnique = [...new Set(allVals.map(v => v != null ? v : '(Blank)'))];
    const currentSelected = columnFilters[col.key] || new Set(allUnique);
    return (
      <th key={col.key} style={style}>
        <div className="gs-th-inner">
          <span>{headerLabel}</span>
          <ColumnFilterDropdown
            columnKey={col.key}
            allValues={allVals}
            selected={currentSelected}
            onApply={(sel) => applyColumnFilter(col.key, sel)}
            onClear={() => clearColumnFilter(col.key)}
          />
        </div>
      </th>
    );
  };

  const tabLabel = isCE ? 'Container Extra' : isImport ? 'Import' : 'Bulk';
  const printedAt = new Date().toLocaleString();

  return (
    <div className="stock-table-print-page">
      <div className="page-header no-print">
        <h2>Stock Summary</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {inventory.length > 0 && (
            <button className="btn btn-danger" onClick={handleDeleteAll}>
              <FiTrash2 /> Delete All Data
            </button>
          )}
          <button className="btn btn-primary" onClick={handlePrint} disabled={displayRows.length === 0} title="Print the table as shown (active tab, filters, row limit, columns)">
            <FiPrinter /> Print
          </button>
          <button className="btn btn-success" onClick={exportExcel}>
            <FiDownload /> Export to Excel
          </button>
          <button className="btn btn-outline" onClick={exportPDF} disabled={filteredInventory.length === 0}>
            <FiDownload /> Export to PDF
          </button>
        </div>
      </div>
      <div className="page-body">
        <div className="st-print-banner only-print-st">
          <h1>WMS — Stock Summary</h1>
          <p><strong>Stock type:</strong> {tabLabel}</p>
          <p><strong>Rows printed:</strong> {displayRows.length}
            {filteredInventory.length !== displayRows.length ? ` (of ${filteredInventory.length} after filters)` : ' (all matching filters)'}
            {inventory.length > 0 ? ` · Source: ${inventory.length} rows in tab` : ''}
          </p>
          <p><strong>Printed:</strong> {printedAt}</p>
        </div>

        <div className="stock-type-tabs no-print">
          {TABS.map(tab => (
            <button key={tab.id} className={`stock-type-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div className="filter-bar no-print">
          <div className="filter-bar-search-single">
            <FiSearch className="filter-bar-search-icon" />
            <input
              type="text"
              className="form-control"
              placeholder="Search all columns..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-outline btn-sm" onClick={exportAsText} disabled={filteredInventory.length === 0} title="Copy filtered table as text">
            <FiCopy /> Export as Text
          </button>
          <button
            className="btn btn-outline btn-sm"
            onClick={copyTableAsImage}
            disabled={displayRows.length === 0}
            title="Copy the visible table as a PNG (paste into Word, chat, etc.)"
          >
            <FiImage /> Copy as image
          </button>
          <div className="st-row-limit-btns">
            <span className="st-row-limit-label">Show rows:</span>
            <button className={`st-row-limit-btn ${rowLimit === 50 ? 'active' : ''}`} onClick={() => setRowLimit(50)}>50</button>
            <button className={`st-row-limit-btn ${rowLimit === 100 ? 'active' : ''}`} onClick={() => setRowLimit(100)}>100</button>
            <button className={`st-row-limit-btn ${rowLimit === 0 ? 'active' : ''}`} onClick={() => setRowLimit(0)}>All</button>
            {rowLimit > 0 && filteredInventory.length > rowLimit && (
              <span className="st-row-limit-hint">({displayRows.length} of {filteredInventory.length})</span>
            )}
          </div>
        </div>

        {activeTab === 'BULK' && (
          <div className="st-bulk-col-toggles no-print">
            <div className="st-bulk-col-left">
              <span className="st-bulk-col-label">Columns (BULK)</span>
              <span className="st-bulk-col-hint">Lines/Stack and Old/New Balance normally OFF — toggle to show</span>
            </div>
            <div className="st-bulk-col-right">
              <button
                type="button"
                className={`st-bulk-pill ${showBulkLinesPlace ? 'active' : ''}`}
                onClick={() => setShowBulkLinesPlace(v => !v)}
              >
                Lines/Place
              </button>
              <button
                type="button"
                className={`st-bulk-pill ${showBulkStackNo ? 'active' : ''}`}
                onClick={() => setShowBulkStackNo(v => !v)}
              >
                Stack No
              </button>
              <button
                type="button"
                className={`st-bulk-pill ${showBulkStackTotal ? 'active' : ''}`}
                onClick={() => setShowBulkStackTotal(v => !v)}
              >
                Stack Total
              </button>
              <button
                type="button"
                className={`st-bulk-pill ${showBulkOldBalance ? 'active' : ''}`}
                onClick={() => setShowBulkOldBalance(v => !v)}
              >
                Old Balance
              </button>
              <button
                type="button"
                className={`st-bulk-pill ${showBulkNewIncome ? 'active' : ''}`}
                onClick={() => setShowBulkNewIncome(v => !v)}
              >
                New Income
              </button>
            </div>
          </div>
        )}

        {activeTab === 'CONTAINER_EXTRA' && (
          <div className="st-bulk-col-toggles no-print">
            <div className="st-bulk-col-left">
              <span className="st-bulk-col-label">Columns (Container Extra)</span>
              <span className="st-bulk-col-hint">Normally OFF</span>
            </div>
            <div className="st-bulk-col-right">
              <button
                type="button"
                className={`st-bulk-pill ${showCElinePlace ? 'active' : ''}`}
                onClick={() => setShowCElinePlace(v => !v)}
              >
                LINE
              </button>
              <button
                type="button"
                className={`st-bulk-pill ${showCEstNo ? 'active' : ''}`}
                onClick={() => setShowCEstNo(v => !v)}
              >
                ST NO
              </button>
            </div>
          </div>
        )}

        {activeFilterCount > 0 && (
          <div className="gs-active-filters-bar">
            <span>{activeFilterCount} column filter{activeFilterCount > 1 ? 's' : ''} active</span>
            <span className="gs-filtered-count">{filteredInventory.length} of {inventory.length} rows</span>
            <button className="btn btn-outline btn-sm" onClick={handleClearAllFilters}><FiX /> Clear All Filters</button>
          </div>
        )}

        <div className="dashboard-grid no-print" style={{ marginBottom: 16 }}>
          <div className="stat-card"><div className="stat-info"><h4>Total MC</h4><div className="stat-value" style={{ fontSize: '1.3rem' }}>{totalMC.toLocaleString()}</div></div></div>
          <div className="stat-card"><div className="stat-info"><h4>Total KG</h4><div className="stat-value" style={{ fontSize: '1.3rem' }}>{totalKG.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div></div></div>
          <div className="stat-card"><div className="stat-info"><h4>Total Stacks</h4><div className="stat-value" style={{ fontSize: '1.3rem' }}>{totalStacks}</div></div></div>
        </div>

        <div className="table-container st-table-print-wrap" ref={reportContainerRef} style={{ maxHeight: '65vh', overflow: 'auto' }}>
          {isNonBulk ? (
            <table className="excel-table gs-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  {visibleColumns.map(col => renderHeaderCell(
                    col,
                    col.label != null ? col.label : (col.key === 'order_code' ? (isImport ? 'Invoice No' : 'Order') : col.key),
                    col.key === 'hand_on_balance_mc' ? { background: '#5c1a1a', color: '#f8d7da' } : {}
                  ))}
                </tr>
              </thead>
              <tbody>
                {inventory.length === 0 ? (
                  <tr><td colSpan={visibleColumns.length + 1} style={{ textAlign: 'center', padding: 60, color: '#999' }}>
                    No {isImport ? 'Import' : 'Container Extra'} stock found. Upload data via Excel Upload.
                  </td></tr>
                ) : filteredInventory.length === 0 ? (
                  <tr><td colSpan={visibleColumns.length + 1} style={{ textAlign: 'center', padding: 40, color: '#999' }}>No rows match the filters</td></tr>
                ) : displayRows.map((r, i) => (
                  <tr key={i}>
                    <td className="text-center" style={{ color: '#999' }}>{i + 1}</td>
                    {visibleColumns.map(col => {
                      const val = r[col.key];
                      const isMC = col.key === 'hand_on_balance_mc';
                      const isKg = col.key === 'bulk_weight_kg' || col.key === 'hand_on_balance_kg';
                      const isOrder = col.key === 'order_code';
                      const isLine = col.key === 'line_place';
                      const isStNo = col.key === 'st_no';
                      return (
                        <td key={col.key} className={isKg || isMC ? 'num-cell' : ''} style={isMC ? { background: '#fef2f2', fontWeight: 700, fontSize: '0.9rem' } : {}}>
                          {isOrder || isLine || isStNo ? <strong>{val ?? '-'}</strong> : isKg ? `${Number(val || 0).toFixed(0)} KG` : (val != null && val !== '' ? String(val) : '-')}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {displayRows.length > 0 && (
                <tfoot>
                  <tr>
                    <td></td>
                    {visibleColumns.map((col) => {
                      if (col.key === 'hand_on_balance_kg') {
                        return (
                          <td key={col.key} className="num-cell">
                            {visibleTotalKG.toFixed(0)} KG
                          </td>
                        );
                      }
                      if (col.key === 'hand_on_balance_mc') {
                        return (
                          <td key={col.key} className="num-cell" style={{ fontSize: '0.95rem' }}>
                            {visibleTotalMC}
                          </td>
                        );
                      }
                      if (visibleColumns[0]?.key === col.key) {
                        return (
                          <td key={col.key} style={{ textAlign: 'right', fontWeight: 700 }}>
                            TOTALS:
                          </td>
                        );
                      }
                      return <td key={col.key}></td>;
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          ) : (
            <table className="excel-table gs-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  {bulkTableColumns.map(col => renderHeaderCell(col, col.label, col.headerStyle || {}))}
                </tr>
              </thead>
              <tbody>
                {inventory.length === 0 ? (
                  <tr>
                    <td colSpan={bulkTableColumns.length + 1} style={{ textAlign: 'center', padding: 60, color: '#999' }}>
                      No stock data found. Record some Stock IN first or upload an Excel file.
                    </td>
                  </tr>
                ) : filteredInventory.length === 0 ? (
                  <tr>
                    <td colSpan={bulkTableColumns.length + 1} style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                      No rows match the filters
                    </td>
                  </tr>
                ) : displayRows.map((r, i) => (
                  <tr key={i}>
                    <td className="text-center" style={{ color: '#999' }}>{i + 1}</td>
                    {bulkTableColumns.map(col => {
                      const val = r[col.key];
                      if (col.key === 'fish_name') return <td key={col.key}><strong>{val || '-'}</strong></td>;
                      if (col.key === 'line_place') return <td key={col.key}><strong>{val || '-'}</strong></td>;
                      if (col.key === 'bulk_weight_kg') return <td key={col.key} className="num-cell">{Number(val || 0).toFixed(2)}</td>;
                      if (col.key === 'hand_on_balance_kg') return <td key={col.key} className="num-cell">{Number(val || 0).toFixed(2)}</td>;
                      if (col.key === 'stack_no' || col.key === 'stack_total') return <td key={col.key} className="num-cell">{val ?? '-'}</td>;
                      if (col.key === 'old_balance_mc') return <td key={col.key} className="num-cell" style={{ background: '#f0fdf4' }}>{val ?? 0}</td>;
                      if (col.key === 'new_income_mc') return <td key={col.key} className="num-cell" style={{ background: '#eff6ff', color: '#1d4ed8', fontWeight: 600 }}>{val ?? '-'}</td>;
                      if (col.key === 'hand_on_balance_mc') return <td key={col.key} className="num-cell" style={{ background: '#fef2f2', fontWeight: 700, fontSize: '0.9rem' }}>{val ?? 0}</td>;
                      // default rendering
                      return <td key={col.key}>{val ?? '-'}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
              {displayRows.length > 0 && bulkFirstAggregateIndex >= 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={bulkTotalsColSpan} style={{ textAlign: 'right', fontWeight: 700 }}>TOTALS:</td>
                    {bulkTableColumns.slice(bulkFirstAggregateIndex).map((col) => {
                      if (col.key === 'old_balance_mc') {
                        return (
                          <td key={col.key} className="num-cell">
                            {visibleOldBalanceSum}
                          </td>
                        );
                      }
                      if (col.key === 'new_income_mc') {
                        return (
                          <td key={col.key} className="num-cell">
                            {visibleNewIncomeSum}
                          </td>
                        );
                      }
                      if (col.key === 'hand_on_balance_mc') {
                        return (
                          <td key={col.key} className="num-cell" style={{ fontSize: '0.95rem' }}>
                            {visibleTotalMC}
                          </td>
                        );
                      }
                      if (col.key === 'hand_on_balance_kg') {
                        return (
                          <td key={col.key} className="num-cell">
                            {visibleTotalKG.toFixed(2)}
                          </td>
                        );
                      }
                      return null;
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default StockTable;
