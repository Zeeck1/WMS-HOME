import React, { useState, useEffect, useRef, useMemo } from 'react';

import { useParams, useNavigate } from 'react-router-dom';

import { FiPrinter, FiDownload, FiArrowLeft, FiMapPin, FiCalendar, FiBox } from 'react-icons/fi';

import { toast } from 'react-toastify';

import html2canvas from 'html2canvas';

import { jsPDF } from 'jspdf';

import { getWithdrawal, getInventory } from '../services/api';

import { bangkokLocaleDateString } from '../utils/bangkokTime';

import { fetchManualInventoryAllTabs } from '../utils/manualInventoryShared';

import {
  requestedMc,
  actualMc,
  groupWithdrawItems,
  getWithdrawReportItems,
  withdrawFishNameLabel,
  formatWithdrawCsInDate,
  oldestCsInDateInGroup,
  withdrawLineStackNo,
  groupWithdrawItemsByLine,
} from '../utils/withdrawItemGrouping';



function WithdrawReport() {

  const { id } = useParams();

  const navigate = useNavigate();

  const reportRef = useRef(null);

  const [data, setData] = useState(null);

  const [inventory, setInventory] = useState([]);

  const [loading, setLoading] = useState(true);

  const [sortMode, setSortMode] = useState('nearest');

  const [lineView, setLineView] = useState(false);



  useEffect(() => {

    fetchData();

    // eslint-disable-next-line

  }, [id]);



  const fetchData = async () => {

    try {

      const [wRes, invRows] = await Promise.all([

        getWithdrawal(id),

        fetchManualInventoryAllTabs(getInventory),

      ]);

      const withdrawal = wRes.data;
      setData(withdrawal);
      setInventory(invRows || []);
      if (withdrawal.pick_route_saved && withdrawal.pick_route_mode === 'fifo') {
        setSortMode('cs_in_date');
      } else if (withdrawal.pick_route_saved) {
        setSortMode('nearest');
      }

    } catch (err) {

      toast.error('Failed to load report data');

    } finally {

      setLoading(false);

    }

  };



  const sortByCsIn = sortMode === 'cs_in_date';

  const reportItems = useMemo(() => {
    return getWithdrawReportItems(data, inventory, sortMode);
  }, [data, inventory, sortMode]);



  const itemGroups = useMemo(

    () => groupWithdrawItems(reportItems, sortMode),

    [reportItems, sortMode]

  );

  const lineViewActive = lineView;

  const lineGroups = useMemo(

    () => (lineViewActive ? groupWithdrawItemsByLine(reportItems, sortMode) : []),

    [reportItems, lineViewActive, sortMode]

  );

  const totalLocations = reportItems.length;

  const totalReqMc = reportItems.reduce((s, it) => s + requestedMc(it), 0);

  const totalActMc = reportItems.reduce((s, it) => s + actualMc(it), 0);

  const totalKg = reportItems.reduce((s, it) => s + (actualMc(it) * Number(it.bulk_weight_kg)), 0);



  const handleDownloadPDF = async () => {

    if (!reportRef.current) return;

    try {

      toast.info('Generating PDF...');

      const canvas = await html2canvas(reportRef.current, {

        useCORS: true,

        scale: 2,

        logging: false,

        backgroundColor: '#ffffff'

      });

      const imgData = canvas.toDataURL('image/png');

      const pdf = new jsPDF('l', 'mm', 'a4');

      const pageW = pdf.internal.pageSize.getWidth();

      const pageH = pdf.internal.pageSize.getHeight();

      const imgW = pageW;

      const imgH = (canvas.height * pageW) / canvas.width;

      if (imgH > pageH) {

        pdf.addImage(imgData, 'PNG', 0, 0, imgW, pageH);

        const extra = imgH - pageH;

        const pages = Math.ceil(extra / pageH) + 1;

        for (let p = 1; p < pages; p++) {

          pdf.addPage();

          const y = -pageH * p;

          pdf.addImage(imgData, 'PNG', 0, y, imgW, imgH);

        }

      } else {

        pdf.addImage(imgData, 'PNG', 0, 0, imgW, imgH);

      }

      const fileName = `stock-report-${data?.request_no || id || 'report'}.pdf`.replace(/\s+/g, '-');

      pdf.save(fileName);

      toast.success('PDF downloaded');

    } catch (err) {

      console.error(err);

      toast.error('Failed to download PDF');

    }

  };



  if (loading) return <div className="loading"><div className="spinner"></div>Loading report...</div>;

  if (!data) return <div className="page-body"><p>Withdrawal request not found.</p></div>;

  const reportColCount = sortByCsIn ? 12 : 11;



  return (

    <>

      <div className="page-header no-print">

        <h2>Stock Report — {data.request_no}</h2>

        <div className="wr-header-actions">

          <div className="wr-sort-switch no-print" role="tablist" aria-label="Report sort order">
            <button
              type="button"
              role="tab"
              aria-selected={sortMode === 'nearest'}
              className={`wr-sort-switch-option ${sortMode === 'nearest' ? 'active' : ''}`}
              onClick={() => setSortMode('nearest')}
              title="Nearest line to aisle (default pick route)"
            >
              <FiMapPin aria-hidden />
              <span>Nearest line</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sortByCsIn}
              className={`wr-sort-switch-option ${sortByCsIn ? 'active' : ''}`}
              onClick={() => setSortMode('cs_in_date')}
              title="Pick route from Stock Summary — oldest CS IN date first (FIFO), same request MC totals"
            >
              <FiCalendar aria-hidden />
              <span>Oldest lot (FIFO)</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sortMode === 'single_place'}
              className={`wr-sort-switch-option ${sortMode === 'single_place' ? 'active' : ''}`}
              onClick={() => setSortMode('single_place')}
              title="Fewest picks — prefer one location that can fulfill the whole request alone (nearest among those), even if farther"
            >
              <FiBox aria-hidden />
              <span>Single place</span>
            </button>
          </div>

          <div className="wr-layout-switch no-print" role="group" aria-label="Report layout">
            <span className="wr-layout-switch-label">Layout</span>
            <button
              type="button"
              className={`wr-layout-switch-option ${!lineView ? 'active' : ''}`}
              aria-pressed={!lineView}
              onClick={() => setLineView(false)}
            >
              By product
            </button>
            <button
              type="button"
              className={`wr-layout-switch-option ${lineView ? 'active' : ''}`}
              aria-pressed={lineView}
              onClick={() => setLineView(true)}
              title={sortMode === 'single_place'
                ? 'Group by warehouse line — fewest picks (single fulfilling location) within each line'
                : (sortByCsIn
                  ? 'Group by warehouse line — oldest CS IN date first within each line'
                  : 'Group by warehouse line — nearest location first within each line')}
            >
              <FiMapPin aria-hidden />
              <span>Line view</span>
            </button>
          </div>

          <button className="btn btn-outline" onClick={() => navigate(-1)}>

            <FiArrowLeft /> Back

          </button>

          <button className="btn btn-primary" onClick={() => window.print()}>

            <FiPrinter /> Print

          </button>

          <button className="btn btn-success" onClick={handleDownloadPDF}>

            <FiDownload /> Download PDF

          </button>

        </div>

      </div>



      <div className="wr-page" ref={reportRef}>

        <div className="wr-report">

          <div className="wr-header">

            <h1 className="wr-title">Stock Report</h1>

            <div className="wr-meta">

              <span><strong>Request No:</strong> {data.request_no}</span>

              <span><strong>Department:</strong> {data.department}</span>

              <span><strong>Date:</strong> {bangkokLocaleDateString(new Date(data.withdraw_date || data.created_at), { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>

              <span><strong>Status:</strong> {data.status}</span>

              <span><strong>Sort:</strong> {(() => {
                const base = sortMode === 'single_place'
                  ? 'Single place (fewest picks)'
                  : (sortByCsIn ? 'Oldest CS IN date first (FIFO)' : 'Nearest line');
                return lineViewActive ? `${base} — by Line / Place` : base;
              })()}</span>

              {lineViewActive && (
                <span className="wr-meta-line-view-tag">Line view layout</span>
              )}

            </div>

          </div>



          <table className={`wr-table${lineViewActive ? ' wr-table--line-view' : ''}`}>

            <thead>

              <tr>

                <th>Fish Name</th>

                <th>Size</th>

                <th>Bulk Weight</th>

                <th>Type</th>

                <th>Glazing</th>

                <th>Sticker</th>

                {sortByCsIn && <th>CS IN Date</th>}

                <th>Lines / Place</th>

                <th>Stack No</th>

                <th>Request MC</th>

                <th className="wr-col-balance">Actual (MC)</th>

                <th className="wr-col-remark">Remark</th>

              </tr>

            </thead>

            <tbody>

              {lineViewActive && lineGroups.map((lg) => {

                const lineDiffersTotal = lg.totalActMc !== lg.totalReqMc;

                return (

                  <React.Fragment key={`line-${lg.key}`}>

                    <tr className="wr-line-section-header">

                      <td colSpan={reportColCount} className="wr-line-section-header-cell">

                        <div className="wr-line-section-banner">

                          <div className="wr-line-section-left">

                            <span className="wr-line-letter" aria-hidden>{lg.line}</span>

                            <div className="wr-line-section-title">

                              <span className="wr-line-section-name">Line {lg.line}</span>

                              <span className="wr-line-section-meta">

                                {lg.lines.length} location{lg.lines.length !== 1 ? 's' : ''}

                              </span>

                            </div>

                          </div>

                          <div className="wr-line-section-stats">

                            <div className="wr-line-stat">

                              <span className="wr-line-stat-label">Request</span>

                              <span className="wr-line-stat-value">{lg.totalReqMc.toLocaleString()} MC</span>

                            </div>

                            <div className="wr-line-stat">

                              <span className="wr-line-stat-label">Actual</span>

                              <span className={`wr-line-stat-value${lineDiffersTotal ? ' wr-line-stat-value--warn' : ''}`}>

                                {lg.totalActMc.toLocaleString()} MC

                              </span>

                            </div>

                            <div className="wr-line-stat">

                              <span className="wr-line-stat-label">Weight</span>

                              <span className="wr-line-stat-value">{lg.totalKg.toLocaleString(undefined, { maximumFractionDigits: 1 })} KG</span>

                            </div>

                          </div>

                        </div>

                      </td>

                    </tr>

                    {lg.lines.map((line, lineIdx) => {

                      const lineDiffers = line.actMc !== line.reqMc;

                      return (

                        <tr
                          key={line.id ?? `${lg.key}-${line.line_place}-${line.stack_no}-${lineIdx}`}
                          className={`wr-line-item-row${lineIdx % 2 === 1 ? ' wr-line-item-row--alt' : ''}`}
                        >

                          <td className="wr-line-fish-cell">

                            <span className="wr-line-fish-name">{withdrawFishNameLabel(line)}</span>

                          </td>

                          <td className="wr-center wr-line-muted">{line.size || '—'}</td>

                          <td className="wr-center wr-line-muted">{Number(line.bulk_weight_kg)} KG</td>

                          <td className="wr-center wr-line-muted">{line.type || '—'}</td>

                          <td className="wr-center wr-line-muted">{line.glazing || '—'}</td>

                          <td className="wr-center wr-line-muted">{line.sticker || '—'}</td>

                          {sortByCsIn && (

                            <td className="wr-center wr-line-date">{formatWithdrawCsInDate(line.cs_in_date)}</td>

                          )}

                          <td className="wr-center">

                            <span className="wr-loc-pill">{line.line_place || '—'}</span>

                          </td>

                          <td className="wr-center wr-line-muted">{withdrawLineStackNo(line) || '—'}</td>

                          <td className="wr-center wr-line-mc">{line.reqMc.toLocaleString()}</td>

                          <td className={`wr-center wr-line-mc wr-line-mc--act${lineDiffers ? ' wr-balance' : ''}`}>

                            {line.actMc.toLocaleString()}

                          </td>

                          <td className="wr-remark-cell" aria-label="Remark (handwriting)" />

                        </tr>

                      );

                    })}

                  </React.Fragment>

                );

              })}

              {!lineViewActive && itemGroups.map((group) => {

                const groupActualDiffers = group.totalActMc !== group.totalReqMc;

                const multiLine = group.lines.length > 1;

                const groupOldestCsIn = sortByCsIn ? oldestCsInDateInGroup(group.lines) : null;

                return (

                  <React.Fragment key={group.key}>

                    <tr className="wr-group-row">

                      <td className="wr-bold">

                        {withdrawFishNameLabel(group)}

                        {multiLine && (

                          <span className="wr-group-badge">{group.lines.length} loc</span>

                        )}

                      </td>

                      <td className="wr-center">{group.size}</td>

                      <td className="wr-center">{Number(group.bulk_weight_kg)} KG</td>

                      <td className="wr-center">{group.type}</td>

                      <td className="wr-center">{group.glazing}</td>

                      <td className="wr-center">{group.sticker}</td>

                      {sortByCsIn && (

                        <td className="wr-center wr-bold">

                          {formatWithdrawCsInDate(groupOldestCsIn)}

                        </td>

                      )}

                      {multiLine ? (

                        <>

                          <td className="wr-center wr-group-loc-summary" colSpan={2}>

                            {group.lines.length} locations

                          </td>

                          <td className="wr-center wr-bold">{group.totalReqMc}</td>

                          <td className={`wr-center wr-bold ${groupActualDiffers ? 'wr-balance' : ''}`}>

                            {group.totalActMc}

                          </td>

                          <td className="wr-remark-cell" aria-label="Remark (handwriting)" />

                        </>

                      ) : (

                        <>

                          <td className="wr-center wr-bold">{group.lines[0].line_place}</td>

                          <td className="wr-center">{withdrawLineStackNo(group.lines[0])}</td>

                          <td className="wr-center">{group.lines[0].reqMc}</td>

                          <td className={`wr-center ${group.lines[0].actMc !== group.lines[0].reqMc ? 'wr-balance' : ''}`}>

                            {group.lines[0].actMc}

                          </td>

                          <td className="wr-remark-cell" aria-label="Remark (handwriting)" />

                        </>

                      )}

                    </tr>

                    {multiLine && group.lines.map((line) => {

                      const lineDiffers = line.actMc !== line.reqMc;

                      return (

                        <tr key={line.id ?? `${group.key}-${line.line_place}-${line.stack_no}`} className="wr-group-detail-row">

                          <td colSpan={6} className="wr-group-detail-spacer" aria-hidden="true" />

                          {sortByCsIn && (

                            <td className="wr-center">{formatWithdrawCsInDate(line.cs_in_date)}</td>

                          )}

                          <td className="wr-center wr-bold">{line.line_place}</td>

                          <td className="wr-center">{withdrawLineStackNo(line)}</td>

                          <td className="wr-center">{line.reqMc}</td>

                          <td className={`wr-center ${lineDiffers ? 'wr-balance' : ''}`}>{line.actMc}</td>

                          <td className="wr-remark-cell" aria-label="Remark (handwriting)" />

                        </tr>

                      );

                    })}

                  </React.Fragment>

                );

              })}

            </tbody>

          </table>



          <div className="wr-summary">

            <div className="wr-summary-item">

              <span className="wr-summary-label">Products</span>

              <span className="wr-summary-value">{itemGroups.length}</span>

            </div>

            <div className="wr-summary-item">

              <span className="wr-summary-label">Locations</span>

              <span className="wr-summary-value">{totalLocations}</span>

            </div>

            <div className="wr-summary-item">

              <span className="wr-summary-label">Requested (MC)</span>

              <span className="wr-summary-value">{totalReqMc}</span>

            </div>

            <div className="wr-summary-item">

              <span className="wr-summary-label">Actual (MC)</span>

              <span className="wr-summary-value">{totalActMc}</span>

            </div>

            <div className="wr-summary-item">

              <span className="wr-summary-label">Total KG</span>

              <span className="wr-summary-value">{totalKg.toFixed(1)}</span>

            </div>

          </div>

        </div>

      </div>

    </>

  );

}



export default WithdrawReport;

