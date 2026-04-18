import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FiSearch, FiPackage, FiArrowDownCircle, FiArrowUpCircle, FiBox, FiChevronDown, FiChevronRight, FiDownload } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getCustomers, getCustomerSummary, getDepositItemDetail } from '../services/api';
import { registerThaiFont } from '../services/pdfFonts';
import logoThai from '../images/logo-thai.png';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { bangkokYYYYMMDD, dateToYYYYMMDDInBangkok } from '../utils/bangkokTime';

const toDate = (d) => d ? (typeof d === 'string' ? d.split('T')[0] : dateToYYYYMMDDInBangkok(d)) : '';
const fmtNum = (v, dec = 2) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });

/** DD/MM/YYYY for PDF (matches typical stock reports) */
const toDMY = (d) => {
  if (!d) return '';
  const s = typeof d === 'string' ? d.split('T')[0] : dateToYYYYMMDDInBangkok(d);
  const [y, m, dd] = s.split('-');
  if (!y || !m || !dd) return String(d);
  return `${dd}/${m}/${y}`;
};

/** Max distinct withdrawal dates as column groups in PDF (each date = OUT กล่อง + OUT KG). */
const PDF_MAX_WITHDRAWAL_COLS = 12;

/** Shown as PDF main title (H1). */
const PDF_COMPANY_NAME =
  'บริษัท ซี.เค.โฟรเซน ฟิช แอนด์ ฟู้ด จำกัด สาขาฉะเชิงเทรา';

/** Report name (H2 — smaller than company name). */
const PDF_REPORT_TITLE = 'Customer Stock Summary';

/** Fallback logos under `public/` if bundled `logo-thai.png` is missing. */
const PDF_LOGO_CANDIDATE_PATHS = ['/logo-report.png', '/company-logo.png', '/logo.png'];

/** PDF theme — green primary, warm “out” and mint “balance” accents */
const PDF = {
  banner: [21, 128, 61],
  bannerAccent: [52, 211, 153],
  headRow1: [22, 101, 52],
  headText: [255, 255, 255],
  headSubMuted: [209, 250, 229],
  outBand: [254, 243, 199],
  outBandText: [120, 53, 15],
  balBand: [209, 250, 229],
  balBandText: [6, 78, 59],
  slate900: [15, 23, 42],
  slate700: [51, 65, 85],
  slate500: [100, 116, 139],
  slate200: [226, 232, 240],
  slate50: [248, 250, 252],
  zebra: [252, 252, 254],
  footBar: [6, 78, 59],
  footText: [255, 255, 255],
  warnBg: [254, 252, 232],
  warnText: [146, 64, 14],
  cardStroke: [226, 232, 240],
};

async function loadImageUrlAsLogo(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    const dataUrl = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
    const format =
      blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'JPEG' : 'PNG';
    return { dataUrl, format };
  } catch {
    return null;
  }
}

async function fetchReportLogo() {
  const bundled = await loadImageUrlAsLogo(logoThai);
  if (bundled) return bundled;

  const prefix = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  for (const path of PDF_LOGO_CANDIDATE_PATHS) {
    const fromPublic = await loadImageUrlAsLogo(`${prefix}${path}`);
    if (fromPublic) return fromPublic;
  }
  return null;
}

function measureLogoDrawMm(dataUrl, format, maxWMm, maxHMm) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const ratio = img.width / img.height;
      let w = maxWMm;
      let h = w / ratio;
      if (h > maxHMm) {
        h = maxHMm;
        w = h * ratio;
      }
      resolve({ drawW: w, drawH: h });
    };
    img.onerror = () => resolve({ drawW: 0, drawH: 0 });
    img.src = dataUrl;
  });
}

/** All distinct withdrawal dates in the section (YYYY-MM-DD), sorted ascending */
function uniqueSortedWithdrawalDates(items, detailsById) {
  const set = new Set();
  for (const it of items) {
    for (const w of detailsById[it.id] || []) {
      if (w && w.withdraw_date) set.add(toDate(w.withdraw_date));
    }
  }
  return [...set].sort();
}

/** Sum boxes / kg for one deposit line on a given calendar date (multiple lines same day add up). */
function outTotalsForWithdrawalDate(item, detailsById, dateKey) {
  if (dateKey == null) return { boxes: 0, kg: 0 };
  let boxes = 0;
  let kg = 0;
  for (const w of detailsById[item.id] || []) {
    if (w && toDate(w.withdraw_date) === dateKey) {
      boxes += Number(w.boxes_out || 0);
      kg += Number(w.weight_kg_out || 0);
    }
  }
  return { boxes, kg };
}

/**
 * Full-bleed banner + customer card. Returns Y (mm) to start autoTable.
 * @param {object} [info.logoDraw] — `{ dataUrl, format, drawW, drawH }` from measureLogoDrawMm
 */
function drawCustomerSummaryPdfHeader(doc, pageW, margin, info, { compact } = {}) {
  if (compact) {
    doc.setFillColor(...PDF.banner);
    doc.rect(0, 0, pageW, 11, 'F');
    doc.setFont('Sarabun', 'bold');
    doc.setTextColor(...PDF.headText);
    doc.setFontSize(10);
    doc.text(`${info.customerName} · รายงานสต็อกลูกค้า (ต่อ)`, margin, 7);
    doc.setFont('Sarabun', 'normal');
    doc.setTextColor(...PDF.headSubMuted);
    doc.setFontSize(7.5);
    return 14;
  }

  const logoGap = 6;
  const logoMaxW = 44;
  const logoMaxH = 22;
  const hasLogo = info.logoDraw && info.logoDraw.drawW > 0;
  const textMaxW =
    pageW - 2 * margin - (hasLogo ? info.logoDraw.drawW + logoGap : 0);

  doc.setFont('Sarabun', 'bold');
  doc.setFontSize(12.5);
  const companyLines = doc.splitTextToSize(PDF_COMPANY_NAME, textMaxW);
  const lineStep = 5.1;
  const topPad = 5;
  const yCompany = topPad + 4;
  const yH2 = yCompany + companyLines.length * lineStep + 1;
  const yMeta = yH2 + 5.5;
  const contentBottom = yMeta + 5;
  const bannerH = Math.max(
    contentBottom,
    hasLogo ? info.logoDraw.drawH + topPad * 2 : 26
  );

  doc.setFillColor(...PDF.banner);
  doc.rect(0, 0, pageW, bannerH, 'F');
  doc.setFillColor(...PDF.bannerAccent);
  doc.rect(0, bannerH - 1.4, pageW, 1.4, 'F');

  doc.setFont('Sarabun', 'bold');
  doc.setTextColor(...PDF.headText);
  doc.setFontSize(12.5);
  doc.text(companyLines, margin, yCompany);

  doc.setFont('Sarabun', 'bold');
  doc.setFontSize(10.5);
  doc.text(PDF_REPORT_TITLE, margin, yH2);

  doc.setFont('Sarabun', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(167, 243, 208);
  doc.text(
    `WMS · ${info.viewLabel} · ${info.exportDMY} · ${info.lineCount} line(s)`,
    margin,
    yMeta
  );

  if (hasLogo) {
    try {
      const lx = pageW - margin - info.logoDraw.drawW;
      const ly = Math.max(topPad, (bannerH - info.logoDraw.drawH) / 2);
      doc.addImage(
        info.logoDraw.dataUrl,
        info.logoDraw.format,
        lx,
        ly,
        info.logoDraw.drawW,
        info.logoDraw.drawH
      );
    } catch {
      /* ignore broken image */
    }
  }

  let y = bannerH + 6;
  const cardW = pageW - 2 * margin;
  doc.setFont('Sarabun', 'normal');
  doc.setFontSize(9);
  const addrText = info.address || '—';
  const addrLines = doc.splitTextToSize(addrText, cardW - 44);
  const lh = 4.6;
  const cardH = 10 + 7 + addrLines.length * lh + 8;

  doc.setFillColor(...PDF.slate50);
  doc.setDrawColor(...PDF.cardStroke);
  doc.setLineWidth(0.35);
  doc.roundedRect(margin, y, cardW, cardH, 2, 2, 'FD');

  const lx = margin + 5;
  const vx = margin + 42;
  let ty = y + 7;

  doc.setFont('Sarabun', 'bold');
  doc.setTextColor(...PDF.slate500);
  doc.setFontSize(7);
  doc.text('CUSTOMER / ลูกค้า', lx, ty);
  doc.setFont('Sarabun', 'bold');
  doc.setTextColor(...PDF.slate900);
  doc.setFontSize(11);
  doc.text(info.customerName, vx, ty);
  ty += 8;

  doc.setFont('Sarabun', 'bold');
  doc.setTextColor(...PDF.slate500);
  doc.setFontSize(7);
  doc.text('ADDRESS / ที่อยู่', lx, ty);
  doc.setFont('Sarabun', 'normal');
  doc.setTextColor(...PDF.slate700);
  doc.setFontSize(9);
  doc.text(addrLines, vx, ty);
  ty += addrLines.length * lh + 1;

  doc.setFont('Sarabun', 'bold');
  doc.setTextColor(...PDF.slate500);
  doc.setFontSize(7);
  doc.text('PHONE / โทร', lx, ty);
  doc.setFont('Sarabun', 'normal');
  doc.setTextColor(...PDF.slate900);
  doc.setFontSize(10);
  doc.text(info.phone || '—', vx, ty);

  return y + cardH + 6;
}

/**
 * Column keys for PDF withdrawal section: one OUT pair per unique date (capped).
 * Uses `null` as a single placeholder when there are no withdrawals anywhere.
 */
function pdfWithdrawalDateColumnKeys(items, detailsById) {
  const all = uniqueSortedWithdrawalDates(items, detailsById);
  const capped = all.slice(0, PDF_MAX_WITHDRAWAL_COLS);
  if (capped.length > 0) return capped;
  return [null];
}

function buildCustomerSummaryPdfTable(items, detailsById, dateKeys) {
  const n = dateKeys.length;
  const hGreen = {
    fillColor: PDF.headRow1,
    textColor: PDF.headText,
    valign: 'middle',
    fontStyle: 'bold',
    halign: 'center',
  };

  const headRow0 = [
    {
      content: 'Information / ข้อมูล',
      colSpan: 7,
      rowSpan: 1,
      styles: { ...hGreen, halign: 'center' },
    },
    {
      content: 'วันที่ถอนเงิน',
      colSpan: n * 2,
      styles: { ...hGreen },
    },
    {
      content: 'Balance / คงเหลือ',
      colSpan: 2,
      rowSpan: 2,
      styles: { ...hGreen },
    },
  ];

  const headRow1 = [
    { content: 'No.', rowSpan: 2, styles: { ...hGreen, halign: 'center' } },
    { content: 'CS IN Date', rowSpan: 2, styles: { ...hGreen, halign: 'center' } },
    { content: 'Fish Name / รายการ', rowSpan: 2, styles: { ...hGreen, halign: 'left' } },
    { content: 'Lot No.', rowSpan: 2, styles: { ...hGreen, halign: 'center' } },
    { content: 'IN - กล่อง', rowSpan: 2, styles: { ...hGreen, halign: 'center' } },
    { content: 'Kg รายละเอียด', rowSpan: 2, styles: { ...hGreen, halign: 'center', fontSize: 6.5 } },
    { content: 'IN - KG (รวม)', rowSpan: 2, styles: { ...hGreen, halign: 'center' } },
  ];
  for (let j = 0; j < n; j += 1) {
    const dk = dateKeys[j];
    headRow1.push({
      content: dk ? toDMY(dk) : '—',
      colSpan: 2,
      rowSpan: 1,
      styles: {
        halign: 'center',
        valign: 'middle',
        fillColor: PDF.outBand,
        textColor: PDF.outBandText,
        fontStyle: 'bold',
        fontSize: 6.5,
      },
    });
  }

  const headRow2 = [];
  const outCell = (label) => ({
    content: label,
    styles: {
      halign: 'center',
      valign: 'middle',
      fillColor: PDF.outBand,
      textColor: PDF.outBandText,
      fontStyle: 'bold',
    },
  });
  const balCell = (label) => ({
    content: label,
    styles: {
      halign: 'center',
      valign: 'middle',
      fillColor: PDF.balBand,
      textColor: PDF.balBandText,
      fontStyle: 'bold',
    },
  });
  for (let j = 0; j < n; j += 1) {
    headRow2.push(outCell('OUT - กล่อง'));
    headRow2.push(outCell('OUT - KG'));
  }
  headRow2.push(balCell('กล่อง'));
  headRow2.push(balCell('KG'));

  const body = items.map((it, i) => {
    const row = [
      String(i + 1),
      toDMY(it.receive_date),
      it.item_name || '',
      it.lot_no || '',
      Number(it.boxes || 0).toLocaleString(),
      it.kg_parts || '—',
      fmtNum(it.weight_kg),
    ];
    for (let j = 0; j < n; j += 1) {
      const { boxes, kg } = outTotalsForWithdrawalDate(it, detailsById, dateKeys[j]);
      row.push(boxes ? Number(boxes).toLocaleString() : '');
      row.push(kg ? fmtNum(kg) : '');
    }
    row.push(Number(it.balance_boxes || 0).toLocaleString());
    row.push(fmtNum(it.balance_kg));
    return row;
  });

  const foot = [
    {
      content: 'Total / รวม',
      colSpan: 4,
      styles: {
        fontStyle: 'bold',
        halign: 'right',
        fillColor: PDF.footBar,
        textColor: PDF.footText,
      },
    },
    items.reduce((s, it) => s + Number(it.boxes || 0), 0).toLocaleString(),
    '',
    fmtNum(items.reduce((s, it) => s + Number(it.weight_kg || 0), 0)),
  ];
  for (let j = 0; j < n; j += 1) {
    const dk = dateKeys[j];
    foot.push(
      items
        .reduce((s, it) => s + outTotalsForWithdrawalDate(it, detailsById, dk).boxes, 0)
        .toLocaleString()
    );
    foot.push(
      fmtNum(items.reduce((s, it) => s + outTotalsForWithdrawalDate(it, detailsById, dk).kg, 0))
    );
  }
  foot.push(items.reduce((s, it) => s + Number(it.balance_boxes || 0), 0).toLocaleString());
  foot.push(fmtNum(items.reduce((s, it) => s + Number(it.balance_kg || 0), 0)));

  return { head: [headRow0, headRow1, headRow2], body, foot: [foot] };
}

function CustomerSummary() {
  const [customers, setCustomers] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState('all');
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [detailCache, setDetailCache] = useState({});
  const [detailLoading, setDetailLoading] = useState(new Set());
  const printRef = useRef(null);

  useEffect(() => {
    (async () => {
      try { const res = await getCustomers(); setCustomers(res.data); }
      catch { toast.error('Failed to load customers'); }
    })();
  }, []);

  useEffect(() => {
    loadSummary();
    setExpandedIds(new Set());
    // eslint-disable-next-line
  }, [selectedCustomerId]);

  const loadSummary = async () => {
    setLoading(true);
    try {
      const params = {};
      if (selectedCustomerId) params.customer_id = selectedCustomerId;
      const res = await getCustomerSummary(params);
      setItems(res.data);
    } catch { toast.error('Failed to load summary'); }
    finally { setLoading(false); }
  };

  const toggleDetail = useCallback(async (itemId) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) { next.delete(itemId); } else { next.add(itemId); }
      return next;
    });
    if (!detailCache[itemId] && !detailLoading.has(itemId)) {
      setDetailLoading(prev => new Set(prev).add(itemId));
      try {
        const res = await getDepositItemDetail(itemId);
        setDetailCache(prev => ({ ...prev, [itemId]: res.data }));
      } catch { toast.error('Failed to load detail'); }
      finally { setDetailLoading(prev => { const n = new Set(prev); n.delete(itemId); return n; }); }
    }
  }, [detailCache, detailLoading]);

  const filtered = useMemo(() => {
    let data = items;
    if (viewMode === 'in_stock') data = data.filter(it => Number(it.balance_boxes) > 0 || Number(it.balance_kg) > 0);
    if (viewMode === 'out') data = data.filter(it => Number(it.total_out_boxes) > 0 || Number(it.total_out_kg) > 0);
    if (search.trim()) {
      const q = search.toLowerCase();
      data = data.filter(it =>
        (it.item_name || '').toLowerCase().includes(q) ||
        (it.lot_no || '').toLowerCase().includes(q) ||
        (it.customer_name || '').toLowerCase().includes(q)
      );
    }
    return data;
  }, [items, search, viewMode]);

  const totals = useMemo(() => ({
    in_boxes: filtered.reduce((s, it) => s + Number(it.boxes || 0), 0),
    in_kg: filtered.reduce((s, it) => s + Number(it.weight_kg || 0), 0),
    out_boxes: filtered.reduce((s, it) => s + Number(it.total_out_boxes || 0), 0),
    out_kg: filtered.reduce((s, it) => s + Number(it.total_out_kg || 0), 0),
    bal_boxes: filtered.reduce((s, it) => s + Number(it.balance_boxes || 0), 0),
    bal_kg: filtered.reduce((s, it) => s + Number(it.balance_kg || 0), 0),
  }), [filtered]);

  const grouped = useMemo(() => {
    if (selectedCustomerId) return null;
    const map = {};
    for (const it of filtered) {
      const cid = it.customer_id;
      if (!map[cid]) map[cid] = { customer_name: it.customer_name, customer_id: cid, items: [] };
      map[cid].items.push(it);
    }
    return Object.values(map);
  }, [filtered, selectedCustomerId]);

  const viewLabel = viewMode === 'all' ? 'All Items' : viewMode === 'in_stock' ? 'In Stock' : 'Withdrawn';

  const buildExcelData = () => {
    return filtered.map((it, i) => ({
      '#': i + 1,
      'Customer': it.customer_name || '',
      'วันที่รับ': toDate(it.receive_date),
      'รายการ': it.item_name || '',
      'LOT No.': it.lot_no || '',
      'IN กล่อง': Number(it.boxes || 0),
      'Kg รายละเอียด': it.kg_parts || '',
      'IN Kg (รวม)': Number(it.weight_kg || 0),
      'OUT กล่อง': Number(it.total_out_boxes || 0),
      'OUT Kg': Number(it.total_out_kg || 0),
      'คงเหลือ กล่อง': Number(it.balance_boxes || 0),
      'คงเหลือ Kg': Number(it.balance_kg || 0),
    }));
  };

  const downloadExcel = () => {
    const data = buildExcelData();
    if (data.length === 0) return toast.warn('No data to export');
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, viewLabel);
    XLSX.writeFile(wb, `Customer_Summary_${viewLabel.replace(/\s/g, '_')}_${bangkokYYYYMMDD()}.xlsx`);
    toast.success('Excel downloaded');
  };

  const downloadPDF = async () => {
    if (filtered.length === 0) {
      toast.warn('No data to export');
      return;
    }

    const customerMap = Object.fromEntries(customers.map((c) => [c.id, c]));
    const sections = selectedCustomerId
      ? [{ customerId: Number(selectedCustomerId), items: filtered }]
      : (grouped || []).map((g) => ({ customerId: g.customer_id, items: g.items }));

    toast.info('Preparing PDF (loading withdrawal lines)...');
    try {
      const merged = { ...detailCache };
      const allIds = new Set();
      for (const sec of sections) {
        for (const it of sec.items) allIds.add(it.id);
      }
      await Promise.all(
        [...allIds].map(async (id) => {
          if (merged[id] != null) return;
          try {
            const res = await getDepositItemDetail(id);
            merged[id] = res.data || [];
          } catch {
            merged[id] = [];
          }
        })
      );
      setDetailCache(merged);

      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const fontReady = await registerThaiFont(doc);
      if (!fontReady) {
        toast.error('Could not load Thai font for PDF. Check network or public/fonts/Sarabun-*.ttf');
        return;
      }
      const fontOpts = { font: 'Sarabun' };
      const margin = 12;
      const pageW = doc.internal.pageSize.getWidth();
      const exportDMY = toDMY(bangkokYYYYMMDD());

      let logoDraw = null;
      const logoRaw = await fetchReportLogo();
      if (logoRaw) {
        const dims = await measureLogoDrawMm(logoRaw.dataUrl, logoRaw.format, 44, 22);
        if (dims.drawW > 0) logoDraw = { ...logoRaw, ...dims };
      }

      sections.forEach((sec, si) => {
        if (si > 0) {
          doc.addPage();
          doc.setFont('Sarabun', 'normal');
        }
        const cust = customerMap[sec.customerId] || {};
        const customerName = cust.name || sec.items[0]?.customer_name || '—';
        const addr = cust.address || '';
        const phone = cust.phone || '';

        let y = drawCustomerSummaryPdfHeader(
          doc,
          pageW,
          margin,
          {
            customerName,
            address: addr,
            phone,
            viewLabel,
            lineCount: sec.items.length,
            exportDMY,
            logoDraw: si === 0 ? logoDraw : null,
          },
          { compact: si > 0 }
        );

        const allWdDates = uniqueSortedWithdrawalDates(sec.items, merged);
        const truncated = allWdDates.length > PDF_MAX_WITHDRAWAL_COLS;
        if (truncated) {
          const noteW = pageW - 2 * margin;
          doc.setFillColor(...PDF.warnBg);
          doc.setDrawColor(253, 230, 138);
          doc.setLineWidth(0.25);
          doc.roundedRect(margin, y, noteW, 12, 2, 2, 'FD');
          doc.setFont('Sarabun', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(...PDF.warnText);
          doc.text(
            `หมายเหตุ: แสดงได้สูงสุด ${PDF_MAX_WITHDRAWAL_COLS} วันที่ถอน — มีวันที่อื่นในระบบที่ไม่แสดงในตารางนี้`,
            margin + 4,
            y + 7.5
          );
          doc.setTextColor(...PDF.slate900);
          y += 15;
        }

        const dateKeys = pdfWithdrawalDateColumnKeys(sec.items, merged);
        const maxW = dateKeys.length;
        const { head, body, foot } = buildCustomerSummaryPdfTable(sec.items, merged, dateKeys);

        const lastCol = 7 + maxW * 2 + 1;
        const columnStyles = {
          0: { halign: 'center', cellWidth: 9 },
          1: { halign: 'center', cellWidth: 18 },
          2: { halign: 'left' },
          3: { halign: 'center', cellWidth: 18 },
        };
        for (let c = 4; c <= lastCol; c += 1) {
          columnStyles[c] = c === 5 ? { halign: 'left', cellWidth: 22 } : { halign: 'right' };
        }

        autoTable(doc, {
          startY: y,
          head,
          body,
          foot,
          theme: 'grid',
          styles: {
            fontSize: 7,
            cellPadding: { top: 1.8, bottom: 1.8, left: 2, right: 2 },
            lineColor: PDF.slate200,
            lineWidth: 0.12,
            textColor: PDF.slate900,
            ...fontOpts,
          },
          headStyles: {
            fontStyle: 'bold',
            ...fontOpts,
          },
          bodyStyles: { ...fontOpts },
          alternateRowStyles: { fillColor: PDF.zebra },
          footStyles: {
            fontStyle: 'bold',
            fillColor: PDF.footBar,
            textColor: PDF.footText,
            ...fontOpts,
          },
          columnStyles,
          showHead: 'everyPage',
          showFoot: 'lastPage',
          horizontalPageBreak: true,
          margin: { left: margin, right: margin },
          didParseCell: (data) => {
            const st = data.cell.styles;
            st.font = 'Sarabun';
            if (data.section === 'foot') {
              st.fillColor = PDF.footBar;
              st.textColor = PDF.footText;
              st.fontStyle = 'bold';
              return;
            }
            if (data.section === 'head') {
              const ri = data.row.index;
              const ci = data.column.index;
              if (ri === 0) {
                st.fillColor = PDF.headRow1;
                st.textColor = PDF.headText;
                st.fontStyle = 'bold';
              } else if (ri === 1) {
                if (ci < 7) {
                  st.fillColor = PDF.headRow1;
                  st.textColor = PDF.headText;
                  st.fontStyle = 'bold';
                } else if (ci < 7 + maxW * 2) {
                  st.fillColor = PDF.outBand;
                  st.textColor = PDF.outBandText;
                  st.fontStyle = 'bold';
                  st.fontSize = 6.5;
                }
              } else if (ri === 2) {
                if (ci >= 7 && ci < 7 + maxW * 2) {
                  st.fillColor = PDF.outBand;
                  st.textColor = PDF.outBandText;
                  st.fontStyle = 'bold';
                } else if (ci >= 7 + maxW * 2) {
                  st.fillColor = PDF.balBand;
                  st.textColor = PDF.balBandText;
                  st.fontStyle = 'bold';
                }
              }
              return;
            }
            if (!st.fontStyle) st.fontStyle = 'normal';
          },
        });
      });

      const lt = doc.lastAutoTable;
      if (lt && typeof lt.finalY === 'number') {
        doc.setFont('Sarabun', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(140, 140, 140);
        doc.text(
          'Powered by CK Intelligence',
          pageW / 2,
          lt.finalY + 6,
          { align: 'center' }
        );
      }

      doc.save(`Customer_Summary_${viewLabel.replace(/\s/g, '_')}_${bangkokYYYYMMDD()}.pdf`);
      toast.success('PDF downloaded');
    } catch {
      toast.error('Failed to generate PDF');
    }
  };

  return (
    <div className="csm-page">
      <div className="page-header">
        <h2><FiPackage /> Customer Stock Summary</h2>
      </div>

      <div className="csm-controls">
        <div className="csm-control-row">
          <div className="csm-select-wrap">
            <label>Customer</label>
            <select value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)}>
              <option value="">-- All Customers --</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="csm-search-wrap">
            <FiSearch />
            <input type="text" placeholder="Search item name, LOT, customer..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        <div className="csm-control-row" style={{ justifyContent: 'space-between' }}>
          <div className="csm-tabs">
            <button className={`csm-tab ${viewMode === 'all' ? 'active' : ''}`} onClick={() => setViewMode('all')}><FiBox /> All Items</button>
            <button className={`csm-tab ${viewMode === 'in_stock' ? 'active' : ''}`} onClick={() => setViewMode('in_stock')}><FiArrowDownCircle /> In Stock</button>
            <button className={`csm-tab ${viewMode === 'out' ? 'active' : ''}`} onClick={() => setViewMode('out')}><FiArrowUpCircle /> Withdrawn</button>
          </div>
          <div className="csm-export-btns">
            <button className="btn btn-outline csm-dl-btn" onClick={downloadExcel}><FiDownload /> Excel</button>
            <button className="btn btn-outline csm-dl-btn" onClick={downloadPDF}><FiDownload /> PDF</button>
          </div>
        </div>
      </div>

      <div className="csm-cards">
        <div className="csm-card csm-card-in">
          <div className="csm-card-icon"><FiArrowDownCircle /></div>
          <div className="csm-card-body">
            <div className="csm-card-label">Total IN</div>
            <div className="csm-card-val">{totals.in_boxes.toLocaleString()} กล่อง</div>
            <div className="csm-card-sub">{fmtNum(totals.in_kg)} Kg</div>
          </div>
        </div>
        <div className="csm-card csm-card-out">
          <div className="csm-card-icon"><FiArrowUpCircle /></div>
          <div className="csm-card-body">
            <div className="csm-card-label">Total OUT</div>
            <div className="csm-card-val">{totals.out_boxes.toLocaleString()} กล่อง</div>
            <div className="csm-card-sub">{fmtNum(totals.out_kg)} Kg</div>
          </div>
        </div>
        <div className="csm-card csm-card-bal">
          <div className="csm-card-icon"><FiBox /></div>
          <div className="csm-card-body">
            <div className="csm-card-label">Balance</div>
            <div className="csm-card-val">{totals.bal_boxes.toLocaleString()} กล่อง</div>
            <div className="csm-card-sub">{fmtNum(totals.bal_kg)} Kg</div>
          </div>
        </div>
      </div>

      {loading && <div className="loading"><div className="spinner"></div>Loading...</div>}
      {!loading && filtered.length === 0 && <div className="csm-empty">No items found</div>}

      <div ref={printRef}>
        {!loading && grouped && grouped.map(g => (
          <div key={g.customer_id} className="csm-group">
            <div className="csm-group-header">
              <span className="csm-group-title">ใบรับฝากสินค้า</span>
              <span className="csm-group-name">{g.customer_name}</span>
              <span className="csm-group-count">{g.items.length} items</span>
            </div>
            <SummaryTable items={g.items} expandedIds={expandedIds} detailCache={detailCache} detailLoading={detailLoading} onToggle={toggleDetail} />
          </div>
        ))}
        {!loading && !grouped && filtered.length > 0 && (
          <SummaryTable items={filtered} expandedIds={expandedIds} detailCache={detailCache} detailLoading={detailLoading} onToggle={toggleDetail} />
        )}
      </div>
    </div>
  );
}

function SummaryTable({ items, expandedIds, detailCache, detailLoading, onToggle, groupTitle }) {
  return (
    <div className="csm-table-wrap">
      <table className="csm-table">
        <thead>
          <tr>
            <th className="csm-th-expand" style={{ width: 30 }}></th>
            <th className="csm-th-index" style={{ width: 36 }}>#</th>
            <th style={{ width: 95 }}>วันที่รับ</th>
            <th className="csm-th-item">รายการ</th>
            <th style={{ width: 80 }}>LOT No.</th>
            <th className="csm-th-num" style={{ width: 70 }}>IN กล่อง</th>
            <th style={{ minWidth: 110 }}>Kg รายละเอียด</th>
            <th className="csm-th-num" style={{ width: 80 }}>IN Kg (รวม)</th>
            <th className="csm-th-num" style={{ width: 70 }}>OUT กล่อง</th>
            <th className="csm-th-num" style={{ width: 80 }}>OUT Kg</th>
            <th className="csm-th-num" style={{ width: 70 }}>คงเหลือ กล่อง</th>
            <th className="csm-th-num" style={{ width: 80 }}>คงเหลือ Kg</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => {
            const balBoxes = Number(it.balance_boxes || 0);
            const balKg = Number(it.balance_kg || 0);
            const isZero = balBoxes <= 0 && balKg <= 0;
            const hasOut = Number(it.total_out_boxes || 0) > 0 || Number(it.total_out_kg || 0) > 0;
            const isExpanded = expandedIds.has(it.id);
            const detail = detailCache[it.id] || [];
            const isLoadingDetail = detailLoading.has(it.id);
            return (
              <React.Fragment key={it.id}>
                <tr className={`${isZero ? 'csm-row-zero' : ''} ${hasOut ? 'csm-row-clickable' : ''}`}
                    onClick={() => hasOut && onToggle(it.id)}>
                  <td className="text-center csm-expand-cell">
                    {hasOut && (isExpanded ? <FiChevronDown /> : <FiChevronRight />)}
                  </td>
                  <td className="text-center">{i + 1}</td>
                  <td className="text-center">{toDate(it.receive_date)}</td>
                  <td>{it.item_name}</td>
                  <td>{it.lot_no || ''}</td>
                  <td className="num-cell">{Number(it.boxes || 0).toLocaleString()}</td>
                  <td className="num-cell" style={{ fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>{it.kg_parts || '—'}</td>
                  <td className="num-cell">{fmtNum(it.weight_kg)}</td>
                  <td className="num-cell">{Number(it.total_out_boxes || 0).toLocaleString()}</td>
                  <td className="num-cell">{fmtNum(it.total_out_kg)}</td>
                  <td className="num-cell" style={{ fontWeight: 600, color: isZero ? '#aaa' : '#1a7f37' }}>{balBoxes.toLocaleString()}</td>
                  <td className="num-cell" style={{ fontWeight: 600, color: isZero ? '#aaa' : '#1a7f37' }}>{fmtNum(balKg)}</td>
                </tr>
                {isExpanded && (
                  <tr className="csm-detail-row">
                    <td colSpan={12}>
                      {isLoadingDetail ? (
                        <div className="csm-detail-loading">Loading...</div>
                      ) : detail.length === 0 ? (
                        <div className="csm-detail-empty">No withdrawal records</div>
                      ) : (
                        <div className="csm-detail-box">
                          <div className="csm-detail-title">WITHDRAWAL HISTORY</div>
                          <table className="csm-detail-table">
                            <thead>
                              <tr>
                                <th className="csm-detail-th-num">#</th>
                                <th>วันที่เบิก</th>
                                <th>Doc Ref</th>
                                <th className="csm-detail-th-num">กล่อง</th>
                                <th className="csm-detail-th-num">Kg</th>
                                <th>เวลา</th>
                                <th>หมายเหตุ</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detail.map((d, di) => (
                                <tr key={d.id}>
                                  <td className="text-center">{di + 1}</td>
                                  <td className="text-center">{toDate(d.withdraw_date)}</td>
                                  <td>{d.wd_doc_ref || ''}</td>
                                  <td className="num-cell">{Number(d.boxes_out || 0).toLocaleString()}</td>
                                  <td className="num-cell">{fmtNum(d.weight_kg_out)}</td>
                                  <td className="text-center">{d.time_str || ''}</td>
                                  <td>{d.remark || ''}</td>
                                </tr>
                              ))}
                            </tbody>
                            <tfoot>
                              <tr className="csm-detail-tfoot-row">
                                <td colSpan={3} className="text-right csm-detail-total-label"><strong>Total OUT</strong></td>
                                <td className="num-cell csm-detail-total-num"><strong>{detail.reduce((s, d) => s + Number(d.boxes_out || 0), 0).toLocaleString()}</strong></td>
                                <td className="num-cell csm-detail-total-num"><strong>{fmtNum(detail.reduce((s, d) => s + Number(d.weight_kg_out || 0), 0))}</strong></td>
                                <td colSpan={2}></td>
                              </tr>
                            </tfoot>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="csm-main-tfoot-row">
            <td></td>
            <td colSpan={4} className="text-right csm-main-total-label"><strong>Total</strong></td>
            <td className="num-cell csm-main-total-num"><strong>{items.reduce((s, it) => s + Number(it.boxes || 0), 0).toLocaleString()}</strong></td>
            <td className="num-cell csm-main-total-num"></td>
            <td className="num-cell csm-main-total-num"><strong>{fmtNum(items.reduce((s, it) => s + Number(it.weight_kg || 0), 0))}</strong></td>
            <td className="num-cell csm-main-total-num"><strong>{items.reduce((s, it) => s + Number(it.total_out_boxes || 0), 0).toLocaleString()}</strong></td>
            <td className="num-cell csm-main-total-num"><strong>{fmtNum(items.reduce((s, it) => s + Number(it.total_out_kg || 0), 0))}</strong></td>
            <td className="num-cell csm-main-total-num"><strong>{items.reduce((s, it) => s + Number(it.balance_boxes || 0), 0).toLocaleString()}</strong></td>
            <td className="num-cell csm-main-total-num"><strong>{fmtNum(items.reduce((s, it) => s + Number(it.balance_kg || 0), 0))}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default CustomerSummary;
