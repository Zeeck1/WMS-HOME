import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { toast } from 'react-toastify';
import {
  FiAlertTriangle, FiDownload, FiSearch,
  FiRefreshCw, FiClock, FiPackage, FiMapPin
} from 'react-icons/fi';
import { SiLine, SiGmail } from 'react-icons/si';
import { getNoMovementStocks, sendLineNotification, sendEmailReport } from '../services/api';

export default function NoMovementStocks() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [months, setMonths] = useState(3);
  const [sendingLine, setSendingLine] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const reportRef = useRef(null);

  const filteredItems = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return items;
    return items.filter(i => {
      const fish = (i.fish_name || '').toLowerCase();
      const order = (i.order_code || '').toLowerCase();
      const loc = (i.line_place || i.location_code || '').toLowerCase();
      return fish.includes(q) || order.includes(q) || loc.includes(q);
    });
  }, [items, searchQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getNoMovementStocks({ months });
      setItems(data);
    } catch (err) {
      toast.error('Failed to load no-movement stocks');
    } finally {
      setLoading(false);
    }
  }, [months]);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  const buildTextReport = (list = filteredItems) => {
    let text = `\n📦 No-Movement Stocks Report (by CS-IN Date)\n📅 ${today} | CS-IN ${months}+ months ago\n${'─'.repeat(40)}\n`;
    if (list.length === 0) { text += '\nNo items found.\n'; return text; }
    list.forEach((item, i) => {
      text += `\n${i + 1}. ${item.fish_name}`;
      if (item.order_code) text += ` (${item.order_code})`;
      text += `\n   Loc: ${item.line_place || item.location_code} | MC: ${Number(item.hand_on_balance_mc)} | KG: ${Number(item.hand_on_balance_kg).toFixed(1)}`;
      text += `\n   CS-IN: ${item.cs_in_date ? new Date(item.cs_in_date).toLocaleDateString('en-GB') : '—'} | Days since CS-IN: ${item.days_idle}`;
      if (item.last_out_date) text += ` | Last OUT: ${new Date(item.last_out_date).toLocaleDateString('en-GB')}`;
      text += '\n';
    });
    text += `\n${'─'.repeat(40)}\nTotal: ${list.length} item(s)`;
    return text;
  };

  const handleSendLine = async () => {
    if (filteredItems.length === 0) { toast.warning('No data to send'); return; }
    setSendingLine(true);
    try {
      await sendLineNotification({ message: buildTextReport() });
      toast.success('Report sent to LINE successfully!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send to LINE');
    } finally {
      setSendingLine(false);
    }
  };

  const handleSendEmail = async () => {
    if (filteredItems.length === 0) { toast.warning('No data to send'); return; }
    setSendingEmail(true);
    try {
      const pdfBase64 = await generatePdfBase64();
      await sendEmailReport({
        subject: `No-Movement Stocks Report - ${today}`,
        body: buildTextReport(),
        pdfBase64
      });
      toast.success('Report sent via Email successfully!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send email');
    } finally {
      setSendingEmail(false);
    }
  };

  const generatePdfBase64 = async () => {
    try {
      const html2canvas = (await import('html2canvas')).default;
      const jsPDF = (await import('jspdf')).default;
      const el = reportRef.current;
      if (!el) return null;
      const canvas = await html2canvas(el, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = (canvas.height * pdfW) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
      return pdf.output('datauristring').split(',')[1];
    } catch {
      return null;
    }
  };

  const handleDownloadPdf = async () => {
    if (filteredItems.length === 0) { toast.warning('No data to download'); return; }
    try {
      const html2canvas = (await import('html2canvas')).default;
      const jsPDF = (await import('jspdf')).default;
      const el = reportRef.current;
      if (!el) return;
      const canvas = await html2canvas(el, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfW = pdf.internal.pageSize.getWidth();
      const pdfH = (canvas.height * pdfW) / canvas.width;
      let position = 0;
      const pageHeight = pdf.internal.pageSize.getHeight();
      if (pdfH <= pageHeight) {
        pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);
      } else {
        while (position < pdfH) {
          if (position > 0) pdf.addPage();
          pdf.addImage(imgData, 'PNG', 0, -position, pdfW, pdfH);
          position += pageHeight;
        }
      }
      pdf.save(`no-movement-stocks-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success('PDF downloaded!');
    } catch {
      toast.error('Failed to generate PDF');
    }
  };

  const severityColor = (days) => {
    if (days >= 180) return '#dc2626';
    if (days >= 120) return '#ea580c';
    return '#f59e0b';
  };

  const totalMC = filteredItems.reduce((s, i) => s + Number(i.hand_on_balance_mc || 0), 0);
  const totalKG = filteredItems.reduce((s, i) => s + Number(i.hand_on_balance_kg || 0), 0);

  return (
    <div className="page-container">
      <div className="nm-page">
        {/* Header */}
        <div className="nm-header">
          <div className="nm-header-left">
            <FiAlertTriangle className="nm-header-icon" />
            <div>
              <h2 className="nm-title">No-Movement Stocks</h2>
              <p className="nm-subtitle">Items with CS-IN Date {months}+ months ago (from Stock Table)</p>
            </div>
          </div>
          <div className="nm-header-actions">
            <select value={months} onChange={e => setMonths(Number(e.target.value))} className="nm-month-select">
              <option value={3}>3+ Months</option>
              <option value={6}>6+ Months</option>
              <option value={9}>9+ Months</option>
              <option value={12}>12+ Months</option>
            </select>
            <button onClick={load} className="nm-btn nm-btn-outline" disabled={loading}>
              <FiRefreshCw className={loading ? 'spin' : ''} /> Refresh
            </button>
            <button onClick={handleDownloadPdf} className="nm-btn nm-btn-primary" disabled={filteredItems.length === 0}>
              <FiDownload /> PDF
            </button>
            <button onClick={handleSendLine} className="nm-btn nm-btn-line" disabled={sendingLine || filteredItems.length === 0}>
              <SiLine className="nm-btn-brand-icon" /> {sendingLine ? 'Sending...' : 'LINE'}
            </button>
            <button onClick={handleSendEmail} className="nm-btn nm-btn-gmail" disabled={sendingEmail || filteredItems.length === 0}>
              <SiGmail className="nm-btn-brand-icon" /> {sendingEmail ? 'Sending...' : 'Gmail'}
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="nm-search-bar">
          <FiSearch className="nm-search-icon" />
          <input
            type="text"
            className="nm-search-input"
            placeholder="Search by fish name, order code, or location..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery.trim() && (
            <button type="button" className="nm-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>

        {/* Summary cards */}
        <div className="nm-summary">
          <div className="nm-card nm-card-total">
            <FiPackage />
            <div className="nm-card-info">
              <span className="nm-card-value">{filteredItems.length}</span>
              <span className="nm-card-label">Total Items</span>
            </div>
          </div>
          <div className="nm-card nm-card-mc">
            <FiAlertTriangle />
            <div className="nm-card-info">
              <span className="nm-card-value">{totalMC.toLocaleString()}</span>
              <span className="nm-card-label">Total MC</span>
            </div>
          </div>
          <div className="nm-card nm-card-kg">
            <FiMapPin />
            <div className="nm-card-info">
              <span className="nm-card-value">{totalKG.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
              <span className="nm-card-label">Total KG</span>
            </div>
          </div>
          <div className="nm-card nm-card-severe">
            <FiClock />
            <div className="nm-card-info">
              <span className="nm-card-value">{filteredItems.filter(i => i.days_idle >= 180).length}</span>
              <span className="nm-card-label">Critical (6M+)</span>
            </div>
          </div>
        </div>

        {/* Report area (for PDF capture) */}
        <div ref={reportRef} className="nm-report">
          <div className="nm-report-header">
            <h3>No-Movement Stocks Report</h3>
            <p>{today} &nbsp;|&nbsp; CS-IN Date {months}+ months ago &nbsp;|&nbsp; {filteredItems.length} item(s){searchQuery.trim() ? ' (filtered)' : ''}</p>
          </div>
          {loading ? (
            <div className="nm-loading">Loading...</div>
          ) : filteredItems.length === 0 ? (
            <div className="nm-empty">
              <FiPackage size={48} />
              <h3>{items.length === 0 ? 'All Clear!' : 'No matches'}</h3>
              <p>{items.length === 0 ? `No items found with CS-IN Date ${months}+ months ago.` : 'Try a different search term.'}</p>
            </div>
          ) : (
            <table className="nm-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fish Name</th>
                  <th>Location</th>
                  <th>Type</th>
                  <th>CS-IN Date</th>
                  <th>Balance MC</th>
                  <th>Balance KG</th>
                  <th>Last OUT</th>
                  <th>Days (since CS-IN)</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, idx) => (
                  <tr key={`${item.lot_id}-${item.location_id}`}>
                    <td className="nm-cell-num">{idx + 1}</td>
                    <td className="nm-cell-name">
                      {item.fish_name}
                      {item.order_code && <span className="nm-order-tag">{item.order_code}</span>}
                    </td>
                    <td>{item.line_place || item.location_code}</td>
                    <td>
                      <span className={`nm-type-badge ${item.stock_type === 'CONTAINER_EXTRA' ? 'nm-type-extra' : item.stock_type === 'IMPORT' ? 'nm-type-import' : 'nm-type-bulk'}`}>
                        {item.stock_type === 'CONTAINER_EXTRA' ? 'EXTRA' : item.stock_type === 'IMPORT' ? 'IMPORT' : 'BULK'}
                      </span>
                    </td>
                    <td>{item.cs_in_date ? new Date(item.cs_in_date).toLocaleDateString('en-GB') : '—'}</td>
                    <td className="nm-cell-num">{Number(item.hand_on_balance_mc)}</td>
                    <td className="nm-cell-num">{Number(item.hand_on_balance_kg).toFixed(1)}</td>
                    <td>{item.last_out_date ? new Date(item.last_out_date).toLocaleDateString('en-GB') : '—'}</td>
                    <td>
                      <span className="nm-days-badge" style={{ backgroundColor: severityColor(item.days_idle) + '18', color: severityColor(item.days_idle), borderColor: severityColor(item.days_idle) + '40' }}>
                        {item.days_idle} days
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
