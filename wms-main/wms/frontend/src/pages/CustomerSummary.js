import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { FiSearch, FiPackage, FiArrowDownCircle, FiArrowUpCircle, FiBox, FiChevronDown, FiChevronRight, FiDownload } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getCustomers, getCustomerSummary, getDepositItemDetail } from '../services/api';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

const toDate = (d) => d ? (typeof d === 'string' ? d.split('T')[0] : new Date(d).toISOString().split('T')[0]) : '';
const fmtNum = (v, dec = 2) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });

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
      'IN Kg': Number(it.weight_kg || 0),
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
    XLSX.writeFile(wb, `Customer_Summary_${viewLabel.replace(/\s/g, '_')}_${toDate(new Date().toISOString())}.xlsx`);
    toast.success('Excel downloaded');
  };

  const downloadPDF = async () => {
    if (!printRef.current) return;
    toast.info('Generating PDF...');
    try {
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true, backgroundColor: '#fff' });
      const imgData = canvas.toDataURL('image/png');
      const imgW = canvas.width;
      const imgH = canvas.height;
      const pdfW = 297;
      const pdfH = (imgH * pdfW) / imgW;
      const pdf = new jsPDF({ orientation: pdfW > pdfH ? 'landscape' : 'landscape', unit: 'mm', format: [pdfW, Math.max(pdfH, 210)] });
      pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
      pdf.save(`Customer_Summary_${viewLabel.replace(/\s/g, '_')}_${toDate(new Date().toISOString())}.pdf`);
      toast.success('PDF downloaded');
    } catch { toast.error('Failed to generate PDF'); }
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
            <th className="csm-th-num" style={{ width: 80 }}>IN Kg</th>
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
                  <td className="num-cell">{fmtNum(it.weight_kg)}</td>
                  <td className="num-cell">{Number(it.total_out_boxes || 0).toLocaleString()}</td>
                  <td className="num-cell">{fmtNum(it.total_out_kg)}</td>
                  <td className="num-cell" style={{ fontWeight: 600, color: isZero ? '#aaa' : '#1a7f37' }}>{balBoxes.toLocaleString()}</td>
                  <td className="num-cell" style={{ fontWeight: 600, color: isZero ? '#aaa' : '#1a7f37' }}>{fmtNum(balKg)}</td>
                </tr>
                {isExpanded && (
                  <tr className="csm-detail-row">
                    <td colSpan={11}>
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
