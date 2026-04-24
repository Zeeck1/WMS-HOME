import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  FiArrowLeft, FiSave, FiPlus, FiTrash2, FiPackage, FiDollarSign,
  FiTruck, FiEdit2, FiDownload
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import {
  getImportShipment, createImportShipment, updateImportShipment,
  createImportStockOut, updateImportStockOut, deleteImportStockOut
} from '../services/api';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { registerThaiFont } from '../services/pdfFonts';
import { bangkokYYYYMMDD, dateToYYYYMMDDInBangkok, bangkokLocaleDateString } from '../utils/bangkokTime';

const toInputDate = (d) => d ? (typeof d === 'string' ? d.split('T')[0] : dateToYYYYMMDDInBangkok(d)) : '';
const fmtDate = (d) => d ? bangkokLocaleDateString(new Date(d), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const num = (v) => parseFloat(v) || 0;

/** N/W (KGS) string from MC × WET/MC (2 dp). */
function nwKgsFromMcAndWet(mcStr, wetStr) {
  if (mcStr === '' || mcStr === null || String(mcStr).trim() === '') return '';
  const m = num(mcStr);
  const w = num(wetStr);
  const n = m * w;
  if (!Number.isFinite(n)) return '';
  return String(Math.round(n * 100) / 100);
}

/** After editing wet_mc / inv_mc / factory_mc, refresh derived N/W columns. */
function itemWithDerivedNw(prev, field, val) {
  const next = { ...prev, [field]: val };
  const recalcInv = field === 'wet_mc' || field === 'inv_mc';
  const recalcFac = field === 'wet_mc' || field === 'factory_mc';
  if (recalcInv) {
    next.inv_nw_kgs = nwKgsFromMcAndWet(next.inv_mc, next.wet_mc);
  }
  if (recalcFac) {
    next.factory_nw_kgs = nwKgsFromMcAndWet(next.factory_mc, next.wet_mc);
  }
  return next;
}

// Safely evaluate simple math expressions: supports +, -, *, / and parentheses
function evalFormula(expr) {
  if (expr === '' || expr === null || expr === undefined) return 0;
  const s = String(expr).trim();
  if (!s) return 0;
  const plain = parseFloat(s);
  if (!isNaN(plain) && /^-?\d+(\.\d+)?$/.test(s)) return plain;
  if (!/^[\d\s+\-*/().]+$/.test(s)) return NaN;
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function(`"use strict"; return (${s});`)();
    return typeof result === 'number' && isFinite(result) ? result : NaN;
  } catch { return NaN; }
}

const EMPTY_ITEM = { item_name: '', size: '', pack: '', wet_mc: '', inv_mc: '', inv_nw_kgs: '', factory_mc: '', factory_nw_kgs: '', remark: '', unit_price: '', lines: '' };

const DEFAULT_EXPENSES = [
  'Freight', 'Transport Charge (THAILAND/CHACHOENGSAO)', 'Transport Charge (CHACHOENGSAO TO CK)',
  'Import DUTY', 'Customs Free', 'Customs Formality charge', 'Customs Overtime',
  'Customs Inspector', 'Fisheries', 'Fisheries Fee', 'Lift on/Lift off Charge',
  'BIO Fee', 'Demorage (ค่าวางตู้/คืนตู้)', 'Electric', 'Storage'
];

const EMPTY_EXPENSE = { expense_name: '', total_baht: '', amount_usd_kgs: '', amount_usd_kgs_expr: '' };

function ImportShipmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const handleImportBack = () => {
    if (location.state?.from === 'stock-summary') {
      navigate('/stock-table', { state: { stockSummaryTab: 'IMPORT' } });
    } else {
      navigate('/imports');
    }
  };
  const isNew = !id || id === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('stock');

  const [shipment, setShipment] = useState({
    inv_no: '', container_no: '', seal_no: '', eta: '', origin_country: '',
    production_date: '', expiry_date: '', last_update_stock: '', total_net_weight: ''
  });
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [stockOuts, setStockOuts] = useState([]);
  const [expenses, setExpenses] = useState(
    DEFAULT_EXPENSES.map(name => ({ expense_name: name, total_baht: '', amount_usd_kgs: '', amount_usd_kgs_expr: '' }))
  );

  // Stock out form
  const [outForm, setOutForm] = useState({ item_id: '', date_out: '', order_ref: '', mc: '', nw_kgs: '' });
  const [editingOut, setEditingOut] = useState(null);

  const loadData = useCallback(async () => {
    if (isNew) return;
    setLoading(true);
    try {
      const res = await getImportShipment(id);
      const d = res.data;
      setShipment({
        inv_no: d.shipment.inv_no || '',
        container_no: d.shipment.container_no || '',
        seal_no: d.shipment.seal_no || '',
        eta: toInputDate(d.shipment.eta),
        origin_country: d.shipment.origin_country || '',
        production_date: toInputDate(d.shipment.production_date),
        expiry_date: toInputDate(d.shipment.expiry_date),
        last_update_stock: d.shipment.last_update_stock || '',
        total_net_weight: d.shipment.total_net_weight || ''
      });
      setItems(d.items.length > 0 ? d.items.map(i => ({
        id: i.id, item_name: i.item_name, size: i.size, pack: i.pack,
        wet_mc: i.wet_mc || '', inv_mc: i.inv_mc || '', inv_nw_kgs: i.inv_nw_kgs || '',
        factory_mc: i.factory_mc || '', factory_nw_kgs: i.factory_nw_kgs || '',
        remark: i.remark || '', unit_price: i.unit_price || '', lines: i.lines || ''
      })) : [{ ...EMPTY_ITEM }]);
      setStockOuts(d.stockOuts || []);
      if (d.expenses.length > 0) {
        setExpenses(d.expenses.map(e => ({
          id: e.id, expense_name: e.expense_name, total_baht: e.total_baht || '',
          amount_usd_kgs: e.amount_usd_kgs || '',
          amount_usd_kgs_expr: e.amount_usd_kgs_expr || String(e.amount_usd_kgs || '')
        })));
      }
    } catch { toast.error('Failed to load shipment'); navigate('/imports'); }
    finally { setLoading(false); }
  }, [id, isNew, navigate]);

  useEffect(() => { loadData(); }, [loadData]);

  // Item handlers
  const updateItem = (idx, field, val) => setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const updateItemDerived = (idx, field, val) =>
    setItems(prev => prev.map((it, i) => (i === idx ? itemWithDerivedNw(it, field, val) : it)));
  const addItem = () => setItems(prev => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => {
    if (items.length <= 1) return;
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  // Expense handlers
  const updateExpense = (idx, field, val) => setExpenses(prev => prev.map((ex, i) => i === idx ? { ...ex, [field]: val } : ex));
  const addExpense = () => setExpenses(prev => [...prev, { ...EMPTY_EXPENSE }]);
  const removeExpense = (idx) => {
    if (expenses.length <= 1) return;
    setExpenses(prev => prev.filter((_, i) => i !== idx));
  };

  // Balance stock computation
  const getBalanceForItem = useCallback((itemRow) => {
    const itemId = itemRow.id;
    if (!itemId) return { mc: num(itemRow.factory_mc), nw: num(itemRow.factory_nw_kgs) };
    const outs = stockOuts.filter(o => o.item_id === itemId);
    const totalOutMc = outs.reduce((s, o) => s + num(o.mc), 0);
    const totalOutNw = outs.reduce((s, o) => s + num(o.nw_kgs), 0);
    return {
      mc: num(itemRow.factory_mc) - totalOutMc,
      nw: num(itemRow.factory_nw_kgs) - totalOutNw
    };
  }, [stockOuts]);

  // Group stock outs by date
  const stockOutDates = useMemo(() => {
    const dateMap = {};
    stockOuts.forEach(o => {
      const d = toInputDate(o.date_out);
      if (!dateMap[d]) dateMap[d] = [];
      dateMap[d].push(o);
    });
    return Object.entries(dateMap).sort((a, b) => a[0].localeCompare(b[0]));
  }, [stockOuts]);

  // Totals
  const totals = useMemo(() => {
    const t = { inv_mc: 0, inv_nw: 0, fac_mc: 0, fac_nw: 0, bal_mc: 0, bal_nw: 0 };
    items.forEach(it => {
      t.inv_mc += num(it.inv_mc);
      t.inv_nw += num(it.inv_nw_kgs);
      t.fac_mc += num(it.factory_mc);
      t.fac_nw += num(it.factory_nw_kgs);
      const bal = getBalanceForItem(it);
      t.bal_mc += bal.mc;
      t.bal_nw += bal.nw;
    });
    return t;
  }, [items, getBalanceForItem]);

  const expenseTotals = useMemo(() => {
    return {
      total_baht: expenses.reduce((s, e) => s + num(e.total_baht), 0),
      amount_usd_kgs: expenses.reduce((s, e) => {
        const val = evalFormula(e.amount_usd_kgs_expr || e.amount_usd_kgs);
        return s + (isNaN(val) ? 0 : val);
      }, 0)
    };
  }, [expenses]);

  const totalNetWeight = num(shipment.total_net_weight);

  const anyLinesData = useMemo(() => items.some(it => it.lines && String(it.lines).trim()), [items]);
  const [showLinesCol, setShowLinesCol] = useState(false);
  useEffect(() => { if (anyLinesData) setShowLinesCol(true); }, [anyLinesData]);
  const hasLines = showLinesCol || anyLinesData;

  /** Optional note included at bottom of Stock Items PDF only (browser localStorage per shipment). */
  const [stockPdfRemark, setStockPdfRemark] = useState('');
  useEffect(() => {
    if (!id || isNew) {
      setStockPdfRemark('');
      return;
    }
    try {
      setStockPdfRemark(localStorage.getItem(`importStockPdfRemark:${id}`) ?? '');
    } catch {
      setStockPdfRemark('');
    }
  }, [id, isNew]);
  const persistStockPdfRemark = () => {
    if (!id || isNew) return;
    try {
      localStorage.setItem(`importStockPdfRemark:${id}`, stockPdfRemark);
    } catch { /* ignore */ }
  };

  // Save
  const handleSave = async () => {
    if (!shipment.inv_no.trim()) return toast.warning('INV NO is required');
    setSaving(true);
    try {
      const processedExpenses = expenses.map(ex => {
        const evaluated = evalFormula(ex.amount_usd_kgs_expr || ex.amount_usd_kgs);
        return {
          ...ex,
          amount_usd_kgs: isNaN(evaluated) ? 0 : evaluated,
          amount_usd_kgs_expr: ex.amount_usd_kgs_expr || String(ex.amount_usd_kgs || '')
        };
      });
      const payload = { shipment, items, expenses: processedExpenses };
      if (isNew) {
        const res = await createImportShipment(payload);
        toast.success('Import created successfully');
        navigate(`/imports/${res.data.id}`);
      } else {
        await updateImportShipment(id, payload);
        toast.success('Saved successfully');
        loadData();
      }
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  // Stock out handlers
  const handleAddStockOut = async () => {
    if (!outForm.item_id || !outForm.date_out) return toast.warning('Select item and date');
    const selectedItem = items.find(it => String(it.id) === String(outForm.item_id));
    if (selectedItem) {
      const bal = getBalanceForItem(selectedItem);
      const reqMc = num(outForm.mc);
      const reqNw = num(outForm.nw_kgs);
      if (reqMc > bal.mc) return toast.error(`Insufficient MC balance. Available: ${bal.mc}, Requested: ${reqMc}`);
      if (reqNw > bal.nw) return toast.error(`Insufficient N/W balance. Available: ${bal.nw.toFixed(2)}, Requested: ${reqNw.toFixed(2)}`);
    }
    try {
      await createImportStockOut(id, outForm);
      toast.success('Stock out added');
      setOutForm({ item_id: '', date_out: '', order_ref: '', mc: '', nw_kgs: '' });
      loadData();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to add stock out'); }
  };

  const handleUpdateStockOut = async () => {
    if (!editingOut) return;
    const selectedItem = items.find(it => String(it.id) === String(editingOut.item_id));
    if (selectedItem) {
      const bal = getBalanceForItem(selectedItem);
      const origOut = stockOuts.find(o => o.id === editingOut.id);
      const availMc = bal.mc + num(origOut?.mc);
      const availNw = bal.nw + num(origOut?.nw_kgs);
      const reqMc = num(editingOut.mc);
      const reqNw = num(editingOut.nw_kgs);
      if (reqMc > availMc) return toast.error(`Insufficient MC balance. Available: ${availMc}, Requested: ${reqMc}`);
      if (reqNw > availNw) return toast.error(`Insufficient N/W balance. Available: ${availNw.toFixed(2)}, Requested: ${reqNw.toFixed(2)}`);
    }
    try {
      await updateImportStockOut(editingOut.id, {
        date_out: editingOut.date_out, order_ref: editingOut.order_ref,
        mc: editingOut.mc, nw_kgs: editingOut.nw_kgs
      });
      toast.success('Updated');
      setEditingOut(null);
      loadData();
    } catch (err) { toast.error(err.response?.data?.error || 'Update failed'); }
  };

  const handleDeleteStockOut = async (outId) => {
    if (!window.confirm('Delete this stock out record?')) return;
    try {
      await deleteImportStockOut(outId);
      toast.success('Deleted');
      loadData();
    } catch { toast.error('Delete failed'); }
  };

  // ─── Export helpers ──────────────────────────────────────────────────────
  const dateStr = () => bangkokYYYYMMDD();
  const invLabel = shipment.inv_no || 'New';

  const exportStockItemsExcel = () => {
    const wb = XLSX.utils.book_new();
    const stockData = items.filter(it => it.item_name).map((it, i) => {
      const bal = getBalanceForItem(it);
      const row = { 'No.': i + 1, 'ITEM': it.item_name, 'SIZE': it.size };
      if (hasLines) row['LINES'] = it.lines || '';
      Object.assign(row, {
        'PACK': it.pack, 'WET/MC': num(it.wet_mc),
        'INV MC': num(it.inv_mc), 'INV N/W (KGS)': num(it.inv_nw_kgs),
        'FACTORY MC': num(it.factory_mc), 'FACTORY N/W (KGS)': num(it.factory_nw_kgs),
        'BALANCE MC': bal.mc, 'BALANCE N/W (KGS)': bal.nw,
        'REMARK': it.remark, 'UNIT PRICE': num(it.unit_price)
      });
      return row;
    });
    const totalRow = { 'No.': '', 'ITEM': 'TOTAL', 'SIZE': '' };
    if (hasLines) totalRow['LINES'] = '';
    Object.assign(totalRow, {
      'PACK': '', 'WET/MC': '',
      'INV MC': totals.inv_mc, 'INV N/W (KGS)': totals.inv_nw,
      'FACTORY MC': totals.fac_mc, 'FACTORY N/W (KGS)': totals.fac_nw,
      'BALANCE MC': totals.bal_mc, 'BALANCE N/W (KGS)': totals.bal_nw,
      'REMARK': '', 'UNIT PRICE': ''
    });
    stockData.push(totalRow);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(stockData), 'Stock Items');

    // Sheet 2: Expenses
    const expData = expenses.filter(e => e.expense_name).map((e, i) => {
      const val = evalFormula(e.amount_usd_kgs_expr || e.amount_usd_kgs);
      return {
        'No.': i + 1, 'DETAILS OF EXPENSES': e.expense_name,
        'TOTAL (฿)': num(e.total_baht), 'AMOUNT (USD/KGS.)': isNaN(val) ? 0 : val
      };
    });
    expData.push({ 'No.': '', 'DETAILS OF EXPENSES': 'Total Amount Import Expenses:', 'TOTAL (฿)': expenseTotals.total_baht, 'AMOUNT (USD/KGS.)': expenseTotals.amount_usd_kgs });
    if (totalNetWeight > 0) {
      expData.push({ 'No.': '', 'DETAILS OF EXPENSES': 'Total Amount Import Expenses/Kg:', 'TOTAL (฿)': +(expenseTotals.total_baht / totalNetWeight).toFixed(2), 'AMOUNT (USD/KGS.)': +(expenseTotals.amount_usd_kgs / totalNetWeight).toFixed(4) });
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expData), 'Expenses');
    XLSX.writeFile(wb, `Import_Stock_${invLabel}_${dateStr()}.xlsx`);
  };

  /** Renders header + meta + stock table + remark on `pdf` (landscape). Caller must create doc and register fonts. */
  const renderStockItemsPdfContent = async (pdf) => {
    const fontOpts = { font: 'Sarabun' };

    const margin = 10;
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const contentW = pageW - 2 * margin;

    const PDF_MAIN_TITLE = 'Stock - CK TH (Chachoengsao)';
    const titleGreen = [5, 150, 105];
    const slate900 = [15, 23, 42];
    const slate500 = [100, 116, 139];
    const slate200 = [226, 232, 240];
    const slate50 = [248, 250, 252];

    let y = margin;
    pdf.setTextColor(...titleGreen);
    pdf.setFont('Sarabun', 'bold');
    pdf.setFontSize(14);
    pdf.text(PDF_MAIN_TITLE, pageW / 2, y + 5, { align: 'center' });
    y += 10;

    const metaPad = 4;
    const metaRowH = 12;
    const metaBoxH = metaPad * 2 + metaRowH * 2 + 1;
    pdf.setDrawColor(...slate200);
    pdf.setLineWidth(0.2);
    pdf.setFillColor(...slate50);
    pdf.roundedRect(margin, y, contentW, metaBoxH, 2.5, 2.5, 'FD');

    const drawMetaLabelValue = (x, rowY, cellW, label, value) => {
      const display = (value && String(value).trim()) ? String(value) : '—';
      pdf.setFont('Sarabun', 'normal');
      pdf.setFontSize(6.2);
      pdf.setTextColor(...slate500);
      pdf.text(label, x + 3, rowY + 4);
      pdf.setFont('Sarabun', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(...slate900);
      const lines = pdf.splitTextToSize(display, cellW - 6);
      let ly = rowY + 8.5;
      lines.forEach((ln) => {
        pdf.text(ln, x + 3, ly);
        ly += 3.6;
      });
    };

    const col4 = contentW / 4;
    const col3 = contentW / 3;
    const r1 = y + metaPad;
    const r2 = r1 + metaRowH;
    drawMetaLabelValue(margin, r1, col4, 'INV NO', shipment.inv_no);
    drawMetaLabelValue(margin + col4, r1, col4, 'CONTAINER NO', shipment.container_no);
    drawMetaLabelValue(margin + col4 * 2, r1, col4, 'SEAL NO', shipment.seal_no);
    drawMetaLabelValue(margin + col4 * 3, r1, col4, 'ETA', fmtDate(shipment.eta));
    drawMetaLabelValue(margin, r2, col3, 'FROM', shipment.origin_country);
    drawMetaLabelValue(margin + col3, r2, col3, 'PRODUCTION DATE', fmtDate(shipment.production_date));
    drawMetaLabelValue(margin + col3 * 2, r2, col3, 'EXPIRY DATE', fmtDate(shipment.expiry_date));

    pdf.setDrawColor(...slate200);
    pdf.setLineWidth(0.12);
    const metaBottom = y + metaBoxH;
    for (let c = 1; c <= 3; c += 1) {
      pdf.line(margin + col4 * c, y + 2, margin + col4 * c, r2 - 1.5);
    }
    for (let c = 1; c <= 2; c += 1) {
      pdf.line(margin + col3 * c, r2 + 1, margin + col3 * c, metaBottom - 2);
    }
    pdf.line(margin + 2, r2 - 1, margin + contentW - 2, r2 - 1);

    y += metaBoxH + 7;
    pdf.setTextColor(...slate900);

    const hPurple = {
      fillColor: [79, 70, 229],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
    };
    const hInv = { fillColor: [219, 234, 254], textColor: [30, 64, 175], fontStyle: 'bold', halign: 'center', valign: 'middle', fontSize: 6.5 };
    const hFac = { fillColor: [209, 250, 229], textColor: [4, 120, 87], fontStyle: 'bold', halign: 'center', valign: 'middle', fontSize: 6.5 };
    const hBal = { fillColor: [254, 226, 226], textColor: [185, 28, 28], fontStyle: 'bold', halign: 'center', valign: 'middle', fontSize: 6.5 };

    const baseCols = hasLines ? 6 : 5;
    const headRow0 = [
      { content: 'No.', rowSpan: 2, styles: hPurple },
      { content: 'ITEM', rowSpan: 2, styles: { ...hPurple, halign: 'left' } },
      { content: 'SIZE', rowSpan: 2, styles: { ...hPurple, halign: 'left' } },
    ];
    if (hasLines) headRow0.push({ content: 'LINES', rowSpan: 2, styles: { ...hPurple, halign: 'left' } });
    headRow0.push(
      { content: 'PACK', rowSpan: 2, styles: { ...hPurple, halign: 'left' } },
      { content: 'WET/MC', rowSpan: 2, styles: hPurple },
      { content: 'TOTAL FROM INV.', colSpan: 2, styles: hInv },
      { content: 'TOTAL FACTORY REC.', colSpan: 2, styles: hFac },
      { content: 'BALANCE STOCK', colSpan: 2, styles: hBal },
      { content: 'REMARK', rowSpan: 2, styles: { ...hPurple, halign: 'left' } },
      { content: 'UNIT PRICE', rowSpan: 2, styles: hPurple }
    );

    const headRow1 = [
      { content: 'MC', styles: hInv },
      { content: 'N/W QTY (KGS)', styles: hInv },
      { content: 'MC', styles: hFac },
      { content: 'N/W QTY (KGS)', styles: hFac },
      { content: 'MC', styles: hBal },
      { content: 'N/W QTY (KGS)', styles: hBal },
    ];

    const body = items.filter(it => it.item_name).map((it, i) => {
      const bal = getBalanceForItem(it);
      const row = [String(i + 1), it.item_name || '', it.size || ''];
      if (hasLines) row.push(it.lines || '');
      row.push(
        it.pack || '',
        num(it.wet_mc).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        String(num(it.inv_mc)),
        num(it.inv_nw_kgs).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        String(num(it.factory_mc)),
        num(it.factory_nw_kgs).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        String(bal.mc),
        bal.nw.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        it.remark || '',
        num(it.unit_price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      );
      return row;
    });

    const foot = [[
      {
        content: 'TOTAL',
        colSpan: baseCols,
        styles: {
          fontStyle: 'bold',
          halign: 'right',
          fillColor: [248, 250, 252],
          textColor: [15, 23, 42],
        },
      },
      String(totals.inv_mc),
      totals.inv_nw.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      String(totals.fac_mc),
      totals.fac_nw.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      String(totals.bal_mc),
      totals.bal_nw.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      '',
      '',
    ]];

    const invBg = [239, 246, 255];
    const facBg = [236, 253, 245];
    const balBg = [254, 242, 242];

    autoTable(pdf, {
      startY: y,
      head: [headRow0, headRow1],
      body,
      foot,
      theme: 'grid',
      styles: {
        fontSize: 6.8,
        cellPadding: { top: 1.4, bottom: 1.4, left: 1.6, right: 1.6 },
        lineColor: [226, 232, 240],
        lineWidth: 0.1,
        textColor: [15, 23, 42],
        ...fontOpts,
      },
      headStyles: { fontStyle: 'bold', ...fontOpts },
      footStyles: {
        fontStyle: 'bold',
        fillColor: [241, 245, 249],
        textColor: [15, 23, 42],
        ...fontOpts,
      },
      showHead: 'everyPage',
      showFoot: 'lastPage',
      horizontalPageBreak: true,
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        data.cell.styles.font = 'Sarabun';
        if (data.section === 'head') return;
        const ci = data.column.index;
        const remarkCol = baseCols + 6;
        const priceCol = baseCols + 7;
        const packCol = hasLines ? 4 : 3;
        const wetCol = hasLines ? 5 : 4;
        if (data.section === 'body' || data.section === 'foot') {
          if (ci >= baseCols && ci <= baseCols + 1) data.cell.styles.fillColor = invBg;
          else if (ci >= baseCols + 2 && ci <= baseCols + 3) data.cell.styles.fillColor = facBg;
          else if (ci >= baseCols + 4 && ci <= baseCols + 5) data.cell.styles.fillColor = balBg;

          if (ci === 0) data.cell.styles.halign = 'center';
          else if (ci === 1 || ci === 2 || (hasLines && ci === 3) || ci === packCol || ci === remarkCol) data.cell.styles.halign = 'left';
          else if (ci === wetCol || (ci >= baseCols && ci <= baseCols + 5) || ci === priceCol) data.cell.styles.halign = 'right';
          else data.cell.styles.halign = 'left';

          if (ci >= baseCols && ci <= baseCols + 5 && data.section === 'foot') data.cell.styles.fontStyle = 'bold';
        }
      },
    });

    const remarkText = (stockPdfRemark || '').trim();
    if (remarkText) {
      let ry = (pdf.lastAutoTable?.finalY || y) + 8;
      pdf.setFont('Sarabun', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(15, 23, 42);
      pdf.text('Remark', margin, ry);
      ry += 5;
      pdf.setFont('Sarabun', 'normal');
      pdf.setFontSize(8);
      const lines = pdf.splitTextToSize(remarkText, contentW);
      const lineH = 4;
      lines.forEach((line) => {
        if (ry > pageH - margin - 8) {
          pdf.addPage();
          ry = margin + 6;
        }
        pdf.text(line, margin, ry);
        ry += lineH;
      });
    }
  };

  /** Portrait appendix: expenses table + totals (matches Expenses tab data). */
  const renderExpensesAppendixPdf = (pdf) => {
    pdf.addPage('a4', 'portrait');
    const fontOpts = { font: 'Sarabun' };
    const margin = 14;
    const pageW = pdf.internal.pageSize.getWidth();
    const contentW = pageW - 2 * margin;

    const PDF_MAIN_TITLE = 'Stock - CK TH (Chachoengsao)';
    const titleGreen = [5, 150, 105];
    const emerald = [16, 185, 129];
    const slate900 = [15, 23, 42];
    const slate500 = [100, 116, 139];
    const slate200 = [226, 232, 240];
    const slate50 = [248, 250, 252];

    let y = margin;
    const barH = 11;
    pdf.setFillColor(...emerald);
    pdf.roundedRect(margin, y, contentW, barH, 2, 2, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('Sarabun', 'bold');
    pdf.setFontSize(12.5);
    pdf.text('EXPENSES — SHIPPING IMPORT', pageW / 2, y + 7.5, { align: 'center' });
    y += barH + 4;
    pdf.setFont('Sarabun', 'bold');
    pdf.setFontSize(7.5);
    pdf.setTextColor(...titleGreen);
    pdf.text(PDF_MAIN_TITLE, pageW / 2, y, { align: 'center' });
    y += 6;

    const metaPad = 3;
    const metaRowH = 11;
    const metaBoxH = metaPad * 2 + metaRowH * 2 + 1;
    pdf.setDrawColor(...slate200);
    pdf.setLineWidth(0.2);
    pdf.setFillColor(...slate50);
    pdf.roundedRect(margin, y, contentW, metaBoxH, 2.5, 2.5, 'FD');

    const drawField = (x, rowY, cellW, label, value) => {
      const display = (value !== undefined && value !== null && String(value).trim() !== '') ? String(value) : '—';
      pdf.setFont('Sarabun', 'normal');
      pdf.setFontSize(6);
      pdf.setTextColor(...slate500);
      pdf.text(label, x + 3, rowY + 4);
      pdf.setFont('Sarabun', 'bold');
      pdf.setFontSize(8);
      pdf.setTextColor(...slate900);
      const lines = pdf.splitTextToSize(display, cellW - 6);
      let ly = rowY + 8;
      lines.forEach((ln) => {
        pdf.text(ln, x + 3, ly);
        ly += 3.5;
      });
    };

    const col4 = contentW / 4;
    const col2 = contentW / 2;
    const r1 = y + metaPad;
    const r2 = r1 + metaRowH;
    drawField(margin, r1, col4, 'INV NO', shipment.inv_no);
    drawField(margin + col4, r1, col4, 'CONTAINER NO', shipment.container_no);
    drawField(margin + col4 * 2, r1, col4, 'SEAL NO', shipment.seal_no);
    drawField(margin + col4 * 3, r1, col4, 'ETA', fmtDate(shipment.eta));
    drawField(margin, r2, col2, 'FROM', shipment.origin_country);
    drawField(margin + col2, r2, col2, 'TOTAL NET WEIGHT (KGS)', totalNetWeight > 0 ? totalNetWeight.toFixed(2) : '—');

    const metaBottom = y + metaBoxH;
    pdf.setDrawColor(...slate200);
    pdf.setLineWidth(0.12);
    for (let c = 1; c <= 3; c += 1) {
      pdf.line(margin + col4 * c, y + 2, margin + col4 * c, r2 - 1.5);
    }
    pdf.line(margin + col2, r2 + 1, margin + col2, metaBottom - 2);
    pdf.line(margin + 2, r2 - 1, margin + contentW - 2, r2 - 1);

    y += metaBoxH + 8;
    pdf.setTextColor(...slate900);

    const dataRows = expenses.filter(e => e.expense_name).map((e, i) => {
      const val = evalFormula(e.amount_usd_kgs_expr || e.amount_usd_kgs);
      return [
        String(i + 1),
        e.expense_name || '',
        num(e.total_baht).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        (isNaN(val) ? 0 : val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 }),
      ];
    });
    const summaryStart = dataRows.length;
    const body = [...dataRows];
    body.push(['', `Total Net Weight: ${totalNetWeight.toFixed(2)} KGS`, '', '']);
    body.push(['', 'Total Amount Import Expenses:', expenseTotals.total_baht.toFixed(2), expenseTotals.amount_usd_kgs.toFixed(4)]);
    if (totalNetWeight > 0) {
      body.push([
        '',
        'Total Amount Import Expenses/Kg:',
        (expenseTotals.total_baht / totalNetWeight).toFixed(2),
        (expenseTotals.amount_usd_kgs / totalNetWeight).toFixed(4),
      ]);
    }

    const sumFill = [236, 253, 245];
    autoTable(pdf, {
      startY: y,
      head: [['No.', 'DETAILS OF EXPENSES', 'TOTAL (฿)', 'AMOUNT (USD/KGS.)']],
      body,
      theme: 'grid',
      styles: {
        fontSize: 8,
        cellPadding: { top: 2.2, bottom: 2.2, left: 3, right: 3 },
        lineColor: slate200,
        lineWidth: 0.1,
        textColor: slate900,
        ...fontOpts,
      },
      headStyles: {
        fillColor: emerald,
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        ...fontOpts,
      },
      columnStyles: {
        0: { halign: 'center', cellWidth: 14 },
        1: { halign: 'left' },
        2: { halign: 'right' },
        3: { halign: 'right' },
      },
      alternateRowStyles: { fillColor: [252, 252, 253] },
      margin: { left: margin, right: margin },
      didParseCell: (data) => {
        data.cell.styles.font = 'Sarabun';
        if (data.section === 'body' && data.row.index >= summaryStart) {
          data.cell.styles.fontStyle = 'bold';
          data.cell.styles.fillColor = sumFill;
          data.cell.styles.textColor = slate900;
        }
      },
    });
  };

  const exportStockItemsPDF = async () => {
    persistStockPdfRemark();
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await registerThaiFont(pdf);
    await renderStockItemsPdfContent(pdf);
    pdf.save(`Import_Stock_${invLabel}_${dateStr()}.pdf`);
  };

  const exportStockItemsWithExpensesPDF = async () => {
    persistStockPdfRemark();
    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    await registerThaiFont(pdf);
    await renderStockItemsPdfContent(pdf);
    renderExpensesAppendixPdf(pdf);
    pdf.save(`Import_Stock_with_Expenses_${invLabel}_${dateStr()}.pdf`);
  };

  const exportStockOutExcel = () => {
    if (stockOuts.length === 0) return;
    const data = stockOuts.map((o, i) => {
      const item = items.find(it => it.id === o.item_id);
      return {
        '#': i + 1, 'DATE OUT': fmtDate(o.date_out), 'ITEM': item?.item_name || '', 'ORDER': o.order_ref,
        'MC': num(o.mc), 'N/W QTY (KGS)': num(o.nw_kgs)
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Stock Out');
    XLSX.writeFile(wb, `Import_StockOut_${invLabel}_${dateStr()}.xlsx`);
  };

  const exportStockOutPDF = async () => {
    if (stockOuts.length === 0) return;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    await registerThaiFont(pdf);
    const fontOpts = { font: 'Sarabun' };

    pdf.setFontSize(14);
    pdf.text(`Stock OUT — ${invLabel}`, 14, 15);
    const body = stockOuts.map((o, i) => {
      const item = items.find(it => it.id === o.item_id);
      return [i + 1, fmtDate(o.date_out), item?.item_name || '', o.order_ref, num(o.mc), num(o.nw_kgs).toFixed(2)];
    });
    autoTable(pdf, {
      startY: 22,
      head: [['#', 'DATE OUT', 'ITEM', 'ORDER', 'MC', 'N/W QTY (KGS)']],
      body,
      styles: { fontSize: 8, cellPadding: 2, ...fontOpts },
      headStyles: { fillColor: [245, 158, 11], ...fontOpts }
    });
    pdf.save(`Import_StockOut_${invLabel}_${dateStr()}.pdf`);
  };

  const exportExpensesExcel = () => {
    const data = expenses.filter(e => e.expense_name).map((e, i) => {
      const val = evalFormula(e.amount_usd_kgs_expr || e.amount_usd_kgs);
      return {
        'No.': i + 1, 'DETAILS OF EXPENSES': e.expense_name,
        'TOTAL (฿)': num(e.total_baht), 'AMOUNT (USD/KGS.)': isNaN(val) ? 0 : val
      };
    });
    data.push({ 'No.': '', 'DETAILS OF EXPENSES': `Total Net Weight: ${totalNetWeight.toFixed(2)} KGS`, 'TOTAL (฿)': '', 'AMOUNT (USD/KGS.)': '' });
    data.push({ 'No.': '', 'DETAILS OF EXPENSES': 'Total Amount Import Expenses:', 'TOTAL (฿)': expenseTotals.total_baht, 'AMOUNT (USD/KGS.)': expenseTotals.amount_usd_kgs });
    if (totalNetWeight > 0) {
      data.push({ 'No.': '', 'DETAILS OF EXPENSES': 'Total Amount Import Expenses/Kg:', 'TOTAL (฿)': +(expenseTotals.total_baht / totalNetWeight).toFixed(2), 'AMOUNT (USD/KGS.)': +(expenseTotals.amount_usd_kgs / totalNetWeight).toFixed(4) });
    }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Expenses');
    XLSX.writeFile(wb, `Import_Expenses_${invLabel}_${dateStr()}.xlsx`);
  };

  const exportExpensesPDF = async () => {
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    await registerThaiFont(pdf);
    const fontOpts = { font: 'Sarabun' };

    pdf.setFontSize(14);
    pdf.text('EXPENSES — SHIPPING IMPORT', 14, 15);
    pdf.setFontSize(9);
    pdf.text(`INV NO: ${shipment.inv_no}  |  DATE: ${shipment.eta}  |  Container: ${shipment.container_no}  |  Seal: ${shipment.seal_no}  |  From: ${shipment.origin_country}`, 14, 22);
    const body = expenses.filter(e => e.expense_name).map((e, i) => {
      const val = evalFormula(e.amount_usd_kgs_expr || e.amount_usd_kgs);
      return [i + 1, e.expense_name, num(e.total_baht).toFixed(2), (isNaN(val) ? 0 : val).toFixed(2)];
    });
    body.push(['', 'Total Net Weight: ' + totalNetWeight.toFixed(2) + ' KGS', '', '']);
    body.push(['', 'Total Amount Import Expenses:', expenseTotals.total_baht.toFixed(2), expenseTotals.amount_usd_kgs.toFixed(2)]);
    if (totalNetWeight > 0) {
      body.push(['', 'Total Amount Import Expenses/Kg:', (expenseTotals.total_baht / totalNetWeight).toFixed(2), (expenseTotals.amount_usd_kgs / totalNetWeight).toFixed(4)]);
    }
    autoTable(pdf, {
      startY: 26,
      head: [['No.', 'DETAILS OF EXPENSES', 'TOTAL (฿)', 'AMOUNT (USD/KGS.)']],
      body,
      styles: { fontSize: 8, cellPadding: 2, ...fontOpts },
      headStyles: { fillColor: [16, 185, 129], ...fontOpts }
    });
    pdf.save(`Import_Expenses_${invLabel}_${dateStr()}.pdf`);
  };

  if (loading) return <div className="imp-page"><div className="imp-loading">Loading...</div></div>;

  return (
    <div className="imp-page">
      {/* Header */}
      <div className="imp-detail-header">
        <button className="imp-btn imp-btn-ghost" onClick={handleImportBack}>
          <FiArrowLeft /> Back
        </button>
        <h2>{isNew ? 'Create New Import' : `STOCK — ${shipment.inv_no}`}</h2>
        <div className="imp-detail-header-actions">
          {shipment.last_update_stock && (
            <span className="imp-last-update">
              Last Update: {fmtDate(shipment.last_update_stock)}
            </span>
          )}
          <button className="imp-btn imp-btn-primary" onClick={handleSave} disabled={saving}>
            <FiSave /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Shipment Header Fields */}
      <div className="imp-card imp-info-card">
        <div className="imp-info-grid">
          <div className="imp-field">
            <label>INV NO</label>
            <input value={shipment.inv_no} onChange={e => setShipment(s => ({ ...s, inv_no: e.target.value }))} placeholder="e.g. 122&16-12-2025" />
          </div>
          <div className="imp-field">
            <label>CONTAINER NO</label>
            <input value={shipment.container_no} onChange={e => setShipment(s => ({ ...s, container_no: e.target.value }))} placeholder="e.g. OOLU6215370" />
          </div>
          <div className="imp-field">
            <label>SEAL NO</label>
            <input value={shipment.seal_no} onChange={e => setShipment(s => ({ ...s, seal_no: e.target.value }))} placeholder="e.g. OOLKST7063" />
          </div>
          <div className="imp-field">
            <label>ETA</label>
            <input type="date" value={shipment.eta} onChange={e => setShipment(s => ({ ...s, eta: e.target.value }))} />
          </div>
          <div className="imp-field">
            <label>FROM</label>
            <input value={shipment.origin_country} onChange={e => setShipment(s => ({ ...s, origin_country: e.target.value }))} placeholder="e.g. INDIA" />
          </div>
          <div className="imp-field">
            <label>PRODUCTION DATE</label>
            <input type="date" value={shipment.production_date} onChange={e => setShipment(s => ({ ...s, production_date: e.target.value }))} />
          </div>
          <div className="imp-field">
            <label>EXPIRY DATE</label>
            <input type="date" value={shipment.expiry_date} onChange={e => setShipment(s => ({ ...s, expiry_date: e.target.value }))} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="imp-tabs">
        <button className={`imp-tab ${activeTab === 'stock' ? 'active' : ''}`} onClick={() => setActiveTab('stock')}>
          <FiPackage /> Stock Items
        </button>
        {!isNew && (
          <button className={`imp-tab ${activeTab === 'out' ? 'active' : ''}`} onClick={() => setActiveTab('out')}>
            <FiTruck /> Stock OUT
          </button>
        )}
        <button className={`imp-tab ${activeTab === 'expenses' ? 'active' : ''}`} onClick={() => setActiveTab('expenses')}>
          <FiDollarSign /> Expenses
        </button>
      </div>

      {/* Stock Items Tab */}
      {activeTab === 'stock' && (
        <div className="imp-card">
          <div className="imp-card-header">
            <h3><FiPackage /> Stock Items</h3>
            <div className="imp-card-header-actions">
              <button
                className={`imp-btn imp-btn-sm ${hasLines ? 'imp-btn-primary' : 'imp-btn-ghost'}`}
                onClick={() => setShowLinesCol(v => !v)}
                title={hasLines ? 'Hide Lines column' : 'Show Lines column'}
              >
                {hasLines ? 'Lines ✓' : '+ Lines'}
              </button>
              {!isNew && (
                <>
                  <button className="imp-btn imp-btn-sm imp-btn-ghost" onClick={exportStockItemsExcel} title="Export Stock Items + Expenses to Excel">
                    <FiDownload /> Excel
                  </button>
                  <button className="imp-btn imp-btn-sm imp-btn-ghost" onClick={exportStockItemsPDF} title="Export Stock Items table to PDF (no Stock OUT / expenses)">
                    <FiDownload /> PDF
                  </button>
                  <button
                    className="imp-btn imp-btn-sm imp-btn-ghost"
                    onClick={exportStockItemsWithExpensesPDF}
                    title="Download PDF: Stock Items then Expenses on a new page"
                  >
                    <FiDownload /> Download with Expenses
                  </button>
                </>
              )}
              <button className="imp-btn imp-btn-sm imp-btn-primary" onClick={addItem}>
                <FiPlus /> Add Row
              </button>
            </div>
          </div>
          <div className="imp-table-wrap">
            <table className="imp-table imp-stock-table">
              <thead>
                <tr>
                  <th rowSpan="2" className="imp-th-center">No.</th>
                  <th rowSpan="2">ITEM</th>
                  <th rowSpan="2">SIZE</th>
                  {hasLines && <th rowSpan="2">LINES</th>}
                  <th rowSpan="2">PACK</th>
                  <th rowSpan="2" className="imp-th-center">WET/MC</th>
                  <th colSpan="2" className="imp-th-group imp-th-inv">TOTAL FROM INV.</th>
                  <th colSpan="2" className="imp-th-group imp-th-fac">TOTAL FACTORY REC.</th>
                  <th colSpan="2" className="imp-th-group imp-th-bal">BALANCE STOCK</th>
                  <th rowSpan="2">REMARK</th>
                  <th rowSpan="2" className="imp-th-center">UNIT PRICE</th>
                  {stockOutDates.map(([date]) => (
                    <th colSpan="3" className="imp-th-group imp-th-out" key={date}>
                      DATE OUT: {fmtDate(date)}
                    </th>
                  ))}
                  <th rowSpan="2" className="imp-th-center">
                    <FiTrash2 />
                  </th>
                </tr>
                <tr>
                  <th className="imp-th-inv">MC</th>
                  <th className="imp-th-inv">N/W QTY (KGS)</th>
                  <th className="imp-th-fac">MC</th>
                  <th className="imp-th-fac">N/W QTY (KGS)</th>
                  <th className="imp-th-bal">MC</th>
                  <th className="imp-th-bal">N/W QTY (KGS)</th>
                  {stockOutDates.map(([date]) => (
                    <React.Fragment key={date}>
                      <th className="imp-th-out">ORDER</th>
                      <th className="imp-th-out">MC</th>
                      <th className="imp-th-out">N/W QTY (KGS)</th>
                    </React.Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((it, idx) => {
                  const bal = getBalanceForItem(it);
                  return (
                    <tr key={idx}>
                      <td className="imp-cell-center">{idx + 1}</td>
                      <td><input className="imp-cell-input imp-cell-wide" value={it.item_name} onChange={e => updateItem(idx, 'item_name', e.target.value)} placeholder="Item name" /></td>
                      <td><input className="imp-cell-input" value={it.size} onChange={e => updateItem(idx, 'size', e.target.value)} placeholder="Size" /></td>
                      {hasLines && <td><input className="imp-cell-input" value={it.lines || ''} onChange={e => updateItem(idx, 'lines', e.target.value)} placeholder="Lines" /></td>}
                      <td><input className="imp-cell-input imp-cell-wide" value={it.pack} onChange={e => updateItem(idx, 'pack', e.target.value)} placeholder="Pack info" /></td>
                      <td><input className="imp-cell-input imp-cell-num" type="number" step="any" value={it.wet_mc} onChange={e => updateItemDerived(idx, 'wet_mc', e.target.value)} title="N/W = MC × WET/MC" /></td>
                      <td className="imp-td-inv"><input className="imp-cell-input imp-cell-num" type="number" step="any" value={it.inv_mc} onChange={e => updateItemDerived(idx, 'inv_mc', e.target.value)} title="N/W QTY = INV MC × WET/MC" /></td>
                      <td className="imp-td-inv"><input className="imp-cell-input imp-cell-num" type="number" step="0.01" value={it.inv_nw_kgs} onChange={e => updateItem(idx, 'inv_nw_kgs', e.target.value)} title="Auto from INV MC × WET/MC; editable if needed" /></td>
                      <td className="imp-td-fac"><input className="imp-cell-input imp-cell-num" type="number" step="any" value={it.factory_mc} onChange={e => updateItemDerived(idx, 'factory_mc', e.target.value)} title="N/W QTY = FACTORY MC × WET/MC" /></td>
                      <td className="imp-td-fac"><input className="imp-cell-input imp-cell-num" type="number" step="0.01" value={it.factory_nw_kgs} onChange={e => updateItem(idx, 'factory_nw_kgs', e.target.value)} title="Auto from FACTORY MC × WET/MC; editable if needed" /></td>
                      <td className={`imp-td-bal ${bal.mc < num(it.factory_mc) ? 'imp-bal-reduced' : ''}`}>
                        <span className="imp-bal-val">{bal.mc}</span>
                      </td>
                      <td className={`imp-td-bal ${bal.nw < num(it.factory_nw_kgs) ? 'imp-bal-reduced' : ''}`}>
                        <span className="imp-bal-val">{bal.nw.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                      </td>
                      <td><input className="imp-cell-input" value={it.remark} onChange={e => updateItem(idx, 'remark', e.target.value)} /></td>
                      <td><input className="imp-cell-input imp-cell-num" type="number" step="0.01" value={it.unit_price} onChange={e => updateItem(idx, 'unit_price', e.target.value)} /></td>
                      {stockOutDates.map(([date, outs]) => {
                        const itemOuts = outs
                          .filter(o => o.item_id === it.id)
                          .sort((a, b) => (a.id || 0) - (b.id || 0));
                        return (
                          <React.Fragment key={date}>
                            <td className="imp-td-out imp-td-out-multi">
                              <div className="imp-out-date-stack">
                                {itemOuts.map((o) => (
                                  <div key={o.id} className="imp-out-date-line imp-out-line-order">
                                    {o.order_ref != null && String(o.order_ref).trim() !== '' ? o.order_ref : '—'}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="imp-td-out imp-td-out-multi">
                              <div className="imp-out-date-stack">
                                {itemOuts.map((o) => (
                                  <div key={o.id} className="imp-out-date-line">
                                    {num(o.mc)}
                                  </div>
                                ))}
                              </div>
                            </td>
                            <td className="imp-td-out imp-td-out-multi">
                              <div className="imp-out-date-stack">
                                {itemOuts.map((o) => (
                                  <div key={o.id} className="imp-out-date-line">
                                    {num(o.nw_kgs).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </React.Fragment>
                        );
                      })}
                      <td className="imp-cell-center">
                        <button className="imp-row-delete" onClick={() => removeItem(idx)} title="Remove row">
                          <FiTrash2 />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {/* Totals row */}
                <tr className="imp-total-row">
                  <td colSpan={hasLines ? 6 : 5} className="imp-total-label">TOTAL</td>
                  <td className="imp-td-inv imp-total-val">{totals.inv_mc}</td>
                  <td className="imp-td-inv imp-total-val">{totals.inv_nw.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="imp-td-fac imp-total-val">{totals.fac_mc}</td>
                  <td className="imp-td-fac imp-total-val">{totals.fac_nw.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="imp-td-bal imp-total-val">{totals.bal_mc}</td>
                  <td className="imp-td-bal imp-total-val">{totals.bal_nw.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td colSpan="2"></td>
                  {stockOutDates.map(([date, outs]) => {
                    const totalMc = outs.reduce((s, o) => s + num(o.mc), 0);
                    const totalNw = outs.reduce((s, o) => s + num(o.nw_kgs), 0);
                    return (
                      <React.Fragment key={date}>
                        <td className="imp-td-out"></td>
                        <td className="imp-td-out imp-total-val">{totalMc}</td>
                        <td className="imp-td-out imp-total-val">{totalNw.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                      </React.Fragment>
                    );
                  })}
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          {!isNew && (
            <div className="imp-stock-pdf-remark">
              <label htmlFor="imp-stock-pdf-remark">Remark (PDF)</label>
              <textarea
                id="imp-stock-pdf-remark"
                value={stockPdfRemark}
                onChange={e => setStockPdfRemark(e.target.value)}
                onBlur={persistStockPdfRemark}
                placeholder="Optional notes — included below the table when you download Stock Items PDF."
                rows={3}
              />
            </div>
          )}
        </div>
      )}

      {/* Stock OUT Tab */}
      {activeTab === 'out' && !isNew && (
        <div className="imp-card">
          <div className="imp-card-header">
            <h3><FiTruck /> Stock OUT Records</h3>
            {stockOuts.length > 0 && (
              <div className="imp-card-header-actions">
                <button className="imp-btn imp-btn-sm imp-btn-ghost" onClick={exportStockOutExcel} title="Export Stock Out to Excel">
                  <FiDownload /> Excel
                </button>
                <button className="imp-btn imp-btn-sm imp-btn-ghost" onClick={exportStockOutPDF} title="Export Stock Out to PDF">
                  <FiDownload /> PDF
                </button>
              </div>
            )}
          </div>

          {/* Add stock out form */}
          <div className="imp-out-form">
            <h4>{editingOut ? 'Edit Stock Out' : 'Add Stock Out'}</h4>
            <div className="imp-out-form-grid">
              {!editingOut && (
                <div className="imp-field">
                  <label>Item</label>
                  <select
                    value={outForm.item_id}
                    onChange={(e) => {
                      const item_id = e.target.value;
                      setOutForm((f) => {
                        const item = items.find((i) => String(i.id) === String(item_id));
                        let nw_kgs = '';
                        if (item && f.mc !== '' && String(f.mc).trim() !== '') {
                          nw_kgs = nwKgsFromMcAndWet(f.mc, item.wet_mc);
                        }
                        return { ...f, item_id, nw_kgs };
                      });
                    }}
                  >
                    <option value="">-- Select Item --</option>
                    {items.filter(i => i.id).map(i => (
                      <option key={i.id} value={i.id}>{i.item_name}</option>
                    ))}
                  </select>
                </div>
              )}
              <div className="imp-field">
                <label>Date Out</label>
                <input
                  type="date"
                  value={editingOut ? toInputDate(editingOut.date_out) : outForm.date_out}
                  onChange={e => editingOut
                    ? setEditingOut(o => ({ ...o, date_out: e.target.value }))
                    : setOutForm(f => ({ ...f, date_out: e.target.value }))}
                />
              </div>
              <div className="imp-field">
                <label>Order Ref</label>
                <input
                  value={editingOut ? editingOut.order_ref : outForm.order_ref}
                  onChange={e => editingOut
                    ? setEditingOut(o => ({ ...o, order_ref: e.target.value }))
                    : setOutForm(f => ({ ...f, order_ref: e.target.value }))}
                  placeholder="e.g. RAT.01"
                />
              </div>
              <div className="imp-field">
                <label>MC</label>
                <input
                  type="number"
                  step="any"
                  value={editingOut ? editingOut.mc : outForm.mc}
                  onChange={(e) => {
                    const mc = e.target.value;
                    if (editingOut) {
                      setEditingOut((o) => {
                        const item = items.find((it) => String(it.id) === String(o.item_id));
                        const nw_kgs = item ? nwKgsFromMcAndWet(mc, item.wet_mc) : o.nw_kgs;
                        return { ...o, mc, nw_kgs };
                      });
                    } else {
                      setOutForm((f) => {
                        const item = items.find((i) => String(i.id) === String(f.item_id));
                        const nw_kgs = item ? nwKgsFromMcAndWet(mc, item.wet_mc) : f.nw_kgs;
                        return { ...f, mc, nw_kgs };
                      });
                    }
                  }}
                  title="N/W QTY = MC × item WET/MC"
                />
              </div>
              <div className="imp-field">
                <label>N/W Quantity (KGS)</label>
                <input
                  type="number" step="0.01"
                  value={editingOut ? editingOut.nw_kgs : outForm.nw_kgs}
                  onChange={e => editingOut
                    ? setEditingOut(o => ({ ...o, nw_kgs: e.target.value }))
                    : setOutForm(f => ({ ...f, nw_kgs: e.target.value }))}
                />
              </div>
            </div>
            <div className="imp-out-form-actions">
              {editingOut ? (
                <>
                  <button className="imp-btn imp-btn-primary" onClick={handleUpdateStockOut}><FiSave /> Update</button>
                  <button className="imp-btn imp-btn-ghost" onClick={() => setEditingOut(null)}>Cancel</button>
                </>
              ) : (
                <button className="imp-btn imp-btn-primary" onClick={handleAddStockOut}><FiPlus /> Add Stock Out</button>
              )}
            </div>
          </div>

          {/* Stock out history table */}
          {stockOuts.length > 0 && (
            <div className="imp-table-wrap" style={{ marginTop: 16 }}>
              <table className="imp-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>DATE OUT</th>
                    <th>ITEM</th>
                    <th>ORDER</th>
                    <th>MC</th>
                    <th>N/W QTY (KGS)</th>
                    <th>ACTIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {stockOuts.map((o, i) => {
                    const item = items.find(it => it.id === o.item_id);
                    return (
                      <tr key={o.id}>
                        <td>{i + 1}</td>
                        <td>{fmtDate(o.date_out)}</td>
                        <td>{item?.item_name || `Item #${o.item_id}`}</td>
                        <td>{o.order_ref}</td>
                        <td className="imp-cell-right">{o.mc}</td>
                        <td className="imp-cell-right">{num(o.nw_kgs).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                        <td>
                          <div className="imp-actions">
                            <button className="imp-action-btn imp-action-edit" onClick={() => setEditingOut({ ...o, date_out: toInputDate(o.date_out) })}>
                              <FiEdit2 />
                            </button>
                            <button className="imp-action-btn imp-action-delete" onClick={() => handleDeleteStockOut(o.id)}>
                              <FiTrash2 />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {stockOuts.length === 0 && (
            <div className="imp-empty-sm">No stock out records yet.</div>
          )}
        </div>
      )}

      {/* Expenses Tab */}
      {activeTab === 'expenses' && (
        <div className="imp-card">
          <div className="imp-card-header">
            <h3><FiDollarSign /> Expenses — Shipping Import</h3>
            <div className="imp-card-header-actions">
              {!isNew && (
                <>
                  <button className="imp-btn imp-btn-sm imp-btn-ghost" onClick={exportExpensesExcel} title="Export Expenses to Excel">
                    <FiDownload /> Excel
                  </button>
                  <button className="imp-btn imp-btn-sm imp-btn-ghost" onClick={exportExpensesPDF} title="Export Expenses to PDF">
                    <FiDownload /> PDF
                  </button>
                </>
              )}
              <button className="imp-btn imp-btn-sm imp-btn-primary" onClick={addExpense}>
                <FiPlus /> Add Row
              </button>
            </div>
          </div>

          {/* Expense info header */}
          <div className="imp-expense-info">
            <div className="imp-expense-info-row">
              <span className="imp-expense-label">INV NO:</span>
              <span>{shipment.inv_no || '-'}</span>
            </div>
            <div className="imp-expense-info-row">
              <span className="imp-expense-label">DATE:</span>
              <span>{shipment.eta ? fmtDate(shipment.eta) : '-'}</span>
            </div>
            <div className="imp-expense-info-row">
              <span className="imp-expense-label">CONTAINER NO:</span>
              <span>{shipment.container_no || '-'}</span>
            </div>
            <div className="imp-expense-info-row">
              <span className="imp-expense-label">SEAL NO:</span>
              <span>{shipment.seal_no || '-'}</span>
            </div>
            <div className="imp-expense-info-row">
              <span className="imp-expense-label">IMPORT FROM:</span>
              <span className="imp-origin-badge">{shipment.origin_country || '-'}</span>
            </div>
          </div>

          <div className="imp-table-wrap">
            <table className="imp-table imp-expense-table">
              <thead>
                <tr>
                  <th className="imp-th-center" style={{ width: 40 }}>No.</th>
                  <th>DETAILS OF EXPENSES</th>
                  <th className="imp-th-center" style={{ width: 150 }}>TOTAL(฿)</th>
                  <th className="imp-th-center" style={{ width: 150 }}>AMOUNT (USD/KGS.)</th>
                  <th className="imp-th-center" style={{ width: 50 }}><FiTrash2 /></th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((ex, idx) => {
                  const expr = ex.amount_usd_kgs_expr || String(ex.amount_usd_kgs || '');
                  const evaluated = evalFormula(expr);
                  const isFormula = expr && /[+\-*/()]/.test(expr) && !isNaN(evaluated);
                  return (
                    <tr key={idx}>
                      <td className="imp-cell-center">{idx + 1}</td>
                      <td>
                        <input className="imp-cell-input imp-cell-wide" value={ex.expense_name}
                          onChange={e => updateExpense(idx, 'expense_name', e.target.value)}
                          placeholder="Expense name" />
                      </td>
                      <td>
                        <input className="imp-cell-input imp-cell-num" type="number" step="0.01"
                          value={ex.total_baht} onChange={e => updateExpense(idx, 'total_baht', e.target.value)} />
                      </td>
                      <td>
                        <div className="imp-formula-cell">
                          <input className="imp-cell-input imp-cell-num" value={expr}
                            onChange={e => updateExpense(idx, 'amount_usd_kgs_expr', e.target.value)}
                            placeholder="e.g. 30*20" />
                          {isFormula && (
                            <span className="imp-formula-result">= {evaluated.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                          )}
                        </div>
                      </td>
                      <td className="imp-cell-center">
                        <button className="imp-row-delete" onClick={() => removeExpense(idx)} title="Remove row">
                          <FiTrash2 />
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {/* Totals */}
                <tr className="imp-total-row">
                  <td></td>
                  <td className="imp-total-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    Total Net Weight:
                    <input className="imp-cell-input imp-cell-num" type="number" step="0.01"
                      style={{ maxWidth: 120, fontWeight: 700 }}
                      value={shipment.total_net_weight}
                      onChange={e => setShipment(s => ({ ...s, total_net_weight: e.target.value }))}
                      placeholder="0.00" />
                    KGS
                  </td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
                <tr className="imp-total-row imp-grand-total">
                  <td></td>
                  <td className="imp-total-label">Total Amount Import Expenses:</td>
                  <td className="imp-total-val imp-total-highlight">{expenseTotals.total_baht.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td className="imp-total-val imp-total-highlight">{expenseTotals.amount_usd_kgs.toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                  <td></td>
                </tr>
                <tr className="imp-total-row imp-grand-total">
                  <td></td>
                  <td className="imp-total-label">Total Amount Import Expenses/Kg:</td>
                  <td className="imp-total-val imp-total-highlight">
                    {totalNetWeight > 0 ? (expenseTotals.total_baht / totalNetWeight).toFixed(2) : '0.00'}
                  </td>
                  <td className="imp-total-val imp-total-highlight">
                    {totalNetWeight > 0 ? (expenseTotals.amount_usd_kgs / totalNetWeight).toFixed(4) : '0.00'}
                  </td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default ImportShipmentDetail;
