import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'react-toastify';
import { FiPackage, FiRefreshCw, FiTrendingDown, FiSearch } from 'react-icons/fi';
import { getLowStockStocks } from '../services/api';

const THRESHOLD_OPTIONS = [1000, 2000, 3000, 5000];

export default function LowSafetyStocks() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [thresholdKg, setThresholdKg] = useState(2000);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredItems = useMemo(() => {
    const q = (searchQuery || '').trim().toLowerCase();
    if (!q) return items;
    return items.filter(i => {
      const fish = (i.fish_name || '').toLowerCase();
      const order = (i.order_code || '').toLowerCase();
      const loc = (i.line_place || i.location_code || '').toLowerCase();
      return fish.includes(q) || order.includes(q) || loc.includes(q);
    });
  }, [items, searchQuery]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await getLowStockStocks({ threshold_kg: thresholdKg });
      setItems(data);
    } catch (err) {
      toast.error('Failed to load low/safety stock data');
    } finally {
      setLoading(false);
    }
  }, [thresholdKg]);

  useEffect(() => { load(); }, [load]);

  const totalMC = items.reduce((s, i) => s + Number(i.hand_on_balance_mc || 0), 0);
  const totalKG = items.reduce((s, i) => s + Number(i.hand_on_balance_kg || 0), 0);

  return (
    <div className="page-container">
      <div className="ls-page">
        <div className="ls-header">
          <div className="ls-header-left">
            <FiTrendingDown className="ls-header-icon" />
            <div>
              <h2 className="ls-title">Low / Safety Stocks</h2>
              <p className="ls-subtitle">Stock below {thresholdKg.toLocaleString()} KG (from Stock Table)</p>
            </div>
          </div>
          <div className="ls-header-actions">
            <select
              value={thresholdKg}
              onChange={e => setThresholdKg(Number(e.target.value))}
              className="ls-threshold-select"
            >
              {THRESHOLD_OPTIONS.map(k => (
                <option key={k} value={k}>Below {k.toLocaleString()} KG</option>
              ))}
            </select>
            <button type="button" onClick={load} className="ls-btn ls-btn-outline" disabled={loading}>
              <FiRefreshCw className={loading ? 'spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        <div className="ls-search-bar">
          <FiSearch className="ls-search-icon" />
          <input
            type="text"
            className="ls-search-input"
            placeholder="Search by fish name, order code, or location..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery.trim() && (
            <button type="button" className="ls-search-clear" onClick={() => setSearchQuery('')} aria-label="Clear search">
              ×
            </button>
          )}
        </div>

        <div className="ls-summary">
          <div className="ls-card ls-card-items">
            <FiPackage />
            <div className="ls-card-info">
              <span className="ls-card-value">{items.length}</span>
              <span className="ls-card-label">Items below threshold</span>
            </div>
          </div>
          <div className="ls-card ls-card-kg">
            <FiTrendingDown />
            <div className="ls-card-info">
              <span className="ls-card-value">{totalKG.toLocaleString(undefined, { maximumFractionDigits: 1 })}</span>
              <span className="ls-card-label">Total KG</span>
            </div>
          </div>
          <div className="ls-card ls-card-mc">
            <FiPackage />
            <div className="ls-card-info">
              <span className="ls-card-value">{totalMC.toLocaleString()}</span>
              <span className="ls-card-label">Total MC</span>
            </div>
          </div>
        </div>

        <div className="ls-report">
          <div className="ls-report-header">
            <h3>Low / Safety Stocks Report</h3>
            <p>Threshold: below {thresholdKg.toLocaleString()} KG &nbsp;|&nbsp; {filteredItems.length} item(s){searchQuery.trim() ? ' (filtered)' : ''}</p>
          </div>
          {loading ? (
            <div className="ls-loading">Loading...</div>
          ) : filteredItems.length === 0 ? (
            <div className="ls-empty">
              <FiPackage size={48} />
              <h3>{items.length === 0 ? 'All above threshold' : 'No matches'}</h3>
              <p>{items.length === 0 ? `No stock below ${thresholdKg.toLocaleString()} KG.` : 'Try a different search term.'}</p>
            </div>
          ) : (
            <div className="ls-table-wrap">
              <table className="ls-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Fish Name</th>
                    <th>Location</th>
                    <th>Type</th>
                    <th>Balance MC</th>
                    <th>Balance KG</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item, idx) => (
                    <tr key={`${item.lot_id}-${item.location_id}`}>
                      <td className="ls-cell-num">{idx + 1}</td>
                      <td className="ls-cell-name">
                        {item.fish_name}
                        {item.order_code && <span className="ls-order-tag">{item.order_code}</span>}
                      </td>
                      <td>{item.line_place || item.location_code || '—'}</td>
                      <td>
                        <span className={`ls-type-badge ${item.stock_type === 'CONTAINER_EXTRA' ? 'ls-type-extra' : item.stock_type === 'IMPORT' ? 'ls-type-import' : 'ls-type-bulk'}`}>
                          {item.stock_type === 'CONTAINER_EXTRA' ? 'EXTRA' : item.stock_type === 'IMPORT' ? 'IMPORT' : 'BULK'}
                        </span>
                      </td>
                      <td className="ls-cell-num">{Number(item.hand_on_balance_mc)}</td>
                      <td className="ls-cell-num ls-cell-kg">{Number(item.hand_on_balance_kg).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
