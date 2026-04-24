import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  FiUpload, FiFile, FiX, FiSearch, FiTrash2,
  FiClipboard, FiClock, FiChevronRight, FiCheckCircle,
  FiAlertTriangle, FiAlertCircle, FiList, FiArrowLeft, FiExternalLink
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { checkOrderAvailability, getOacChecks, deleteOacCheck, getOacOrderGroups, getOacCheck } from '../services/api';
import { bangkokLocaleString } from '../utils/bangkokTime';

function formatOacOrderNum(n, decimals = 2) {
  return (Number(n) || 0).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function displayOrderName(name) {
  if (!name) return name;
  const parts = String(name).split('_');
  if (parts.length >= 3) return parts.slice(1, -1).join('_');
  return name;
}

function OrderAvailabilityChecker() {
  const [mainTab, setMainTab] = useState('check');
  const [files, setFiles] = useState([]);
  const [checking, setChecking] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [recentChecks, setRecentChecks] = useState([]);
  const [orderGroups, setOrderGroups] = useState([]);
  const [orderGroupsLoading, setOrderGroupsLoading] = useState(false);
  const [orderListSearch, setOrderListSearch] = useState('');
  const [orderListQuery, setOrderListQuery] = useState('');
  const [orderDetail, setOrderDetail] = useState(null);
  const [orderDetailLoading, setOrderDetailLoading] = useState(false);
  const fileRef = useRef();
  const navigate = useNavigate();
  const location = useLocation();
  const restoredOrderKeyRef = useRef('');

  useEffect(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    if (tab === 'orders' || tab === 'check') {
      setMainTab(tab);
      if (tab !== 'orders') setOrderDetail(null);
    }
  }, [location.search]);

  const loadOrderDetailByRef = useCallback(async (checkId, orderFile, checkedAt = null) => {
    if (!checkId || !orderFile) return;
    setOrderDetailLoading(true);
    setOrderDetail(null);
    try {
      const res = await getOacCheck(checkId);
      const of = String(orderFile || '').trim();
      const rows = (res.data.results || []).filter(
        (r) => String(r.orderFile || '').trim() === of
      );
      if (rows.length === 0) {
        toast.warning('No lines found for this order file');
        setOrderDetail(null);
        return;
      }
      const resolvedCheckedAt = checkedAt || res.data.checkedAt || null;
      setOrderDetail({ checkId, orderFile, checkedAt: resolvedCheckedAt, rows });
    } catch {
      toast.error('Failed to load order');
      setOrderDetail(null);
    } finally {
      setOrderDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    getOacChecks(10).then(r => setRecentChecks(r.data)).catch(() => {});
  }, []);

  const loadOrderGroups = useCallback(async () => {
    setOrderGroupsLoading(true);
    try {
      const res = await getOacOrderGroups({
        search: (orderListQuery && orderListQuery.trim()) || undefined
      });
      setOrderGroups(res.data || []);
    } catch {
      toast.error('Failed to load orders');
    } finally {
      setOrderGroupsLoading(false);
    }
  }, [orderListQuery]);

  useEffect(() => {
    if (mainTab !== 'orders') return;
    loadOrderGroups();
  }, [mainTab, orderListQuery, loadOrderGroups]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const tab = params.get('tab');
    const checkId = params.get('checkId');
    const orderFile = params.get('orderFile');
    if (tab !== 'orders' || !checkId || !orderFile) return;
    const restoreKey = `${checkId}::${orderFile}`;
    if (restoredOrderKeyRef.current === restoreKey) return;
    restoredOrderKeyRef.current = restoreKey;
    loadOrderDetailByRef(checkId, orderFile);
  }, [location.search, loadOrderDetailByRef]);

  const openOrderDetail = async (g) => {
    loadOrderDetailByRef(g.checkId, g.orderFile, g.checkedAt);
  };

  const orderTotals = useMemo(() => {
    if (!orderDetail?.rows) return { ctn: 0, net: 0, gross: 0 };
    return orderDetail.rows.reduce(
      (acc, r) => ({
        ctn: acc.ctn + (Number(r.orderedCtn) || 0),
        net: acc.net + (Number(r.orderedKg) || 0),
        gross: acc.gross + (Number(r.grossWeightKg) || 0)
      }),
      { ctn: 0, net: 0, gross: 0 }
    );
  }, [orderDetail]);

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

  const applyOrderListSearch = () => {
    setOrderListQuery(orderListSearch.trim());
  };

  return (
    <>
      <div className="page-header">
        <h2><FiClipboard /> Order Availability Checker</h2>
        <p className="page-subtitle">Upload order files to check stock availability — results are saved automatically</p>
      </div>
      <div className="page-body">
        <div className="oac-page-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mainTab === 'check'}
            className={`oac-page-tab ${mainTab === 'check' ? 'active' : ''}`}
            onClick={() => { setMainTab('check'); setOrderDetail(null); }}
          >
            <FiUpload /> Check
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mainTab === 'orders'}
            className={`oac-page-tab ${mainTab === 'orders' ? 'active' : ''}`}
            onClick={() => setMainTab('orders')}
          >
            <FiList /> Orders
          </button>
        </div>

        {mainTab === 'check' && (
        <>
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
        </>
        )}

        {mainTab === 'orders' && (
          <div className="card oac-orders-card">
            {orderDetail && !orderDetailLoading && orderDetail.rows?.length > 0 ? (
              <>
                <div className="card-header" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => setOrderDetail(null)}
                    >
                      <FiArrowLeft /> Back
                    </button>
                    <h3 style={{ margin: 0 }}><FiFile /> {displayOrderName(orderDetail.orderFile) || 'Order'}</h3>
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span className="text-muted" style={{ fontSize: '0.85rem' }}>
                      {orderDetail.checkedAt
                        ? bangkokLocaleString(new Date(orderDetail.checkedAt), {
                            day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                          })
                        : ''}
                    </span>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => navigate(
                        `/oac-result/${orderDetail.checkId}?from=orders&orderFile=${encodeURIComponent(orderDetail.orderFile || '')}`,
                        {
                          state: {
                            fromOrders: true,
                            checkId: orderDetail.checkId,
                            orderFile: orderDetail.orderFile || ''
                          }
                        }
                      )}
                    >
                      <FiExternalLink /> Open availability result
                    </button>
                  </div>
                </div>
                <div className="card-body oac-order-design-wrap">
                  <table className="oac-order-design-table">
                    <thead>
                      <tr>
                        <th className="oac-col-no">NO</th>
                        <th className="oac-col-desc">DESCRIPTION OF GOODS</th>
                        <th className="oac-col-pack">PACK</th>
                        <th className="oac-col-num">WET/MC (KG.)</th>
                        <th className="oac-col-num">TOTAL/CTN</th>
                        <th className="oac-col-num">NET/WET (KG.)</th>
                        <th className="oac-col-num">GROSS/WET (KG.)</th>
                        <th className="oac-col-remark">REMARK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderDetail.rows.map((r, i) => (
                        <tr key={r.id != null ? `line-${r.id}` : `line-${i}`}>
                          <td className="oac-col-no">{i + 1}</td>
                          <td className="oac-col-desc">{r.product || '—'}</td>
                          <td className="oac-col-pack">{r.pack || '—'}</td>
                          <td className="oac-col-num">{formatOacOrderNum(r.weightMc)}</td>
                          <td className="oac-col-num">{(r.orderedCtn ?? 0).toLocaleString('en-US')}</td>
                          <td className="oac-col-num">{formatOacOrderNum(r.orderedKg)}</td>
                          <td className="oac-col-num">{formatOacOrderNum(r.grossWeightKg)}</td>
                          <td className="oac-col-remark">{r.remark || ''}</td>
                        </tr>
                      ))}
                      <tr className="oac-order-total-row">
                        <td colSpan="3" className="oac-order-total-label">TOTAL</td>
                        <td className="oac-col-num" />
                        <td className="oac-col-num oac-order-total-val">{orderTotals.ctn.toLocaleString('en-US')}</td>
                        <td className="oac-col-num oac-order-total-val">{formatOacOrderNum(orderTotals.net)}</td>
                        <td className="oac-col-num oac-order-total-val">{formatOacOrderNum(orderTotals.gross)}</td>
                        <td className="oac-col-remark" />
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <div className="card-header" style={{ flexWrap: 'wrap', gap: 12 }}>
                  <h3><FiList /> Orders</h3>
                  <div className="search-inline" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input
                      type="search"
                      className="form-control"
                      style={{ minWidth: 200, maxWidth: 360 }}
                      placeholder="Search by order / file name…"
                      value={orderListSearch}
                      onChange={e => setOrderListSearch(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') applyOrderListSearch(); }}
                    />
                    <button type="button" className="btn btn-primary btn-sm" onClick={applyOrderListSearch}>
                      <FiSearch /> Search
                    </button>
                  </div>
                </div>
                <div className="card-body">
                  {orderDetailLoading && (
                    <p className="text-muted" style={{ padding: 24 }}>Loading order…</p>
                  )}
                  {!orderDetailLoading && orderGroupsLoading && orderGroups.length === 0 && (
                    <p className="text-muted" style={{ padding: 24 }}>Loading…</p>
                  )}
                  {!orderGroupsLoading && !orderDetailLoading && orderGroups.length === 0 && (
                    <p className="text-muted" style={{ padding: 24, textAlign: 'center' }}>
                      No saved orders yet. Run a check on the <strong>Check</strong> tab with your Excel order files.
                    </p>
                  )}
                  {orderGroups.length > 0 && (
                    <ul className="oac-order-name-list">
                      {orderGroups.map((g) => (
                        <li key={`${g.checkId}-${g.orderFile}`}>
                          <button
                            type="button"
                            className="oac-order-name-btn"
                            onClick={() => openOrderDetail(g)}
                            disabled={orderDetailLoading}
                          >
                            <span className="oac-order-name-text">{displayOrderName(g.orderFile) || '—'}</span>
                            <FiChevronRight className="oac-order-name-chev" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default OrderAvailabilityChecker;
