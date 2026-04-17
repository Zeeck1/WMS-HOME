import React, { useState, useCallback, useMemo } from 'react';
import { FiRefreshCw, FiSave, FiArrowRight, FiLayers, FiChevronDown } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getInventory, manualReformat } from '../services/api';
import { WAREHOUSES, parseLocationCode } from '../config/warehouseConfig';

const WH = WAREHOUSES['CS-3'];
const ALL_LINES = [...WH.leftLines, ...WH.rightLines];
const SIDES = [
  { value: 'L', label: 'L (Left)' },
  { value: 'R', label: 'R (Right)' },
];

function buildPositionCodes(line, side) {
  const codes = [];
  const positions = side === 'L' ? 8 : 8;
  const levels = WH.levels;
  for (let p = 1; p <= positions; p++) {
    for (let lv = 1; lv <= levels; lv++) {
      codes.push(`${line}${String(p).padStart(2, '0')}${side}-${lv}`);
    }
  }
  return codes;
}

function LinesReformat() {
  const [line, setLine] = useState('A');
  const [side, setSide] = useState('R');
  const [items, setItems] = useState([]);
  const [assignments, setAssignments] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const positionCodes = useMemo(() => buildPositionCodes(line, side), [line, side]);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setLoaded(false);
    try {
      const res = await getInventory({ location: line, merge_import_shipments: '1' });
      const filtered = res.data.filter(r => {
        const p = parseLocationCode(r.line_place);
        return p && p.line === line && p.side === side;
      });
      filtered.sort((a, b) => {
        const pa = parseLocationCode(a.line_place);
        const pb = parseLocationCode(b.line_place);
        if (pa && pb) {
          if (pa.position !== pb.position) return pa.position - pb.position;
          return (pa.level || 0) - (pb.level || 0);
        }
        return (a.line_place || '').localeCompare(b.line_place || '');
      });
      setItems(filtered);
      setAssignments({});
      setLoaded(true);
    } catch { toast.error('Failed to load data'); }
    finally { setLoading(false); }
  }, [line, side]);

  const usedCodes = useMemo(() => {
    const used = new Set();
    items.forEach((item, i) => {
      const key = `${item.lot_id}-${item.location_id}`;
      const assigned = assignments[key];
      used.add(assigned || (item.line_place || '').toUpperCase());
    });
    return used;
  }, [items, assignments]);

  const handleAssign = (item, newCode) => {
    const key = `${item.lot_id}-${item.location_id}`;
    const current = (item.line_place || '').toUpperCase();
    if (newCode === current) {
      setAssignments(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    } else {
      setAssignments(prev => ({ ...prev, [key]: newCode }));
    }
  };

  const hasChanges = Object.keys(assignments).length > 0;

  const handleAutoRenumber = () => {
    const newMap = {};
    const grouped = {};
    items.forEach(item => {
      const p = parseLocationCode(item.line_place);
      const posKey = p ? `${p.line}${String(p.position).padStart(2, '0')}${p.side}` : 'UNKNOWN';
      if (!grouped[posKey]) grouped[posKey] = [];
      grouped[posKey].push(item);
    });

    Object.entries(grouped).forEach(([posKey, posItems]) => {
      posItems.forEach((item, idx) => {
        const newCode = `${posKey}-${idx + 1}`;
        const current = (item.line_place || '').toUpperCase();
        if (newCode !== current) {
          const key = `${item.lot_id}-${item.location_id}`;
          newMap[key] = newCode;
        }
      });
    });

    setAssignments(newMap);
    const changeCount = Object.keys(newMap).length;
    if (changeCount > 0) toast.info(`${changeCount} item(s) will be renumbered`);
    else toast.info('Already sequential — no changes needed');
  };

  const handleSave = async () => {
    if (!hasChanges) return;
    setSaving(true);
    try {
      const changes = Object.entries(assignments).map(([key, newCode]) => {
        const [lot_id, location_id] = key.split('-').map(Number);
        return { lot_id, old_location_id: location_id, new_line_place: newCode };
      });
      const res = await manualReformat(changes);
      toast.success(`${res.data.updated} position(s) updated`);
      setAssignments({});
      loadItems();
    } catch { toast.error('Save failed'); }
    finally { setSaving(false); }
  };

  const groupedItems = useMemo(() => {
    const groups = {};
    items.forEach(item => {
      const key = `${item.lot_id}-${item.location_id}`;
      const assigned = assignments[key];
      const effectiveLoc = assigned || (item.line_place || '').toUpperCase();
      const p = parseLocationCode(effectiveLoc);
      const posKey = p ? `${p.line}${String(p.position).padStart(2, '0')}${p.side}` : 'OTHER';
      if (!groups[posKey]) groups[posKey] = [];
      groups[posKey].push({ ...item, _effectiveLoc: effectiveLoc, _changed: !!assigned });
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [items, assignments]);

  return (
    <>
      <div className="page-header">
        <h2><FiLayers style={{ marginRight: 8, verticalAlign: 'middle' }} /> Lines Re-format</h2>
      </div>
      <div className="page-body">
        {/* Controls */}
        <div className="lr-controls">
          <div className="lr-control-group">
            <label>Line</label>
            <select className="form-control" value={line} onChange={e => setLine(e.target.value)}>
              {ALL_LINES.map(l => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div className="lr-control-group">
            <label>Side</label>
            <select className="form-control" value={side} onChange={e => setSide(e.target.value)}>
              {SIDES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={loadItems} disabled={loading}>
            <FiRefreshCw className={loading ? 'spin' : ''} /> {loading ? 'Loading...' : 'Load'}
          </button>
          {loaded && items.length > 0 && (
            <>
              <button className="btn btn-outline" onClick={handleAutoRenumber} title="Renumber levels sequentially within each position">
                Auto Renumber
              </button>
              <button className="btn btn-success" onClick={handleSave} disabled={!hasChanges || saving}>
                <FiSave /> {saving ? 'Saving...' : `Save${hasChanges ? ` (${Object.keys(assignments).length})` : ''}`}
              </button>
            </>
          )}
        </div>

        {/* Summary */}
        {loaded && (
          <div className="lr-summary">
            <span><b>{items.length}</b> item(s) on Line <b>{line}</b>, Side <b>{side}</b></span>
            {hasChanges && <span className="lr-changes-badge">{Object.keys(assignments).length} change(s)</span>}
          </div>
        )}

        {/* Grouped Position View */}
        {loaded && items.length === 0 && (
          <div className="lr-empty">No items found on Line {line}, Side {side}.</div>
        )}

        {groupedItems.map(([posKey, posItems]) => (
          <div key={posKey} className="lr-position-group">
            <div className="lr-position-header">
              <FiLayers /> Position <b>{posKey}</b>
              <span className="lr-pos-count">{posItems.length} item(s)</span>
            </div>
            <table className="lr-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}>#</th>
                  <th>Fish Name</th>
                  <th style={{ width: 80 }}>Size</th>
                  <th style={{ width: 80 }}>MC</th>
                  <th style={{ width: 140 }}>Current Location</th>
                  <th style={{ width: 50 }}></th>
                  <th style={{ width: 180 }}>New Location</th>
                </tr>
              </thead>
              <tbody>
                {posItems.map((item, idx) => {
                  const key = `${item.lot_id}-${item.location_id}`;
                  const current = (item.line_place || '').toUpperCase();
                  const assigned = assignments[key] || '';
                  return (
                    <tr key={key} className={item._changed ? 'lr-row-changed' : ''}>
                      <td className="lr-idx">{idx + 1}</td>
                      <td className="lr-fish">{item.fish_name}</td>
                      <td>{item.size || '-'}</td>
                      <td className="lr-mc">{item.hand_on_balance_mc}</td>
                      <td className="lr-loc">{current}</td>
                      <td className="lr-arrow"><FiArrowRight /></td>
                      <td>
                        <select className={`form-control lr-select ${assigned ? 'lr-select-changed' : ''}`}
                          value={assigned || current}
                          onChange={e => handleAssign(item, e.target.value)}>
                          <option value={current}>{current}</option>
                          {positionCodes.filter(c => c !== current && !usedCodes.has(c)).map(c => (
                            <option key={c} value={c}>{c}</option>
                          ))}
                          {assigned && assigned !== current && !positionCodes.includes(assigned) && (
                            <option value={assigned}>{assigned}</option>
                          )}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}

export default LinesReformat;
