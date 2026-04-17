import React, { useState, useEffect, useMemo, useRef } from 'react';
import ReactDOM from 'react-dom';
import { FiSearch, FiChevronDown, FiCheck, FiX } from 'react-icons/fi';

/** Google Sheets–style column filter (checkbox list + search). */
export default function ColumnFilterDropdown({ allValues, selected, onApply, onClear }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [localSelected, setLocalSelected] = useState(new Set(selected));
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const popupRef = useRef(null);
  const uniqueCount = new Set(allValues.map(v => v != null ? String(v) : '(Blank)')).size;
  const isFiltered = selected.size < uniqueCount;

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popupRef.current && popupRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => { if (open) setLocalSelected(new Set(selected)); }, [open, selected]);

  const handleOpen = () => {
    if (open) { setOpen(false); return; }
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      let left = rect.left;
      const popW = 300;
      if (left + popW > window.innerWidth - 12) left = window.innerWidth - popW - 12;
      if (left < 8) left = 8;
      setPos({ top: rect.bottom + 4, left });
    }
    setOpen(true);
  };

  const uniqueValues = useMemo(() => {
    const vals = [...new Set(allValues.map(v => v != null ? String(v) : '(Blank)'))];
    vals.sort((a, b) => a === '(Blank)' ? 1 : b === '(Blank)' ? -1 : a.localeCompare(b, undefined, { numeric: true }));
    return vals;
  }, [allValues]);

  const displayValues = useMemo(() => {
    if (!search.trim()) return uniqueValues;
    const q = search.toLowerCase();
    return uniqueValues.filter(v => v.toLowerCase().includes(q));
  }, [uniqueValues, search]);

  const allDisplaySelected = displayValues.length > 0 && displayValues.every(v => localSelected.has(v));

  const toggleValue = (val) => {
    setLocalSelected(prev => {
      const next = new Set(prev);
      next.has(val) ? next.delete(val) : next.add(val);
      return next;
    });
  };

  const handleSelectAll = () => {
    setLocalSelected(prev => {
      const next = new Set(prev);
      if (allDisplaySelected) { displayValues.forEach(v => next.delete(v)); }
      else { displayValues.forEach(v => next.add(v)); }
      return next;
    });
  };

  const handleApply = () => { onApply(localSelected); setOpen(false); setSearch(''); };
  const handleClearFilter = () => { onClear(); setOpen(false); setSearch(''); };

  const popup = open ? ReactDOM.createPortal(
    <div className="gs-filter-popup" ref={popupRef} style={{ top: pos.top, left: pos.left }}>
      <div className="gs-filter-search">
        <FiSearch size={13} />
        <input type="text" placeholder="Search..." value={search}
          onChange={e => setSearch(e.target.value)} autoFocus />
        {search && <button type="button" className="gs-filter-clear-search" onClick={() => setSearch('')}><FiX size={12} /></button>}
      </div>
      <div className="gs-filter-actions-top">
        <button type="button" onClick={handleSelectAll}>{allDisplaySelected ? 'Deselect All' : 'Select All'}</button>
        {isFiltered && <button type="button" onClick={handleClearFilter} className="gs-filter-clear-btn">Clear Filter</button>}
      </div>
      <div className="gs-filter-list">
        {displayValues.length === 0 ? (
          <div className="gs-filter-empty">No matches</div>
        ) : displayValues.map(val => (
          <div key={val} className="gs-filter-item" onClick={() => toggleValue(val)}>
            <div className={`gs-checkbox ${localSelected.has(val) ? 'gs-checked' : ''}`}>
              {localSelected.has(val) && <FiCheck size={11} />}
            </div>
            <span className="gs-filter-val">{val}</span>
          </div>
        ))}
      </div>
      <div className="gs-filter-footer">
        <button type="button" className="gs-filter-cancel" onClick={() => { setOpen(false); setSearch(''); }}>Cancel</button>
        <button type="button" className="gs-filter-ok" onClick={handleApply}>OK</button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div className="gs-filter-wrap">
      <button type="button" ref={btnRef}
        className={`gs-filter-btn ${isFiltered ? 'gs-filter-active' : ''}`}
        onClick={handleOpen} title="Filter this column">
        <FiChevronDown size={12} />
      </button>
      {popup}
    </div>
  );
}
