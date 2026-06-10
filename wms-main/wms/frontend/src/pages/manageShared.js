import {
  FiClock, FiTruck, FiPackage, FiCheckCircle, FiXCircle
} from 'react-icons/fi';

export const STATUS_FLOW = ['PENDING', 'TAKING_OUT', 'READY', 'FINISHED'];

export const STATUS_CONFIG = {
  PENDING:     { label: 'Receive Request', icon: <FiClock />,       color: '#f59e0b', bg: '#fffbeb', next: 'TAKING_OUT', nextLabel: 'Start Taking Out' },
  TAKING_OUT:  { label: 'Taking Out',      icon: <FiTruck />,       color: '#3b82f6', bg: '#eff6ff', next: 'READY',      nextLabel: 'Mark as Ready' },
  READY:       { label: 'Ready to Take',   icon: <FiPackage />,     color: '#8b5cf6', bg: '#f5f3ff', next: 'FINISHED',   nextLabel: 'Finish Take Out' },
  FINISHED:    { label: 'Finished',         icon: <FiCheckCircle />, color: '#22c55e', bg: '#f0fdf4', next: null,         nextLabel: null },
  CANCELLED:   { label: 'Cancelled',        icon: <FiXCircle />,    color: '#ef4444', bg: '#fef2f2', next: null,         nextLabel: null },
};

/** Shared localStorage key — Approval page & Manage page use the same approver / manager name. */
export const WITHDRAW_APPROVER_STORAGE_KEY = 'wms_withdraw_approver_name';

export function withdrawApproverStorageKey(userId) {
  return userId ? `${WITHDRAW_APPROVER_STORAGE_KEY}_${userId}` : WITHDRAW_APPROVER_STORAGE_KEY;
}

export function loadWithdrawApproverName(userId) {
  try {
    const keys = [
      withdrawApproverStorageKey(userId),
      userId ? `wms_approver_name_${userId}` : 'wms_approver_name',
      userId ? `wms_manager_preparer_name_${userId}` : 'wms_manager_preparer_name',
    ];
    for (const key of keys) {
      const saved = localStorage.getItem(key);
      if (saved?.trim()) return saved.trim();
    }
  } catch { /* ignore */ }
  return '';
}

export function saveWithdrawApproverName(userId, name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return;
  try {
    localStorage.setItem(withdrawApproverStorageKey(userId), trimmed);
  } catch { /* ignore */ }
}

export function withdrawDeptBadgeClass(department) {
  switch (department) {
    case 'PK': return 'mg-dept-PK';
    case 'RM': return 'mg-dept-RM';
    case 'Branch.05 (SM)': return 'mg-dept-B05SM';
    default: return 'mg-dept-other';
  }
}
