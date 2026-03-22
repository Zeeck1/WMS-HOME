import React, { useState, useEffect, useMemo } from 'react';
import { FiLayers, FiArrowLeft, FiMaximize2, FiMinimize2, FiEye, FiMapPin, FiBox } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getInventory } from '../services/api';
import { WAREHOUSES, parseLocationCode } from '../config/warehouseConfig';

const OCC_FULL_MIN = 860;
const OCC_MEDIUM_MIN = 500;

function LocationLayout() {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedWarehouse, setSelectedWarehouse] = useState('CS-3');
  const [selectedLine, setSelectedLine] = useState(null);
  const [selectedSide, setSelectedSide] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);
  const [viewMode, setViewMode] = useState('3d');

  const wh = WAREHOUSES[selectedWarehouse];

  useEffect(() => {
    getInventory()
      .then(res => setInventory(res.data))
      .catch(() => toast.error('Failed to load inventory'))
      .finally(() => setLoading(false));
  }, []);

  const occupancyMap = useMemo(() => {
    const map = {};
    inventory.forEach(item => {
      const parsed = parseLocationCode(item.line_place);
      if (!parsed) return;
      const mc = Number(item.hand_on_balance_mc) || 0;
      const bulkKg = Number(item.bulk_weight_kg) || 0;
      const totalKg = mc * bulkKg;
      const orderCode = item.order_code || '';
      const productInfo = { fish: item.fish_name, size: item.size, qty: mc, bulkKg, totalKg, lot: item.lot_no, location: item.line_place, orderCode, stockType: item.stock_type };

      const posKey = `${parsed.line}-${parsed.position}-${parsed.side}`;
      if (!map[posKey]) map[posKey] = { qty: 0, kg: 0, products: [], line: parsed.line };
      map[posKey].qty += mc;
      map[posKey].kg += totalKg;
      map[posKey].products.push(productInfo);

      if (parsed.level) {
        const levelKey = `${parsed.line}-${parsed.position}-${parsed.side}-${parsed.level}`;
        if (!map[levelKey]) map[levelKey] = { qty: 0, kg: 0, products: [], line: parsed.line, level: parsed.level };
        map[levelKey].qty += mc;
        map[levelKey].kg += totalKg;
        map[levelKey].products.push(productInfo);
      }

      const lineKey = `LINE-${parsed.line}`;
      if (!map[lineKey]) map[lineKey] = { qty: 0, kg: 0, count: 0 };
      map[lineKey].qty += mc;
      map[lineKey].kg += totalKg;
      map[lineKey].count += 1;
    });
    return map;
  }, [inventory]);

  const getOccupancyFromKg = (kg) => {
    if (!kg || kg === 0) return 0;
    if (kg >= OCC_FULL_MIN) return 3;
    if (kg >= OCC_MEDIUM_MIN) return 2;
    return 1;
  };

  const getOccupancyLabel = (kg) => {
    if (!kg || kg === 0) return 'Empty';
    if (kg >= OCC_FULL_MIN) return 'Full';
    if (kg >= OCC_MEDIUM_MIN) return 'Medium';
    return 'Low';
  };

  const getPosData = (line, pos, side) => occupancyMap[`${line}-${pos}-${side}`] || null;
  const getLevelData = (line, pos, side, level) => occupancyMap[`${line}-${pos}-${side}-${level}`] || null;

  const openDetail = (line, side) => { setSelectedLine(line); setSelectedSide(side); };
  const closeDetail = () => { setSelectedLine(null); setSelectedSide(null); };

  const renderRack = (line, side, count, reversed, clickSide) => {
    const positions = Array.from({ length: count }, (_, i) => i + 1);
    if (reversed) positions.reverse();
    return positions.map(pos => {
      const data = getPosData(line, pos, side);
      const kg = data ? data.kg : 0;
      const occ = getOccupancyFromKg(kg);
      return (
        <div key={`${line}-${side}${pos}`} className={`wh-cell wh-occ-${occ}`}
          onMouseEnter={() => setHoveredCell({ line, pos, side })}
          onMouseLeave={() => setHoveredCell(null)}
          onClick={(e) => { e.stopPropagation(); openDetail(line, clickSide); }}>
          <div className="wh-cell-top"></div>
          <div className="wh-cell-front"></div>
          <div className="wh-cell-side"></div>
        </div>
      );
    });
  };

  // ── 3D Overview ──
  const render3DOverview = () => {
    const leftLines = [...wh.leftLines].reverse();
    const rightLines = [...wh.rightLines].reverse();

    return (
      <div className="wh-scene-wrapper">
        <div className="wh-legend">
          <span className="wh-legend-item"><span className="wh-dot wh-dot-empty"></span> Empty (0 KG)</span>
          <span className="wh-legend-item"><span className="wh-dot wh-dot-light"></span> Low (&lt;500 KG)</span>
          <span className="wh-legend-item"><span className="wh-dot wh-dot-medium"></span> Medium (500-860 KG)</span>
          <span className="wh-legend-item"><span className="wh-dot wh-dot-full"></span> Full (860+ KG)</span>
        </div>
        <div className={`wh-scene ${viewMode === '3d' ? 'wh-scene-3d' : 'wh-scene-2d'}`}>
          <div className="wh-warehouse-title">{wh.name} ({wh.id})</div>
          <div className="wh-two-sides">
            <div className="wh-group wh-group-left">
              <div className="wh-group-header">
                <span className="wh-gh-section">Left (Long) 8x4</span>
                <span className="wh-gh-label">Line</span>
                <span className="wh-gh-section">Right (Short) 4x4</span>
              </div>
              <div className="wh-group-body">
                {leftLines.map(line => {
                  const lineData = occupancyMap[`LINE-${line}`];
                  const hasStock = lineData && lineData.count > 0;
                  return (
                    <div key={line} className={`wh-row ${hasStock ? 'wh-row-active' : ''}`}>
                      <div className="wh-rack wh-rack-8" onClick={() => openDetail(line, 'L')}>{renderRack(line, 'L', 8, false, 'L')}</div>
                      <div className="wh-row-label"><span className="wh-line-label">{line}</span></div>
                      <div className="wh-rack wh-rack-4" onClick={() => openDetail(line, 'R')}>{renderRack(line, 'R', 4, true, 'R')}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="wh-central-aisle">
              <div className="wh-aisle-stripe"></div>
              <span className="wh-aisle-text">A I S L E</span>
              <div className="wh-aisle-stripe"></div>
            </div>
            <div className="wh-group wh-group-right">
              <div className="wh-group-header">
                <span className="wh-gh-section">Left (Short) 4x4</span>
                <span className="wh-gh-label">Line</span>
                <span className="wh-gh-section">Right (Long) 8x4</span>
              </div>
              <div className="wh-group-body">
                {rightLines.map(line => {
                  const lineData = occupancyMap[`LINE-${line}`];
                  const hasStock = lineData && lineData.count > 0;
                  return (
                    <div key={line} className={`wh-row ${hasStock ? 'wh-row-active' : ''}`}>
                      <div className="wh-rack wh-rack-4" onClick={() => openDetail(line, 'L')}>{renderRack(line, 'L', 4, false, 'L')}</div>
                      <div className="wh-row-label"><span className="wh-line-label">{line}</span></div>
                      <div className="wh-rack wh-rack-8" onClick={() => openDetail(line, 'R')}>{renderRack(line, 'R', 8, true, 'R')}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="wh-pos-indicators">
            <span>01 (Wall)</span>
            <span>01 (Aisle) →</span>
            <span className="wh-pos-center">← 01 (Aisle)</span>
            <span>(Wall) 01</span>
          </div>
        </div>
        {hoveredCell && (
          <div className="wh-tooltip">
            <strong>{hoveredCell.line}{String(hoveredCell.pos).padStart(2, '0')}{hoveredCell.side}</strong>
            {(() => {
              const data = getPosData(hoveredCell.line, hoveredCell.pos, hoveredCell.side);
              if (!data) return <span className="wh-tooltip-empty">Empty</span>;
              const label = getOccupancyLabel(data.kg);
              return (
                <>
                  <span>{data.qty} MC / {data.kg.toFixed(0)} KG</span>
                  <span className={`badge badge-occ-${label === 'Full' ? 'full' : label === 'Medium' ? 'med' : 'low'}`}>{label}</span>
                  {data.products.slice(0, 3).map((p, i) => (
                    <span key={i} className="wh-tooltip-product">{p.orderCode ? `[${p.orderCode}] ` : ''}{p.fish} ({p.qty} MC × {p.bulkKg} KG = {p.totalKg.toFixed(0)} KG)</span>
                  ))}
                  {data.products.length > 3 && <span>+{data.products.length - 3} more</span>}
                </>
              );
            })()}
          </div>
        )}
      </div>
    );
  };

  // ── Line Detail View ──
  const renderLineDetail = () => {
    const line = selectedLine;
    const side = selectedSide;
    const isLeftGroup = wh.leftLines.includes(line);
    let section;
    if (isLeftGroup) {
      section = side === 'L'
        ? { id: 'LL', label: 'Left (Long)', side: 'L', positions: 8, levels: 4, desc: '8x4/15' }
        : { id: 'RS', label: 'Right (Short)', side: 'R', positions: 4, levels: 4, desc: '4x4/15' };
    } else {
      section = side === 'L'
        ? { id: 'LS', label: 'Left (Short)', side: 'L', positions: 4, levels: 4, desc: '4x4/15' }
        : { id: 'RL', label: 'Right (Long)', side: 'R', positions: 8, levels: 4, desc: '8x4/15' };
    }

    const levelGroups = {};
    for (let p = 1; p <= section.positions; p++) {
      for (let lv = 1; lv <= section.levels; lv++) {
        const lvData = getLevelData(line, p, section.side, lv);
        if (lvData && lvData.qty > 0) {
          const locCode = `${line}${String(p).padStart(2, '0')}${section.side}-${lv}`;
          levelGroups[locCode] = { pos: p, level: lv, data: lvData, occ: getOccupancyFromKg(lvData.kg), label: getOccupancyLabel(lvData.kg) };
        }
      }
    }

    const sideLabel = side === 'L' ? 'Left' : 'Right';

    return (
      <div className="wh-detail">
        <div className="wh-detail-header">
          <button className="btn btn-outline" onClick={closeDetail}><FiArrowLeft /> Back to Overview</button>
          <h3>Line {line} — {sideLabel} Side ({section.label})</h3>
          <span className="wh-detail-badge">{section.desc}</span>
        </div>
        <div className="wh-detail-section">
          <div className="wh-detail-rack">
            <div className="wh-detail-level-labels">
              <div className="wh-detail-corner">Pos</div>
              {Array.from({ length: section.levels }, (_, l) => (
                <div key={l} className="wh-detail-level-label">Lv {l + 1}</div>
              ))}
              <div className="wh-detail-level-label wh-detail-kg-col">Total KG</div>
            </div>
            {Array.from({ length: section.positions }, (_, p) => {
              const pos = p + 1;
              const posStr = String(pos).padStart(2, '0');
              const posData = getPosData(line, pos, section.side);
              const posTotalKg = posData ? posData.kg : 0;
              const posOcc = getOccupancyFromKg(posTotalKg);
              return (
                <div key={pos} className="wh-detail-pos-row">
                  <div className="wh-detail-pos-label">{line}{posStr}{section.side}</div>
                  {Array.from({ length: section.levels }, (_, l) => {
                    const level = l + 1;
                    const lvData = getLevelData(line, pos, section.side, level);
                    const lvKg = lvData ? lvData.kg : 0;
                    const lvOcc = getOccupancyFromKg(lvKg);
                    const hasData = lvData && lvData.qty > 0;
                    return (
                      <div key={level} className={`wh-detail-cell wh-detail-occ-${lvOcc}`}
                        title={hasData ? `${line}${posStr}${section.side}-${level}: ${lvKg.toFixed(0)} KG (${getOccupancyLabel(lvKg)})` : `${line}${posStr}${section.side}-${level}: Empty`}>
                        {hasData && (
                          <div className="wh-detail-cell-content">
                            <span className="wh-detail-qty">{lvData.qty}</span>
                            <span className="wh-detail-unit">MC</span>
                            <span className="wh-detail-cell-kg">{lvKg.toFixed(0)} KG</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <div className={`wh-detail-cell wh-detail-kg-cell wh-detail-occ-${posOcc}`}>
                    {posTotalKg > 0 ? (
                      <div className="wh-detail-cell-content">
                        <strong>{posTotalKg.toFixed(0)}</strong>
                        <span className={`wh-detail-occ-badge wh-detail-occ-badge-${posOcc}`}>{getOccupancyLabel(posTotalKg)}</span>
                      </div>
                    ) : (
                      <span style={{ color: 'var(--gray-400)' }}>-</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {Object.keys(levelGroups).length > 0 && (
          <div className="wh-products-section">
            <h4 className="wh-products-title"><FiBox /> Stored Products — Line {line} {sideLabel} ({section.side})</h4>
            <div className="wh-product-cards">
              {Object.entries(levelGroups).map(([locCode, group]) => (
                <div key={locCode} className={`wh-product-card wh-product-card-occ-${group.occ}`}>
                  <div className="wh-product-card-header">
                    <div className="wh-product-card-loc"><FiMapPin /><span className="wh-product-card-code">{locCode}</span></div>
                    <div className="wh-product-card-summary">
                      <span className="wh-product-card-kg">{group.data.kg.toFixed(0)} KG</span>
                      <span className={`wh-product-card-badge wh-product-card-badge-${group.occ}`}>{group.label}</span>
                    </div>
                  </div>
                  <div className="wh-product-card-body">
                    {group.data.products.map((prod, i) => (
                      <div key={i} className="wh-product-card-item">
                        <div className="wh-product-card-item-main">
                          <span className="wh-product-card-fish">{prod.orderCode ? `[${prod.orderCode}] ` : ''}{prod.fish}</span>
                          <span className="wh-product-card-size">{prod.size}</span>
                        </div>
                        <div className="wh-product-card-item-detail">
                          <span className="wh-product-card-calc">{prod.qty} MC × {prod.bulkKg} KG = <strong>{prod.totalKg.toFixed(0)} KG</strong></span>
                          <span className="wh-product-card-lot">Lot: {prod.lot}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="wh-product-card-footer">
                    <span>Total: {group.data.qty} MC</span>
                    <span>{group.data.kg.toFixed(0)} KG</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) return <div className="loading"><div className="spinner"></div>Loading warehouse layout...</div>;

  return (
    <>
      <div className="page-header">
        <h2><FiLayers /> Location Layout</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select className="form-control" style={{ width: 'auto', minWidth: 140 }}
            value={selectedWarehouse}
            onChange={e => { setSelectedWarehouse(e.target.value); closeDetail(); }}>
            {Object.keys(WAREHOUSES).map(id => (
              <option key={id} value={id}>{WAREHOUSES[id].name}</option>
            ))}
          </select>
          {!selectedLine && (
            <button className={`btn ${viewMode === '3d' ? 'btn-primary' : 'btn-outline'}`}
              onClick={() => setViewMode(viewMode === '3d' ? '2d' : '3d')}>
              {viewMode === '3d' ? <FiMinimize2 /> : <FiMaximize2 />}
              {viewMode === '3d' ? '3D' : '2D'}
            </button>
          )}
          {selectedLine && (
            <button className="btn btn-outline" onClick={closeDetail}><FiEye /> Overview</button>
          )}
        </div>
      </div>
      <div className="page-body">
        <div className="wh-stats-bar">
          <div className="wh-stat"><strong>{wh.leftLines.length + wh.rightLines.length}</strong><span>Lines</span></div>
          <div className="wh-stat"><strong>{(wh.leftLines.length + wh.rightLines.length) * 24}</strong><span>Positions</span></div>
          <div className="wh-stat"><strong>{wh.totalLevels}</strong><span>Levels</span></div>
          <div className="wh-stat"><strong>{inventory.length}</strong><span>Active Stocks</span></div>
        </div>
        {selectedLine ? renderLineDetail() : render3DOverview()}
      </div>
    </>
  );
}

export default LocationLayout;
