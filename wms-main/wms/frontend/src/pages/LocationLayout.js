import React, { useState, useEffect, useMemo } from 'react';
import { FiLayers, FiArrowLeft, FiEye, FiMapPin, FiBox } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getInventory } from '../services/api';
import {
  WAREHOUSES,
  parseLocationCode,
  getAllLines,
  getTotalFloorPositions,
} from '../config/warehouseConfig';

const OCC_FULL_MIN = 860;
const OCC_MEDIUM_MIN = 500;

/** Only CS-3 is wired to live inventory; CS-1/CS-2 are layout previews until room data exists. */
function warehouseUsesInventory(warehouseId) {
  return warehouseId === 'CS-3';
}

/** Section meta for line detail (2D grid) */
function getSectionForLine(wh, line, side) {
  if (!wh) return { label: '', side: 'L', positions: 0, levels: 4, desc: '' };
  if (wh.layoutMode === 'single-aisle') {
    const rack = side === 'L' ? wh.leftRack : wh.rightRack;
    return {
      id: side,
      label: rack.label,
      side: rack.side,
      positions: rack.positions,
      levels: wh.levels,
      desc: `${rack.positions}×${wh.levels}`,
    };
  }
  const isLeftGroup = wh.leftLines.includes(line);
  if (isLeftGroup) {
    return side === 'L'
      ? {
          id: 'LL',
          label: wh.leftBlock.long.label,
          side: wh.leftBlock.long.side,
          positions: wh.leftBlock.long.positions,
          levels: wh.levels,
          desc: `${wh.leftBlock.long.positions}×${wh.levels}`,
        }
      : {
          id: 'RS',
          label: wh.leftBlock.short.label,
          side: wh.leftBlock.short.side,
          positions: wh.leftBlock.short.positions,
          levels: wh.levels,
          desc: `${wh.leftBlock.short.positions}×${wh.levels}`,
        };
  }
  return side === 'L'
    ? {
        id: 'LS',
        label: wh.rightBlock.short.label,
        side: wh.rightBlock.short.side,
        positions: wh.rightBlock.short.positions,
        levels: wh.levels,
        desc: `${wh.rightBlock.short.positions}×${wh.levels}`,
      }
    : {
        id: 'RL',
        label: wh.rightBlock.long.label,
        side: wh.rightBlock.long.side,
        positions: wh.rightBlock.long.positions,
        levels: wh.levels,
        desc: `${wh.rightBlock.long.positions}×${wh.levels}`,
      };
}

function LocationLayout() {
  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedWarehouse, setSelectedWarehouse] = useState('CS-3');
  const [selectedLine, setSelectedLine] = useState(null);
  const [selectedSide, setSelectedSide] = useState(null);
  const [hoveredCell, setHoveredCell] = useState(null);

  const wh = WAREHOUSES[selectedWarehouse];

  const sceneStyle = useMemo(() => {
    if (!wh) return {};
    const step = '40px';
    if (wh.layoutMode === 'single-aisle') {
      return {
        '--wh-cell-step': step,
        '--wh-g1s1': String(wh.leftRack.positions),
        '--wh-g1s2': String(wh.rightRack.positions),
      };
    }
    return {
      '--wh-cell-step': step,
      '--wh-g1s1': String(wh.leftBlock.long.positions),
      '--wh-g1s2': String(wh.leftBlock.short.positions),
      '--wh-g2s1': String(wh.rightBlock.short.positions),
      '--wh-g2s2': String(wh.rightBlock.long.positions),
    };
  }, [wh]);

  useEffect(() => {
    getInventory()
      .then((res) => setInventory(res.data))
      .catch(() => toast.error('Failed to load inventory'))
      .finally(() => setLoading(false));
  }, []);

  const inventoryForLayout = useMemo(() => {
    if (!warehouseUsesInventory(selectedWarehouse)) return [];
    return inventory;
  }, [inventory, selectedWarehouse]);

  const occupancyMap = useMemo(() => {
    const map = {};
    inventoryForLayout.forEach((item) => {
      const parsed = parseLocationCode(item.line_place);
      if (!parsed) return;
      const mc = Number(item.hand_on_balance_mc) || 0;
      const bulkKg = Number(item.bulk_weight_kg) || 0;
      const totalKg = mc * bulkKg;
      const orderCode = item.order_code || '';
      const productInfo = {
        fish: item.fish_name,
        size: item.size,
        qty: mc,
        bulkKg,
        totalKg,
        lot: item.lot_no,
        location: item.line_place,
        orderCode,
        stockType: item.stock_type,
      };

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
  }, [inventoryForLayout]);

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

  const hasLevel4Stock = (line, pos, side) => {
    const d = getLevelData(line, pos, side, 4);
    return !!(d && d.qty > 0);
  };

  const openDetail = (line, side) => {
    setSelectedLine(line);
    setSelectedSide(side);
  };
  const closeDetail = () => {
    setSelectedLine(null);
    setSelectedSide(null);
  };

  const renderRack = (line, side, count, reversed, clickSide) => {
    const positions = Array.from({ length: count }, (_, i) => i + 1);
    if (reversed) positions.reverse();
    return positions.map((pos) => {
      const data = getPosData(line, pos, side);
      const kg = data ? data.kg : 0;
      const occ = getOccupancyFromKg(kg);
      const showNoL4Slash = kg > 0 && !hasLevel4Stock(line, pos, side);
      return (
        <div
          key={`${line}-${side}${pos}`}
          className={`wh-cell wh-occ-${occ}`}
          onMouseEnter={() => setHoveredCell({ line, pos, side })}
          onMouseLeave={() => setHoveredCell(null)}
          onClick={(e) => {
            e.stopPropagation();
            openDetail(line, clickSide);
          }}
        >
          <div className="wh-cell-top" />
          <div className="wh-cell-front" />
          <div className="wh-cell-side" />
          {showNoL4Slash && <span className="wh-cell-level4-slash">/</span>}
        </div>
      );
    });
  };

  const renderSingleAisleOverview = () => {
    const lines = [...wh.lines].reverse();
    const nL = wh.leftRack.positions;
    const nR = wh.rightRack.positions;
    const revShort = true;

    return (
      <div className="wh-scene-wrapper">
        <div className="wh-legend">
          <span className="wh-legend-item">
            <span className="wh-dot wh-dot-empty" /> Empty (0 KG)
          </span>
          <span className="wh-legend-item">
            <span className="wh-dot wh-dot-light" /> Low (&lt;500 KG)
          </span>
          <span className="wh-legend-item">
            <span className="wh-dot wh-dot-medium" /> Medium (500-860 KG)
          </span>
          <span className="wh-legend-item">
            <span className="wh-dot wh-dot-full" /> Full (860+ KG)
          </span>
        </div>
        <div className="wh-scene wh-scene-2d wh-scene-flat" style={sceneStyle}>
          <div className="wh-warehouse-title">
            {wh.name} ({wh.id}) — {wh.lines.length} lines · {nL}+{nR} positions per line · {wh.levels} levels
          </div>
          <div className="wh-two-sides wh-two-sides-single">
            <div className="wh-group wh-group-left wh-group-single">
              <div className="wh-group-header">
                <span className="wh-gh-section">
                  {wh.leftRack.label} {nL}×{wh.levels}
                </span>
                <span className="wh-gh-label">Line</span>
                <span className="wh-gh-section">
                  {wh.rightRack.label} {nR}×{wh.levels}
                </span>
              </div>
              <div className="wh-group-body">
                {lines.map((line) => {
                  const lineData = occupancyMap[`LINE-${line}`];
                  const hasStock = lineData && lineData.count > 0;
                  return (
                    <div key={line} className={`wh-row ${hasStock ? 'wh-row-active' : ''}`}>
                      <div className="wh-rack wh-rack-dynamic" onClick={() => openDetail(line, 'L')}>
                        {renderRack(line, wh.leftRack.side, nL, false, 'L')}
                      </div>
                      <div className="wh-row-label">
                        <span className="wh-line-label">{line}</span>
                      </div>
                      <div className="wh-rack wh-rack-dynamic" onClick={() => openDetail(line, 'R')}>
                        {renderRack(line, wh.rightRack.side, nR, revShort, 'R')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
          <div className="wh-pos-indicators wh-pos-indicators-single">
            <span>01 (Wall)</span>
            <span>01 (Aisle) →</span>
            <span className="wh-pos-center">← 01 (Aisle)</span>
            <span>(Wall) 01</span>
          </div>
        </div>
        {hoveredCell && (
          <div className="wh-tooltip">
            <strong>
              {hoveredCell.line}
              {String(hoveredCell.pos).padStart(2, '0')}
              {hoveredCell.side}
            </strong>
            {(() => {
              const data = getPosData(hoveredCell.line, hoveredCell.pos, hoveredCell.side);
              if (!data) return <span className="wh-tooltip-empty">Empty</span>;
              const label = getOccupancyLabel(data.kg);
              return (
                <>
                  <span>
                    {data.qty} MC / {data.kg.toFixed(0)} KG
                  </span>
                  <span
                    className={`badge badge-occ-${label === 'Full' ? 'full' : label === 'Medium' ? 'med' : 'low'}`}
                  >
                    {label}
                  </span>
                  {data.products.slice(0, 3).map((p, i) => (
                    <span key={i} className="wh-tooltip-product">
                      {p.orderCode ? `[${p.orderCode}] ` : ''}
                      {p.fish} ({p.qty} MC × {p.bulkKg} KG = {p.totalKg.toFixed(0)} KG)
                    </span>
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

  const renderDoubleAisleOverview = () => {
    const leftLines = [...wh.leftLines].reverse();
    const rightLines = [...wh.rightLines].reverse();
    const g1L = wh.leftBlock.long.positions;
    const g1R = wh.leftBlock.short.positions;
    const g2L = wh.rightBlock.short.positions;
    const g2R = wh.rightBlock.long.positions;

    return (
      <div className="wh-scene-wrapper">
        <div className="wh-legend">
          <span className="wh-legend-item">
            <span className="wh-dot wh-dot-empty" /> Empty (0 KG)
          </span>
          <span className="wh-legend-item">
            <span className="wh-dot wh-dot-light" /> Low (&lt;500 KG)
          </span>
          <span className="wh-legend-item">
            <span className="wh-dot wh-dot-medium" /> Medium (500-860 KG)
          </span>
          <span className="wh-legend-item">
            <span className="wh-dot wh-dot-full" /> Full (860+ KG)
          </span>
        </div>
        <div className="wh-scene wh-scene-2d wh-scene-flat" style={sceneStyle}>
          <div className="wh-warehouse-title">
            {wh.name} ({wh.id})
          </div>
          <div className="wh-two-sides">
            <div className="wh-group wh-group-left">
              <div className="wh-group-header">
                <span className="wh-gh-section">
                  {wh.leftBlock.long.label} {g1L}×{wh.levels}
                </span>
                <span className="wh-gh-label">Line</span>
                <span className="wh-gh-section">
                  {wh.leftBlock.short.label} {g1R}×{wh.levels}
                </span>
              </div>
              <div className="wh-group-body">
                {leftLines.map((line) => {
                  const lineData = occupancyMap[`LINE-${line}`];
                  const hasStock = lineData && lineData.count > 0;
                  return (
                    <div key={line} className={`wh-row ${hasStock ? 'wh-row-active' : ''}`}>
                      <div className="wh-rack wh-rack-dynamic" onClick={() => openDetail(line, 'L')}>
                        {renderRack(line, wh.leftBlock.long.side, g1L, false, 'L')}
                      </div>
                      <div className="wh-row-label">
                        <span className="wh-line-label">{line}</span>
                      </div>
                      <div className="wh-rack wh-rack-dynamic" onClick={() => openDetail(line, 'R')}>
                        {renderRack(line, wh.leftBlock.short.side, g1R, true, 'R')}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="wh-central-aisle">
              <div className="wh-aisle-stripe" />
              <span className="wh-aisle-text">A I S L E</span>
              <div className="wh-aisle-stripe" />
            </div>
            <div className="wh-group wh-group-right">
              <div className="wh-group-header">
                <span className="wh-gh-section">
                  {wh.rightBlock.short.label} {g2L}×{wh.levels}
                </span>
                <span className="wh-gh-label">Line</span>
                <span className="wh-gh-section">
                  {wh.rightBlock.long.label} {g2R}×{wh.levels}
                </span>
              </div>
              <div className="wh-group-body">
                {rightLines.map((line) => {
                  const lineData = occupancyMap[`LINE-${line}`];
                  const hasStock = lineData && lineData.count > 0;
                  return (
                    <div key={line} className={`wh-row ${hasStock ? 'wh-row-active' : ''}`}>
                      <div className="wh-rack wh-rack-dynamic" onClick={() => openDetail(line, 'L')}>
                        {renderRack(line, wh.rightBlock.short.side, g2L, false, 'L')}
                      </div>
                      <div className="wh-row-label">
                        <span className="wh-line-label">{line}</span>
                      </div>
                      <div className="wh-rack wh-rack-dynamic" onClick={() => openDetail(line, 'R')}>
                        {renderRack(line, wh.rightBlock.long.side, g2R, true, 'R')}
                      </div>
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
            <strong>
              {hoveredCell.line}
              {String(hoveredCell.pos).padStart(2, '0')}
              {hoveredCell.side}
            </strong>
            {(() => {
              const data = getPosData(hoveredCell.line, hoveredCell.pos, hoveredCell.side);
              if (!data) return <span className="wh-tooltip-empty">Empty</span>;
              const label = getOccupancyLabel(data.kg);
              return (
                <>
                  <span>
                    {data.qty} MC / {data.kg.toFixed(0)} KG
                  </span>
                  <span
                    className={`badge badge-occ-${label === 'Full' ? 'full' : label === 'Medium' ? 'med' : 'low'}`}
                  >
                    {label}
                  </span>
                  {data.products.slice(0, 3).map((p, i) => (
                    <span key={i} className="wh-tooltip-product">
                      {p.orderCode ? `[${p.orderCode}] ` : ''}
                      {p.fish} ({p.qty} MC × {p.bulkKg} KG = {p.totalKg.toFixed(0)} KG)
                    </span>
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

  const renderOverview = () => {
    if (!wh) return null;
    if (wh.layoutMode === 'single-aisle') return renderSingleAisleOverview();
    return renderDoubleAisleOverview();
  };

  const renderLineDetail = () => {
    const line = selectedLine;
    const side = selectedSide;
    const section = getSectionForLine(wh, line, side);
    const sideLabel = side === 'L' ? 'Left' : 'Right';

    const levelGroups = {};
    for (let p = 1; p <= section.positions; p++) {
      for (let lv = 1; lv <= section.levels; lv++) {
        const lvData = getLevelData(line, p, section.side, lv);
        if (lvData && lvData.qty > 0) {
          const locCode = `${line}${String(p).padStart(2, '0')}${section.side}-${lv}`;
          levelGroups[locCode] = {
            pos: p,
            level: lv,
            data: lvData,
            occ: getOccupancyFromKg(lvData.kg),
            label: getOccupancyLabel(lvData.kg),
          };
        }
      }
    }

    return (
      <div className="wh-detail">
        <div className="wh-detail-header">
          <button type="button" className="btn btn-outline" onClick={closeDetail}>
            <FiArrowLeft /> Back to Overview
          </button>
          <h3>
            Line {line} — {sideLabel} Side ({section.label})
          </h3>
          <span className="wh-detail-badge">{section.desc}</span>
        </div>
        <div className="wh-detail-section">
          <div className="wh-detail-rack">
            <div className="wh-detail-level-labels">
              <div className="wh-detail-corner">Pos</div>
              {Array.from({ length: section.levels }, (_, l) => (
                <div key={l} className="wh-detail-level-label">
                  Lv {l + 1}
                </div>
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
                  <div className="wh-detail-pos-label">
                    {line}
                    {posStr}
                    {section.side}
                  </div>
                  {Array.from({ length: section.levels }, (_, l) => {
                    const level = l + 1;
                    const lvData = getLevelData(line, pos, section.side, level);
                    const lvKg = lvData ? lvData.kg : 0;
                    const lvOcc = getOccupancyFromKg(lvKg);
                    const hasData = lvData && lvData.qty > 0;
                    return (
                      <div
                        key={level}
                        className={`wh-detail-cell wh-detail-occ-${lvOcc}`}
                        title={
                          hasData
                            ? `${line}${posStr}${section.side}-${level}: ${lvKg.toFixed(0)} KG (${getOccupancyLabel(lvKg)})`
                            : `${line}${posStr}${section.side}-${level}: Empty`
                        }
                      >
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
                        <span className={`wh-detail-occ-badge wh-detail-occ-badge-${posOcc}`}>
                          {getOccupancyLabel(posTotalKg)}
                        </span>
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
            <h4 className="wh-products-title">
              <FiBox /> Stored Products — Line {line} {sideLabel} ({section.side})
            </h4>
            <div className="wh-product-cards">
              {Object.entries(levelGroups).map(([locCode, group]) => (
                <div key={locCode} className={`wh-product-card wh-product-card-occ-${group.occ}`}>
                  <div className="wh-product-card-header">
                    <div className="wh-product-card-loc">
                      <FiMapPin />
                      <span className="wh-product-card-code">{locCode}</span>
                    </div>
                    <div className="wh-product-card-summary">
                      <span className="wh-product-card-kg">{group.data.kg.toFixed(0)} KG</span>
                      <span className={`wh-product-card-badge wh-product-card-badge-${group.occ}`}>{group.label}</span>
                    </div>
                  </div>
                  <div className="wh-product-card-body">
                    {group.data.products.map((prod, i) => (
                      <div key={i} className="wh-product-card-item">
                        <div className="wh-product-card-item-main">
                          <span className="wh-product-card-fish">
                            {prod.orderCode ? `[${prod.orderCode}] ` : ''}
                            {prod.fish}
                          </span>
                          <span className="wh-product-card-size">{prod.size}</span>
                        </div>
                        <div className="wh-product-card-item-detail">
                          <span className="wh-product-card-calc">
                            {prod.qty} MC × {prod.bulkKg} KG = <strong>{prod.totalKg.toFixed(0)} KG</strong>
                          </span>
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

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading warehouse layout...
      </div>
    );
  }

  const lineCount = wh ? getAllLines(selectedWarehouse).length : 0;
  const floorPositions = wh ? getTotalFloorPositions(selectedWarehouse) : 0;
  const levels = wh?.levels ?? 4;

  return (
    <>
      <div className="page-header">
        <h2>
          <FiLayers /> Location Layout
        </h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <select
            className="form-control"
            style={{ width: 'auto', minWidth: 160 }}
            value={selectedWarehouse}
            onChange={(e) => {
              setSelectedWarehouse(e.target.value);
              closeDetail();
            }}
          >
            {Object.keys(WAREHOUSES).map((id) => (
              <option key={id} value={id}>
                {WAREHOUSES[id].name}
              </option>
            ))}
          </select>
          {selectedLine && (
            <button type="button" className="btn btn-outline" onClick={closeDetail}>
              <FiEye /> Overview
            </button>
          )}
        </div>
      </div>
      <div className="page-body">
        <div className="wh-stats-bar">
          <div className="wh-stat">
            <strong>{lineCount}</strong>
            <span>Lines</span>
          </div>
          <div className="wh-stat">
            <strong>{floorPositions}</strong>
            <span>Floor positions</span>
          </div>
          <div className="wh-stat">
            <strong>{levels}</strong>
            <span>Levels</span>
          </div>
          <div className="wh-stat">
            <strong>{inventoryForLayout.length}</strong>
            <span>Active Stocks</span>
          </div>
        </div>
        {selectedLine ? renderLineDetail() : renderOverview()}
      </div>
    </>
  );
}

export default LocationLayout;
