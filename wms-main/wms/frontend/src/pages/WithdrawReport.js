import React, { useState, useEffect, useRef, useMemo } from 'react';

import { useParams, useNavigate } from 'react-router-dom';

import { FiPrinter, FiDownload, FiArrowLeft, FiMapPin, FiCalendar } from 'react-icons/fi';

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

  buildOldestLotReportFromStockSummary,

  buildNearestLineReportFromStockSummary,

  sortWithdrawItems,

  withdrawFishNameLabel,

  formatWithdrawCsInDate,

  oldestCsInDateInGroup,

  withdrawLineStackNo,

  enrichWithdrawLinesFromInventory,

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

    const raw = data?.items || [];

    let lines;

    if (data?.status === 'FINISHED' || data?.pick_route_saved) {

      lines = sortWithdrawItems([...raw], sortByCsIn ? 'cs_in_date' : 'nearest');

    } else if (sortByCsIn && inventory.length) {

      lines = buildOldestLotReportFromStockSummary(raw, inventory);

    } else if (inventory.length) {

      lines = buildNearestLineReportFromStockSummary(raw, inventory);

    } else {

      lines = raw;

    }

    // Stack No must match the Manual page — resolve from live inventory (lot + line place)
    return enrichWithdrawLinesFromInventory(lines, inventory);

  }, [data, inventory, sortByCsIn]);



  const itemGroups = useMemo(

    () => groupWithdrawItems(reportItems, sortMode),

    [reportItems, sortMode]

  );

  // Line View only applies to "Nearest line" sort — group rows by warehouse line letter.
  const lineViewActive = lineView && !sortByCsIn;

  const lineGroups = useMemo(

    () => (lineViewActive ? groupWithdrawItemsByLine(reportItems) : []),

    [reportItems, lineViewActive]

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
          </div>

          {!sortByCsIn && (
            <button
              type="button"
              className={`wr-sort-switch-option wr-line-view-toggle ${lineView ? 'active' : ''}`}
              aria-pressed={lineView}
              onClick={() => setLineView((v) => !v)}
              title="Group the report by warehouse line (e.g. O Line, then P Line), nearest location first"
            >
              <FiMapPin aria-hidden />
              <span>Line view</span>
            </button>
          )}

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

              <span><strong>Sort:</strong> {sortByCsIn ? 'Oldest CS IN date first (FIFO)' : (lineViewActive ? 'Nearest line — by Line / Place' : 'Nearest line')}</span>

            </div>

          </div>



          <table className="wr-table">

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

                const colsBeforeLoc = sortByCsIn ? 7 : 6;

                return (

                  <React.Fragment key={`line-${lg.key}`}>

                    <tr className="wr-group-row wr-line-header-row">

                      <td className="wr-bold wr-line-header" colSpan={colsBeforeLoc + 5}>

                        {lg.line} Line

                        <span className="wr-group-badge">{lg.lines.length} loc</span>

                      </td>

                    </tr>

                    {lg.lines.map((line) => {

                      const lineDiffers = line.actMc !== line.reqMc;

                      return (

                        <tr key={line.id ?? `${lg.key}-${line.line_place}-${line.stack_no}`} className="wr-line-detail-row">

                          <td className="wr-bold">{withdrawFishNameLabel(line)}</td>

                          <td className="wr-center">{line.size}</td>

                          <td className="wr-center">{Number(line.bulk_weight_kg)} KG</td>

                          <td className="wr-center">{line.type}</td>

                          <td className="wr-center">{line.glazing}</td>

                          <td className="wr-center">{line.sticker}</td>

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

