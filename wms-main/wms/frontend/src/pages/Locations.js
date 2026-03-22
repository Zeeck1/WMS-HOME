import React, { useState, useEffect } from 'react';
import { FiPlus, FiEdit2, FiTrash2, FiSearch } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getLocations, createLocation, updateLocation, deleteLocation, deleteAllLocations } from '../services/api';

function Locations() {
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState({ line_place: '', stack_no: '1', stack_total: '1', description: '' });

  useEffect(() => { fetchLocations(); }, []);

  const fetchLocations = async () => {
    try {
      const res = await getLocations();
      setLocations(res.data);
    } catch (err) {
      toast.error('Failed to load locations');
    } finally {
      setLoading(false);
    }
  };

  const openAdd = () => {
    setEditing(null);
    setForm({ line_place: '', stack_no: '1', stack_total: '1', description: '' });
    setShowModal(true);
  };

  const openEdit = (loc) => {
    setEditing(loc);
    setForm({
      line_place: loc.line_place,
      stack_no: String(loc.stack_no),
      stack_total: String(loc.stack_total),
      description: loc.description || ''
    });
    setShowModal(true);
  };

  // Check if a location with the same line_place code already exists
  const isDuplicate = (formData, editingId) => {
    const code = formData.line_place.trim().toUpperCase();
    return locations.find(loc => {
      if (editingId && loc.id === editingId) return false;
      return loc.line_place.toUpperCase() === code;
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.line_place) {
      toast.warning('Line/Place code is required');
      return;
    }

    // Frontend duplicate check — by line_place only
    const dup = isDuplicate(form, editing?.id);
    if (dup) {
      toast.error(`Location "${dup.line_place}" already exists. Each location code must be unique.`);
      return;
    }

    try {
      const payload = { ...form, stack_no: parseInt(form.stack_no), stack_total: parseInt(form.stack_total) };
      if (editing) {
        await updateLocation(editing.id, payload);
        toast.success('Location updated');
      } else {
        await createLocation(payload);
        toast.success('Location created');
      }
      setShowModal(false);
      fetchLocations();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save location');
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Deactivate this location?')) return;
    try {
      await deleteLocation(id);
      toast.success('Location deactivated');
      fetchLocations();
    } catch (err) {
      toast.error('Failed to delete location');
    }
  };

  const handleDeleteAll = async () => {
    if (!window.confirm(`Are you sure you want to delete ALL ${locations.length} locations?\n\nThis action will deactivate every location.`)) return;
    if (!window.confirm('This is irreversible. Confirm again to proceed.')) return;
    try {
      const res = await deleteAllLocations();
      toast.success(res.data.message || 'All locations deleted');
      fetchLocations();
    } catch (err) {
      toast.error('Failed to delete all locations');
    }
  };

  // Filter locations by search
  const filtered = locations.filter(loc => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      loc.line_place.toLowerCase().includes(q) ||
      String(loc.stack_no).includes(q) ||
      (loc.description || '').toLowerCase().includes(q)
    );
  });

  if (loading) return <div className="loading"><div className="spinner"></div>Loading locations...</div>;

  return (
    <>
      <div className="page-header">
        <h2>Location Master</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          {locations.length > 0 && (
            <button className="btn btn-danger" onClick={handleDeleteAll}><FiTrash2 /> Delete All</button>
          )}
          <button className="btn btn-primary" onClick={openAdd}><FiPlus /> Add Location</button>
        </div>
      </div>
      <div className="page-body">
        <div className="alert alert-info">
          Each location code (e.g. <strong>A01R-1</strong>, <strong>A03R-2</strong>) must be unique.
          Multiple products can be stored at the same location — the location is only listed once here.
        </div>

        {/* Search Bar */}
        <div className="filter-bar">
          <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
            <FiSearch style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--gray-400)' }} />
            <input
              className="form-control"
              style={{ paddingLeft: 36 }}
              placeholder="Search by location code, description..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <span style={{ color: 'var(--gray-400)', fontSize: '0.82rem' }}>
            {filtered.length} of {locations.length} locations
          </span>
        </div>

        <div className="table-container">
          <table className="excel-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Line / Place</th>
                <th>Stack No</th>
                <th>Stack Total</th>
                <th>Description</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan="6" style={{ textAlign: 'center', padding: 40, color: '#999' }}>
                  {search ? 'No locations match your search.' : 'No locations found. Click "Add Location" to create one.'}
                </td></tr>
              ) : filtered.map((loc, i) => (
                <tr key={loc.id}>
                  <td className="text-center">{i + 1}</td>
                  <td><strong>{loc.line_place}</strong></td>
                  <td className="num-cell">{loc.stack_no}</td>
                  <td className="num-cell">{loc.stack_total}</td>
                  <td>{loc.description || '-'}</td>
                  <td>
                    <button className="btn btn-outline btn-sm" onClick={() => openEdit(loc)}><FiEdit2 /></button>
                    {' '}
                    <button className="btn btn-danger btn-sm" onClick={() => handleDelete(loc.id)}><FiTrash2 /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editing ? 'Edit Location' : 'Add Location'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="modal-body">
                <div className="form-group">
                  <label>Line / Place Code *</label>
                  <input className="form-control" value={form.line_place} onChange={e => setForm({ ...form, line_place: e.target.value })} placeholder="e.g. A01R-1" required />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Stack No</label>
                    <input className="form-control" type="number" min="1" value={form.stack_no} onChange={e => setForm({ ...form, stack_no: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Stack Total</label>
                    <input className="form-control" type="number" min="1" value={form.stack_total} onChange={e => setForm({ ...form, stack_total: e.target.value })} />
                  </div>
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <input className="form-control" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Optional description" />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default Locations;
