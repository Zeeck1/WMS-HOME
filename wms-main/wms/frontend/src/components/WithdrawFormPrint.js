import React, { forwardRef } from 'react';
import { sortLocationsNearestFirst } from '../config/warehouseConfig';
import { bangkokLocaleDateString, bangkokLocaleString } from '../utils/bangkokTime';

/** One row per product line — merges multiple lots/locations with the same product. */
export function summarizeWithdrawItems(items) {
  const sorted = sortLocationsNearestFirst(items || [], 'line_place');
  const map = new Map();
  for (const it of sorted) {
    const st = it.stock_type || 'BULK';
    const key = [
      it.fish_name,
      it.size,
      it.type || '',
      it.glazing || '',
      Number(it.bulk_weight_kg),
      st,
      it.order_code || '',
    ].join('\0');
    const req = Number(it.requested_mc || it.quantity_mc);
    const act = Number(it.quantity_mc);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        ...it,
        requested_mc: req,
        quantity_mc: act,
      });
    } else {
      prev.requested_mc += req;
      prev.quantity_mc += act;
      const a = (it.production_process || '').trim();
      const b = (prev.production_process || '').trim();
      if (a && a !== b) {
        const parts = new Set([b, a].filter(Boolean));
        prev.production_process = [...parts].join(', ');
      } else if (a && !b) {
        prev.production_process = a;
      }
    }
  }
  return [...map.values()];
}

/**
 * Printable withdraw form (same layout as Withdraw Form page) — use with ref + html2canvas.
 */
const WithdrawFormPrint = forwardRef(function WithdrawFormPrint({ data }, ref) {
  if (!data) return null;

  const items = summarizeWithdrawItems(data.items || []);

  const formDate = data.withdraw_date
    ? new Date(data.withdraw_date)
    : new Date(data.created_at);
  const dateStr = formDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

  const requestTimeStr = data.request_time
    ? data.request_time.slice(0, 5)
    : '';

  const finishedAtStr = data.finished_at
    ? bangkokLocaleString(new Date(data.finished_at), { hour: '2-digit', minute: '2-digit' })
    : '';

  const totalRequestMC = items.reduce((s, it) => s + Number(it.requested_mc || it.quantity_mc), 0);
  const totalActualMC = items.reduce((s, it) => s + Number(it.quantity_mc), 0);
  const totalNetKG = items.reduce((s, it) => s + (Number(it.quantity_mc) * Number(it.bulk_weight_kg)), 0);

  const minRows = 10;
  const emptyRows = Math.max(0, minRows - items.length);

  return (
    <div className="wf-page" ref={ref}>
      <div className="wf-form">
        <div className="wf-header">
          <div className="wf-title-area">
            <h1 className="wf-title-th">ขอเบิกสินค้าออกจากห้องเย็น</h1>
            <h2 className="wf-title-en">(WITHDRAW LIST)</h2>
          </div>
          <div className="wf-ref">FM-CS-002.1 Rev.00</div>
        </div>

        <div className="wf-meta">
          <div className="wf-meta-item">
            <span className="wf-meta-label">DATE (วันที่) :</span>
            <span className="wf-meta-value">{dateStr}</span>
          </div>
          <div className="wf-meta-item">
            <span className="wf-meta-label">DEP (แผนก) :</span>
            <span className="wf-meta-value wf-meta-dept">{data.department}</span>
          </div>
          <div className="wf-meta-item">
            <span className="wf-meta-label">Request No :</span>
            <span className="wf-meta-value">{data.request_no}</span>
          </div>
        </div>

        <table className="wf-table">
          <thead>
            <tr>
              <th className="wf-col-no">NO.</th>
              <th className="wf-col-origin">ORIGIN</th>
              <th className="wf-col-product">PRODUCT NAME</th>
              <th className="wf-col-size">SIZE</th>
              <th className="wf-col-req-pkg">
                <div>REQUEST OF</div>
                <div>PACKAGE</div>
                <div className="wf-th-sub">CTN</div>
              </th>
              <th className="wf-col-req-time">
                <div>REQUEST</div>
                <div>TIME</div>
              </th>
              <th className="wf-col-act-pkg">
                <div>ACTUAL OF</div>
                <div>PACKAGE</div>
                <div className="wf-th-sub">CTN</div>
              </th>
              <th className="wf-col-weight">
                <div>NET WEIGHT</div>
                <div className="wf-th-sub">KG.</div>
              </th>
              <th className="wf-col-timeout">Time out</th>
              <th className="wf-col-process">
                <div>PRODUCTION</div>
                <div>PROCESS</div>
              </th>
              <th className="wf-col-remark">Remark</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, i) => {
              const requestedMc = Number(item.requested_mc || item.quantity_mc);
              const actualMc = Number(item.quantity_mc);
              const netKg = actualMc * Number(item.bulk_weight_kg);
              const st = item.stock_type || 'BULK';
              const originDisplay = st === 'CONTAINER_EXTRA' ? (item.order_code || 'EXTRA')
                : st === 'IMPORT' ? (item.order_code || 'IMPORT')
                : 'SCK';
              const showActual = data.status !== 'PENDING';
              return (
                <tr key={item.id}>
                  <td className="wf-center">{i + 1}</td>
                  <td className="wf-center">{originDisplay}</td>
                  <td>{item.fish_name}{item.type ? `/${item.type}` : ''}{item.glazing ? `(${item.glazing})` : ''}</td>
                  <td className="wf-center">{item.size}</td>
                  <td className="wf-center wf-bold">{requestedMc}</td>
                  <td className="wf-center">{requestTimeStr}</td>
                  <td className="wf-center wf-bold">{showActual ? actualMc : ''}</td>
                  <td className="wf-center">{showActual ? netKg.toFixed(1) : ''}</td>
                  <td className="wf-center">{finishedAtStr}</td>
                  <td className="wf-center">{item.production_process || ''}</td>
                  <td className="wf-center wf-remark">{i === 0 ? (data.notes || '') : ''}</td>
                </tr>
              );
            })}
            {Array.from({ length: emptyRows }, (_, i) => (
              <tr key={`empty-${i}`}>
                <td className="wf-center">{items.length + i + 1}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            ))}
            <tr className="wf-total-row">
              <td colSpan="4" className="wf-right wf-bold">TOTAL</td>
              <td className="wf-center wf-bold">{totalRequestMC}</td>
              <td></td>
              <td className="wf-center wf-bold">{data.status !== 'PENDING' ? totalActualMC : ''}</td>
              <td className="wf-center wf-bold">{data.status !== 'PENDING' ? totalNetKG.toFixed(1) : ''}</td>
              <td></td>
              <td></td>
              <td></td>
            </tr>
          </tbody>
        </table>

        <div className="wf-signatures">
          <div className="wf-sig-block">
            <div className="wf-sig-line">
              {data.requested_by && data.requested_by !== 'system' && (
                <span className="wf-sig-name">{data.requested_by}</span>
              )}
            </div>
            <div className="wf-sig-label">ผู้ขอเบิก</div>
            <div className="wf-sig-label-en">Requester</div>
          </div>
          <div className="wf-sig-block">
            <div className="wf-sig-line"></div>
            <div className="wf-sig-label">ผู้อนุมัติ</div>
            <div className="wf-sig-label-en">Approver</div>
          </div>
          <div className="wf-sig-block">
            <div className="wf-sig-line">
              {data.managed_by && data.managed_by !== 'system' && data.managed_by !== 'admin' && (
                <span className="wf-sig-name">{data.managed_by}</span>
              )}
            </div>
            <div className="wf-sig-label">ผู้จัด</div>
            <div className="wf-sig-label-en">Preparer</div>
          </div>
          <div className="wf-sig-block">
            <div className="wf-sig-line"></div>
            <div className="wf-sig-label">ผลจ่าย</div>
            <div className="wf-sig-label-en">Dispatcher</div>
          </div>
        </div>
      </div>
    </div>
  );
});

export default WithdrawFormPrint;
