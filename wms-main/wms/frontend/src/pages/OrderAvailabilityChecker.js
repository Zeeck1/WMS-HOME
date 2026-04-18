import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiUpload, FiFile, FiX, FiSearch, FiTrash2,
  FiClipboard, FiClock, FiChevronRight, FiCheckCircle,
  FiAlertTriangle, FiAlertCircle
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { checkOrderAvailability, getOacChecks, deleteOacCheck } from '../services/api';
import { bangkokLocaleString } from '../utils/bangkokTime';

function OrderAvailabilityChecker() {
  const [files, setFiles] = useState([]);
  const [checking, setChecking] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [recentChecks, setRecentChecks] = useState([]);
  const fileRef = useRef();
  const navigate = useNavigate();

  useEffect(() => {
    getOacChecks(10).then(r => setRecentChecks(r.data)).catch(() => {});
  }, []);

  const handleFileChange = useCallback((e) => {
    const incoming = Array.from(e.target.files);
    setFiles(prev => {
      const combined = [...prev, ...incoming];
      if (combined.length > 32) {
        toast.warning('Maximum 32 files allowed. Extra files were ignored.');
        return combined.slice(0, 32);
      }
      return combined;
    });
    e.target.value = '';
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const incoming = Array.from(e.dataTransfer.files).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return ['xlsx', 'xls', 'csv'].includes(ext);
    });
    if (incoming.length === 0) {
      toast.warning('Only Excel files (.xlsx, .xls, .csv) are accepted');
      return;
    }
    setFiles(prev => {
      const combined = [...prev, ...incoming];
      if (combined.length > 32) {
        toast.warning('Maximum 32 files allowed. Extra files were ignored.');
        return combined.slice(0, 32);
      }
      return combined;
    });
  }, []);

  const removeFile = useCallback((index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  const clearAll = useCallback(() => {
    setFiles([]);
  }, []);

  const handleCheck = useCallback(async () => {
    if (files.length === 0) {
      toast.warning('Please upload at least one order file');
      return;
    }
    setChecking(true);
    try {
      const res = await checkOrderAvailability(files);
      const { checkId } = res.data;
      navigate(`/oac-result/${checkId}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Availability check failed');
    } finally {
      setChecking(false);
    }
  }, [files, navigate]);

  const handleDeleteCheck = async (id, e) => {
    e.stopPropagation();
    try {
      await deleteOacCheck(id);
      setRecentChecks(prev => prev.filter(c => c.id !== id));
    } catch {
      toast.error('Failed to delete');
    }
  };

  const formatTime = (ts) =>
    bangkokLocaleString(new Date(ts), { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  const filledPct = Math.round((files.length / 32) * 100);

  return (
    <>
      <div className="page-header">
        <h2><FiClipboard /> Order Availability Checker</h2>
        <p className="page-subtitle">Upload order files to check stock availability — results are saved automatically</p>
      </div>
      <div className="page-body">
        {/* Upload card */}
        <div className="card oac-upload-card">
          <div className="card-header">
            <h3><FiUpload /> Upload Order Files</h3>
            <div className="oac-file-counter">
              <div className="oac-counter-bar">
                <div className="oac-counter-fill" style={{ width: `${filledPct}%` }} />
              </div>
              <span className="oac-file-count">{files.length} / 32</span>
            </div>
          </div>
          <div className="card-body">
            <div
              className={`oac-dropzone ${dragOver ? 'oac-dropzone-active' : ''} ${files.length > 0 ? 'oac-dropzone-compact' : ''}`}
              onClick={() => fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                type="file"
                ref={fileRef}
                onChange={handleFileChange}
                accept=".xlsx,.xls,.csv"
                multiple
                style={{ display: 'none' }}
              />
              <div className="oac-dropzone-icon">
                <FiUpload />
              </div>
              <div className="oac-dropzone-text">
                <h4>Drop order files here or click to browse</h4>
                <p>.xlsx, .xls, .csv — up to 32 files, 10MB each</p>
              </div>
            </div>

            {files.length > 0 && (
              <div className="oac-file-grid">
                {files.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="oac-file-chip">
                    <FiFile className="oac-chip-icon" />
                    <div className="oac-chip-body">
                      <span className="oac-chip-name" title={f.name}>{f.name}</span>
                      <span className="oac-chip-size">{(f.size / 1024).toFixed(1)} KB</span>
                    </div>
                    <button className="oac-chip-remove" onClick={(e) => { e.stopPropagation(); removeFile(i); }}>
                      <FiX />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="oac-actions">
              <button
                className={`btn btn-primary oac-check-btn ${checking ? 'oac-checking' : ''}`}
                onClick={handleCheck}
                disabled={files.length === 0 || checking}
              >
                {checking ? (
                  <>
                    <span className="oac-spinner" />
                    Checking availability...
                  </>
                ) : (
                  <><FiSearch /> Check Availability</>
                )}
              </button>
              {files.length > 0 && (
                <button className="btn btn-outline" onClick={clearAll}>
                  <FiTrash2 /> Clear All
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Recent checks */}
        {recentChecks.length > 0 && (
          <div className="card oac-recent-card">
            <div className="card-header">
              <h3><FiClock /> Recent Checks</h3>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              {recentChecks.map(c => (
                <div key={c.id} className="oac-recent-row" onClick={() => navigate(`/oac-result/${c.id}`)}>
                  <div className="oac-recent-main">
                    <span className="oac-recent-time">{formatTime(c.checked_at)}</span>
                    <span className="oac-recent-files">{c.total_files} file{c.total_files !== 1 ? 's' : ''}</span>
                    <span className="oac-recent-items">{c.total_items} items</span>
                  </div>
                  <div className="oac-recent-badges">
                    <span className="oacr-fbadge oacr-fbadge-full"><FiCheckCircle /> {c.full_count}</span>
                    <span className="oacr-fbadge oacr-fbadge-notfull"><FiAlertTriangle /> {c.not_full_count}</span>
                    <span className="oacr-fbadge oacr-fbadge-nothave"><FiAlertCircle /> {c.not_have_count}</span>
                  </div>
                  <div className="oac-recent-actions">
                    <button className="oac-recent-del" onClick={(e) => handleDeleteCheck(c.id, e)} title="Delete">
                      <FiTrash2 />
                    </button>
                    <FiChevronRight className="oac-recent-arrow" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default OrderAvailabilityChecker;
