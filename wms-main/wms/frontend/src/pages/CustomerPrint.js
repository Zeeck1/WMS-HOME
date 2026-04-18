import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiPrinter, FiArrowLeft } from 'react-icons/fi';
import { toast } from 'react-toastify';
import { getCustomerPrintData } from '../services/api';
import { dateToYYYYMMDDInBangkok } from '../utils/bangkokTime';

const toDate = (d) => d ? (typeof d === 'string' ? d.split('T')[0] : dateToYYYYMMDDInBangkok(d)) : '';
const COMPANY = 'Powered by CK Intelligence';
const DOC_FOOTER = 'FM-CS-001 Rev.01 (01-11-2023)';
const BLANK_ROWS_IN = 10;
const BLANK_ROWS_OUT = 10;

function CustomerPrint() {
  const { depositId, withdrawalId } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await getCustomerPrintData(depositId || 0, withdrawalId || 0);
        setData(res.data);
      } catch { toast.error('โหลดข้อมูลไม่สำเร็จ'); }
      finally { setLoading(false); }
    })();
  }, [depositId, withdrawalId]);

  const rawWithdrawalItems = data?.withdrawalItems || [];
  const { outRows, dayGroups } = useMemo(() => {
    if (rawWithdrawalItems.length === 0) return { outRows: [], dayGroups: [] };
    const balanceMap = {};
    const rows = rawWithdrawalItems.map(it => {
      const key = it.deposit_item_id;
      if (!balanceMap[key]) {
        balanceMap[key] = { boxes: Number(it.orig_boxes || 0), kg: Number(it.orig_weight_kg || 0) };
      }
      balanceMap[key].boxes -= Number(it.boxes_out || 0);
      balanceMap[key].kg -= Number(it.weight_kg_out || 0);
      return { ...it, remaining_boxes: balanceMap[key].boxes, remaining_kg: balanceMap[key].kg };
    });
    const grouped = [];
    let curDate = null, curGroup = null;
    for (const row of rows) {
      const d = toDate(row.withdraw_date);
      if (d !== curDate) { curDate = d; curGroup = { date: d, items: [] }; grouped.push(curGroup); }
      curGroup.items.push(row);
    }
    return { outRows: rows, dayGroups: grouped };
  }, [rawWithdrawalItems]);

  if (loading) return <div className="loading"><div className="spinner"></div>Loading...</div>;
  if (!data) return <div style={{ padding: 40, textAlign: 'center' }}>ไม่พบข้อมูล</div>;

  const { deposit, withdrawal } = data;
  const customer = deposit || withdrawal;
  if (!customer) return <div style={{ padding: 40, textAlign: 'center' }}>ไม่พบข้อมูล</div>;

  const isOutPrint = !!(withdrawalId && withdrawalId !== '0');
  const depItems = deposit?.items || [];
  const depTotalBoxes = depItems.reduce((s, it) => s + (it.boxes || 0), 0);
  const depTotalKg = depItems.reduce((s, it) => s + Number(it.weight_kg || 0), 0);

  const wdTotalBoxes = outRows.reduce((s, it) => s + Number(it.boxes_out || 0), 0);
  const wdTotalKg = outRows.reduce((s, it) => s + Number(it.weight_kg_out || 0), 0);

  const hasOutData = isOutPrint && (outRows.length > 0 || withdrawal);
  const blankArr = (count, current) => Array.from({ length: Math.max(0, count - current) }, (_, i) => i);

  return (
    <>
      <div className="cp-toolbar no-print">
        <button className="btn btn-outline" onClick={() => navigate('/customer', { state: { tab: isOutPrint ? 'OUT' : 'IN', customerId: customer?.customer_id } })}><FiArrowLeft /> กลับ</button>
        <button className="btn btn-primary" onClick={() => window.print()}><FiPrinter /> พิมพ์</button>
      </div>

      <div className="cp-print-area">
        {/* ═══════════════ รายการรับฝากสินค้า (IN) ═══════════════ */}
        {deposit && (
          <div className="cp-form">
            <div className="cp-company">{COMPANY}</div>
            <div className="cp-title">ใบรับเก้าฝ่ายสินค้า</div>
            <div className="cp-doc-row">
              <span></span>
              <span>เลขที่เอกสาร&nbsp;&nbsp;<b>{deposit.doc_ref || customer.document_no || '___________'}</b></span>
            </div>

            <div className="cp-info-grid">
              <div className="cp-info-row">
                <span className="cp-label">ลูกค้า</span>
                <span className="cp-val-line">{customer.customer_name}</span>
              </div>
              <div className="cp-info-row">
                <span className="cp-label">ที่อยู่</span>
                <span className="cp-val-line">{customer.address || ''}</span>
              </div>
              <div className="cp-info-row" style={{ justifyContent: 'flex-end' }}>
                <span className="cp-label">เบอร์โทร</span>
                <span className="cp-val-line" style={{ flex: 'none', minWidth: 150 }}>{customer.phone || ''}</span>
              </div>
            </div>

            <div className="cp-section-label">รายการรับฝากสินค้า</div>

            <table className="cp-table">
              <thead>
                <tr>
                  <th rowSpan={2} style={{ width: 35 }}>ลำดับ</th>
                  <th rowSpan={2} style={{ width: 72 }}>วันที่รับ</th>
                  <th rowSpan={2}>รายการ</th>
                  <th rowSpan={2} style={{ width: 65 }}>LOT No.</th>
                  <th colSpan={3}>Total G/W</th>
                  <th colSpan={2}>N/W:UNIT</th>
                  <th rowSpan={2} style={{ width: 45 }}>เวลา</th>
                  <th rowSpan={2} style={{ width: 65 }}>หมายเหตุ</th>
                </tr>
                <tr><th>กล่อง</th><th style={{ fontSize: '0.65rem' }}>Kg รายละเอียด</th><th>Kg รวม</th><th>กล่อง</th><th>(Kg.)</th></tr>
              </thead>
              <tbody>
                {depItems.map((it, i) => (
                  <tr key={it.id}>
                    <td className="text-center">{i + 1}</td>
                    <td className="text-center">{toDate(it.receive_date)}</td>
                    <td>{it.item_name}</td>
                    <td>{it.lot_no || ''}</td>
                    <td className="num-cell">{it.boxes || ''}</td>
                    <td className="num-cell" style={{ fontSize: '0.7rem', whiteSpace: 'pre-wrap' }}>{it.kg_parts || '—'}</td>
                    <td className="num-cell">{it.weight_kg ? Number(it.weight_kg).toFixed(2) : ''}</td>
                    <td className="num-cell">-</td>
                    <td className="num-cell">{it.nw_unit ? Number(it.nw_unit).toFixed(2) : ''}</td>
                    <td className="text-center">{it.time_str || ''}</td>
                    <td>{it.remark || ''}</td>
                  </tr>
                ))}
                {blankArr(BLANK_ROWS_IN, depItems.length).map(i => (
                  <tr key={`bi${i}`} className="cp-blank-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="text-right"></td>
                  <td className="num-cell"><b>{depTotalBoxes || ''}</b></td>
                  <td></td>
                  <td className="num-cell"><b>{depTotalKg ? depTotalKg.toFixed(2) : ''}</b></td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>

            <table className="cp-sig-table">
              <tbody>
                <tr>
                  <td className="cp-sig-lbl">ผู้ฝากสินค้า/ลูกค้า</td>
                  <td className="cp-sig-val"></td>
                  <td className="cp-sig-lbl">เบอร์โทร</td>
                  <td className="cp-sig-val"></td>
                  <td className="cp-sig-lbl">รถ</td>
                  <td className="cp-sig-val"></td>
                  <td className="cp-sig-lbl">ห้องเย็น</td>
                  <td className="cp-sig-val"></td>
                  <td className="cp-sig-lbl">ทะเบียน</td>
                  <td className="cp-sig-val"></td>
                </tr>
                <tr><td colSpan={10} style={{ height: 10, border: 'none' }}></td></tr>
                <tr>
                  <td className="cp-sig-lbl">ผู้รับฝากสินค้า</td>
                  <td className="cp-sig-val">{deposit.receiver_name || ''}</td>
                  <td className="cp-sig-lbl">ผู้ตรวจสอบ</td>
                  <td className="cp-sig-val">{deposit.inspector_name || ''}</td>
                  <td colSpan={6} style={{ border: 'none' }}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* ═══════════════ รายการเบิกจ่ายสินค้า (OUT) ═══════════════ */}
        {hasOutData && (
          <div className="cp-form" style={{ marginTop: deposit ? 20 : 0 }}>
            {!deposit && (
              <>
                <div className="cp-company">{COMPANY}</div>
                <div className="cp-doc-row">
                  <span></span>
                  <span>เลขที่เอกสาร&nbsp;&nbsp;<b>{withdrawal?.doc_ref || customer.document_no || '___________'}</b></span>
                </div>
                <div className="cp-info-grid">
                  <div className="cp-info-row"><span className="cp-label">ลูกค้า</span><span className="cp-val-line">{customer.customer_name}</span></div>
                  <div className="cp-info-row"><span className="cp-label">ที่อยู่</span><span className="cp-val-line">{customer.address || ''}</span></div>
                </div>
              </>
            )}

            <div className="cp-section-label">รายการเบิกจ่ายสินค้า</div>

            <table className="cp-table">
              <thead>
                <tr>
                  <th rowSpan={2} style={{ width: 35 }}>ลำดับ</th>
                  <th rowSpan={2} style={{ width: 72 }}>วันที่เบิก</th>
                  <th rowSpan={2}>รายการ</th>
                  <th rowSpan={2} style={{ width: 65 }}>LOT No.</th>
                  <th colSpan={2}>Total G/W</th>
                  <th colSpan={2}>คงเหลือ</th>
                  <th rowSpan={2} style={{ width: 45 }}>เวลา</th>
                  <th rowSpan={2} style={{ width: 65 }}>หมายเหตุ</th>
                </tr>
                <tr><th>กล่อง</th><th>(Kg.)</th><th>กล่อง</th><th>(Kg.)</th></tr>
              </thead>
              <tbody>
                {(() => { let seq = 0; return dayGroups.map((group) => {
                  return group.items.map((it, ii) => {
                    seq++;
                    return (
                      <React.Fragment key={`wr${it.id}`}>
                        {ii === 0 && (
                          <tr className="cp-day-header">
                            <td colSpan={10} style={{ background: '#f8f9fa', fontWeight: 700, fontSize: '0.72rem', textAlign: 'left', padding: '4px 8px' }}>
                              วันที่เบิก: {group.date}
                            </td>
                          </tr>
                        )}
                        <tr>
                          <td className="text-center">{seq}</td>
                          <td className="text-center">{group.date}</td>
                          <td>{it.item_name}</td>
                          <td>{it.lot_no || ''}</td>
                          <td className="num-cell">{it.boxes_out || ''}</td>
                          <td className="num-cell">{it.weight_kg_out ? Number(it.weight_kg_out).toFixed(2) : ''}</td>
                          <td className="num-cell">{it.remaining_boxes}</td>
                          <td className="num-cell">{Number(it.remaining_kg).toFixed(2)}</td>
                          <td className="text-center">{it.time_str || ''}</td>
                          <td>{it.remark || ''}</td>
                        </tr>
                      </React.Fragment>
                    );
                  });
                }); })()}
                {blankArr(BLANK_ROWS_OUT, outRows.length).map(i => (
                  <tr key={`bo${i}`} className="cp-blank-row"><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="text-right"></td>
                  <td className="num-cell"><b>{wdTotalBoxes || ''}</b></td>
                  <td className="num-cell"><b>{wdTotalKg ? wdTotalKg.toFixed(2) : ''}</b></td>
                  <td colSpan={4}></td>
                </tr>
              </tfoot>
            </table>

            <table className="cp-sig-table">
              <tbody>
                <tr>
                  <td className="cp-sig-lbl">ผู้เบิกสินค้า/ลูกค้า</td>
                  <td className="cp-sig-val"></td>
                  <td className="cp-sig-lbl">เบอร์โทร</td>
                  <td className="cp-sig-val"></td>
                  <td className="cp-sig-lbl">รถ</td>
                  <td className="cp-sig-val"></td>
                  <td className="cp-sig-lbl">ห้องเย็น</td>
                  <td className="cp-sig-val"></td>
                  <td className="cp-sig-lbl">ทะเบียน</td>
                  <td className="cp-sig-val"></td>
                </tr>
                <tr><td colSpan={10} style={{ height: 10, border: 'none' }}></td></tr>
                <tr>
                  <td className="cp-sig-lbl">ผู้เบิกจ่ายสินค้า</td>
                  <td className="cp-sig-val">{withdrawal?.withdrawer_name || ''}</td>
                  <td className="cp-sig-lbl">ผู้ตรวจสอบ</td>
                  <td className="cp-sig-val">{withdrawal?.inspector_name || ''}</td>
                  <td colSpan={6} style={{ border: 'none' }}></td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <div className="cp-footer">
          <span>{COMPANY}</span>
          <span>{DOC_FOOTER}</span>
        </div>
      </div>
    </>
  );
}

export default CustomerPrint;
