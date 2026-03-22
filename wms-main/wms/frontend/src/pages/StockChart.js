import React, { useState, useEffect } from 'react';
import { FiSearch, FiBarChart2 } from 'react-icons/fi';
import { toast } from 'react-toastify';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import { getInventory } from '../services/api';

const CHART_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#ef4444', '#84cc16'];

function StockChart() {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ fish_name: '', location: '', lot_no: '' });

  useEffect(() => {
    fetchInventory();
  }, []);

  const fetchInventory = async () => {
    try {
      const res = await getInventory(filters);
      setInventory(res.data);
    } catch (err) {
      toast.error('Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e) => {
    e.preventDefault();
    setLoading(true);
    fetchInventory();
  };

  // Aggregate by product (fish_name + size)
  const byProduct = React.useMemo(() => {
    const map = {};
    inventory.forEach((r) => {
      const key = `${r.fish_name}${r.size ? ' / ' + r.size : ''}`;
      if (!map[key]) map[key] = { name: key, mc: 0, kg: 0 };
      map[key].mc += Number(r.hand_on_balance_mc) || 0;
      map[key].kg += Number(r.hand_on_balance_kg) || 0;
    });
    return Object.values(map)
      .sort((a, b) => b.mc - a.mc)
      .slice(0, 12);
  }, [inventory]);

  // Aggregate by location (line_place)
  const byLocation = React.useMemo(() => {
    const map = {};
    inventory.forEach((r) => {
      const loc = r.line_place || 'Unknown';
      if (!map[loc]) map[loc] = { name: loc, mc: 0, kg: 0 };
      map[loc].mc += Number(r.hand_on_balance_mc) || 0;
      map[loc].kg += Number(r.hand_on_balance_kg) || 0;
    });
    return Object.values(map)
      .sort((a, b) => b.mc - a.mc)
      .slice(0, 15);
  }, [inventory]);

  // Pie data (top products by MC)
  const pieData = React.useMemo(() => {
    return byProduct.slice(0, 8).map((d, i) => ({
      name: d.name,
      shortName: d.name.length > 26 ? d.name.slice(0, 24) + '…' : d.name,
      value: d.mc,
      color: CHART_COLORS[i % CHART_COLORS.length]
    }));
  }, [byProduct]);

  const totalMC = inventory.reduce((sum, r) => sum + Number(r.hand_on_balance_mc), 0);
  const totalKG = inventory.reduce((sum, r) => sum + Number(r.hand_on_balance_kg), 0);

  if (loading) return <div className="loading"><div className="spinner"></div>Loading stock data...</div>;

  return (
    <>
      <div className="page-header">
        <h2><FiBarChart2 /> Stock Chart</h2>
      </div>
      <div className="page-body">
        <p className="stock-chart-intro">Charts are based on the same data as Stock Table. Use filters and Search to update.</p>

        {/* Filter Bar — same as Stock Table */}
        <form className="filter-bar" onSubmit={handleSearch}>
          <input
            className="form-control"
            placeholder="Fish Name..."
            value={filters.fish_name}
            onChange={e => setFilters({ ...filters, fish_name: e.target.value })}
          />
          <input
            className="form-control"
            placeholder="Location..."
            value={filters.location}
            onChange={e => setFilters({ ...filters, location: e.target.value })}
          />
          <input
            className="form-control"
            placeholder="Lot No..."
            value={filters.lot_no}
            onChange={e => setFilters({ ...filters, lot_no: e.target.value })}
          />
          <button type="submit" className="btn btn-primary"><FiSearch /> Search</button>
        </form>

        {/* Summary */}
        <div className="dashboard-grid" style={{ marginBottom: 24 }}>
          <div className="stat-card">
            <div className="stat-info">
              <h4>Total MC</h4>
              <div className="stat-value" style={{ fontSize: '1.3rem' }}>{totalMC.toLocaleString()}</div>
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-info">
              <h4>Total KG</h4>
              <div className="stat-value" style={{ fontSize: '1.3rem' }}>{totalKG.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
            </div>
          </div>
        </div>

        {inventory.length === 0 ? (
          <div className="empty-state" style={{ padding: 48, textAlign: 'center', color: '#64748b' }}>
            No stock data to chart. Record Stock IN or upload Excel, then try again.
          </div>
        ) : (
          <div className="stock-chart-grid">
            {/* Bar: Stock by Product */}
            <div className="chart-card">
              <h3 className="chart-title">Stock by Product (Hand On Balance MC)</h3>
              <div className="chart-inner">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={byProduct} margin={{ top: 8, right: 16, left: 8, bottom: 60 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} angle={-35} textAnchor="end" height={70} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => [value, 'MC']} />
                    <Bar dataKey="mc" name="MC" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Bar: Stock by Location */}
            <div className="chart-card">
              <h3 className="chart-title">Stock by Location (Hand On Balance MC)</h3>
              <div className="chart-inner">
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={byLocation} margin={{ top: 8, right: 16, left: 8, bottom: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => [value, 'MC']} />
                    <Bar dataKey="mc" name="MC" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Pie: Distribution by Product */}
            <div className="chart-card chart-card-full">
              <h3 className="chart-title">Stock Distribution by Product (Top 8)</h3>
              <div className="chart-inner" style={{ maxWidth: 760, margin: '0 auto' }}>
                <ResponsiveContainer width="100%" height={360}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={120}
                      paddingAngle={2}
                      dataKey="value"
                      nameKey="name"
                      label={false}
                      labelLine={false}
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={index} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [value, 'MC']} />
                    <Legend
                      layout="vertical"
                      verticalAlign="middle"
                      align="right"
                      formatter={(value, entry) => {
                        const payload = entry && entry.payload ? entry.payload : null;
                        const nm = payload?.shortName || value;
                        const mc = payload?.value;
                        return `${nm} (${mc} MC)`;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default StockChart;
