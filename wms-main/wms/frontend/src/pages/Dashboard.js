import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import { FiBox, FiTruck, FiMapPin, FiCheckCircle, FiAlertTriangle, FiTool, FiArrowDownCircle, FiClock } from 'react-icons/fi';
import { getDashboard } from '../services/api';
import { bangkokLocaleString } from '../utils/bangkokTime';

function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showStockIssues, setShowStockIssues] = useState(false);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const res = await getDashboard();
      setData(res.data);
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Loading dashboard...</div>;

  const d = data || {
    total_mc: 0,
    total_kg: 0,
    total_stacks: 0,
    stock_status: 'No Data',
    recent_movements: [],
    error_count: 0,
    stock_issues: [],
  };

  const stockIssues = Array.isArray(d.stock_issues) ? d.stock_issues : [];
  const hasStockErrors = typeof d.stock_status === 'string' && d.stock_status.startsWith('Error');

  return (
    <>
      <div className="page-header">
        <h2>Dashboard</h2>
        <button className="btn btn-outline" onClick={fetchDashboard}>Refresh</button>
      </div>
      <div className="page-body">
        <div className="dashboard-grid">
          <div className="stat-card">
            <div className="stat-icon blue"><FiBox /></div>
            <div className="stat-info">
              <h4>Total MC</h4>
              <div className="stat-value">{Number(d.total_mc).toLocaleString()}</div>
              <div className="stat-sub">Master Cartons</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon green"><FiTruck /></div>
            <div className="stat-info">
              <h4>Total KG</h4>
              <div className="stat-value">{Number(d.total_kg).toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
              <div className="stat-sub">Kilograms</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-icon orange"><FiMapPin /></div>
            <div className="stat-info">
              <h4>Total Stacks</h4>
              <div className="stat-value">{Number(d.total_stacks).toLocaleString()}</div>
              <div className="stat-sub">Active Locations</div>
            </div>
          </div>
          <div className="stat-card">
            <div className={`stat-icon ${d.stock_status === 'Correct' ? 'green' : 'red'}`}>
              {d.stock_status === 'Correct' ? <FiCheckCircle /> : <FiAlertTriangle />}
            </div>
            <div className="stat-info">
              <h4>Stock Status</h4>
              <div className="stat-value" style={{ fontSize: '1.25rem' }}>
                <span className={`badge ${d.stock_status === 'Correct' ? 'badge-correct' : 'badge-error'}`}>
                  {d.stock_status}
                </span>
              </div>
              <div className="stat-sub">Tracking Status</div>
              {hasStockErrors && (
                <button
                  type="button"
                  className="btn btn-sm btn-outline dashboard-stock-issues-btn"
                  onClick={() => setShowStockIssues(true)}
                >
                  View details &amp; fix
                </button>
              )}
            </div>
          </div>
        </div>

        {showStockIssues && (
          <div className="modal-overlay" role="presentation" onClick={() => setShowStockIssues(false)}>
            <div className="modal dashboard-stock-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>Stock tracking issues</h3>
                <button type="button" className="modal-close" onClick={() => setShowStockIssues(false)} aria-label="Close">
                  &times;
                </button>
              </div>
              <div className="modal-body">
                <p className="dashboard-stock-modal-intro">
                  These rows have a <strong>negative master-carton (MC) balance</strong> for a lot at a location — more
                  stock has been recorded <em>out</em> than <em>in</em>. Correct movement history, add a matching Stock IN,
                  or use <strong>Manual</strong> to align balances.
                </p>
                {stockIssues.length > 0 ? (
                  <div className="table-wrap dashboard-stock-issues-wrap">
                    <table className="data-table dashboard-stock-issues-table">
                      <thead>
                        <tr>
                          <th>Lot</th>
                          <th>Product</th>
                          <th>Size</th>
                          <th>Location</th>
                          <th>Type</th>
                          <th className="text-right">MC balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stockIssues.map((row) => (
                          <tr key={`${row.lot_id}-${row.location_id}`}>
                            <td>{row.lot_no}</td>
                            <td>{row.fish_name}</td>
                            <td>{row.size}</td>
                            <td>{row.line_place}</td>
                            <td>{row.stock_type || '—'}</td>
                            <td className="text-right dashboard-stock-balance-cell">{Number(row.balance_mc).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p style={{ color: 'var(--gray-500)', fontSize: '0.9rem' }}>
                    Detailed rows are not available (refresh the dashboard). Count: {d.error_count || 0} issue(s).
                  </p>
                )}
              </div>
              <div className="modal-footer dashboard-stock-modal-footer">
                <NavLink to="/manual" className="btn btn-primary" onClick={() => setShowStockIssues(false)}>
                  <FiTool /> Manual edit
                </NavLink>
                <NavLink to="/stock-in" className="btn btn-outline" onClick={() => setShowStockIssues(false)}>
                  <FiArrowDownCircle /> Stock IN
                </NavLink>
                <NavLink to="/stock-table" className="btn btn-outline" onClick={() => setShowStockIssues(false)}>
                  Stock Summary
                </NavLink>
                <NavLink to="/movements" className="btn btn-outline" onClick={() => setShowStockIssues(false)}>
                  <FiClock /> Movement history
                </NavLink>
                <button type="button" className="btn btn-outline" onClick={() => setShowStockIssues(false)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="dashboard-calendar-row">
          <div className="card dashboard-calendar-card">
            <div className="card-header">
              <h3>Calendar</h3>
            </div>
            <div className="card-body calendar-embed-wrap dashboard-calendar-embed" style={{ padding: 0 }}>
              <iframe
                title="WMS Calendar"
                src="https://calendar.google.com/calendar/embed?src=43fc401935073480d71aef1792ee5dfe9d22a0056561823d90372856c6011e35%40group.calendar.google.com&ctz=Asia%2FBangkok"
                style={{ border: 0 }}
                width="100%"
                frameBorder="0"
                scrolling="no"
              />
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <h3>Recent Movements</h3>
            </div>
            <div className="card-body">
              {d.recent_movements && d.recent_movements.length > 0 ? (
                <div className="movement-list">
                  {d.recent_movements.map(m => (
                    <div key={m.id} className="movement-item">
                      <span className={`badge badge-${m.movement_type.toLowerCase()}`}>
                        {m.movement_type}
                      </span>
                      <span><strong>{m.fish_name}</strong></span>
                      <span>Lot: {m.lot_no}</span>
                      <span>Location: {m.line_place}</span>
                      <span>{m.quantity_mc} MC / {Number(m.weight_kg).toFixed(2)} KG</span>
                      <span className="movement-time">
                        {bangkokLocaleString(new Date(m.created_at))}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <h4>No movements yet</h4>
                  <p>Start by adding products and recording stock IN</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default Dashboard;
