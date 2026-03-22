import React, { useState, useEffect } from 'react';
import { FiBox, FiTruck, FiMapPin, FiCheckCircle, FiAlertTriangle } from 'react-icons/fi';
import { getDashboard } from '../services/api';

function Dashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const d = data || { total_mc: 0, total_kg: 0, total_stacks: 0, stock_status: 'No Data', recent_movements: [] };

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
            </div>
          </div>
        </div>

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
                        {new Date(m.created_at).toLocaleString()}
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
