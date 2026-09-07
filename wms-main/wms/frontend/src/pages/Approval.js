import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  FiCheckCircle, FiSearch, FiRefreshCw, FiUser,
  FiPrinter, FiShield, FiX, FiAlertCircle, FiCopy, FiXCircle, FiTrash2
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { copyWithdrawFormImageToClipboard } from '../utils/captureWithdrawFormImage';
import { getWithdrawals, getWithdrawal, rejectWithdrawal, purgeWithdrawal } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { approveWithdrawalToTakingOut } from '../utils/withdrawApprove';
import WithdrawFormPrint from '../components/WithdrawFormPrint';
import {
  STATUS_CONFIG, withdrawDeptBadgeClass, isWithdrawStopped,
  loadWithdrawApproverName, saveWithdrawApproverName,
} from './manageShared';
import {
  bangkokYYYYMMDD,
  bangkokYMDYesterday,
  bangkokLocaleDateString,
  dateToYYYYMMDDInBangkok,
  formatWithdrawRequestedAt,
} from '../utils/bangkokTime';

const STATUS_TABS = ['PENDING', 'REJECTED', 'ALL', 'TAKING_OUT', 'READY', 'FINISHED'];

export default function Approval() {
  const { user } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusTab, setStatusTab] = useState('PENDING');
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [approverName, setApproverName] = useState('');
  const [approverSaved, setApproverSaved] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedData, setSelectedData] = useState(null);
  const [loadingForm, setLoadingForm] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null); // { action: 'approve'|'reject'|'delete', req }
  const [copyingImage, setCopyingImage] = useState(false);
  const formRef = useRef(null);

  useEffect(() => {
    const saved = loadWithdrawApproverName(user?.id);
    if (saved) {
      setApproverName(saved);
      setApproverSaved(true);
    }
  }, [user?.id]);

  const persistApproverName = useCallback((name) => {
    const trimmed = (name || '').trim();
    if (!trimmed) return;
    saveWithdrawApproverName(user?.id, trimmed);
    setApproverSaved(true);
  }, [user?.id]);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (statusTab !== 'ALL') params.status = statusTab;
      if (deptFilter) params.department = deptFilter;
      if (dateFilter) params.date = dateFilter;
      const res = await getWithdrawals(params);
      setRequests(Array.isArray(res.data) ? res.data : []);
    } catch {
      toast.error('Failed to load requests');
    } finally {
      setLoading(false);
    }
  }, [statusTab, deptFilter, dateFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const filtered = useMemo(() => {
    if (!search.trim()) return requests;
    const q = search.toLowerCase();
    return requests.filter((r) =>
      r.request_no?.toLowerCase().includes(q) ||
      r.department?.toLowerCase().includes(q) ||
      r.item_summary?.toLowerCase().includes(q) ||
      (r.requested_by && r.requested_by.toLowerCase().includes(q))
    );
  }, [requests, search]);

  const requestsByDay = useMemo(() => {
    const groups = {};
    filtered.forEach((req) => {
      const raw = req.withdraw_date || req.created_at;
      const d = raw ? new Date(raw) : new Date();
      const dateKey = dateToYYYYMMDDInBangkok(d);
      const dateLabel = bangkokLocaleDateString(d, {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      });
      if (!groups[dateKey]) groups[dateKey] = { dateKey, dateLabel, requests: [] };
      groups[dateKey].requests.push(req);
    });
    return Object.values(groups).sort((a, b) => b.dateKey.localeCompare(a.dateKey));
  }, [filtered]);

  const counts = useMemo(() => ({
    pending: requests.filter((r) => r.status === 'PENDING').length,
    active: requests.filter((r) => r.status === 'PENDING' || r.status === 'TAKING_OUT').length,
    total: requests.length,
  }), [requests]);

  const selectRequest = async (id) => {
    if (selectedId === id && selectedData) return;
    setSelectedId(id);
    setLoadingForm(true);
    try {
      const res = await getWithdrawal(id);
      setSelectedData(res.data);
    } catch {
      toast.error('Failed to load print form');
      setSelectedId(null);
      setSelectedData(null);
    } finally {
      setLoadingForm(false);
    }
  };

  const openApproveModal = (req) => {
    const name = approverName.trim();
    if (!name) {
      toast.error('กรุณากรอกชื่อผู้อนุมัติ / Please enter Approver name');
      return;
    }
    if (req.status !== 'PENDING') {
      toast.error('Only pending requests can be approved');
      return;
    }
    setConfirmModal({ action: 'approve', req });
  };

  const openRejectModal = (req) => {
    if (req.status === 'FINISHED') {
      toast.error('Finished requests cannot be rejected');
      return;
    }
    if (isWithdrawStopped(req.status)) {
      toast.error('This request is already rejected or cancelled');
      return;
    }
    setConfirmModal({ action: 'reject', req });
  };

  const openDeleteModal = (req) => {
    setConfirmModal({ action: 'delete', req });
  };

  const executeApprove = async () => {
    const req = confirmModal?.req;
    if (!req) return;
    const name = approverName.trim();
    setProcessingId(req.id);
    try {
      persistApproverName(name);
      await approveWithdrawalToTakingOut(req.id, name);
      toast.success(`อนุมัติแล้ว — ${req.request_no} moved to Taking Out`);
      setConfirmModal(null);
      if (selectedId === req.id) {
        const res = await getWithdrawal(req.id);
        setSelectedData(res.data);
      }
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to approve');
    } finally {
      setProcessingId(null);
    }
  };

  const executeReject = async () => {
    const req = confirmModal?.req;
    if (!req) return;
    setProcessingId(req.id);
    try {
      await rejectWithdrawal(req.id);
      toast.success(`ปฏิเสธแล้ว — ${req.request_no} stays visible and cannot go to the next process`);
      setConfirmModal(null);
      if (selectedId === req.id) {
        const res = await getWithdrawal(req.id);
        setSelectedData(res.data);
      }
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to reject');
    } finally {
      setProcessingId(null);
    }
  };

  const executeDelete = async () => {
    const req = confirmModal?.req;
    if (!req) return;
    setProcessingId(req.id);
    try {
      await purgeWithdrawal(req.id);
      toast.success(`ลบแล้ว — ${req.request_no} deleted from the database`);
      setConfirmModal(null);
      if (selectedId === req.id) {
        setSelectedId(null);
        setSelectedData(null);
      }
      fetchRequests();
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Failed to delete');
    } finally {
      setProcessingId(null);
    }
  };

  const handlePrint = () => {
    if (!formRef.current) return;
    document.body.classList.add('ap-print-mode');
    const cleanup = () => {
      document.body.classList.remove('ap-print-mode');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
  };

  const handleCopyImage = async () => {
    if (!formRef.current) return;
    setCopyingImage(true);
    try {
      const ok = await copyWithdrawFormImageToClipboard(formRef);
      if (!ok) {
        toast.error('Failed to create image');
        return;
      }
      toast.success('Form image copied to clipboard');
    } catch (err) {
      console.error(err);
      toast.error('Failed to copy image — try Chrome/Edge on HTTPS or localhost');
    } finally {
      setCopyingImage(false);
    }
  };

  const todayStr = bangkokYYYYMMDD();
  const yesterdayStr = bangkokYMDYesterday();
  const selectedReq = filtered.find((r) => r.id === selectedId) || (selectedData ? { id: selectedData.id, status: selectedData.status, request_no: selectedData.request_no, department: selectedData.department } : null);
  const isSelectedPending = selectedReq?.status === 'PENDING';
  const canRejectSelected = selectedReq && selectedReq.status !== 'FINISHED' && !isWithdrawStopped(selectedReq.status);
  const canDeleteSelected = Boolean(selectedReq);
  const modalReq = confirmModal?.req;
  const isRejectModal = confirmModal?.action === 'reject';
  const isDeleteModal = confirmModal?.action === 'delete';

  return (
    <div className="ap-page">
      <div className="ap-hero ap-hero--compact">
        <div className="ap-hero-content">
          <div className="ap-hero-icon"><FiShield /></div>
          <div>
            <h1 className="ap-hero-title">Approval <span className="ap-hero-th">อนุมัติ</span></h1>
            <p className="ap-hero-sub">Click a request to preview the withdraw form</p>
          </div>
        </div>
        <div className="ap-hero-right">
          <button type="button" className="ap-refresh-btn" onClick={fetchRequests} title="Refresh">
            <FiRefreshCw size={16} />
          </button>
          <div className="ap-hero-stats ap-hero-stats--compact">
            <div className="ap-stat ap-stat--pending">
              <span className="ap-stat-val">{counts.pending}</span>
              <span className="ap-stat-lbl">Awaiting</span>
            </div>
          </div>
        </div>
      </div>

      <div className="ap-approver-card ap-approver-card--compact">
        <div className="ap-approver-icon"><FiUser /></div>
        <div className="ap-approver-body">
          <label className="ap-approver-label">
            ผู้อนุมัติ <span className="ap-approver-en">Approver</span>
          </label>
          <input
            type="text"
            className="form-control ap-approver-input"
            placeholder="Your name — shown on print form"
            value={approverName}
            onChange={(e) => {
              const v = e.target.value;
              setApproverName(v);
              if (v.trim()) {
                saveWithdrawApproverName(user?.id, v);
                setApproverSaved(true);
              } else {
                setApproverSaved(false);
              }
            }}
            onBlur={() => persistApproverName(approverName)}
            autoComplete="name"
          />
        </div>
      </div>

      <div className="ap-toolbar ap-toolbar--compact">
        <div className="ap-tabs">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              className={`ap-tab ${statusTab === tab ? 'ap-tab--active' : ''}`}
              onClick={() => setStatusTab(tab)}
            >
              {tab === 'ALL' ? 'All' : STATUS_CONFIG[tab]?.label || tab}
            </button>
          ))}
        </div>
        <div className="ap-filters">
          <div className="ap-search-wrap">
            <FiSearch className="ap-search-icon" />
            <input
              className="form-control ap-search-input"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select className="form-control ap-dept-select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All Depts</option>
            <option value="PK">PK</option>
            <option value="RM">RM</option>
            <option value="Branch.05 (SM)">Branch.05 (SM)</option>
          </select>
        </div>
      </div>

      <div className="ap-date-bar ap-date-bar--compact">
        <input type="date" className="form-control ap-date-input" value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} />
        <button type="button" className={`ap-date-btn ${!dateFilter ? 'active' : ''}`} onClick={() => setDateFilter('')}>All</button>
        <button type="button" className={`ap-date-btn ${dateFilter === todayStr ? 'active' : ''}`} onClick={() => setDateFilter(todayStr)}>Today</button>
        <button type="button" className={`ap-date-btn ${dateFilter === yesterdayStr ? 'active' : ''}`} onClick={() => setDateFilter(yesterdayStr)}>Yesterday</button>
      </div>

      <div className="ap-split">
        {/* Left — request list */}
        <div className="ap-list-col">
          {loading ? (
            <div className="loading"><div className="spinner" /></div>
          ) : filtered.length === 0 ? (
            <div className="ap-empty ap-empty--compact">
              <FiCheckCircle size={32} />
              <p>No requests found</p>
            </div>
          ) : (
            <div className="ap-days">
              {requestsByDay.map((day) => (
                <div key={day.dateKey} className="ap-day-section">
                  <h3 className="ap-day-heading">{day.dateLabel}</h3>
                  <div className="ap-cards ap-cards--compact">
                    {day.requests.map((req) => {
                      const config = STATUS_CONFIG[req.status] || STATUS_CONFIG.PENDING;
                      const isSelected = selectedId === req.id;
                      const isPending = req.status === 'PENDING';

                      return (
                        <button
                          key={req.id}
                          type="button"
                          className={`ap-card-btn ${isPending ? 'ap-card-btn--pending' : ''} ${isSelected ? 'ap-card-btn--selected' : ''}`}
                          onClick={() => selectRequest(req.id)}
                        >
                          <div className="ap-card-btn-top">
                            <span className={`mg-dept-badge ${withdrawDeptBadgeClass(req.department)}`}>
                              {req.department}
                            </span>
                            <span className="ap-status-pill ap-status-pill--sm" style={{ color: config.color, background: config.bg }}>
                              {config.label}
                            </span>
                          </div>
                          <span className="ap-card-btn-no">{req.request_no}</span>
                          <span className="ap-card-btn-when">{formatWithdrawRequestedAt(req)}</span>
                          <span className="ap-card-btn-meta">
                            {req.item_count} items · {Number(req.total_requested_mc || req.total_mc)} MC
                          </span>
                          {req.item_summary && (
                            <span className="ap-card-btn-products">{req.item_summary}</span>
                          )}
                          {isSelected && (
                            <span className="ap-card-btn-active">
                              <FiPrinter size={12} /> Viewing form
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right — print form preview */}
        <div className="ap-form-col">
          {!selectedId ? (
            <div className="ap-form-placeholder">
              <FiPrinter size={40} />
              <h3>Select a request</h3>
              <p>Click a card on the left to preview the withdraw print form</p>
            </div>
          ) : loadingForm ? (
            <div className="loading"><div className="spinner" />Loading form...</div>
          ) : selectedData ? (
            <div className="ap-form-panel">
              <div className="ap-form-panel-header">
                <div>
                  <strong>{selectedData.request_no}</strong>
                  <span className="ap-form-panel-dept">{selectedData.department}</span>
                  <div className="ap-form-panel-when">
                    Requested {formatWithdrawRequestedAt(selectedData)}
                  </div>
                </div>
                <div className="ap-form-panel-actions">
                  <button
                    type="button"
                    className="ap-icon-btn"
                    onClick={handlePrint}
                    title="Print form"
                  >
                    <FiPrinter />
                  </button>
                  <button
                    type="button"
                    className="ap-icon-btn"
                    onClick={handleCopyImage}
                    disabled={copyingImage}
                    title="Copy form as image"
                  >
                    {copyingImage ? <span className="login-spinner" /> : <FiCopy />}
                  </button>
                  {canRejectSelected && (
                    <button
                      type="button"
                      className="ap-reject-btn ap-reject-btn--sm"
                      onClick={() => openRejectModal(selectedReq)}
                      disabled={processingId === selectedId}
                    >
                      {processingId === selectedId ? (
                        <span className="login-spinner" />
                      ) : (
                        <FiXCircle />
                      )}
                      ปฏิเสธ Reject
                    </button>
                  )}
                  {canDeleteSelected && (
                    <button
                      type="button"
                      className="ap-delete-btn ap-delete-btn--sm"
                      onClick={() => openDeleteModal(selectedReq)}
                      disabled={processingId === selectedId}
                    >
                      {processingId === selectedId ? (
                        <span className="login-spinner" />
                      ) : (
                        <FiTrash2 />
                      )}
                      ลบ Delete
                    </button>
                  )}
                  {isSelectedPending && (
                    <button
                      type="button"
                      className="ap-approve-btn ap-approve-btn--sm"
                      onClick={() => openApproveModal(selectedReq)}
                      disabled={processingId === selectedId || !approverName.trim()}
                    >
                      {processingId === selectedId ? (
                        <span className="login-spinner" />
                      ) : (
                        <FiCheckCircle />
                      )}
                      อนุมัติ Approve
                    </button>
                  )}
                </div>
              </div>
              {selectedData.status === 'REJECTED' && (
                <div className="ap-rejected-banner">
                  This request is <strong>Rejected</strong> — it stays on record and cannot go to the next process.
                </div>
              )}
              <div className="ap-form-scroll ap-form-print-target">
                <WithdrawFormPrint ref={formRef} data={selectedData} />
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {/* Approve / Reject / Delete confirm modal */}
      {confirmModal && modalReq && (
        <div className="ap-modal-overlay" onClick={() => !processingId && setConfirmModal(null)}>
          <div className="ap-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="ap-modal-close"
              onClick={() => !processingId && setConfirmModal(null)}
              disabled={Boolean(processingId)}
            >
              <FiX />
            </button>
            <div className={`ap-modal-icon ${isDeleteModal ? 'ap-modal-icon--delete' : isRejectModal ? 'ap-modal-icon--reject' : ''}`}>
              {isDeleteModal ? <FiTrash2 /> : isRejectModal ? <FiXCircle /> : <FiAlertCircle />}
            </div>
            <h3 className="ap-modal-title">
              {isDeleteModal ? 'ยืนยันการลบ' : isRejectModal ? 'ยืนยันการปฏิเสธ' : 'ยืนยันการอนุมัติ'}
            </h3>
            <p className="ap-modal-sub">
              {isDeleteModal
                ? 'Confirm Delete — remove from database'
                : isRejectModal
                  ? 'Confirm Reject — keep visible, stop next process'
                  : 'Confirm Approval'}
            </p>
            <div className="ap-modal-body">
              <div className="ap-modal-row">
                <span className="ap-modal-label">Request No</span>
                <strong>{modalReq.request_no}</strong>
              </div>
              <div className="ap-modal-row">
                <span className="ap-modal-label">Department</span>
                <strong>{modalReq.department}</strong>
              </div>
              <div className="ap-modal-row">
                <span className="ap-modal-label">Requested</span>
                <strong>{formatWithdrawRequestedAt(modalReq)}</strong>
              </div>
              {!isRejectModal && !isDeleteModal && (
                <div className="ap-modal-row">
                  <span className="ap-modal-label">ผู้อนุมัติ / Approver</span>
                  <strong className="ap-modal-approver">{approverName.trim()}</strong>
                </div>
              )}
              <p className="ap-modal-note">
                {isDeleteModal ? (
                  <>
                    This will <strong>permanently delete</strong> the request, items, and any linked stock records from the database.
                    It cannot be undone.
                  </>
                ) : isRejectModal ? (
                  <>
                    The request will stay visible as <strong>Rejected</strong>. It cannot be approved or moved to the next process.
                  </>
                ) : (
                  <>
                    This will advance the request to <strong>Taking Out</strong> — same as Manage → Start Taking Out.
                  </>
                )}
              </p>
            </div>
            <div className="ap-modal-footer">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setConfirmModal(null)}
                disabled={Boolean(processingId)}
              >
                Cancel
              </button>
              {isDeleteModal ? (
                <button
                  type="button"
                  className="ap-delete-btn"
                  onClick={executeDelete}
                  disabled={Boolean(processingId)}
                >
                  {processingId ? <span className="login-spinner" /> : <FiTrash2 />}
                  {processingId ? 'กำลังลบ...' : 'ลบทั้งหมด Delete'}
                </button>
              ) : isRejectModal ? (
                <button
                  type="button"
                  className="ap-reject-btn"
                  onClick={executeReject}
                  disabled={Boolean(processingId)}
                >
                  {processingId ? <span className="login-spinner" /> : <FiXCircle />}
                  {processingId ? 'กำลังปฏิเสธ...' : 'ปฏิเสธ Reject'}
                </button>
              ) : (
                <button
                  type="button"
                  className="ap-approve-btn"
                  onClick={executeApprove}
                  disabled={Boolean(processingId)}
                >
                  {processingId ? <span className="login-spinner" /> : <FiCheckCircle />}
                  {processingId ? 'กำลังอนุมัติ...' : 'อนุมัติ Confirm'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
