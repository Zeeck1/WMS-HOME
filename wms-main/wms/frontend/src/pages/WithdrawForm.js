import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiPrinter, FiDownload, FiArrowLeft, FiCamera } from 'react-icons/fi';
import { toast } from 'react-toastify';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { getWithdrawal } from '../services/api';
import { sortLocationsNearestFirst } from '../config/warehouseConfig';

function WithdrawForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const formRef = useRef(null);
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
      toast.error('Failed to load withdrawal data');
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadPDF = async () => {
    if (!formRef.current) return;
    try {
      toast.info('Generating PDF...');
      const canvas = await html2canvas(formRef.current, {
        useCORS: true,
        scale: 2,
        logging: false,
        backgroundColor: '#ffffff'
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
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
      const fileName = `withdraw-form-${data?.request_no || id || 'form'}.pdf`.replace(/\s+/g, '-');
      pdf.save(fileName);
      toast.success('PDF downloaded');
    } catch (err) {
      console.error(err);
      toast.error('Failed to download PDF');
    }
  };

  const handleScreenShot = async () => {
    if (!formRef.current) return;
    try {
      toast.info('Capturing screenshot...');
      const canvas = await html2canvas(formRef.current, {
        useCORS: true,
        scale: 2,
        logging: false,
        backgroundColor: '#ffffff'
      });
      const link = document.createElement('a');
      const fileName = `withdraw-form-${data?.request_no || id || 'form'}.png`.replace(/\s+/g, '-');
      link.download = fileName;
      link.href = canvas.toDataURL('image/png');
      link.click();
      toast.success('Screenshot downloaded');
    } catch (err) {
      console.error(err);
      toast.error('Failed to capture screenshot');
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Loading form...</div>;
  if (!data) return <div className="page-body"><p>Withdrawal request not found.</p></div>;

  // Sort items by nearest location first (04, 08 = nearest; 01 = far; then by line A–DD)
  const items = sortLocationsNearestFirst(data.items || [], 'line_place');

  // Use withdraw_date if available, otherwise fall back to created_at
  const formDate = data.withdraw_date
    ? new Date(data.withdraw_date)
    : new Date(data.created_at);
  const dateStr = formDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Request time
  const requestTimeStr = data.request_time
    ? data.request_time.slice(0, 5)  // "HH:MM"
    : '';

  // Time out = finished_at timestamp
  const finishedAtStr = data.finished_at
    ? new Date(data.finished_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : '';

  // Calculate totals
  const totalRequestMC = items.reduce((s, it) => s + Number(it.requested_mc || it.quantity_mc), 0);
  const totalActualMC = items.reduce((s, it) => s + Number(it.quantity_mc), 0);
  const totalNetKG = items.reduce((s, it) => s + (Number(it.quantity_mc) * Number(it.bulk_weight_kg)), 0);

  // Pad to minimum 10 rows for the form
  const minRows = 10;
  const emptyRows = Math.max(0, minRows - items.length);

  return (
    <>
      {/* Action bar — hidden when printing */}
      <div className="page-header no-print">
        <h2>Withdraw Form</h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-outline" onClick={() => navigate(-1)}>
            <FiArrowLeft /> Back
          </button>
          <button className="btn btn-primary" onClick={handlePrint}>
            <FiPrinter /> Print
          </button>
          <button className="btn btn-success" onClick={handleDownloadPDF}>
            <FiDownload /> Download PDF
          </button>
          <button className="btn btn-outline" onClick={handleScreenShot}>
            <FiCamera /> Screen Shot
          </button>
        </div>
      </div>

      {/* Printable form */}
      <div className="wf-page" ref={formRef}>
        <div className="wf-form">
          {/* Form header */}
          <div className="wf-header">
            <div className="wf-title-area">
              <h1 className="wf-title-th">ขอเบิกสินค้าออกจากห้องเย็น</h1>
              <h2 className="wf-title-en">(WITHDRAW LIST)</h2>
            </div>
            <div className="wf-ref">FM-CS-002.1 Rev.00</div>
          </div>

          {/* Form meta row */}
          <div className="wf-meta">
            <div className="wf-meta-item">
              <span className="wf-meta-label">DATE (วันที่) :</span>
              <span className="wf-meta-value">{dateStr}</span>
            </div>
            <div className="wf-meta-item">
              <span className="wf-meta-label">DEP (แผนก) :</span>
              <span className="wf-meta-value wf-meta-dept">{data.department}</span>
            </div>
            <div className="wf-meta-item">
              <span className="wf-meta-label">Request No :</span>
              <span className="wf-meta-value">{data.request_no}</span>
            </div>
          </div>

          {/* Main table */}
          <table className="wf-table">
            <thead>
              <tr>
                <th className="wf-col-no">NO.</th>
                <th className="wf-col-origin">ORIGIN</th>
                <th className="wf-col-product">PRODUCT NAME</th>
                <th className="wf-col-size">SIZE</th>
                <th className="wf-col-req-pkg">
                  <div>REQUEST OF</div>
                  <div>PACKAGE</div>
                  <div className="wf-th-sub">CTN</div>
                </th>
                <th className="wf-col-req-time">
                  <div>REQUEST</div>
                  <div>TIME</div>
                </th>
                <th className="wf-col-act-pkg">
                  <div>ACTUAL OF</div>
                  <div>PACKAGE</div>
                  <div className="wf-th-sub">CTN</div>
                </th>
                <th className="wf-col-weight">
                  <div>NET WEIGHT</div>
                  <div className="wf-th-sub">KG.</div>
                </th>
                <th className="wf-col-timeout">Time out</th>
                <th className="wf-col-process">
                  <div>PRODUCTION</div>
                  <div>PROCESS</div>
                </th>
                <th className="wf-col-remark">Remark</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, i) => {
                const requestedMc = Number(item.requested_mc || item.quantity_mc);
                const actualMc = Number(item.quantity_mc);
                const netKg = actualMc * Number(item.bulk_weight_kg);
                const st = item.stock_type || 'BULK';
                const originDisplay = st === 'CONTAINER_EXTRA' ? (item.order_code || 'EXTRA')
                  : st === 'IMPORT' ? (item.order_code || 'IMPORT')
                  : 'SCK';
                // Only show actual/weight after manager has confirmed (status past PENDING)
                const showActual = data.status !== 'PENDING';
                return (
                  <tr key={item.id}>
                    <td className="wf-center">{i + 1}</td>
                    <td className="wf-center">{originDisplay}</td>
                    <td>{item.fish_name}{item.type ? `/${item.type}` : ''}{item.glazing ? `(${item.glazing})` : ''}</td>
                    <td className="wf-center">{item.size}</td>
                    <td className="wf-center wf-bold">{requestedMc}</td>
                    <td className="wf-center">{requestTimeStr}</td>
                    <td className="wf-center wf-bold">{showActual ? actualMc : ''}</td>
                    <td className="wf-center">{showActual ? netKg.toFixed(1) : ''}</td>
                    <td className="wf-center">{finishedAtStr}</td>
                    <td className="wf-center">{item.production_process || ''}</td>
                    <td className="wf-center wf-remark">{i === 0 ? (data.notes || '') : ''}</td>
                  </tr>
                );
              })}
              {/* Empty rows to fill the form */}
              {Array.from({ length: emptyRows }, (_, i) => (
                <tr key={`empty-${i}`}>
                  <td className="wf-center">{items.length + i + 1}</td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                  <td></td>
                </tr>
              ))}
              {/* Total row */}
              <tr className="wf-total-row">
                <td colSpan="4" className="wf-right wf-bold">TOTAL</td>
                <td className="wf-center wf-bold">{totalRequestMC}</td>
                <td></td>
                <td className="wf-center wf-bold">{data.status !== 'PENDING' ? totalActualMC : ''}</td>
                <td className="wf-center wf-bold">{data.status !== 'PENDING' ? totalNetKG.toFixed(1) : ''}</td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tbody>
          </table>

          {/* Signature section */}
          <div className="wf-signatures">
            <div className="wf-sig-block">
              <div className="wf-sig-line">
                {data.requested_by && data.requested_by !== 'system' && (
                  <span className="wf-sig-name">{data.requested_by}</span>
                )}
              </div>
              <div className="wf-sig-label">ผู้ขอเบิก</div>
              <div className="wf-sig-label-en">Requester</div>
            </div>
            <div className="wf-sig-block">
              <div className="wf-sig-line"></div>
              <div className="wf-sig-label">ผู้อนุมัติ</div>
              <div className="wf-sig-label-en">Approver</div>
            </div>
            <div className="wf-sig-block">
              <div className="wf-sig-line">
                {data.managed_by && data.managed_by !== 'system' && data.managed_by !== 'admin' && (
                  <span className="wf-sig-name">{data.managed_by}</span>
                )}
              </div>
              <div className="wf-sig-label">ผู้จัด</div>
              <div className="wf-sig-label-en">Preparer</div>
            </div>
            <div className="wf-sig-block">
              <div className="wf-sig-line"></div>
              <div className="wf-sig-label">ผลจ่าย</div>
              <div className="wf-sig-label-en">Dispatcher</div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default WithdrawForm;
