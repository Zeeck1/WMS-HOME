import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  FiArrowLeft, FiCheckCircle, FiAlertCircle, FiAlertTriangle,
  FiSearch, FiDownload, FiPackage, FiBox, FiFile,
  FiChevronDown, FiChevronUp, FiX, FiClipboard,
  FiFilter, FiPrinter, FiLoader, FiFileText
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getOacCheck } from '../services/api';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const STATUS_CONFIG = {
  FULL: { label: 'Full', cls: 'oacr-st-full', icon: <FiCheckCircle />, desc: 'Ready to fulfill' },
  NOT_FULL: { label: 'Not Full', cls: 'oacr-st-notfull', icon: <FiAlertTriangle />, desc: 'Partial stock' },
  NOT_HAVE: { label: 'Not Have', cls: 'oacr-st-nothave', icon: <FiAlertCircle />, desc: 'Need to store' }
};

const FILTER_TABS = [
  { id: 'ALL', label: 'All' },
  { id: 'FULL', label: 'Full' },
  { id: 'NOT_FULL', label: 'Not Full' },
  { id: 'NOT_HAVE', label: 'Not Have' }
];

function shortFileName(name) {
  if (!name) return name;
  const parts = name.split('_');
  if (parts.length >= 3) return parts.slice(1, -1).join('_');
  return name;
}

function OACResult() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    getOacCheck(id)
      .then(res => {
        setData(res.data);
        setError(null);
      })
      .catch(err => {
        setError(err.response?.data?.error || 'Failed to load check results');
      })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="oacr-empty">
        <div className="oacr-empty-inner">
          <FiLoader style={{ fontSize: '2.5rem', color: 'var(--primary)', animation: 'oac-spin 1s linear infinite' }} />
          <h3>Loading results...</h3>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="oacr-empty">
        <div className="oacr-empty-inner">
          <FiClipboard style={{ fontSize: '3rem', color: 'var(--gray-300)' }} />
          <h3>{error || 'No results to display'}</h3>
          <p>Please run an availability check first.</p>
          <button className="btn btn-primary" onClick={() => navigate('/oac')}>
            <FiArrowLeft /> Go to Order Checker
          </button>
        </div>
      </div>
    );
  }

  const { summary, fileSummaries, results, checkedAt } = data;

  return (
    <OACResultInner
      summary={summary}
      fileSummaries={fileSummaries}
      results={results}
      checkedAt={checkedAt}
      navigate={navigate}
    />
  );
}

function OACResultInner({ summary, fileSummaries, results, checkedAt, navigate }) {
  const [activeFilter, setActiveFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: null, dir: 'asc' });
  const [groupByFile, setGroupByFile] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  const checkedTime = checkedAt ? new Date(checkedAt) : new Date();
  const timeStr = checkedTime.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });

  const filteredResults = useMemo(() => results.filter(r => {
    if (activeFilter !== 'ALL' && r.status !== activeFilter) return false;
    if (searchTerm) {
      const t = searchTerm.toLowerCase();
      return (
        r.product.toLowerCase().includes(t) ||
        r.orderFile.toLowerCase().includes(t) ||
        (r.matchedProduct || '').toLowerCase().includes(t) ||
        (r.pack || '').toLowerCase().includes(t) ||
        (r.origin || '').toLowerCase().includes(t)
      );
    }
    return true;
  }), [results, activeFilter, searchTerm]);

  const sortedResults = useMemo(() => {
    const arr = [...filteredResults];
    if (!sortConfig.key) return arr;
    return arr.sort((a, b) => {
      let va = a[sortConfig.key];
      let vb = b[sortConfig.key];
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1;
      if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredResults, sortConfig]);

  const grouped = useMemo(() => {
    if (!groupByFile) return null;
    const map = new Map();
    for (const r of sortedResults) {
      if (!map.has(r.orderFile)) map.set(r.orderFile, []);
      map.get(r.orderFile).push(r);
    }
    return map;
  }, [sortedResults, groupByFile]);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc'
    }));
  };

  const toggleGroup = useCallback((name) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const renderSortIcon = (key) => {
    if (sortConfig.key !== key) return <FiChevronDown className="oacr-sort-dim" />;
    return sortConfig.dir === 'asc' ? <FiChevronUp /> : <FiChevronDown />;
  };

  const fmtNum = (v, dec = 0) => {
    if (!v || v === 0) return '-';
    return v.toLocaleString(undefined, { maximumFractionDigits: dec });
  };

  const totalOrderedCtn = results.reduce((s, r) => s + r.orderedCtn, 0);
  const totalOrderedKg = results.reduce((s, r) => s + r.orderedKg, 0);
  const totalShortageCtn = results.reduce((s, r) => s + r.shortageCtn, 0);
  const totalShortageKg = results.reduce((s, r) => s + r.shortageKg, 0);

  const fullPct = summary.totalItems > 0 ? Math.round((summary.full / summary.totalItems) * 100) : 0;
  const notFullPct = summary.totalItems > 0 ? Math.round((summary.notFull / summary.totalItems) * 100) : 0;
  const notHavePct = summary.totalItems > 0 ? 100 - fullPct - notFullPct : 0;

  const exportToExcel = useCallback(() => {
    if (results.length === 0) return;

    const data = results.map((r, i) => ({
      'No': i + 1,
      'Order File': shortFileName(r.orderFile),
      'Sheet': r.orderSheet,
      'Product': r.product,
      'Pack': r.pack,
      'Weight/MC': r.weightMc,
      'Ordered CTN': r.orderedCtn,
      'Ordered KG': r.orderedKg,
      'Stock CTN': r.stockMc,
      'Stock KG': r.stockKg,
      'Available CTN': r.availableCtn,
      'Available KG': r.availableKg,
      'Shortage CTN': r.shortageCtn,
      'Shortage KG': r.shortageKg,
      'Status': STATUS_CONFIG[r.status]?.label || r.status,
      'Origin': r.origin || '-',
      'Matched Stock': r.matchedProduct || '-',
      'Remark': r.remark
    }));

    const summaryData = [
      { 'Metric': 'Checked At', 'Value': timeStr },
      { 'Metric': 'Total Files', 'Value': summary.totalFiles },
      { 'Metric': 'Total Items', 'Value': summary.totalItems },
      { 'Metric': 'Full', 'Value': summary.full },
      { 'Metric': 'Not Full', 'Value': summary.notFull },
      { 'Metric': 'Not Have', 'Value': summary.notHave },
      { 'Metric': 'Total Ordered CTN', 'Value': totalOrderedCtn },
      { 'Metric': 'Total Ordered KG', 'Value': totalOrderedKg },
      { 'Metric': 'Total Shortage CTN', 'Value': totalShortageCtn },
      { 'Metric': 'Total Shortage KG', 'Value': totalShortageKg },
      {},
      ...fileSummaries.map(f => ({
        'Metric': f.fileName,
        'Value': `${f.totalItems} items — Full: ${f.full}, Not Full: ${f.notFull}, Not Have: ${f.notHave}`
      }))
    ];

    const wb = XLSX.utils.book_new();

    const wsDetail = XLSX.utils.json_to_sheet(data);
    wsDetail['!cols'] = [
      { wch: 4 }, { wch: 25 }, { wch: 20 }, { wch: 40 }, { wch: 30 },
      { wch: 10 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 12 },
      { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 13 }, { wch: 10 },
      { wch: 40 }, { wch: 20 }
    ];
    XLSX.utils.book_append_sheet(wb, wsDetail, 'All Results');

    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    wsSummary['!cols'] = [{ wch: 25 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

    for (const [status, sheetName] of [['FULL', 'Full'], ['NOT_FULL', 'Not Full'], ['NOT_HAVE', 'Not Have']]) {
      const items = results.filter(r => r.status === status).map((r, i) => ({
        'No': i + 1, 'Order File': shortFileName(r.orderFile), 'Product': r.product,
        'Pack': r.pack, 'Ordered CTN': r.orderedCtn, 'Ordered KG': r.orderedKg,
        ...(status !== 'NOT_HAVE' ? { 'Available CTN': r.availableCtn, 'Available KG': r.availableKg } : {}),
        ...(status === 'NOT_FULL' ? { 'Shortage CTN': r.shortageCtn, 'Shortage KG': r.shortageKg } : {}),
        ...(status === 'FULL' ? { 'Stock CTN': r.stockMc, 'Stock KG': r.stockKg } : {}),
        'Origin': r.origin || '-',
        'Remark': r.remark
      }));
      if (items.length > 0) {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(items), sheetName);
      }
    }

    const ts = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `OAC_Results_${ts}.xlsx`);
    toast.success('Exported to Excel');
  }, [results, summary, fileSummaries, timeStr, totalOrderedCtn, totalOrderedKg, totalShortageCtn, totalShortageKg]);

  const handlePrint = () => window.print();

  // --- PDF Export ---
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const pdfRef = useRef(null);

  useEffect(() => {
    if (!pdfMenuOpen) return;
    const close = (e) => { if (pdfRef.current && !pdfRef.current.contains(e.target)) setPdfMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [pdfMenuOpen]);

  const exportToPdf = useCallback((mode) => {
    setPdfMenuOpen(false);
    if (results.length === 0) return;

    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw = doc.internal.pageSize.getWidth();
    const fmtN = (v, dec = 0) => (!v || v === 0) ? '-' : v.toLocaleString(undefined, { maximumFractionDigits: dec });
    const statusLabel = (s) => ({ FULL: 'Full', NOT_FULL: 'Not Full', NOT_HAVE: 'Not Have' }[s] || s);
    const statusColor = (s) => {
      if (s === 'FULL') return { fillColor: [39, 174, 96], textColor: [255, 255, 255] };
      if (s === 'NOT_FULL') return { fillColor: [243, 156, 18], textColor: [255, 255, 255] };
      return { fillColor: [231, 76, 60], textColor: [255, 255, 255] };
    };

    const drawOverview = (startY = 15) => {
      let y = startY;
      doc.setFontSize(16);
      doc.setFont(undefined, 'bold');
      doc.text('OAC Result', 14, y);
      doc.setFontSize(9);
      doc.setFont(undefined, 'normal');
      doc.setTextColor(100);
      doc.text(`Checked: ${timeStr}`, pw - 14, y, { align: 'right' });
      doc.setTextColor(0);
      y += 10;

      const boxW = (pw - 28 - 18) / 4;
      const statsData = [
        { label: 'Files', value: String(summary.totalFiles), color: [52, 73, 94] },
        { label: 'Full', value: `${summary.full} (${fullPct}%)`, color: [39, 174, 96] },
        { label: 'Not Full', value: `${summary.notFull} (${notFullPct}%)`, color: [243, 156, 18] },
        { label: 'Not Have', value: `${summary.notHave} (${notHavePct}%)`, color: [231, 76, 60] },
      ];
      for (let i = 0; i < 4; i++) {
        const x = 14 + i * (boxW + 6);
        doc.setFillColor(...statsData[i].color);
        doc.roundedRect(x, y, boxW, 18, 2, 2, 'F');
        doc.setTextColor(255);
        doc.setFontSize(13);
        doc.setFont(undefined, 'bold');
        doc.text(statsData[i].value, x + boxW / 2, y + 9, { align: 'center' });
        doc.setFontSize(7);
        doc.setFont(undefined, 'normal');
        doc.text(statsData[i].label, x + boxW / 2, y + 15, { align: 'center' });
      }
      doc.setTextColor(0);
      y += 24;

      const totals = [
        { label: 'Ordered CTN', value: totalOrderedCtn.toLocaleString(), danger: false },
        { label: 'Ordered KG', value: fmtN(totalOrderedKg, 2), danger: false },
        { label: 'Shortage CTN', value: totalShortageCtn > 0 ? totalShortageCtn.toLocaleString() : '0', danger: true },
        { label: 'Shortage KG', value: totalShortageKg > 0 ? fmtN(totalShortageKg, 2) : '0', danger: true },
      ];
      for (let i = 0; i < 4; i++) {
        const x = 14 + i * (boxW + 6);
        doc.setDrawColor(totals[i].danger ? 231 : 200, totals[i].danger ? 76 : 200, totals[i].danger ? 60 : 200);
        doc.roundedRect(x, y, boxW, 12, 2, 2, 'S');
        doc.setFontSize(6);
        doc.setTextColor(120);
        doc.text(totals[i].label, x + 3, y + 4.5);
        doc.setFontSize(9);
        doc.setTextColor(totals[i].danger ? 200 : 0, totals[i].danger ? 50 : 0, totals[i].danger ? 50 : 0);
        doc.setFont(undefined, 'bold');
        doc.text(totals[i].value, x + 3, y + 10);
        doc.setFont(undefined, 'normal');
      }
      doc.setTextColor(0);
      doc.setDrawColor(0);
      y += 18;

      if (fileSummaries.length > 1) {
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text('Per-File Breakdown', 14, y);
        y += 5;
        doc.setFont(undefined, 'normal');
        doc.setFontSize(7);
        for (const fs of fileSummaries) {
          doc.setTextColor(60);
          doc.text(
            `${shortFileName(fs.fileName)}  —  ${fs.totalItems} items  |  Full: ${fs.full}  |  Not Full: ${fs.notFull}  |  Not Have: ${fs.notHave}`,
            16, y
          );
          y += 4.5;
        }
        doc.setTextColor(0);
        y += 4;
      }
      return y;
    };

    if (mode === 'summary') {
      const y = drawOverview();
      const head = [['#', 'File', 'Product', 'Pack', 'Ord CTN', 'Ord KG', 'Stk CTN', 'Stk KG', 'Avl CTN', 'Avl KG', 'Sht CTN', 'Sht KG', 'Status', 'Origin', 'Matched', 'Remark']];
      const body = results.map((r, i) => [
        i + 1, shortFileName(r.orderFile), r.product, r.pack || '-',
        fmtN(r.orderedCtn), fmtN(r.orderedKg, 2), fmtN(r.stockMc), fmtN(r.stockKg, 2),
        fmtN(r.availableCtn), fmtN(r.availableKg, 2),
        r.shortageCtn > 0 ? fmtN(r.shortageCtn) : '-', r.shortageKg > 0 ? fmtN(r.shortageKg, 2) : '-',
        statusLabel(r.status), r.origin || '-', r.matchedProduct || '-', r.remark || '-'
      ]);

      autoTable(doc, {
        startY: y,
        head, body,
        theme: 'grid',
        styles: { fontSize: 6, cellPadding: 1.5, overflow: 'linebreak' },
        headStyles: { fillColor: [44, 62, 80], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 6 },
        columnStyles: {
          0: { cellWidth: 7, halign: 'center' },
          1: { cellWidth: 18 }, 2: { cellWidth: 32 }, 3: { cellWidth: 22 },
          4: { cellWidth: 13, halign: 'right' }, 5: { cellWidth: 13, halign: 'right' },
          6: { cellWidth: 13, halign: 'right' }, 7: { cellWidth: 13, halign: 'right' },
          8: { cellWidth: 13, halign: 'right' }, 9: { cellWidth: 13, halign: 'right' },
          10: { cellWidth: 12, halign: 'right' }, 11: { cellWidth: 12, halign: 'right' },
          12: { cellWidth: 15, halign: 'center' }, 13: { cellWidth: 22 }, 14: { cellWidth: 26 }, 15: { cellWidth: 15 },
        },
        didParseCell: (data) => {
          if (data.section === 'body' && data.column.index === 12) {
            const row = results[data.row.index];
            if (row) Object.assign(data.cell.styles, statusColor(row.status), { fontStyle: 'bold' });
          }
        },
        margin: { left: 14, right: 14 },
      });

    } else {
      drawOverview();

      const byFile = new Map();
      for (const r of results) {
        if (!byFile.has(r.orderFile)) byFile.set(r.orderFile, []);
        byFile.get(r.orderFile).push(r);
      }

      const head = [['#', 'Product', 'Pack', 'Ord CTN', 'Ord KG', 'Stk CTN', 'Stk KG', 'Avl CTN', 'Avl KG', 'Sht CTN', 'Sht KG', 'Status', 'Origin', 'Matched', 'Remark']];
      const mL = 10, mR = 10;
      const tW = pw - mL - mR;

      for (const [fileName, rows] of byFile.entries()) {
        doc.addPage('a4', 'landscape');
        const fs = fileSummaries.find(f => f.fileName === fileName);
        let y = 15;

        doc.setFontSize(13);
        doc.setFont(undefined, 'bold');
        doc.text(`Order: ${shortFileName(fileName)}`, mL, y);
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(100);
        if (fs) {
          doc.text(
            `${rows.length} items  |  Full: ${fs.full}  |  Not Full: ${fs.notFull}  |  Not Have: ${fs.notHave}`,
            mL, y + 6
          );
        }
        doc.setTextColor(0);
        y += 14;

        const totOrdCtn = rows.reduce((s, r) => s + r.orderedCtn, 0);
        const totOrdKg  = rows.reduce((s, r) => s + r.orderedKg, 0);
        const totAvlCtn = rows.reduce((s, r) => s + r.availableCtn, 0);
        const totAvlKg  = rows.reduce((s, r) => s + r.availableKg, 0);
        const totShtCtn = rows.reduce((s, r) => s + r.shortageCtn, 0);
        const totShtKg  = rows.reduce((s, r) => s + r.shortageKg, 0);

        const body = rows.map((r, i) => [
          i + 1, r.product, r.pack || '-',
          fmtN(r.orderedCtn), fmtN(r.orderedKg, 2), fmtN(r.stockMc), fmtN(r.stockKg, 2),
          fmtN(r.availableCtn), fmtN(r.availableKg, 2),
          r.shortageCtn > 0 ? fmtN(r.shortageCtn) : '-', r.shortageKg > 0 ? fmtN(r.shortageKg, 2) : '-',
          statusLabel(r.status), r.origin || '-', r.matchedProduct || '-', r.remark || '-'
        ]);

        const foot = [['', 'TOTAL', '',
          fmtN(totOrdCtn), fmtN(totOrdKg, 2), '', '',
          fmtN(totAvlCtn), fmtN(totAvlKg, 2),
          totShtCtn > 0 ? fmtN(totShtCtn) : '-', totShtKg > 0 ? fmtN(totShtKg, 2) : '-',
          '', '', '', ''
        ]];

        autoTable(doc, {
          startY: y,
          head, body, foot,
          tableWidth: tW,
          theme: 'grid',
          styles: { fontSize: 7, cellPadding: 1.8, overflow: 'linebreak' },
          headStyles: { fillColor: [44, 62, 80], textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 7 },
          footStyles: { fillColor: [240, 240, 240], textColor: [30, 30, 30], fontStyle: 'bold', fontSize: 7 },
          columnStyles: {
            0: { halign: 'center' },
            3: { halign: 'right' }, 4: { halign: 'right' },
            5: { halign: 'right' }, 6: { halign: 'right' },
            7: { halign: 'right' }, 8: { halign: 'right' },
            9: { halign: 'right' }, 10: { halign: 'right' },
            11: { halign: 'center' },
          },
          didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === 11) {
              const row = rows[data.row.index];
              if (row) Object.assign(data.cell.styles, statusColor(row.status), { fontStyle: 'bold' });
            }
          },
          margin: { left: mL, right: mR },
        });
      }
    }

    const ts = new Date().toISOString().slice(0, 10);
    doc.save(`OAC_${mode === 'summary' ? 'Summary' : 'OrderByOrder'}_${ts}.pdf`);
    toast.success('PDF exported');
  }, [results, summary, fileSummaries, timeStr, fullPct, notFullPct, notHavePct, totalOrderedCtn, totalOrderedKg, totalShortageCtn, totalShortageKg]);

  const renderRow = (r, i, showFile = true) => {
    const cfg = STATUS_CONFIG[r.status];
    return (
      <tr key={i} className={`oacr-row ${cfg.cls}`}>
        <td className="oacr-td-idx">{i + 1}</td>
        {showFile && <td className="oacr-td-file" title={r.orderFile}>{shortFileName(r.orderFile)}</td>}
        <td className="oacr-td-product" title={r.product}>{r.product}</td>
        <td className="oacr-td-pack" title={r.pack}>{r.pack || '-'}</td>
        <td className="oacr-td-num">{fmtNum(r.orderedCtn)}</td>
        <td className="oacr-td-num">{fmtNum(r.orderedKg, 2)}</td>
        <td className="oacr-td-num oacr-c-stock">{fmtNum(r.stockMc)}</td>
        <td className="oacr-td-num oacr-c-stock">{fmtNum(r.stockKg, 2)}</td>
        <td className="oacr-td-num oacr-c-avail">{fmtNum(r.availableCtn)}</td>
        <td className="oacr-td-num oacr-c-avail">{fmtNum(r.availableKg, 2)}</td>
        <td className="oacr-td-num oacr-c-short">{r.shortageCtn > 0 ? fmtNum(r.shortageCtn) : '-'}</td>
        <td className="oacr-td-num oacr-c-short">{r.shortageKg > 0 ? fmtNum(r.shortageKg, 2) : '-'}</td>
        <td><span className={`oacr-badge ${cfg.cls}`}>{cfg.icon} {cfg.label}</span></td>
        <td className="oacr-td-origin" title={r.origin || ''}>{r.origin || '-'}</td>
        <td className="oacr-td-match" title={r.matchedProduct || ''}>{r.matchedProduct || <em className="oacr-nomatch">No match</em>}</td>
        <td className="oacr-td-remark" title={r.remark}>{r.remark || '-'}</td>
      </tr>
    );
  };

  const renderTableHead = (showFile = true) => (
    <thead>
      <tr>
        <th className="oacr-th-idx">#</th>
        {showFile && (
          <th className="oacr-th-sort" onClick={() => handleSort('orderFile')}>
            Order File {renderSortIcon('orderFile')}
          </th>
        )}
        <th className="oacr-th-sort" onClick={() => handleSort('product')}>
          Product {renderSortIcon('product')}
        </th>
        <th>Pack</th>
        <th className="oacr-th-num oacr-th-sort" onClick={() => handleSort('orderedCtn')}>
          Order CTN {renderSortIcon('orderedCtn')}
        </th>
        <th className="oacr-th-num">Order KG</th>
        <th className="oacr-th-num oacr-th-sort" onClick={() => handleSort('stockMc')}>
          Stock CTN {renderSortIcon('stockMc')}
        </th>
        <th className="oacr-th-num">Stock KG</th>
        <th className="oacr-th-num">Avail CTN</th>
        <th className="oacr-th-num">Avail KG</th>
        <th className="oacr-th-num oacr-th-sort" onClick={() => handleSort('shortageCtn')}>
          Short CTN {renderSortIcon('shortageCtn')}
        </th>
        <th className="oacr-th-num">Short KG</th>
        <th className="oacr-th-sort" onClick={() => handleSort('status')}>
          Status {renderSortIcon('status')}
        </th>
        <th className="oacr-th-sort" onClick={() => handleSort('origin')}>
          Origin {renderSortIcon('origin')}
        </th>
        <th>Matched Stock</th>
        <th>Remark</th>
      </tr>
    </thead>
  );

  return (
    <>
      <div className="oacr-topbar">
        <button className="oacr-back" onClick={() => navigate('/oac')}>
          <FiArrowLeft /> Back
        </button>
        <div className="oacr-topbar-center">
          <h2><FiClipboard /> OAC Result</h2>
          <span className="oacr-timestamp">{timeStr}</span>
        </div>
        <div className="oacr-topbar-actions">
          <button className="btn btn-outline btn-sm" onClick={handlePrint}><FiPrinter /> Print</button>
          <button className="btn btn-primary btn-sm" onClick={exportToExcel}><FiDownload /> Export</button>
        </div>
      </div>

      <div className="oacr-body">
        {/* Overview row */}
        <div className="oacr-overview">
          <div className="oacr-donut-card">
            <svg viewBox="0 0 120 120" className="oacr-donut">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--gray-100)" strokeWidth="12" />
              {fullPct > 0 && (
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--success)" strokeWidth="12"
                  strokeDasharray={`${fullPct * 3.267} ${326.7 - fullPct * 3.267}`}
                  strokeDashoffset="81.675" strokeLinecap="round" />
              )}
              {notFullPct > 0 && (
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--warning)" strokeWidth="12"
                  strokeDasharray={`${notFullPct * 3.267} ${326.7 - notFullPct * 3.267}`}
                  strokeDashoffset={81.675 - fullPct * 3.267} strokeLinecap="round" />
              )}
              {notHavePct > 0 && (
                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--danger)" strokeWidth="12"
                  strokeDasharray={`${notHavePct * 3.267} ${326.7 - notHavePct * 3.267}`}
                  strokeDashoffset={81.675 - (fullPct + notFullPct) * 3.267} strokeLinecap="round" />
              )}
              <text x="60" y="55" textAnchor="middle" className="oacr-donut-num">{summary.totalItems}</text>
              <text x="60" y="72" textAnchor="middle" className="oacr-donut-label">items</text>
            </svg>
            <div className="oacr-donut-legend">
              <div className="oacr-legend-item"><span className="oacr-dot oacr-dot-full" />{summary.full} Full ({fullPct}%)</div>
              <div className="oacr-legend-item"><span className="oacr-dot oacr-dot-notfull" />{summary.notFull} Not Full ({notFullPct}%)</div>
              <div className="oacr-legend-item"><span className="oacr-dot oacr-dot-nothave" />{summary.notHave} Not Have ({notHavePct}%)</div>
            </div>
          </div>

          <div className="oacr-stats">
            <div className="oacr-stat oacr-stat-total">
              <FiPackage className="oacr-stat-icon" />
              <div className="oacr-stat-val">{summary.totalFiles}</div>
              <div className="oacr-stat-lbl">Files</div>
            </div>
            <div className="oacr-stat oacr-stat-full" onClick={() => setActiveFilter('FULL')}>
              <FiCheckCircle className="oacr-stat-icon" />
              <div className="oacr-stat-val">{summary.full}</div>
              <div className="oacr-stat-lbl">Full</div>
            </div>
            <div className="oacr-stat oacr-stat-notfull" onClick={() => setActiveFilter('NOT_FULL')}>
              <FiAlertTriangle className="oacr-stat-icon" />
              <div className="oacr-stat-val">{summary.notFull}</div>
              <div className="oacr-stat-lbl">Not Full</div>
            </div>
            <div className="oacr-stat oacr-stat-nothave" onClick={() => setActiveFilter('NOT_HAVE')}>
              <FiAlertCircle className="oacr-stat-icon" />
              <div className="oacr-stat-val">{summary.notHave}</div>
              <div className="oacr-stat-lbl">Not Have</div>
            </div>
          </div>

          <div className="oacr-totals-grid">
            <div className="oacr-total-box">
              <div className="oacr-total-label">Total Ordered CTN</div>
              <div className="oacr-total-value">{totalOrderedCtn.toLocaleString()}</div>
            </div>
            <div className="oacr-total-box">
              <div className="oacr-total-label">Total Ordered KG</div>
              <div className="oacr-total-value">{fmtNum(totalOrderedKg, 2)}</div>
            </div>
            <div className="oacr-total-box oacr-total-danger">
              <div className="oacr-total-label">Total Shortage CTN</div>
              <div className="oacr-total-value">{totalShortageCtn > 0 ? totalShortageCtn.toLocaleString() : '0'}</div>
            </div>
            <div className="oacr-total-box oacr-total-danger">
              <div className="oacr-total-label">Total Shortage KG</div>
              <div className="oacr-total-value">{totalShortageKg > 0 ? fmtNum(totalShortageKg, 2) : '0'}</div>
            </div>
          </div>
        </div>

        {/* Per-file bars */}
        {fileSummaries.length > 1 && (
          <div className="card oacr-files-card">
            <div className="card-header"><h3><FiBox /> Per-File Breakdown</h3></div>
            <div className="card-body" style={{ padding: 0 }}>
              {fileSummaries.map((fs, i) => (
                <div key={i} className="oacr-frow">
                  <FiFile className="oacr-frow-icon" />
                  <span className="oacr-frow-name" title={fs.fileName}>{shortFileName(fs.fileName)}</span>
                  <span className="oacr-frow-count">{fs.totalItems}</span>
                  <div className="oacr-frow-bar-wrap">
                    <div className="oacr-frow-bar">
                      {fs.totalItems > 0 && (
                        <>
                          <div className="oacr-fbar oacr-fbar-full" style={{ width: `${(fs.full / fs.totalItems) * 100}%` }} title={`Full: ${fs.full}`} />
                          <div className="oacr-fbar oacr-fbar-notfull" style={{ width: `${(fs.notFull / fs.totalItems) * 100}%` }} title={`Not Full: ${fs.notFull}`} />
                          <div className="oacr-fbar oacr-fbar-nothave" style={{ width: `${(fs.notHave / fs.totalItems) * 100}%` }} title={`Not Have: ${fs.notHave}`} />
                        </>
                      )}
                    </div>
                  </div>
                  <div className="oacr-frow-badges">
                    <span className="oacr-fbadge oacr-fbadge-full">{fs.full}</span>
                    <span className="oacr-fbadge oacr-fbadge-notfull">{fs.notFull}</span>
                    <span className="oacr-fbadge oacr-fbadge-nothave">{fs.notHave}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detailed Table */}
        <div className="card oacr-table-card">
          <div className="oacr-toolbar">
            <div className="oacr-toolbar-left">
              <div className="oacr-tabs">
                {FILTER_TABS.map(tab => {
                  const cnt = tab.id === 'ALL' ? results.length
                    : tab.id === 'FULL' ? summary.full
                    : tab.id === 'NOT_FULL' ? summary.notFull : summary.notHave;
                  return (
                    <button
                      key={tab.id}
                      className={`oacr-tab ${activeFilter === tab.id ? 'active' : ''}`}
                      onClick={() => setActiveFilter(tab.id)}
                    >
                      {tab.label}
                      <span className="oacr-tab-count">{cnt}</span>
                    </button>
                  );
                })}
              </div>
              <button
                className={`oacr-group-btn ${groupByFile ? 'active' : ''}`}
                onClick={() => {
                  setGroupByFile(g => !g);
                  setExpandedGroups(new Set(fileSummaries.map(f => f.fileName)));
                }}
                title="Group by file"
              >
                <FiFilter /> Group by file
              </button>
              <div className="oacr-pdf-wrap" ref={pdfRef}>
                <button
                  className="oacr-group-btn"
                  onClick={() => setPdfMenuOpen(p => !p)}
                  title="Export as PDF"
                >
                  <FiFileText /> PDF
                </button>
                {pdfMenuOpen && (
                  <div className="oacr-pdf-menu">
                    <button onClick={() => exportToPdf('summary')}>
                      <FiDownload /> Summary (All)
                    </button>
                    <button onClick={() => exportToPdf('orderByOrder')}>
                      <FiFile /> Order by Order
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="oacr-toolbar-right">
              <div className="oacr-search">
                <FiSearch />
                <input
                  type="text"
                  placeholder="Search product, file..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
                {searchTerm && <button className="oacr-search-x" onClick={() => setSearchTerm('')}><FiX /></button>}
              </div>
            </div>
          </div>

          <div className="oacr-table-wrap">
            <table className="oacr-table">
              {!groupByFile ? (
                <>
                  {renderTableHead(true)}
                  <tbody>
                    {sortedResults.length === 0 ? (
                      <tr><td colSpan={16} className="oacr-empty-td">No items match the current filter</td></tr>
                    ) : (
                      sortedResults.map((r, i) => renderRow(r, i, true))
                    )}
                  </tbody>
                </>
              ) : (
                <>
                  {renderTableHead(false)}
                  <tbody>
                    {grouped && Array.from(grouped.entries()).map(([fileName, rows]) => {
                      const isOpen = expandedGroups.has(fileName);
                      const fs = fileSummaries.find(f => f.fileName === fileName);
                      return (
                        <React.Fragment key={fileName}>
                          <tr className="oacr-group-header" onClick={() => toggleGroup(fileName)}>
                            <td colSpan={15}>
                              <div className="oacr-group-toggle">
                                {isOpen ? <FiChevronUp /> : <FiChevronDown />}
                                <FiFile />
                                <strong>{shortFileName(fileName)}</strong>
                                <span className="oacr-group-meta">{rows.length} items</span>
                                {fs && (
                                  <>
                                    <span className="oacr-fbadge oacr-fbadge-full">{fs.full}</span>
                                    <span className="oacr-fbadge oacr-fbadge-notfull">{fs.notFull}</span>
                                    <span className="oacr-fbadge oacr-fbadge-nothave">{fs.notHave}</span>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                          {isOpen && rows.map((r, i) => renderRow(r, i, false))}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </>
              )}
            </table>
          </div>

          <div className="oacr-table-foot">
            Showing {sortedResults.length} of {results.length} items
            {activeFilter !== 'ALL' && ` — filtered: ${FILTER_TABS.find(t => t.id === activeFilter)?.label}`}
          </div>
        </div>
      </div>
    </>
  );
}

export default OACResult;
