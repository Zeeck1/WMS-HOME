import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiPrinter, FiDownload, FiArrowLeft } from 'react-icons/fi';
import { toast } from 'react-toastify';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { getWithdrawal } from '../services/api';
import { sortLocationsNearestFirst } from '../config/warehouseConfig';
import { bangkokLocaleDateString } from '../utils/bangkokTime';

function WithdrawReport() {
  const { id } = useParams();
  const navigate = useNavigate();
  const reportRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line
  }, [id]);

  const fetchData = async () => {
    try {
      const res = await getWithdrawal(id);
      setData(res.data);
    } catch (err) {
      toast.error('Failed to load report data');
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!reportRef.current) return;
    try {
      toast.info('Generating PDF...');
      const canvas = await html2canvas(reportRef.current, {
        useCORS: true,
        scale: 2,
        logging: false,
        backgroundColor: '#ffffff'
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('l', 'mm', 'a4');
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW;
      const imgH = (canvas.height * pageW) / canvas.width;
      if (imgH > pageH) {
        pdf.addImage(imgData, 'PNG', 0, 0, imgW, pageH);
        const extra = imgH - pageH;
        const pages = Math.ceil(extra / pageH) + 1;
        for (let p = 1; p < pages; p++) {
          pdf.addPage();
          const y = -pageH * p;
          pdf.addImage(imgData, 'PNG', 0, y, imgW, imgH);
        }
      } else {
        pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);
      }
      const fileName = `stock-report-${data?.request_no || id || 'report'}.pdf`.replace(/\s+/g, '-');
      pdf.save(fileName);
      toast.success('PDF downloaded');
    } catch (err) {
      console.error(err);
      toast.error('Failed to download PDF');
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Loading report...</div>;
  if (!data) return <div className="page-body"><p>Withdrawal request not found.</p></div>;

  // Sort items by nearest location first (04, 08 = nearest; 01 = far; then by line A–DD)
  const items = sortLocationsNearestFirst(data.items || [], 'line_place');

  const requestedMc = (it) => Number(it.requested_mc ?? it.quantity_mc ?? 0);
  /** Actual picked qty for this line — same as Withdraw form (not live stock balance) */
  const actualMc = (it) => Number(it.quantity_mc ?? 0);

  return (
    <>
      {/* Action bar — hidden when printing */}
      <div className="page-header no-print">
        <h2>Stock Report — {data.request_no}</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-outline" onClick={() => navigate(-1)}>
            <FiArrowLeft /> Back
          </button>
          <button className="btn btn-primary" onClick={() => window.print()}>
            <FiPrinter /> Print
          </button>
          <button className="btn btn-success" onClick={handleDownloadPDF}>
            <FiDownload /> Download PDF
          </button>
        </div>
      </div>

      {/* Printable report */}
      <div className="wr-page" ref={reportRef}>
        <div className="wr-report">
          {/* Report header */}
          <div className="wr-header">
            <h1 className="wr-title">Stock Report</h1>
            <div className="wr-meta">
              <span><strong>Request No:</strong> {data.request_no}</span>
              <span><strong>Department:</strong> {data.department}</span>
              <span><strong>Date:</strong> {bangkokLocaleDateString(new Date(data.withdraw_date || data.created_at), { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
              <span><strong>Status:</strong> {data.status}</span>
            </div>
          </div>

          {/* Stock table — matching the Excel layout */}
          <table className="wr-table">
            <thead>
              <tr>
                <th>Fish Name</th>
                <th>Size</th>
                <th>Bulk Weight</th>
                <th>Type</th>
                <th>Glazing</th>
                <th>Sticker</th>
                <th>Lines / Place</th>
                <th>Stack No</th>
                <th>Request MC</th>
                <th className="wr-col-balance">Actual (MC)</th>
                <th className="wr-col-remark">Remark</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const reqMc = requestedMc(item);
                const actMc = actualMc(item);
                const actualDiffers = actMc !== reqMc;
                return (
                <tr key={item.id}>
                  <td className="wr-bold">
                    {(item.stock_type === 'CONTAINER_EXTRA' || item.stock_type === 'IMPORT') && item.order_code
                      ? `${item.fish_name} (${item.order_code})`
                      : item.fish_name}
                  </td>
                  <td className="wr-center">{item.size}</td>
                  <td className="wr-center">{Number(item.bulk_weight_kg)} KG</td>
                  <td className="wr-center">{item.type || ''}</td>
                  <td className="wr-center">{item.glazing || ''}</td>
                  <td className="wr-center">{item.sticker || ''}</td>
                  <td className="wr-center wr-bold">{item.line_place}</td>
                  <td className="wr-center">{item.stack_no || ''}</td>
                  <td className="wr-center">{reqMc}</td>
                  <td className={`wr-center ${actualDiffers ? 'wr-balance' : ''}`}>{actMc}</td>
                  <td className="wr-remark-cell" aria-label="Remark (handwriting)" />
                </tr>
              );
              })}
            </tbody>
          </table>

          {/* Summary */}
          <div className="wr-summary">
            <div className="wr-summary-item">
              <span className="wr-summary-label">Total Items</span>
              <span className="wr-summary-value">{items.length}</span>
            </div>
            <div className="wr-summary-item">
              <span className="wr-summary-label">Requested (MC)</span>
              <span className="wr-summary-value">{items.reduce((s, it) => s + requestedMc(it), 0)}</span>
            </div>
            <div className="wr-summary-item">
              <span className="wr-summary-label">Actual (MC)</span>
              <span className="wr-summary-value">{items.reduce((s, it) => s + actualMc(it), 0)}</span>
            </div>
            <div className="wr-summary-item">
              <span className="wr-summary-label">Total KG</span>
              <span className="wr-summary-value">{items.reduce((s, it) => s + (Number(it.quantity_mc) * Number(it.bulk_weight_kg)), 0).toFixed(1)}</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default WithdrawReport;
