import ExcelJS from 'exceljs';
import {
  bangkokYYYYMMDD,
  bangkokLocaleString,
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
  emerald: 'FF10B981',
  indigo: 'FF6366F1',
  blue: 'FF3B82F6',
  violet: 'FF8B5CF6',
  typeBulk: 'FFF1F5F9',
  typeImport: 'FFEFF6FF',
  typeExtra: 'FFF5F3FF',
  typeBulkFont: 'FF334155',
  typeImportFont: 'FF1D4ED8',
  typeExtraFont: 'FF6D28D9',
};

const ROW_TITLE = 1;
const ROW_META = 2;
const ROW_KPI = 3;
const ROW_HEADER = 4;
const ROW_DATA_START = 5;

const BULK_LABELS = {
  fish_name: 'Fish Name',
  size: 'Size',
  bulk_weight_kg: 'Bulk Wt (KG)',
  type: 'Type',
  glazing: 'Glazing',
  cs_in_date: 'CS In Date',
  sticker: 'Sticker',
  lot_no_numeric: 'Lot No',
  line_place: 'Lines / Place',
  stack_no: 'Stack No',
  stack_total: 'Stack Total',
  old_balance_mc: 'Old Balance',
  new_income_mc: 'New Income',
  hand_on_balance_mc: 'Hand On (MC)',
  hand_on_balance_kg: 'Hand On (KG)',
};

const NUMERIC_KEYS = new Set([
  'bulk_weight_kg',
  'old_balance_mc',
  'new_income_mc',
  'hand_on_balance_mc',
  'hand_on_balance_kg',
  'stack_no',
  'stack_total',
]);

const COL_WIDTHS = {
  _num: 6,
  fish_name: 24,
  size: 12,
  bulk_weight_kg: 12,
  type: 10,
  glazing: 10,
  cs_in_date: 12,
  sticker: 10,
  lot_no_numeric: 10,
  line_place: 14,
  stack_no: 10,
  stack_total: 11,
  old_balance_mc: 12,
  new_income_mc: 12,
  hand_on_balance_mc: 14,
  hand_on_balance_kg: 14,
  order_code: 16,
  production_date: 14,
  expiration_date: 14,
  country: 12,
  st_no: 10,
  remark: 18,
};

const BULK_AGGREGATE_KEYS = ['old_balance_mc', 'new_income_mc', 'hand_on_balance_mc', 'hand_on_balance_kg'];

function tabAccent(activeTab) {
  if (activeTab === 'IMPORT') return COLORS.blue;
  if (activeTab === 'CONTAINER_EXTRA') return COLORS.violet;
  return COLORS.brand;
}

function tabTitle(activeTab) {
  if (activeTab === 'IMPORT') return 'Import';
  if (activeTab === 'CONTAINER_EXTRA') return 'Container Extra';
  return 'Bulk';
}

function tabSheetName(activeTab) {
  if (activeTab === 'IMPORT') return 'Import Stock';
  if (activeTab === 'CONTAINER_EXTRA') return 'Container Extra';
  return 'Bulk Stock';
}

function filePrefix(activeTab) {
  if (activeTab === 'IMPORT') return 'Import';
  if (activeTab === 'CONTAINER_EXTRA') return 'Container_Extra';
  return 'Bulk';
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

function buildExportColumns(activeTab, options) {
  const {
    bulkTableColumns = [],
    visibleColumns = [],
  } = options;

  const numCol = { key: '_num', header: '#', width: 6, align: 'center' };

  if (activeTab === 'BULK') {
    return [
      numCol,
      ...bulkTableColumns.map((c) => ({
        key: c.key,
        header: BULK_LABELS[c.key] || c.label,
        width: COL_WIDTHS[c.key] || 14,
        align: c.key === 'fish_name' ? 'left' : 'center',
        isNumeric: NUMERIC_KEYS.has(c.key),
        isAggregate: BULK_AGGREGATE_KEYS.includes(c.key),
      })),
    ];
  }

  if (activeTab === 'CONTAINER_EXTRA') {
    return [
      numCol,
      ...visibleColumns.map((c) => ({
        key: c.key,
        header: c.label || c.key,
        width: COL_WIDTHS[c.key] || 14,
        align: c.key === 'fish_name' || c.key === 'remark' ? 'left' : 'center',
        isNumeric: NUMERIC_KEYS.has(c.key),
        isAggregate: c.key === 'hand_on_balance_mc' || c.key === 'hand_on_balance_kg',
      })),
    ];
  }

  // IMPORT
  const orderHeader = 'Invoice No';
  return [
    numCol,
    { key: 'order_code', header: orderHeader, width: COL_WIDTHS.order_code, align: 'center' },
    { key: 'fish_name', header: 'Fish Name', width: COL_WIDTHS.fish_name, align: 'left' },
    { key: 'size', header: 'Size', width: COL_WIDTHS.size, align: 'center' },
    { key: 'bulk_weight_kg', header: 'KG', width: COL_WIDTHS.bulk_weight_kg, align: 'center', isNumeric: true },
    { key: 'cs_in_date', header: 'Arrival Date', width: COL_WIDTHS.cs_in_date, align: 'center' },
    { key: 'country', header: 'Country', width: COL_WIDTHS.country, align: 'center' },
    { key: 'hand_on_balance_kg', header: 'Total KG', width: COL_WIDTHS.hand_on_balance_kg, align: 'center', isNumeric: true, isAggregate: true },
    { key: 'hand_on_balance_mc', header: 'Balance MC', width: COL_WIDTHS.hand_on_balance_mc, align: 'center', isNumeric: true, isAggregate: true },
    { key: 'line_place', header: 'Line', width: COL_WIDTHS.line_place, align: 'center' },
    { key: 'remark', header: 'Remark', width: COL_WIDTHS.remark, align: 'left' },
  ];
}

function cellValue(row, col, rowIndex) {
  if (col.key === '_num') return rowIndex + 1;
  const v = row[col.key];
  if (col.isNumeric) return Number(v ?? 0);
  if (v == null || v === '') return '';
  return v;
}

function totalValue(col, totals, activeTab, rowCount) {
  if (col.key === '_num') return rowCount;
  if (col.key === 'fish_name') return 'TOTAL';
  if (activeTab === 'BULK' && col.key === 'stack_total') return totals.totalStacks ?? '';
  if (col.key === 'hand_on_balance_mc') return totals.totalMC ?? 0;
  if (col.key === 'hand_on_balance_kg') return totals.totalKG ?? 0;
  return '';
}

function rowToTableValues(row, columns, rowIndex) {
  return columns.map((col) => cellValue(row, col, rowIndex));
}

function styleDataRows(sheet, columns, list, activeTab) {
  const headerRow = sheet.getRow(ROW_HEADER);
  headerRow.height = 26;
  columns.forEach((col, idx) => {
    applyCellStyle(headerRow.getCell(idx + 1), {
      font: { name: 'Calibri', size: 10, bold: true, color: { argb: COLORS.white } },
      fill: solidFill(COLORS.brandDark),
      alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
      border: thinBorder('FF0D9488'),
    });
  });

  const typeFill =
    activeTab === 'IMPORT'
      ? COLORS.typeImport
      : activeTab === 'CONTAINER_EXTRA'
        ? COLORS.typeExtra
        : COLORS.typeBulk;
  const typeFont =
    activeTab === 'IMPORT'
      ? COLORS.typeImportFont
      : activeTab === 'CONTAINER_EXTRA'
        ? COLORS.typeExtraFont
        : COLORS.typeBulkFont;

  list.forEach((row, index) => {
    const excelRow = sheet.getRow(ROW_DATA_START + index);
    const zebra = index % 2 === 1 ? COLORS.slate50 : COLORS.white;
    excelRow.height = 22;

    columns.forEach((col, colIdx) => {
      const cell = excelRow.getCell(colIdx + 1);
      const isLeft = col.align === 'left';
      const isFish = col.key === 'fish_name';
      const isMc = col.key === 'hand_on_balance_mc';
      const isKg = col.key === 'hand_on_balance_kg';

      applyCellStyle(cell, {
        font: {
          name: 'Calibri',
          size: 10,
          bold: isFish,
          color: { argb: isMc ? COLORS.brandDark : isKg ? COLORS.emerald : COLORS.slate900 },
        },
        fill: solidFill(zebra),
        alignment: {
          vertical: 'middle',
          horizontal: isLeft ? 'left' : 'center',
          wrapText: isFish,
        },
        border: thinBorder(),
        numFmt: col.isNumeric
          ? col.key === 'hand_on_balance_kg' || col.key === 'bulk_weight_kg'
            ? '#,##0.00'
            : '#,##0'
          : undefined,
      });

      if (col.key === 'order_code' && row.order_code) {
        applyCellStyle(cell, {
          font: { name: 'Calibri', size: 10, bold: true, color: { argb: typeFont } },
          fill: solidFill(typeFill),
        });
      }
    });
  });
}

/**
 * @param {Object} options
 * @param {'BULK'|'CONTAINER_EXTRA'|'IMPORT'} options.activeTab
 * @param {Array} options.rows — filtered inventory rows
 * @param {{ totalMC: number, totalKG: number, totalStacks?: number }} options.totals
 * @param {Array} [options.bulkTableColumns]
 * @param {Array} [options.visibleColumns]
 * @param {string} [options.searchQuery]
 * @param {number} [options.filterCount]
 */
export async function downloadStockSummaryExcel(options = {}) {
  const {
    activeTab = 'BULK',
    rows = [],
    totals = {},
    bulkTableColumns = [],
    visibleColumns = [],
    searchQuery = '',
    filterCount = 0,
  } = options;

  const list = rows || [];
  const columns = buildExportColumns(activeTab, { bulkTableColumns, visibleColumns });
  const lastCol = columns.length;
  const accent = tabAccent(activeTab);
  const totalMC = Number(totals.totalMC) || 0;
  const totalKG = Number(totals.totalKG) || 0;
  const totalStacks = Number(totals.totalStacks) || 0;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WMS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(tabSheetName(activeTab), {
    properties: { defaultRowHeight: 20, showGridLines: false },
    pageSetup: { showGridLines: false },
  });

  sheet.views = [{
    showGridLines: false,
    state: 'normal',
    activeCell: `A${ROW_DATA_START}`,
  }];

  columns.forEach((col, idx) => {
    sheet.getColumn(idx + 1).width = col.width;
  });

  const endCol = sheet.getColumn(lastCol).letter;
  const totalRowNum = list.length > 0 ? ROW_DATA_START + list.length : ROW_HEADER + 1;

  // Title
  sheet.mergeCells(`A${ROW_TITLE}:${endCol}${ROW_TITLE}`);
  const titleCell = sheet.getCell(ROW_TITLE, 1);
  titleCell.value = `WMS — Stock Summary (${tabTitle(activeTab)})`;
  applyCellStyle(titleCell, {
    font: { name: 'Calibri', size: 18, bold: true, color: { argb: COLORS.white } },
    fill: solidFill(accent),
    alignment: { vertical: 'middle', horizontal: 'center' },
  });
  sheet.getRow(ROW_TITLE).height = 40;

  // Meta
  sheet.mergeCells(`A${ROW_META}:${endCol}${ROW_META}`);
  const metaParts = [
    `Generated: ${bangkokLocaleString()}`,
    `Stock type: ${tabTitle(activeTab)}`,
    `${list.length} line(s)`,
  ];
  if (searchQuery.trim()) metaParts.push(`Search: "${searchQuery.trim()}"`);
  if (filterCount > 0) metaParts.push(`${filterCount} column filter(s)`);
  const metaCell = sheet.getCell(ROW_META, 1);
  metaCell.value = metaParts.join('   |   ');
  applyCellStyle(metaCell, {
    font: { name: 'Calibri', size: 10, color: { argb: COLORS.slate600 } },
    fill: solidFill(COLORS.slate100),
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
  });
  sheet.getRow(ROW_META).height = 24;

  // KPI
  const kpiSpan = Math.max(1, Math.floor(lastCol / 4));
  const kpiBlocks =
    activeTab === 'BULK'
      ? [
          { label: 'Total Lines', value: list.length, accent: COLORS.indigo },
          { label: 'Total MC', value: totalMC.toLocaleString(), accent: COLORS.amber },
          { label: 'Total KG', value: totalKG.toLocaleString(undefined, { maximumFractionDigits: 1 }), accent: COLORS.emerald },
          { label: 'Line / Stack pairs', value: totalStacks, accent: COLORS.brand },
        ]
      : [
          { label: 'Total Lines', value: list.length, accent: COLORS.indigo },
          { label: 'Total MC', value: totalMC.toLocaleString(), accent: COLORS.amber },
          { label: 'Total KG', value: totalKG.toLocaleString(undefined, { maximumFractionDigits: 1 }), accent: COLORS.emerald },
          { label: 'Stock Type', value: tabTitle(activeTab), accent },
        ];

  let colStart = 1;
  kpiBlocks.forEach((kpi, i) => {
    const span = i < 3 ? kpiSpan : lastCol - colStart + 1;
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

  if (list.length > 0) {
    sheet.addTable({
      name: `StockSummary_${activeTab}`,
      ref: `A${ROW_HEADER}`,
      headerRow: true,
      totalsRow: false,
      style: {
        theme: 'TableStyleLight1',
        showRowStripes: false,
        showFirstColumn: false,
        showLastColumn: false,
      },
      columns: columns.map((c) => ({ name: c.header, filterButton: true })),
      rows: list.map((row, i) => rowToTableValues(row, columns, i)),
    });
    styleDataRows(sheet, columns, list, activeTab);
  }

  if (list.length > 0) {
    const totalRow = sheet.getRow(totalRowNum);
    totalRow.height = 26;
    columns.forEach((col, colIdx) => {
      const cell = totalRow.getCell(colIdx + 1);
      const value = totalValue(col, totals, activeTab, list.length);
      cell.value = value;
      const isNumericTotal = col.isAggregate || col.key === '_num';
      applyCellStyle(cell, {
        font: { name: 'Calibri', size: 11, bold: true, color: { argb: COLORS.white } },
        fill: solidFill(COLORS.brand),
        alignment: {
          vertical: 'middle',
          horizontal: col.align === 'left' ? 'left' : 'center',
        },
        border: thinBorder('FF0D9488'),
        numFmt:
          col.key === 'hand_on_balance_kg'
            ? '#,##0.00'
            : col.key === 'hand_on_balance_mc' || col.key === 'stack_total'
              ? '#,##0'
              : undefined,
      });
      if (!isNumericTotal && col.key !== 'fish_name' && col.key !== '_num') {
        if (value === '') cell.value = '';
      }
    });
  }

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
    oddHeader: `&C&WMS Stock Summary — ${tabTitle(activeTab)}`,
    oddFooter: `&LGenerated ${bangkokLocaleString()}&RPage &P of &N`,
  };

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `WMS_${filePrefix(activeTab)}_Stock_${bangkokYYYYMMDD()}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
