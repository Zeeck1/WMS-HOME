import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiChevronDown, FiChevronUp, FiSave, FiCheckCircle, FiPrinter, FiFileText,
  FiAlertTriangle, FiEdit3
} from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getWithdrawal, manualAdjustWithdrawal } from '../services/api';
import { bangkokLocaleDateString } from '../utils/bangkokTime';
import { STATUS_CONFIG, withdrawDeptBadgeClass } from '../pages/manageShared';

function itemEditKey(item) {
  return String(item.id);
}

function getEditValue(edits, item, field) {
  const key = itemEditKey(item);
  if (edits[key]?.[field] !== undefined) return edits[key][field];
  return field === 'requested_mc'
    ? Number(item.requested_mc ?? item.quantity_mc)
    : Number(item.quantity_mc);
}

export default function ManageManualAdjust({ requests, loading, onRefresh }) {
  const navigate = useNavigate();
  const [expandedId, setExpandedId] = useState(null);
  const [expandedData, setExpandedData] = useState(null);
  const [edits, setEdits] = useState({});
  const [dispatcherName, setDispatcherName] = useState('');
  const [saving, setSaving] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const visibleRequests = useMemo(
    () => (requests || []).filter((r) => r.status !== 'CANCELLED'),
    [requests]
  );

  const hasChanges = useMemo(() => {
    if (!expandedData?.items) return false;
    return expandedData.items.some((item) => {
      const key = itemEditKey(item);
      const e = edits[key];
      if (!e) return false;
      const origReq = Number(item.requested_mc ?? item.quantity_mc);
      const origAct = Number(item.quantity_mc);
      if (e.requested_mc !== undefined && Number(e.requested_mc) !== origReq) return true;
      if (e.quantity_mc !== undefined && Number(e.quantity_mc) !== origAct) return true;
      return false;
    });
  }, [expandedData, edits]);

  const toggleExpand = async (id) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedData(null);
      setEdits({});
      setDispatcherName('');
      return;
    }
    try {
      const res = await getWithdrawal(id);
      setExpandedData(res.data);
      setExpandedId(id);
      setEdits({});
      setDispatcherName(
        res.data.manual_adjust ? (res.data.dispatcher || '') : ''
      );
    } catch {
      toast.error('Failed to load request details');
    }
  };

  const setField = (item, field, value) => {
    const key = itemEditKey(item);
    const num = Math.max(0, Number(value) || 0);
    setEdits((prev) => ({
      ...prev,
      [key]: { ...prev[key], [field]: num },
    }));
  };

  const buildPayloadItems = () => {
    if (!expandedData?.items) return [];
    return expandedData.items.map((item) => ({
      id: item.id,
      requested_mc: getEditValue(edits, item, 'requested_mc'),
      quantity_mc: getEditValue(edits, item, 'quantity_mc'),
    }));
  };

  const handleSave = async () => {
    if (!expandedId) return;
    setSaving(true);
    try {
      const res = await manualAdjustWithdrawal(expandedId, {
        items: buildPayloadItems(),
        dispatcher: dispatcherName.trim() || undefined,
      });
      toast.success(res.data.message || 'Manual adjust saved');
      setExpandedData((prev) => ({ ...prev, ...res.data.request, items: res.data.items }));
      setEdits({});
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save manual adjust');
    } finally {
      setSaving(false);
    }
  };

  const handleFinish = async () => {
    if (!expandedId) return;
    if (!dispatcherName.trim()) {
      toast.error('Please enter Dispatcher name before finishing');
      return;
    }
    if (!window.confirm(
      'Mark this request as FINISHED without deducting stock?\n\nCarton numbers will appear on Withdraw form/report only.'
    )) return;

    setFinishing(true);
    try {
      const res = await manualAdjustWithdrawal(expandedId, {
        items: buildPayloadItems(),
        finish: true,
        dispatcher: dispatcherName.trim(),
      });
      toast.success(res.data.message || 'Marked finished (no stock deducted)');
      setExpandedData((prev) => ({ ...prev, ...res.data.request, items: res.data.items }));
      setEdits({});
      onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to finish request');
    } finally {
      setFinishing(false);
    }
  };

  if (loading) {
    return <div className="loading"><div className="spinner" />Loading requests...</div>;
  }

  return (
    <>
      <div className="mg-manual-banner">
        <FiAlertTriangle />
        <div>
          <strong>Manual Adjust (Superadmin)</strong>
          <p>
            Edit Requested / Actual carton numbers without stock validation or deduction.
            Lines stay even when Actual MC is 0. Use <strong>Mark Finished (No Stock Out)</strong> to show
            cartons on Withdraw form and report.
          </p>
        </div>
      </div>

      {visibleRequests.length === 0 ? (
        <div className="mg-empty">No withdrawal requests found.</div>
      ) : (
        <div className="mg-requests">
          {visibleRequests.map((req) => {
            const isExpanded = expandedId === req.id;
            const config = STATUS_CONFIG[req.status] || STATUS_CONFIG.PENDING;
            const isFinished = req.status === 'FINISHED';

            return (
              <div key={req.id} className={`mg-request-card ${isExpanded ? 'expanded' : ''}`}>
                <div className="mg-req-header" onClick={() => toggleExpand(req.id)}>
                  <div className="mg-req-left">
                    <span className={`mg-dept-badge ${withdrawDeptBadgeClass(req.department)}`}>
                      {req.department}
                    </span>
                    <div className="mg-req-info">
                      <span className="mg-req-no">{req.request_no}</span>
                      {req.manual_adjust ? (
                        <span className="mg-manual-badge"><FiEdit3 /> Manual</span>
                      ) : null}
                      <span className="mg-req-date">
                        {bangkokLocaleDateString(new Date(req.withdraw_date || req.created_at))}
                      </span>
                    </div>
                  </div>
                  <div className="mg-req-right">
                    <span className="mg-req-stats">
                      {req.total_requested_mc ?? req.total_mc} MC req
                    </span>
                    <span className="mg-status-badge" style={{ color: config.color, background: config.bg }}>
                      {config.icon} {config.label}
                    </span>
                    {isExpanded ? <FiChevronUp /> : <FiChevronDown />}
                  </div>
                </div>

                {isExpanded && expandedData && (
                  <div className="mg-req-detail">
                    {isFinished && (
                      <p className="mg-pick-route-hint">
                        This withdrawal is <strong>Finished</strong> — saved carton data is permanent and cannot be edited.
                      </p>
                    )}
                    <table className="table mg-items-table mg-manual-table">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Fish Name</th>
                          <th>Size</th>
                          <th>Location</th>
                          <th>Lot / Ref</th>
                          <th className="mg-col-requested">Requested (MC)</th>
                          <th className="mg-col-qty">Actual (MC)</th>
                          <th>Weight (KG)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(expandedData.items || []).map((item, i) => {
                          const reqMc = getEditValue(edits, item, 'requested_mc');
                          const actMc = getEditValue(edits, item, 'quantity_mc');
                          const weightKg = actMc * Number(item.bulk_weight_kg || 0);
                          const origReq = Number(item.requested_mc ?? item.quantity_mc);
                          const origAct = Number(item.quantity_mc);
                          const changed = reqMc !== origReq || actMc !== origAct;

                          return (
                            <tr key={item.id} className={changed ? 'mg-manual-row-changed' : ''}>
                              <td>{i + 1}</td>
                              <td><strong>{item.fish_name}</strong></td>
                              <td>{item.size}</td>
                              <td>{item.line_place || '—'}</td>
                              <td className="mg-lot-cell">{item.lot_no || item.order_code || '—'}</td>
                              <td className="num-cell">
                                {isFinished ? (
                                  reqMc
                                ) : (
                                  <input
                                    type="number"
                                    className="mg-qty-input mg-manual-input"
                                    min={0}
                                    value={reqMc}
                                    onChange={(e) => setField(item, 'requested_mc', e.target.value)}
                                  />
                                )}
                              </td>
                              <td className="num-cell">
                                {isFinished ? (
                                  actMc
                                ) : (
                                  <input
                                    type="number"
                                    className="mg-qty-input mg-manual-input"
                                    min={0}
                                    value={actMc}
                                    onChange={(e) => setField(item, 'quantity_mc', e.target.value)}
                                  />
                                )}
                              </td>
                              <td className="num-cell">{weightKg.toFixed(0)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>

                    {!isFinished && (
                      <div className="mg-manager-field mg-card-manager-field mg-dispatcher-field mg-manual-dispatcher">
                        <label>Dispatcher Name (Manual Adjust only)</label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Enter dispatcher name for print form"
                          value={dispatcherName}
                          onChange={(e) => setDispatcherName(e.target.value)}
                          autoComplete="name"
                        />
                        <p className="mg-manager-hint">
                          Shown as <strong>Dispatcher</strong> on withdraw print form — used only for Manual Adjust requests
                        </p>
                      </div>
                    )}

                    <div className="mg-actions">
                      {!isFinished && (
                        <button
                          type="button"
                          className="btn btn-warning"
                          onClick={handleSave}
                          disabled={saving || finishing}
                        >
                          <FiSave /> {saving ? 'Saving...' : 'Save Manual Adjust'}
                        </button>
                      )}
                      {!isFinished && (
                        <button
                          type="button"
                          className="btn btn-primary btn-lg"
                          onClick={handleFinish}
                          disabled={saving || finishing}
                        >
                          <FiCheckCircle /> {finishing ? 'Finishing...' : 'Mark Finished (No Stock Out)'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => navigate(`/withdraw/${req.id}/form`)}
                      >
                        <FiPrinter /> Print Form
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => navigate(`/withdraw/${req.id}/report`)}
                      >
                        <FiFileText /> Report
                      </button>
                    </div>
                    {isFinished && expandedData.manual_adjust && (
                      <p className="mg-manual-finished-note">
                        Finished via manual adjust — stock was not deducted. You can still edit cartons above.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
