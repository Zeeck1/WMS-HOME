import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FiPlus, FiEdit2, FiTrash2, FiSearch, FiAnchor, FiEye } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getImportShipments, deleteImportShipment } from '../services/api';
import { bangkokLocaleDateString } from '../utils/bangkokTime';

const fmtDate = (d) => d ? bangkokLocaleDateString(new Date(d), { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';

function ImportShipments() {
  const navigate = useNavigate();
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { fetchData(); }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const res = await getImportShipments();
      setShipments(res.data);
    } catch { toast.error('Failed to load import shipments'); }
    finally { setLoading(false); }
  };

  const handleDelete = async (id, invNo) => {
    if (!window.confirm(`Delete import "${invNo}"? This will remove all items, stock outs, and expenses.`)) return;
    try {
      await deleteImportShipment(id);
      toast.success('Deleted successfully');
      fetchData();
    } catch { toast.error('Delete failed'); }
  };

  const filtered = shipments.filter(s => {
    const q = search.toLowerCase();
    return !q || s.inv_no?.toLowerCase().includes(q) ||
      s.origin_country?.toLowerCase().includes(q) ||
      s.container_no?.toLowerCase().includes(q);
  });

  return (
    <div className="imp-page">
      <div className="imp-header">
        <div className="imp-header-left">
          <FiAnchor className="imp-header-icon" />
          <div>
            <h2>Import Shipments</h2>
            <p>Manage import stock, expenses, and tracking</p>
          </div>
        </div>
        <button className="imp-btn imp-btn-primary" onClick={() => navigate('/imports/new')}>
          <FiPlus /> Create New Import
        </button>
      </div>

      <div className="imp-card">
        <div className="imp-toolbar">
          <div className="imp-search">
            <FiSearch />
            <input
              placeholder="Search by INV NO, country, container..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span className="imp-count">{filtered.length} shipment{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="imp-loading">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="imp-empty">
            <FiAnchor />
            <p>No import shipments found</p>
            <button className="imp-btn imp-btn-primary" onClick={() => navigate('/imports/new')}>
              <FiPlus /> Create New Import
            </button>
          </div>
        ) : (
          <div className="imp-table-wrap">
            <table className="imp-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>INV NO</th>
                  <th>FROM</th>
                  <th>CONTAINER / SEAL</th>
                  <th>ETA</th>
                  <th>PRODUCTION</th>
                  <th>EXPIRY</th>
                  <th>ITEMS</th>
                  <th>TOTAL KGS</th>
                  <th>LAST UPDATE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, i) => (
                  <tr key={s.id}>
                    <td>{i + 1}</td>
                    <td className="imp-cell-bold">{s.inv_no}</td>
                    <td><span className="imp-origin-badge">{s.origin_country || '-'}</span></td>
                    <td className="imp-cell-small">
                      {s.container_no || '-'}{s.seal_no ? ` / ${s.seal_no}` : ''}
                    </td>
                    <td>{fmtDate(s.eta)}</td>
                    <td>{fmtDate(s.production_date)}</td>
                    <td>{fmtDate(s.expiry_date)}</td>
                    <td className="imp-cell-center">{s.item_count}</td>
                    <td className="imp-cell-right">{Number(s.total_inv_kgs || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</td>
                    <td>{s.last_update_stock ? fmtDate(s.last_update_stock) : '-'}</td>
                    <td>
                      <div className="imp-actions">
                        <button className="imp-action-btn imp-action-view" title="View / Edit" onClick={() => navigate(`/imports/${s.id}`)}>
                          <FiEye />
                        </button>
                        <button className="imp-action-btn imp-action-edit" title="Edit" onClick={() => navigate(`/imports/${s.id}`)}>
                          <FiEdit2 />
                        </button>
                        <button className="imp-action-btn imp-action-delete" title="Delete" onClick={() => handleDelete(s.id, s.inv_no)}>
                          <FiTrash2 />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default ImportShipments;
