import React from 'react';
import { FiAlertOctagon } from 'react-icons/fi';

function MaintenanceNotice() {
  return (
    <div className="dashboard-maintenance-notice no-print" role="alert" aria-live="polite">
      <div className="dashboard-maintenance-notice-icon-wrap">
        <FiAlertOctagon className="dashboard-maintenance-notice-icon" aria-hidden="true" />
      </div>
      <div className="dashboard-maintenance-notice-content">
        <span className="dashboard-maintenance-notice-badge">Maintenance Notice</span>
        <p className="dashboard-maintenance-notice-en">
          Currently undergoing maintenance and stocks are not updated.
        </p>
        <p className="dashboard-maintenance-notice-th">
          ขณะนี้ระบบกำลังอยู่ในระหว่างการปรับปรุง และสต็อกสินค้ายังไม่ได้อัปเดต
        </p>
      </div>
    </div>
  );
}

export default MaintenanceNotice;
