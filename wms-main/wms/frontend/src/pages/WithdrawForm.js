import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiPrinter, FiDownload, FiArrowLeft, FiCamera } from 'react-icons/fi';
import { toast } from 'react-toastify';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { getWithdrawal } from '../services/api';
import WithdrawFormPrint from '../components/WithdrawFormPrint';

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

  return (
    <>
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

      <WithdrawFormPrint ref={formRef} data={data} />
    </>
  );
}

export default WithdrawForm;
