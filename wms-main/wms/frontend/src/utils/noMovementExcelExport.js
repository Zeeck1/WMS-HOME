import ExcelJS from 'exceljs';
import {
  bangkokYYYYMMDD,
  bangkokLocaleString,
  bangkokLocaleDateString,
} from './bangkokTime';

const COLORS = {
  brand: 'FF0F766E',
  brandDark: 'FF115E59',
  white: 'FFFFFFFF',
  slate900: 'FF0F172A',
  slate600: 'FF475569',
  slate100: 'FFF1F5F9',
  slate50: 'FFF8FAFC',
  border: 'FFE2E8F0',
  amber: 'FFF59E0B',
  orange: 'FFEA580C',
  red: 'FFDC2626',
  amberBg: 'FFFFFBEB',
  orangeBg: 'FFFFF7ED',
  redBg: 'FFFEF2F2',
  indigo: 'FF6366F1',
  emerald: 'FF10B981',
  typeBulk: 'FFF1F5F9',
  typeImport: 'FFEFF6FF',
  typeExtra: 'FFF5F3FF',
  typeBulkFont: 'FF334155',
  typeImportFont: 'FF1D4ED8',
  typeExtraFont: 'FF6D28D9',
};

/** Row numbers — banner scrolls; only table header row repeats when scrolling data. */
const ROW_TITLE = 1;
const ROW_META = 2;
const ROW_KPI = 3;
const ROW_HEADER = 4;
const ROW_DATA_START = 5;

function stockTypeLabel(stockType) {
  if (stockType === 'CONTAINER_EXTRA') return 'EXTRA';
  if (stockType === 'IMPORT') return 'IMPORT';
  return 'BULK';
}

function stockTypeColors(stockType) {
  if (stockType === 'CONTAINER_EXTRA') {
    return { fill: COLORS.typeExtra, font: COLORS.typeExtraFont };
  }
  if (stockType === 'IMPORT') {
    return { fill: COLORS.typeImport, font: COLORS.typeImportFont };
  }
  return { fill: COLORS.typeBulk, font: COLORS.typeBulkFont };
}

function daysSeverity(days) {
  const d = Number(days) || 0;
  if (d >= 180) return { fill: COLORS.redBg, font: COLORS.red, label: 'Critical' };
  if (d >= 120) return { fill: COLORS.orangeBg, font: COLORS.orange, label: 'High' };
  return { fill: COLORS.amberBg, font: COLORS.amber, label: 'Watch' };
}

function formatCsInDate(value) {
  if (!value) return '—';
  return bangkokLocaleDateString(new Date(value), {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function solidFill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}

function thinBorder(color = COLORS.border) {
  const side = { style: 'thin', color: { argb: color } };
  return { top: side, left: side, bottom: side, right: side };
}

function applyCellStyle(cell, { font, fill, alignment, border, numFmt }) {
  if (font) cell.font = font;
  if (fill) cell.fill = fill;
  if (alignment) cell.alignment = alignment;
  if (border) cell.border = border;
  if (numFmt) cell.numFmt = numFmt;
}

function itemToTableRow(item, index) {
  const sev = daysSeverity(item.days_idle);
  return [
    index + 1,
    item.fish_name || '—',
    item.size || '—',
    item.order_code || item.lot_no || '—',
    item.line_place || item.location_code || '—',
    stockTypeLabel(item.stock_type),
    formatCsInDate(item.cs_in_date),
    Number(item.hand_on_balance_mc) || 0,
    Number(item.hand_on_balance_kg) || 0,
    item.last_out_date ? formatCsInDate(item.last_out_date) : '—',
    Number(item.days_idle) || 0,
    sev.label,
  ];
}

function styleTableRegion(sheet, list) {
  const headerRow = sheet.getRow(ROW_HEADER);
  headerRow.height = 26;
  DATA_COLUMNS.forEach((col, idx) => {
    applyCellStyle(headerRow.getCell(idx + 1), {
      font: { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.white } },
      fill: solidFill(COLORS.brandDark),
      alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
      border: thinBorder('FF0D9488'),
    });
  });

  list.forEach((item, index) => {
    const row = sheet.getRow(ROW_DATA_START + index);
    const sev = daysSeverity(item.days_idle);
    const typeColors = stockTypeColors(item.stock_type);
    const zebra = index % 2 === 1 ? COLORS.slate50 : COLORS.white;
    row.height = 22;

    DATA_COLUMNS.forEach((col, colIdx) => {
      const cell = row.getCell(colIdx + 1);
      const baseFont = { name: 'Calibri', size: 10, color: { argb: COLORS.slate900 } };
      const baseAlign = {
        vertical: 'middle',
        horizontal: col.key === 'fish_name' || col.key === 'size' || col.key === 'order_code'
          ? 'left'
          : 'center',
        wrapText: col.key === 'fish_name',
      };
      let fill = solidFill(zebra);
      let font = { ...baseFont };
      if (col.key === 'stock_type') {
        fill = solidFill(typeColors.fill);
        font = { ...baseFont, bold: true, color: { argb: typeColors.font } };
      } else if (col.key === 'days_idle' || col.key === 'severity') {
        fill = solidFill(sev.fill);
        font = { ...baseFont, bold: true, color: { argb: sev.font } };
      } else if (col.key === 'fish_name') {
        font = { ...baseFont, bold: true };
      }
      applyCellStyle(cell, {
        font,
        fill,
        alignment: baseAlign,
        border: thinBorder(),
        numFmt: col.key === 'hand_on_balance_mc'
          ? '#,##0'
          : col.key === 'hand_on_balance_kg'
            ? '#,##0.0'
            : undefined,
      });
    });
  });
}

const DATA_COLUMNS = [
  { key: 'num', header: '#', width: 6 },
  { key: 'fish_name', header: 'Fish Name', width: 26 },
  { key: 'size', header: 'Size', width: 14 },
  { key: 'order_code', header: 'Order / Invoice', width: 18 },
  { key: 'location', header: 'Location', width: 14 },
  { key: 'stock_type', header: 'Type', width: 10 },
  { key: 'cs_in_date', header: 'CS-IN Date', width: 12 },
  { key: 'hand_on_balance_mc', header: 'Balance (MC)', width: 14 },
  { key: 'hand_on_balance_kg', header: 'Balance (KG)', width: 14 },
  { key: 'last_out_date', header: 'Last OUT', width: 12 },
  { key: 'days_idle', header: 'Days (CS-IN)', width: 14 },
  { key: 'severity', header: 'Severity', width: 11 },
];

const LAST_COL = DATA_COLUMNS.length;

/**
 * Build and download a styled No-Movement Excel report.
 * @param {Array} items — filtered rows (same shape as API)
 * @param {{ months: number, searchQuery?: string }} options
 */
export async function downloadNoMovementExcel(items, options = {}) {
  const { months = 3, searchQuery = '' } = options;
  const list = items || [];
  const totalMC = list.reduce((s, i) => s + Number(i.hand_on_balance_mc || 0), 0);
  const totalKG = list.reduce((s, i) => s + Number(i.hand_on_balance_kg || 0), 0);
  const criticalCount = list.filter((i) => Number(i.days_idle) >= 180).length;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WMS';
  workbook.created = new Date();
  workbook.modified = new Date();

  const sheet = workbook.addWorksheet('No-Movement', {
    properties: { defaultRowHeight: 20, showGridLines: false },
    pageSetup: {
      showGridLines: false,
    },
  });

  // No freeze panes — Excel table repeats header row only while scrolling data
  sheet.views = [{
    showGridLines: false,
    state: 'normal',
    activeCell: `A${ROW_DATA_START}`,
  }];

  DATA_COLUMNS.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width;
  });

  const endCol = sheet.getColumn(LAST_COL).letter;
  const totalRowNum = list.length > 0 ? ROW_DATA_START + list.length : ROW_HEADER + 1;

  // ── Title band ──
  sheet.mergeCells(`${sheet.getColumn(1).letter}${ROW_TITLE}:${endCol}${ROW_TITLE}`);
  const titleCell = sheet.getCell(ROW_TITLE, 1);
  titleCell.value = 'WMS — No-Movement Stocks Report';
  applyCellStyle(titleCell, {
    font: { name: 'Calibri', size: 18, bold: true, color: { argb: COLORS.white } },
    fill: solidFill(COLORS.brand),
    alignment: { vertical: 'middle', horizontal: 'center' },
  });
  sheet.getRow(ROW_TITLE).height = 40;

  // ── Meta ──
  sheet.mergeCells(`${sheet.getColumn(1).letter}${ROW_META}:${endCol}${ROW_META}`);
  const metaParts = [
    `Generated: ${bangkokLocaleString()}`,
    `Filter: CS-IN ${months}+ months ago`,
    `${list.length} item(s)`,
  ];
  if (searchQuery.trim()) metaParts.push(`Search: "${searchQuery.trim()}"`);
  const metaCell = sheet.getCell(ROW_META, 1);
  metaCell.value = metaParts.join('   |   ');
  applyCellStyle(metaCell, {
    font: { name: 'Calibri', size: 10, color: { argb: COLORS.slate600 } },
    fill: solidFill(COLORS.slate100),
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
  });
  sheet.getRow(ROW_META).height = 22;

  // ── KPI row ──
  const kpiSpan = Math.floor(LAST_COL / 4);
  const kpiBlocks = [
    { label: 'Total Items', value: list.length, accent: COLORS.indigo },
    { label: 'Total MC', value: totalMC.toLocaleString(), accent: COLORS.amber },
    { label: 'Total KG', value: totalKG.toLocaleString(undefined, { maximumFractionDigits: 1 }), accent: COLORS.emerald },
    { label: 'Critical (6M+)', value: criticalCount, accent: COLORS.red },
  ];
  let colStart = 1;
  kpiBlocks.forEach((kpi, i) => {
    const span = i < 3 ? kpiSpan : LAST_COL - colStart + 1;
    const c1 = sheet.getColumn(colStart).letter;
    const c2 = sheet.getColumn(colStart + span - 1).letter;
    if (span > 1) sheet.mergeCells(`${c1}${ROW_KPI}:${c2}${ROW_KPI}`);
    const cell = sheet.getCell(`${c1}${ROW_KPI}`);
    cell.value = `${kpi.label}:  ${kpi.value}`;
    applyCellStyle(cell, {
      font: { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.slate900 } },
      fill: solidFill(COLORS.white),
      alignment: { vertical: 'middle', horizontal: 'center' },
      border: {
        top: { style: 'medium', color: { argb: kpi.accent } },
        left: thinBorder().left,
        bottom: thinBorder().bottom,
        right: thinBorder().right,
      },
    });
    colStart += span;
  });
  sheet.getRow(ROW_KPI).height = 28;

  // Excel table (requires rows[]) — header repeats when scrolling; banner rows 1–3 scroll away
  if (list.length > 0) {
    sheet.addTable({
      name: 'NoMovementTable',
      ref: `A${ROW_HEADER}`,
      headerRow: true,
      totalsRow: false,
      style: {
        theme: 'TableStyleLight1',
        showRowStripes: false,
        showFirstColumn: false,
        showLastColumn: false,
      },
      columns: DATA_COLUMNS.map((c) => ({ name: c.header, filterButton: true })),
      rows: list.map(itemToTableRow),
    });
    styleTableRegion(sheet, list);
  }

  // ── Totals row (outside table) ──
  if (list.length > 0) {
    const totalRow = sheet.getRow(totalRowNum);
    totalRow.height = 26;
    DATA_COLUMNS.forEach((col, colIdx) => {
      const cell = totalRow.getCell(colIdx + 1);
      let value = '';
      if (col.key === 'fish_name') value = 'TOTAL';
      else if (col.key === 'hand_on_balance_mc') value = totalMC;
      else if (col.key === 'hand_on_balance_kg') value = totalKG;
      else if (col.key === 'num') value = list.length;

      cell.value = value;
      applyCellStyle(cell, {
        font: { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.white } },
        fill: solidFill(COLORS.brand),
        alignment: {
          vertical: 'middle',
          horizontal: col.key === 'fish_name' ? 'left' : 'center',
        },
        border: thinBorder('FF0D9488'),
        numFmt: col.key === 'hand_on_balance_mc'
          ? '#,##0'
          : col.key === 'hand_on_balance_kg'
            ? '#,##0.0'
            : undefined,
      });
    });
  }

  // Print area = used content only (clean blank margin in Excel)
  const printLastRow = list.length > 0 ? totalRowNum : ROW_KPI;
  sheet.pageSetup = {
    orientation: 'landscape',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    showGridLines: false,
    printArea: `A1:${endCol}${printLastRow}`,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
  sheet.headerFooter = {
    oddHeader: '&C&WMS No-Movement Stocks',
    oddFooter: `&LGenerated ${bangkokLocaleString()}&RPage &P of &N`,
  };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `No-Movement_Stocks_${months}M_${bangkokYYYYMMDD()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
