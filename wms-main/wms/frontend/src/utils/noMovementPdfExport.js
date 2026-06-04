import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import {
  bangkokYYYYMMDD,
  bangkokLocaleString,
  bangkokLocaleDateString,
} from './bangkokTime';

const BRAND = [15, 118, 110];
const BRAND_DARK = [17, 94, 89];

function stockTypeLabel(stockType) {
  if (stockType === 'CONTAINER_EXTRA') return 'EXTRA';
  if (stockType === 'IMPORT') return 'IMPORT';
  return 'BULK';
}

function formatCsInDate(value) {
  if (!value) return '—';
  return bangkokLocaleDateString(new Date(value), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function severityRgb(days) {
  const d = Number(days) || 0;
  if (d >= 180) return { bg: [254, 242, 242], text: [220, 38, 38], label: 'Critical' };
  if (d >= 120) return { bg: [255, 247, 237], text: [234, 88, 12], label: 'High' };
  return { bg: [255, 251, 235], text: [245, 158, 11], label: 'Watch' };
}

function drawPdfBanner(doc, pageW, margin, { months, list, searchQuery, totalMC, totalKG, criticalCount }) {
  doc.setFillColor(...BRAND);
  doc.rect(0, 0, pageW, 24, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('WMS — No-Movement Stocks Report', margin, 10);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const meta = [
    bangkokLocaleString(),
    `CS-IN ${months}+ months`,
    `${list.length} item(s)`,
    `MC ${totalMC.toLocaleString()}`,
    `KG ${totalKG.toLocaleString(undefined, { maximumFractionDigits: 1 })}`,
    `Critical ${criticalCount}`,
  ];
  if (searchQuery?.trim()) meta.push(`Search: ${searchQuery.trim()}`);
  doc.text(meta.join('  |  '), margin, 18);
  return 28;
}

/**
 * @returns {import('jspdf').jsPDF}
 */
export function buildNoMovementPdf(items, options = {}) {
  const { months = 3, searchQuery = '' } = options;
  const list = items || [];
  const totalMC = list.reduce((s, i) => s + Number(i.hand_on_balance_mc || 0), 0);
  const totalKG = list.reduce((s, i) => s + Number(i.hand_on_balance_kg || 0), 0);
  const criticalCount = list.filter((i) => Number(i.days_idle) >= 180).length;

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const margin = 8;
  const pageW = doc.internal.pageSize.getWidth();

  const startY = drawPdfBanner(doc, pageW, margin, {
    months,
    list,
    searchQuery,
    totalMC,
    totalKG,
    criticalCount,
  });

  const head = [[
    '#', 'Fish Name', 'Size', 'Order / Invoice', 'Location', 'Type',
    'CS-IN', 'MC', 'KG', 'Last OUT', 'Days', 'Severity',
  ]];

  const body = list.map((item, idx) => {
    const sev = severityRgb(item.days_idle);
    return [
      idx + 1,
      item.fish_name || '—',
      item.size || '—',
      item.order_code || item.lot_no || '—',
      item.line_place || item.location_code || '—',
      stockTypeLabel(item.stock_type),
      formatCsInDate(item.cs_in_date),
      Number(item.hand_on_balance_mc) || 0,
      Number(item.hand_on_balance_kg).toFixed(1),
      item.last_out_date ? formatCsInDate(item.last_out_date) : '—',
      Number(item.days_idle) || 0,
      sev.label,
    ];
  });

  const foot = [[
    list.length,
    'TOTAL',
    '', '', '', '', '',
    totalMC,
    totalKG.toFixed(1),
    '', '', '',
  ]];

  autoTable(doc, {
    startY,
    head,
    body,
    foot,
    theme: 'grid',
    styles: {
      fontSize: 7,
      cellPadding: 1.4,
      overflow: 'linebreak',
      lineColor: [226, 232, 240],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: BRAND_DARK,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7,
    },
    footStyles: {
      fillColor: BRAND,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7,
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 38 },
      7: { halign: 'right' },
      8: { halign: 'right' },
      10: { halign: 'center' },
      11: { halign: 'center' },
    },
    didParseCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 11) return;
      const item = list[data.row.index];
      if (!item) return;
      const sev = severityRgb(item.days_idle);
      Object.assign(data.cell.styles, {
        fillColor: sev.bg,
        textColor: sev.text,
        fontStyle: 'bold',
      });
    },
    margin: { left: margin, right: margin, top: margin, bottom: margin },
    showFoot: 'lastPage',
  });

  return doc;
}

export function downloadNoMovementPdf(items, options = {}) {
  const { months = 3 } = options;
  const doc = buildNoMovementPdf(items, options);
  doc.save(`no-movement-stocks-${months}M-${bangkokYYYYMMDD()}.pdf`);
}

/** Compact base64 for email attachment (vector PDF, not raster). */
export function noMovementPdfBase64(items, options = {}) {
  const doc = buildNoMovementPdf(items, options);
  return doc.output('datauristring').split(',')[1];
}
