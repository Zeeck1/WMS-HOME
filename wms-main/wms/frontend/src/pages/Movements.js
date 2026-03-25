import React, { useState, useEffect } from 'react';
import { FiClock, FiSearch } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getMovements, getImportMovementHistory } from '../services/api';

function Movements() {
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({
    type: '',
    from_date: '',
    to_date: '',
    limit: '100'
  });

  useEffect(() => { fetchMovements(); }, []);

  const fetchMovements = async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.type) params.type = filters.type;
      if (filters.from_date) params.from_date = filters.from_date;
      if (filters.to_date) params.to_date = filters.to_date;
      if (filters.limit) params.limit = filters.limit;

      let mainData = [];
      let impData = [];

      try {
        const mainRes = await getMovements(params);
        mainData = (mainRes.data || []).map(m => ({ ...m, _source: 'warehouse' }));
      } catch (e) {
        console.error('Failed to load warehouse movements:', e);
      }

      if (!filters.type || filters.type === 'OUT') {
        try {
          const impRes = await getImportMovementHistory({
            from_date: filters.from_date,
            to_date: filters.to_date,
            limit: filters.limit
          });
          impData = (impRes.data || []).map(m => ({
            ...m,
            _source: 'import',
            id: `imp_${m.id}`,
            _date_out: m.date_out
          }));
        } catch (e) {
          console.error('Failed to load import movements:', e);
        }
      }

      const merged = [...mainData, ...impData].sort((a, b) =>
        new Date(b.created_at) - new Date(a.created_at)
      );

      setMovements(merged);
    } catch (err) {
      toast.error('Failed to load movements');
    } finally {
      setLoading(false);
    }
  };

  const handleFilter = (e) => {
    e.preventDefault();
    fetchMovements();
  };

  // Client-side text search across all visible columns
  const filtered = movements.filter(m => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (m.fish_name || '').toLowerCase().includes(q) ||
      (m.size || '').toLowerCase().includes(q) ||
      (m.lot_no || '').toLowerCase().includes(q) ||
      (m.line_place || '').toLowerCase().includes(q) ||
      (m.reference_no || '').toLowerCase().includes(q) ||
      (m.created_by || '').toLowerCase().includes(q) ||
      (m.notes || '').toLowerCase().includes(q) ||
      (m.movement_type || '').toLowerCase().includes(q)
    );
  });

  return (
    <>
      <div className="page-header">
        <h2><FiClock /> Movement History</h2>
      </div>
      <div className="page-body">
        {/* Search Bar */}
        <div className="filter-bar" style={{ marginBottom: 12 }}>
          <div style={{ position: 'relative', flex: 1, maxWidth: 420 }}>
            <FiSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
            <input
              className="form-control"
              style={{ paddingLeft: 36 }}
              placeholder="Search fish name, lot, location, reference, notes..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {search && (
            <span style={{ color: 'var(--gray-400)', fontSize: '0.82rem' }}>
              {filtered.length} of {movements.length} movements
            </span>
          )}
        </div>

        {/* Filters */}
        <form className="filter-bar" onSubmit={handleFilter}>
          <select className="form-control" value={filters.type} onChange={e => setFilters({ ...filters, type: e.target.value })} style={{ minWidth: 140 }}>
            <option value="">All Types</option>
            <option value="IN">Stock IN</option>
            <option value="OUT">Stock OUT</option>
            <option value="MOVE">Move</option>
          </select>
          <input className="form-control" type="date" value={filters.from_date} onChange={e => setFilters({ ...filters, from_date: e.target.value })} style={{ minWidth: 160 }} />
          <input className="form-control" type="date" value={filters.to_date} onChange={e => setFilters({ ...filters, to_date: e.target.value })} style={{ minWidth: 160 }} />
          <select className="form-control" value={filters.limit} onChange={e => setFilters({ ...filters, limit: e.target.value })} style={{ minWidth: 100 }}>
            <option value="50">50 rows</option>
            <option value="100">100 rows</option>
            <option value="500">500 rows</option>
            <option value="1000">1000 rows</option>
          </select>
          <button type="submit" className="btn btn-primary"><FiSearch /> Filter</button>
        </form>

        {loading ? (
          <div className="loading"><div className="spinner"></div>Loading movements...</div>
        ) : (
          <div className="table-container" style={{ maxHeight: '70vh', overflow: 'auto' }}>
            <table className="excel-table">
              <thead>
                <tr>
                  <th>Date/Time</th>
                  <th>Type</th>
                  <th>Fish Name</th>
                  <th>Size</th>
                  <th>Lot No</th>
                  <th>Location</th>
                  <th>Qty (MC)</th>
                  <th>Weight (KG)</th>
                  <th>Reference</th>
                  <th>Created By</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan="11" style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                    {search ? 'No movements match your search.' : 'No movements found'}
                  </td></tr>
                ) : filtered.map(m => (
                  <tr key={m.id} style={m._source === 'import' ? { background: 'rgba(79,70,229,0.03)' } : {}}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(m.created_at).toLocaleString()}</td>
                    <td>
                      <span className={`badge badge-${m.movement_type.toLowerCase()}`}>
                        {m.movement_type}
                      </span>
                      {m._source === 'import' && <span style={{ marginLeft: 4, fontSize: '0.65rem', color: 'var(--primary)', fontWeight: 700 }}>IMP</span>}
                    </td>
                    <td><strong>{m.fish_name}</strong></td>
                    <td>{m.size || '-'}</td>
                    <td>{m.lot_no}</td>
                    <td>{m.stack_no ? `${m.line_place} (Stack ${m.stack_no})` : (m.line_place || '-')}</td>
                    <td className="num-cell">{m.quantity_mc}</td>
                    <td className="num-cell">{Number(m.weight_kg).toFixed(2)}</td>
                    <td>{m.reference_no || '-'}</td>
                    <td>{m.created_by}</td>
                    <td>{m.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default Movements;
