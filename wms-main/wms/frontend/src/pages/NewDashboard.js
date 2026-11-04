import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getNewDashboard, getWithdrawals, getWithdrawal } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { bangkokYYYYMMDD, bangkokLocaleString } from '../utils/bangkokTime';
import './NewDashboard.css';

/* ───────────────────────── helpers ───────────────────────── */

const fmt = (n, digits = 0) =>
  Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const fmtCompact = (n) => {
  const v = Number(n || 0);
  if (v >= 100000) return `${Math.round(v / 1000)}k`;
  if (v >= 10000) return `${(v / 1000).toFixed(1)}k`;
  return fmt(v);
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pretty = (s) => {
  if (!s) return '—';
  const [y, m, d] = String(s).slice(0, 10).split('-');
  if (!y || !m || !d) return s;
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};
const shortDate = (s) => {
  if (!s) return '';
  const [, m, d] = String(s).slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}`;
};
const shiftDate = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const typeLabel = (t) => String(t || '').replace(/_/g, ' ');
const statusLabel = (s) => String(s || '').replace(/_/g, ' ');
const statusPill = (s) =>
  s === 'FINISHED' ? 'p-ok' : s === 'CANCELLED' || s === 'REJECTED' ? 'p-crit' : 'p-warn';

/** 4-step "nice" axis that always covers max. */
function niceScale(max, steps = 4) {
  if (!max || max <= 0) return { max: steps, step: 1 };
  const raw = max / steps;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  return { max: step * steps, step };
}
const tickLabel = (v) => (v === 0 ? '0' : v >= 1000 ? `${fmt(v / 1000, 1)}k` : fmt(v, 1));

const TYPE_COLORS = ['var(--nd-s1)', 'var(--nd-s2)', 'var(--nd-s3)', 'var(--nd-s4)'];
const AGE_COLORS = ['var(--nd-seq-250)', 'var(--nd-seq-350)', 'var(--nd-seq-450)', 'var(--nd-seq-550)', 'var(--nd-seq-650)', 'var(--nd-seq-700)'];
const PERIODS = [30, 60, 90, 180, 365];

const CALENDARS = [
  {
    key: 'chachoengsao',
    title: 'Chachoengsao',
    badgeColor: 'var(--nd-s1)',
    baseUrl: 'https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=Asia%2FBangkok&showPrint=0&showTitle=0&showNav=1&showDate=1&showTabs=0&showCalendars=0&src=43fc401935073480d71aef1792ee5dfe9d22a0056561823d90372856c6011e35%40group.calendar.google.com',
    openUrl: 'https://calendar.google.com/calendar/embed?src=43fc401935073480d71aef1792ee5dfe9d22a0056561823d90372856c6011e35%40group.calendar.google.com&ctz=Asia%2FBangkok',
  },
  {
    key: 'samut-prakarn',
    title: 'Samut Prakarn',
    badgeColor: 'var(--nd-s3)',
    baseUrl: 'https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=Asia%2FBangkok&showPrint=0&showTitle=0&showNav=1&showDate=1&showTabs=0&showCalendars=0&src=YTY2OGMyZDQ0MWZiMTU5N2I5YmVkYzE0MzNkODI3Y2RkYWQyMDQxNWMzOWFmNWViYjdjMjBlZWE3NmE3M2Y3N0Bncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=NTZlOWM1YzBjNDhiMmRiOTM0OWM5MTgwZDc0OGE1MjA1OTU3YTg5NDJhYWVlMzQ5YmJjZmQ3YWVmYzhkNTAyYUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&color=%23c0ca33&color=%23009688',
    openUrl: 'https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=Asia%2FBangkok&showPrint=0&src=YTY2OGMyZDQ0MWZiMTU5N2I5YmVkYzE0MzNkODI3Y2RkYWQyMDQxNWMzOWFmNWViYjdjMjBlZWE3NmE3M2Y3N0Bncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=NTZlOWM1YzBjNDhiMmRiOTM0OWM5MTgwZDc0OGE1MjA1OTU3YTg5NDJhYWVlMzQ5YmJjZmQ3YWVmYzhkNTAyYUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&color=%23c0ca33&color=%23009688',
  },
];

const SECTIONS = [
  { id: 'nd-calendar', label: 'Calendar' },
  { id: 'nd-overview', label: 'Overview' },
  { id: 'nd-aging', label: 'Aging' },
  { id: 'nd-requests', label: 'Requests' },
  { id: 'nd-composition', label: 'Composition' },
  { id: 'nd-movement', label: 'Movement' },
];

/* ───────────────────────── charts ───────────────────────── */

function StockTypeBar({ types, totalKg, hover, isMobile }) {
  const W = isMobile ? 420 : 900;
  const H = isMobile ? 28 : 26;
  const GAP = 2;
  const tot = totalKg || types.reduce((s, d) => s + d.kg, 0) || 1;
  let x = 0;
  return (
    <div className="nd-chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Stock by type">
        {types.map((d, i) => {
          const w = Math.max((d.kg / tot) * (W - GAP * (types.length - 1)), 2);
          const pct = ((d.kg / tot) * 100).toFixed(1);
          const minTextW = isMobile ? 110 : 120;
          const el = (
            <g key={d.name}>
              <rect
                x={x} y={0} width={w} height={H} rx={5} fill={TYPE_COLORS[i % TYPE_COLORS.length]}
                {...hover(<><b>{typeLabel(d.name)}</b><br />{fmt(d.kg)} kg · {pct}% · {fmt(d.lots)} lots</>)}
              />
              {w > minTextW && (
                <text x={x + 10} y={H / 2 + 4} fill="#fff" fontSize={isMobile ? 11.5 : 12} fontWeight={600} pointerEvents="none">
                  {typeLabel(d.name)}  {pct}%
                </text>
              )}
            </g>
          );
          x += w + GAP;
          return el;
        })}
      </svg>
    </div>
  );
}

function HBar({ rows, color, unit, hover, isMobile, emptyText = 'No data' }) {
  if (!rows.length) return <div className="nd-empty">{emptyText}</div>;
  const max = Math.max(...rows.map((r) => r.value), 1);

  if (isMobile) {
    return (
      <div className="nd-hbar-mobile">
        {rows.map((r, i) => {
          const pct = Math.max((r.value / max) * 100, 1.5);
          return (
            <div key={`${r.name}-${i}`} className="nd-hbar-mrow">
              <div className="nd-hbar-mhead">
                <span className="nd-hbar-mname">{r.name}</span>
                <span className="nd-hbar-mval">{fmt(r.value)} {unit}</span>
              </div>
              <div className="nd-hbar-mtrack">
                <div className="nd-hbar-mfill" style={{ width: `${pct}%`, background: color }} />
              </div>
              {r.extra && <div className="nd-hbar-mextra">{r.extra}</div>}
            </div>
          );
        })}
      </div>
    );
  }

  const W = 460;
  const PADL = 150;
  const PADR = 70;
  const BH = 20;
  const GAP = 12;
  const height = rows.length * (BH + GAP) + 14;
  return (
    <div className="nd-chart-box">
      <svg viewBox={`0 0 ${W} ${height}`}>
        {rows.map((r, i) => {
          const y = i * (BH + GAP) + 8;
          const w = Math.max((r.value / max) * (W - PADL - PADR), 2);
          const name = String(r.name);
          return (
            <g key={`${name}-${i}`}>
              <text x={PADL - 10} y={y + BH / 2 + 4} textAnchor="end" className="clab">
                {name.length > 20 ? `${name.slice(0, 19)}…` : name}
              </text>
              <rect
                x={PADL} y={y} width={w} height={BH} rx={4} fill={color}
                {...hover(<><b>{name}</b><br />{fmt(r.value)} {unit}{r.extra ? <><br />{r.extra}</> : null}</>)}
              />
              <text x={PADL + w + 8} y={y + BH / 2 + 4} className="vlab">{fmt(r.value)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function AgeColumns({ buckets, totalKg, hover, isMobile }) {
  const W = isMobile ? 420 : 900;
  const H = isMobile ? 235 : 300;
  const PT = isMobile ? 24 : 20;
  const PB = isMobile ? 48 : 52;
  const PL = isMobile ? 42 : 62;
  const PR = isMobile ? 8 : 14;
  const { max, step } = niceScale(Math.max(...buckets.map((b) => b.kg), 0));
  const ph = H - PT - PB;
  const band = (W - PL - PR) / buckets.length;
  const bw = Math.min(isMobile ? 42 : 84, band * 0.72);
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);
  return (
    <div className="nd-chart-box">
      <svg viewBox={`0 0 ${W} ${H}`}>
        {ticks.map((v) => {
          const y = PT + ph - (v / max) * ph;
          return (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={y} y2={y} className={v ? 'gl' : 'ax'} />
              <text x={PL - 7} y={y + 4} textAnchor="end" className="tick">{tickLabel(v)}</text>
            </g>
          );
        })}
        {buckets.map((d, i) => {
          const x = PL + i * band + (band - bw) / 2;
          const h = (d.kg / max) * ph;
          const y = PT + ph - h;
          const r = Math.min(4, h);
          const path = h > 0
            ? `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + bw - r},${y} Q${x + bw},${y} ${x + bw},${y + r} L${x + bw},${y + h} Z`
            : '';
          return (
            <g key={d.key}>
              {h > 0 && (
                <path
                  d={path} fill={AGE_COLORS[i % AGE_COLORS.length]}
                  {...hover(<><b>{d.label} in store</b><br />{fmt(d.kg)} kg · {fmt(d.mc)} MC<br />{fmt(d.lots)} lots · {totalKg ? ((d.kg / totalKg) * 100).toFixed(1) : '0.0'}% of stock</>)}
                />
              )}
              <text x={x + bw / 2} y={Math.max(12, y - 6)} textAnchor="middle" className="vlab">
                {isMobile ? fmtCompact(d.kg) : fmt(d.kg)}
              </text>
              <text x={x + bw / 2} y={H - PB + 18} textAnchor="middle" className="clab">{d.label}</text>
              <text x={x + bw / 2} y={H - PB + 34} textAnchor="middle" className="tick">
                {isMobile ? `${fmt(d.lots)}L` : `${fmt(d.lots)} lots`}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function MovementChart({ daily, hover, isMobile }) {
  const [hi, setHi] = useState(null);
  if (!daily.length) return <div className="nd-empty">No stock movements recorded in this period.</div>;
  const W = isMobile ? 420 : 900;
  const H = isMobile ? 240 : 320;
  const PT = 26;
  const PB = isMobile ? 36 : 46;
  const PL = isMobile ? 42 : 62;
  const PR = isMobile ? 12 : 18;
  const n = daily.length;
  const { max, step } = niceScale(Math.max(...daily.map((r) => Math.max(r.in_kg, r.out_kg)), 0));
  const ph = H - PT - PB;
  const pw = W - PL - PR;
  const X = (i) => (n === 1 ? PL + pw / 2 : PL + (i / (n - 1)) * pw);
  const Y = (v) => PT + ph - (v / max) * ph;
  const clampX = (x) => Math.max(PL + 44, Math.min(W - PR - 44, x));
  const zone = n === 1 ? pw : pw / (n - 1);
  const linePath = (key) => daily.map((r, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(r[key]).toFixed(1)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(n / (isMobile ? 4 : 9)));
  const maxIn = daily.reduce((b, r, i) => (r.in_kg > daily[b].in_kg ? i : b), 0);
  const maxOut = daily.reduce((b, r, i) => (r.out_kg > daily[b].out_kg ? i : b), 0);
  const ticks = [0, 1, 2, 3, 4].map((k) => k * step);
  const activeDay = hi != null ? daily[hi] : daily[daily.length - 1];

  return (
    <>
      {activeDay && (
        <div className="nd-mv-selected-bar">
          <span><b>{pretty(activeDay.date)}</b></span>
          <span><i className="nd-sw" style={{ background: 'var(--nd-s1)' }} /> IN <b>{fmt(activeDay.in_kg)} kg</b> ({fmt(activeDay.in_mc)} MC)</span>
          <span><i className="nd-sw" style={{ background: 'var(--nd-s2)' }} /> OUT <b>{fmt(activeDay.out_kg)} kg</b> ({fmt(activeDay.out_mc)} MC)</span>
        </div>
      )}
      <div className="nd-chart-box">
        <svg viewBox={`0 0 ${W} ${H}`}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PL} x2={W - PR} y1={Y(v)} y2={Y(v)} className={v ? 'gl' : 'ax'} />
              <text x={PL - 7} y={Y(v) + 4} textAnchor="end" className="tick">{tickLabel(v)}</text>
            </g>
          ))}
          <path d={linePath('in_kg')} fill="none" stroke="var(--nd-s1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={linePath('out_kg')} fill="none" stroke="var(--nd-s2)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {n === 1 && (
            <>
              <circle cx={X(0)} cy={Y(daily[0].in_kg)} r={4} fill="var(--nd-s1)" />
              <circle cx={X(0)} cy={Y(daily[0].out_kg)} r={4} fill="var(--nd-s2)" />
            </>
          )}
          {daily.map((r, i) => (i % labelEvery === 0 ? (
            <text key={`t-${r.date}`} x={X(i)} y={H - PB + 18} textAnchor="middle" className="tick">{shortDate(r.date)}</text>
          ) : null))}
          {daily[maxIn].in_kg > 0 && (
            <text x={clampX(X(maxIn))} y={Math.max(14, Y(daily[maxIn].in_kg) - 10)} textAnchor="middle" className="vlab">
              {fmt(daily[maxIn].in_kg)} kg in
            </text>
          )}
          {daily[maxOut].out_kg > 0 && maxOut !== maxIn && (
            <text x={clampX(X(maxOut))} y={Math.min(Y(daily[maxOut].out_kg) + 22, PT + ph - 4)} textAnchor="middle" className="vlab">
              {fmt(daily[maxOut].out_kg)} kg out
            </text>
          )}
          {hi != null && (
            <g pointerEvents="none">
              <line x1={X(hi)} x2={X(hi)} y1={PT} y2={PT + ph} stroke="var(--nd-axis)" strokeWidth={1} />
              <circle cx={X(hi)} cy={Y(daily[hi].in_kg)} r={5} fill="var(--nd-s1)" stroke="var(--nd-surface)" strokeWidth={2} />
              <circle cx={X(hi)} cy={Y(daily[hi].out_kg)} r={5} fill="var(--nd-s2)" stroke="var(--nd-surface)" strokeWidth={2} />
            </g>
          )}
          {daily.map((r, i) => {
            const h = hover(
              <>
                <b>{pretty(r.date)}</b><br />
                <span style={{ color: 'var(--nd-s1)' }}>■</span> IN {fmt(r.in_kg)} kg · {fmt(r.in_mc)} MC<br />
                <span style={{ color: 'var(--nd-s2)' }}>■</span> OUT {fmt(r.out_kg)} kg · {fmt(r.out_mc)} MC
              </>
            );
            return (
              <rect
                key={`z-${r.date}`} x={X(i) - zone / 2} y={PT} width={zone} height={ph} fill="transparent"
                {...h}
                onPointerEnter={(e) => { h.onPointerEnter(e); setHi(i); }}
                onPointerDown={() => setHi(i)}
                onPointerLeave={(e) => { h.onPointerLeave(e); setHi(null); }}
              />
            );
          })}
        </svg>
      </div>
    </>
  );
}

/* ───────────────────────── Google Calendar section ───────────────────────── */

function CalendarSection({ isMobile }) {
  const [calMode, setCalMode] = useState(() => (isMobile ? 'AGENDA' : 'MONTH'));

  useEffect(() => {
    setCalMode((prev) => (prev === 'MONTH' && isMobile ? 'AGENDA' : prev));
  }, [isMobile]);

  return (
    <div className="nd-card" id="nd-calendar">
      <div className="nd-reqhead">
        <div>
          <h2>Loading schedule &amp; Google Calendar</h2>
          <p className="nd-note" style={{ marginBottom: 0 }}>
            Chachoengsao &amp; Samut Prakarn schedules side-by-side (Asia/Bangkok).
          </p>
        </div>
        <div className="nd-reqctl nd-cal-ctl">
          {[
            { key: 'MONTH', label: 'Month' },
            { key: 'WEEK', label: 'Week' },
            { key: 'AGENDA', label: 'Agenda' },
          ].map((m) => (
            <button
              key={m.key}
              type="button"
              className={`nd-btn${calMode === m.key ? ' on' : ''}`}
              onClick={() => setCalMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="nd-cal-grid">
        {CALENDARS.map((cal) => (
          <div className="nd-cal-panel" key={cal.key}>
            <div className="nd-cal-panel-hd">
              <div className="nd-cal-panel-title">
                <i className="nd-sw" style={{ background: cal.badgeColor }} />
                <h3>{cal.title}</h3>
              </div>
              <a
                className="nd-btn nd-cal-open"
                href={cal.openUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open ↗
              </a>
            </div>
            <div className="nd-calendar-wrap">
              <iframe
                title={`WMS Google Calendar — ${cal.title}`}
                src={`${cal.baseUrl}&mode=${calMode}`}
                className="nd-calendar-iframe"
                frameBorder="0"
                scrolling="no"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────── request forms ───────────────────────── */

function RequestForms({ activeDates, today, reloadKey }) {
  const { hasAccess } = useAuth();
  const canOpenForm = hasAccess('withdraw');
  const initial = activeDates.includes(today) ? today : activeDates[0] || today;
  const [date, setDate] = useState(initial);
  const [forms, setForms] = useState(null);
  const [error, setError] = useState(null);
  const reqSeq = useRef(0);

  useEffect(() => {
    const seq = ++reqSeq.current;
    setForms(null);
    setError(null);
    (async () => {
      try {
        const listRes = await getWithdrawals({ date });
        const list = Array.isArray(listRes.data) ? listRes.data : [];
        list.sort((a, b) => String(a.request_time || '').localeCompare(String(b.request_time || '')));
        const details = await Promise.all(list.map((w) => getWithdrawal(w.id).then((r) => r.data).catch(() => ({ ...w, items: [] }))));
        if (seq === reqSeq.current) setForms(details);
      } catch (e) {
        if (seq === reqSeq.current) setError(e?.response?.data?.error || e.message || 'Failed to load request forms');
      }
    })();
  }, [date, reloadKey]);

  const chipDates = useMemo(() => {
    const set = new Set(activeDates.slice(0, 8));
    return [...set].sort().reverse();
  }, [activeDates]);

  const chips = (
    <div className="nd-chips">
      {chipDates.map((d) => (
        <button key={d} type="button" className={`nd-chip${d === date ? ' on' : ''}`} onClick={() => setDate(d)}>
          {pretty(d)}
        </button>
      ))}
    </div>
  );

  const itemsOf = (f) => (Array.isArray(f.items) ? f.items : []);
  let body;
  if (error) {
    body = <div className="nd-empty nd-error">{error}</div>;
  } else if (!forms) {
    body = <p className="nd-note" style={{ marginTop: 18 }}>Loading request forms…</p>;
  } else if (!forms.length) {
    body = <><div className="nd-empty">No request forms for {pretty(date)}.</div>{chips}</>;
  } else {
    const totIt = forms.reduce((s, f) => s + itemsOf(f).length, 0);
    const totMc = forms.reduce((s, f) => s + itemsOf(f).reduce((a, i) => a + (Number(i.requested_mc) || 0), 0), 0);
    const totKg = forms.reduce((s, f) => s + itemsOf(f).reduce((a, i) => a + (Number(i.weight_kg) || 0), 0), 0);
    const depts = [...new Set(forms.map((f) => f.department).filter(Boolean))];
    body = (
      <>
        <div className="nd-daybar">
          <span><b>{forms.length}</b> request form{forms.length > 1 ? 's' : ''}</span>
          <span><b>{totIt}</b> line items</span>
          <span><b>{fmt(totMc)}</b> MC requested</span>
          <span><b>{fmt(totKg)}</b> kg</span>
          <span>{depts.join(' · ')}</span>
        </div>
        {chips}
        {forms.map((f) => {
          const items = itemsOf(f);
          const sMc = items.reduce((a, i) => a + (Number(i.requested_mc) || 0), 0);
          const sAct = items.reduce((a, i) => a + (Number(i.quantity_mc) || 0), 0);
          const sKg = items.reduce((a, i) => a + (Number(i.weight_kg) || 0), 0);
          return (
            <div className="nd-form" key={f.id}>
              <div className="nd-form-hd">
                <div className="nd-form-id">
                  {canOpenForm
                    ? <Link className="nd-form-no" to={`/withdraw/${f.id}/form`}>{f.request_no}</Link>
                    : <span className="nd-form-no">{f.request_no}</span>}
                  <span className="nd-pill p-neutral">{f.department}</span>
                  <span className={`nd-pill ${statusPill(f.status)}`}>{statusLabel(f.status)}</span>
                </div>
                <div className="nd-form-meta">
                  <span>Pick time <b>{String(f.request_time || '').slice(0, 5) || '—'}</b></span>
                  <span>Requested by <b>{f.requested_by || '—'}</b></span>
                  {f.managed_by && <span>Managed by <b>{f.managed_by}</b></span>}
                  {f.dispatcher && <span>Dispatcher <b>{f.dispatcher}</b></span>}
                  {f.finished_at && <span>Finished <b>{String(f.finished_at).slice(11, 16)}</b></span>}
                </div>
              </div>
              {f.notes && <div className="nd-form-note"><b>Note:</b> {f.notes}</div>}

              {/* Desktop / Tablet table */}
              <div className="nd-table-scroll nd-hide-mobile">
                <table>
                  <thead>
                    <tr>
                      <th className="idx">#</th><th>Product</th><th>Size</th><th>Lot no</th><th>Location</th>
                      <th className="n">Req MC</th><th className="n">Picked MC</th><th className="n">Kg</th><th>Production</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i, n) => {
                      const req = Number(i.requested_mc) || 0;
                      const act = Number(i.quantity_mc) || 0;
                      const loc = i.line_place || i.snap_line_place || '';
                      return (
                        <tr key={i.id || n}>
                          <td className="idx">{n + 1}</td>
                          <td>{i.fish_name || i.snap_fish_name || '—'}</td>
                          <td>{i.size || i.snap_size || '—'}</td>
                          <td className="lotno">{i.lot_no || i.snap_lot_no || i.import_inv_no || '—'}</td>
                          <td className="loc">{loc && loc !== '_' && loc !== '-' ? loc : '—'}</td>
                          <td className="n">{fmt(req)}</td>
                          <td className="n">{act === req ? fmt(act) : <span className="short">{fmt(act)}</span>}</td>
                          <td className="n">{fmt(Number(i.weight_kg) || 0)}</td>
                          <td className="proc">{i.production_process || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td /><td colSpan={4}>{items.length} item{items.length !== 1 ? 's' : ''}</td>
                      <td className="n">{fmt(sMc)}</td><td className="n">{fmt(sAct)}</td><td className="n">{fmt(sKg)}</td><td />
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* Mobile card list */}
              <div className="nd-mobile-req-items nd-show-mobile">
                {items.map((i, n) => {
                  const req = Number(i.requested_mc) || 0;
                  const act = Number(i.quantity_mc) || 0;
                  const loc = i.line_place || i.snap_line_place || '';
                  const cleanLoc = loc && loc !== '_' && loc !== '-' ? loc : '—';
                  const lot = i.lot_no || i.snap_lot_no || i.import_inv_no || '—';
                  return (
                    <div className="nd-mitem" key={i.id || n}>
                      <div className="nd-mitem-top">
                        <span className="nd-mitem-idx">#{n + 1}</span>
                        <div className="nd-mitem-name">
                          <b>{i.fish_name || i.snap_fish_name || '—'}</b>
                          <span>{i.size || i.snap_size || '—'}</span>
                        </div>
                        <span className="nd-mitem-loc">{cleanLoc}</span>
                      </div>
                      <div className="nd-mitem-grid">
                        <div><span>Req MC</span><b>{fmt(req)}</b></div>
                        <div><span>Picked</span><b>{act === req ? fmt(act) : <span className="short">{fmt(act)}</span>}</b></div>
                        <div><span>Weight</span><b>{fmt(Number(i.weight_kg) || 0)} kg</b></div>
                      </div>
                      <div className="nd-mitem-sub">
                        <span className="lotno">Lot: {lot}</span>
                        {i.production_process && <span className="proc">Process: <b>{i.production_process}</b></span>}
                      </div>
                    </div>
                  );
                })}
                <div className="nd-mitem-foot">
                  <span>{items.length} item{items.length !== 1 ? 's' : ''} total</span>
                  <span>Req <b>{fmt(sMc)}</b> MC · Picked <b>{fmt(sAct)}</b> MC · <b>{fmt(sKg)}</b> kg</span>
                </div>
              </div>
            </div>
          );
        })}
      </>
    );
  }

  return (
    <div className="nd-card" id="nd-requests">
      <div className="nd-reqhead">
        <div>
          <h2>Request forms</h2>
          <p className="nd-note" style={{ marginBottom: 0 }}>Every item asked of cold storage on the selected day. Pulled live from the WMS.</p>
        </div>
        <div className="nd-reqctl">
          <button type="button" className="nd-btn" title="Previous day" onClick={() => setDate((d) => shiftDate(d, -1))}>←</button>
          <input type="date" className="nd-btn nd-date-picker" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
          <button type="button" className="nd-btn" title="Next day" onClick={() => setDate((d) => shiftDate(d, 1))}>→</button>
          <button type="button" className="nd-btn" onClick={() => setDate(today)}>Today</button>
        </div>
      </div>
      {body}
    </div>
  );
}

/* ───────────────────────── page ───────────────────────── */

function Callout({ tone = 'warn', icon = '⚠', children }) {
  return (
    <div className={`nd-callout ${tone}`}>
      <span>{icon}</span>
      <div>{children}</div>
    </div>
  );
}

function NewDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [days, setDays] = useState(90);
  const [reloadKey, setReloadKey] = useState(0);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== 'undefined' ? window.innerWidth <= 640 : false
  ));
  const [theme, setTheme] = useState(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('nd_theme') : null;
    if (saved === 'dark' || saved === 'light') return saved;
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 640);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* tooltip (DOM-positioned so pointer moves don't re-render the page) */
  const tipRef = useRef(null);
  const [tipContent, setTipContent] = useState(null);
  const hover = useCallback((content) => ({
    style: { cursor: 'default' },
    onPointerEnter: (e) => {
      if (e.pointerType === 'touch') return;
      setTipContent(content);
      if (tipRef.current) tipRef.current.style.opacity = 1;
    },
    onPointerMove: (e) => {
      if (e.pointerType === 'touch') return;
      const el = tipRef.current;
      if (!el) return;
      el.style.left = `${Math.max(8, Math.min(e.clientX + 14, window.innerWidth - el.offsetWidth - 10))}px`;
      el.style.top = `${Math.max(8, e.clientY - el.offsetHeight - 12)}px`;
    },
    onPointerLeave: () => {
      if (tipRef.current) tipRef.current.style.opacity = 0;
    },
  }), []);

  const load = useCallback(async (d, isRefresh) => {
    if (isRefresh) setRefreshing(true);
    try {
      const res = await getNewDashboard({ days: d });
      setData(res.data);
      setError(null);
    } catch (e) {
      setError(e?.response?.data?.error || e.message || 'Failed to load dashboard');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const firstLoad = useRef(true);
  useEffect(() => {
    load(days, !firstLoad.current);
    firstLoad.current = false;
  }, [days, load]);

  useEffect(() => { localStorage.setItem('nd_theme', theme); }, [theme]);

  const refresh = () => {
    setReloadKey((k) => k + 1);
    load(days, true);
  };

  const scrollToSection = (id) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const today = data?.today || bangkokYYYYMMDD();

  if (loading) {
    return <div className="nd" data-theme={theme}><div className="nd-loading">Loading dashboard…</div></div>;
  }
  if (!data) {
    return (
      <div className="nd" data-theme={theme}>
        <div className="nd-loading nd-error">
          {error || 'No data'}<br /><br />
          <button type="button" className="nd-btn" onClick={() => load(days, true)}>Retry</button>
        </div>
      </div>
    );
  }

  const { overview: ov, composition: comp, aging, expiry, movement: mv, withdrawals: wd } = data;
  const totalKg = ov.total_kg;
  const freeLocations = Math.max(0, (ov.locations_total || 0) - (ov.locations_used || 0));
  const takingOut = wd.by_status.find((s) => s.status === 'TAKING_OUT');
  const takingOutPct = takingOut && ov.total_mc ? (takingOut.requested_mc / ov.total_mc) * 100 : 0;
  const topProducts = comp.by_product;

  return (
    <div className="nd" data-theme={theme}>
      <div className="nd-wrap">
        <header className="nd-header">
          <div>
            <h1>CK Cold Storage — Stock Dashboard</h1>
            <p className="nd-sub">Snapshot as of {pretty(today)} · CK Thailand WMS</p>
            <p className="nd-sub nd-sub-layout">
              Calendar → Overview → Aging &amp; expiry → Request forms → Stock composition → Movement trends
            </p>
          </div>
          <div className="nd-actions">
            {error && <span className="nd-error" style={{ fontSize: 12 }}>{error}</span>}
            <button type="button" className="nd-btn" onClick={refresh} disabled={refreshing}>
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button type="button" className="nd-btn" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}>
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
          </div>
        </header>

        <nav className="nd-jump-bar" aria-label="Dashboard sections">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="nd-jump-pill" onClick={() => scrollToSection(s.id)}>
              {s.label}
            </button>
          ))}
        </nav>

        {/* ============ GOOGLE CALENDAR ============ */}
        <CalendarSection isMobile={isMobile} />

        {/* ============ OVERVIEW ============ */}
        <div className="nd-card" id="nd-overview">
          <div className="nd-hero-lab">Total stock on hand</div>
          <div className="nd-hero-fig">{fmt(totalKg)}<span className="unit">kg</span></div>
          <div className="nd-tiles">
            <div className="nd-tile">
              <div className="lab">Master cartons</div>
              <div className="val">{fmt(ov.total_mc)}</div>
              <div className="meta">across {fmt(ov.lots)} lots</div>
            </div>
            <div className="nd-tile">
              <div className="lab">Locations in use</div>
              <div className="val">{fmt(ov.locations_used)}</div>
              <div className="meta">
                {ov.locations_total ? `of ${fmt(ov.locations_total)} · ${ov.occupancy_pct}% occupied` : 'no location master'}
              </div>
            </div>
            <div className="nd-tile">
              <div className="lab">Distinct products</div>
              <div className="val">{fmt(ov.distinct_products)}</div>
              <div className="meta">product / size combinations</div>
            </div>
            <div className="nd-tile">
              <div className="lab">Avg lot size</div>
              <div className="val">{fmt(ov.avg_lot_kg)}<small> kg</small></div>
              <div className="meta">{fmt(ov.avg_lot_mc)} MC per lot</div>
            </div>
            <div className="nd-tile">
              <div className="lab">Open withdrawals</div>
              <div className="val">{fmt(ov.open_withdrawals.total)}</div>
              <div className="meta">
                {ov.open_withdrawals.pending} pending · {ov.open_withdrawals.taking_out} taking out
                {ov.open_withdrawals.ready ? ` · ${ov.open_withdrawals.ready} ready` : ''}
              </div>
            </div>
          </div>
          {ov.occupancy_pct != null && ov.occupancy_pct >= 95 && (
            <Callout tone="crit">
              <b>Capacity is effectively full.</b> {fmt(ov.locations_used)} of {fmt(ov.locations_total)} storage positions are
              occupied — only {fmt(freeLocations)} free stack{freeLocations === 1 ? '' : 's'} remain. Any inbound volume needs an outbound clear-down first.
            </Callout>
          )}
          {ov.occupancy_pct != null && ov.occupancy_pct >= 85 && ov.occupancy_pct < 95 && (
            <Callout tone="warn">
              <b>Capacity is getting tight.</b> {ov.occupancy_pct}% of storage positions are occupied — {fmt(freeLocations)} free stacks remain.
            </Callout>
          )}
        </div>

        {/* ============ AGING ============ */}
        <div className="nd-card" id="nd-aging">
          <h2>Aging &amp; expiry risk</h2>
          <p className="nd-note">Longest-resident stock first, then how the whole warehouse ages. As of {pretty(today)}.</p>

          <h3>Oldest lots on hand</h3>
          <p className="nd-note">Longest-resident stock — first candidates for clear-down.</p>
          {aging.oldest.length ? (
            <>
              <div className="nd-table-scroll nd-hide-mobile">
                <table>
                  <thead>
                    <tr>
                      <th>Product</th><th>Size</th><th>Lot no</th><th>Location</th><th>In date</th>
                      <th className="n">Age</th><th className="n">MC</th><th className="n">Kg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {aging.oldest.map((o, i) => {
                      const cls = o.age_days > 730 ? 'p-crit' : o.age_days > 365 ? 'p-warn' : 'p-ok';
                      return (
                        <tr key={`${o.lot_no}-${o.line_place}-${i}`}>
                          <td>{o.fish_name}</td>
                          <td>{o.size || '–'}</td>
                          <td className="lotno">{o.lot_no || '–'}</td>
                          <td>{o.line_place || '(unassigned)'}</td>
                          <td>{o.cs_in_date || '–'}</td>
                          <td className="n"><span className={`nd-pill ${cls}`}>{fmt(o.age_days)}d</span></td>
                          <td className="n">{fmt(o.mc)}</td>
                          <td className="n">{fmt(o.kg)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="nd-mobile-lot-list nd-show-mobile">
                {aging.oldest.map((o, i) => {
                  const cls = o.age_days > 730 ? 'p-crit' : o.age_days > 365 ? 'p-warn' : 'p-ok';
                  return (
                    <div className="nd-mlot" key={`${o.lot_no}-${o.line_place}-${i}`}>
                      <div className="nd-mlot-top">
                        <div className="nd-mlot-title">
                          <b>{o.fish_name}</b>
                          {o.size && <span>{o.size}</span>}
                        </div>
                        <span className={`nd-pill ${cls}`}>{fmt(o.age_days)}d</span>
                      </div>
                      <div className="nd-mlot-meta">
                        <span className="loc">{o.line_place || '(unassigned)'}</span>
                        <span>In: {o.cs_in_date || '–'}</span>
                        <span><b>{fmt(o.mc)}</b> MC · <b>{fmt(o.kg)}</b> kg</span>
                      </div>
                      {o.lot_no && <div className="nd-mlot-lot lotno">Lot: {o.lot_no}</div>}
                    </div>
                  );
                })}
              </div>
            </>
          ) : <div className="nd-empty">No stock on hand.</div>}

          <h3 style={{ marginTop: 30 }}>Stock by time in cold store</h3>
          <p className="nd-note">Kilograms on hand by age bucket (days since CS in date).</p>
          <AgeColumns buckets={aging.buckets} totalKg={totalKg} hover={hover} isMobile={isMobile} />

          <div className="nd-cols" style={{ marginTop: 20 }}>
            <div className="nd-tile">
              <div className="lab">Older than 90 days</div>
              <div className="val">{fmt(aging.over_90.kg)}<small> kg</small></div>
              <div className="meta">{aging.over_90.pct}% of stock · {fmt(aging.over_90.lots)} lots</div>
            </div>
            <div className="nd-tile">
              <div className="lab">Older than 180 days</div>
              <div className="val">{fmt(aging.over_180.kg)}<small> kg</small></div>
              <div className="meta">{aging.over_180.pct}% of stock · {fmt(aging.over_180.lots)} lots</div>
            </div>
            <div className="nd-tile">
              <div className="lab">Older than 1 year</div>
              <div className="val">{fmt(aging.over_365.kg)}<small> kg</small></div>
              <div className="meta">{aging.over_365.pct}% of stock · {fmt(aging.over_365.lots)} lots</div>
            </div>
            <div className="nd-tile">
              <div className="lab">Lots past expiry date</div>
              <div className="val" style={expiry.expired_lots ? { color: 'var(--nd-critical)' } : undefined}>{fmt(expiry.expired_lots)}</div>
              <div className="meta">
                {fmt(expiry.expired_kg)} kg · {fmt(expiry.expired_mc)} MC
                {expiry.soon_lots ? ` · ${expiry.soon_lots} more expire ≤30d` : ''}
              </div>
            </div>
          </div>

          {aging.over_90.pct >= 40 && (
            <Callout tone="warn">
              <b>{aging.over_90.pct >= 50 ? 'Half the warehouse' : 'A large share of stock'} is over 90 days old.</b> {fmt(aging.over_90.kg)} kg
              has been in cold store for more than three months, and {fmt(aging.over_180.kg)} kg for more than six.
              {ov.occupancy_pct >= 85 ? ` With capacity at ${ov.occupancy_pct}%, the aged tail is what is blocking space.` : ''}
            </Callout>
          )}
          {expiry.expired_lots > 0 && (
            <Callout tone="crit">
              <b>{fmt(expiry.expired_lots)} lot{expiry.expired_lots > 1 ? 's are' : ' is'} past expiry.</b> {fmt(expiry.expired_kg)} kg
              ({fmt(expiry.expired_mc)} MC) should be reviewed for disposal or customer release.
            </Callout>
          )}
          {ov.lots > 0 && expiry.coverage_pct < 50 && (
            <Callout tone="warn" icon="◔">
              <b>Expiry dates are barely recorded.</b> Only <b>{fmt(expiry.with_date)} of {fmt(ov.lots)} lots</b> ({expiry.coverage_pct}%)
              carry an expiration date, so expiry risk can't be measured for {fmt(100 - expiry.coverage_pct, 1)}% of stock — aging by
              intake date is the only usable proxy today. Capturing expiry at stock-in would fix this.
            </Callout>
          )}
        </div>

        {/* ============ REQUEST FORMS ============ */}
        <RequestForms activeDates={wd.active_dates} today={today} reloadKey={reloadKey} />

        {/* ============ COMPOSITION ============ */}
        <div className="nd-card" id="nd-composition">
          <h2>Stock composition</h2>
          <p className="nd-note">What is in the warehouse, by stock type, product and size.</p>

          {comp.by_type.length ? (
            <>
              <div className="nd-legend">
                {comp.by_type.map((t, i) => (
                  <span key={t.name}><i className="nd-sw" style={{ background: TYPE_COLORS[i % TYPE_COLORS.length] }} />{typeLabel(t.name)}</span>
                ))}
              </div>
              <StockTypeBar types={comp.by_type} totalKg={totalKg} hover={hover} isMobile={isMobile} />
              <div className="nd-typebar-stats">
                {comp.by_type.map((t) => (
                  <span key={t.name}><b>{typeLabel(t.name)}</b> {fmt(t.kg)} kg · {t.pct}% · {fmt(t.lots)} lots</span>
                ))}
              </div>
            </>
          ) : <div className="nd-empty">No stock on hand.</div>}

          <div className="nd-grid2" style={{ marginTop: 26 }}>
            <div>
              <h3>Top 10 products by weight</h3>
              <p className="nd-note">kilograms on hand</p>
              <HBar
                rows={topProducts.slice(0, 10).map((p) => ({ name: p.name, value: p.kg, extra: `${fmt(p.mc)} MC · ${p.lots} lots · ${p.pct}%` }))}
                color="var(--nd-s1)" unit="kg" hover={hover} isMobile={isMobile}
              />
            </div>
            <div>
              <h3>Top 10 sizes by weight</h3>
              <p className="nd-note">kilograms on hand</p>
              <HBar
                rows={comp.by_size.map((s) => ({ name: s.name, value: s.kg, extra: `${fmt(s.mc)} MC · ${s.lots} lots · ${s.pct}%` }))}
                color="var(--nd-s1)" unit="kg" hover={hover} isMobile={isMobile}
              />
            </div>
          </div>

          {topProducts.length >= 2 && (
            <Callout tone={comp.top2_pct >= 40 ? 'warn' : 'info'} icon="◆">
              <b>{comp.top2_pct >= 40 ? 'Heavy concentration in two products.' : 'Stock concentration.'}</b> {topProducts[0].name} and {topProducts[1].name} alone
              are {fmt(topProducts[0].kg + topProducts[1].kg)} kg — <b>{comp.top2_pct}%</b> of everything in the building.
              The top 5 products cover {comp.top5_pct}%, the top 10 cover {comp.top10_pct}%.
            </Callout>
          )}

          {topProducts.length > 0 && (
            <details>
              <summary>Show product table (top {topProducts.length} of {fmt(comp.product_count)} products)</summary>
              <div className="nd-table-scroll">
                <table>
                  <thead>
                    <tr><th>Product</th><th className="n">MC</th><th className="n">Kg</th><th className="n">Lots</th><th className="n">% of stock</th></tr>
                  </thead>
                  <tbody>
                    {topProducts.map((p) => (
                      <tr key={p.name}>
                        <td>{p.name}</td><td className="n">{fmt(p.mc)}</td><td className="n">{fmt(p.kg)}</td>
                        <td className="n">{fmt(p.lots)}</td><td className="n">{p.pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </div>

        {/* ============ MOVEMENT ============ */}
        <div className="nd-card" id="nd-movement">
          <div className="nd-reqhead">
            <div>
              <h2>Movement trends</h2>
              <p className="nd-note" style={{ marginBottom: 12 }}>
                Daily stock in vs stock out, kilograms — {mv.daily.length} recorded day{mv.daily.length === 1 ? '' : 's'} ({pretty(mv.from)} – {pretty(mv.to)}).
                Opening Excel loads and manual corrections are excluded.
              </p>
            </div>
            <div className="nd-reqctl nd-period-ctl">
              {PERIODS.map((p) => (
                <button key={p} type="button" className={`nd-btn${p === days ? ' on' : ''}`} onClick={() => setDays(p)} disabled={refreshing}>
                  {p}d
                </button>
              ))}
            </div>
          </div>

          <div className="nd-legend">
            <span><i className="nd-ln" style={{ background: 'var(--nd-s1)' }} /> Stock IN</span>
            <span><i className="nd-ln" style={{ background: 'var(--nd-s2)' }} /> Stock OUT</span>
          </div>
          <MovementChart daily={mv.daily} hover={hover} isMobile={isMobile} />

          <div className="nd-cols" style={{ marginTop: 20 }}>
            <div className="nd-tile">
              <div className="lab">Received</div>
              <div className="val">{fmt(mv.in_kg)}<small> kg</small></div>
              <div className="meta">{shortDate(mv.from)} – {pretty(mv.to)}</div>
            </div>
            <div className="nd-tile">
              <div className="lab">Dispatched</div>
              <div className="val">{fmt(mv.out_kg)}<small> kg</small></div>
              <div className="meta">same period</div>
            </div>
            <div className="nd-tile">
              <div className="lab">Net build-up</div>
              <div className="val" style={{ color: mv.net_kg > 0 ? 'var(--nd-critical)' : 'var(--nd-success-text)' }}>
                {mv.net_kg > 0 ? '+' : ''}{fmt(mv.net_kg)}<small> kg</small>
              </div>
              <div className="meta">{mv.ratio != null ? `IN is ${mv.ratio}× OUT` : 'no dispatches in period'}</div>
            </div>
            <div className="nd-tile">
              <div className="lab">Est. months of cover</div>
              <div className="val">{mv.months_cover != null ? `~${fmt(mv.months_cover, 1)}` : '—'}</div>
              <div className="meta">at current dispatch rate</div>
            </div>
          </div>

          {mv.ratio != null && mv.ratio >= 1.5 && (
            <Callout tone="crit">
              <b>Inflow is running far ahead of outflow.</b> Over the last {mv.days} days the site has taken in {mv.ratio} kg for every 1 kg
              dispatched, adding ~{fmt(mv.net_kg / 1000, 1)} tonnes net.
              {ov.occupancy_pct >= 85 ? ` That is the direct driver of the ${ov.occupancy_pct}% occupancy and the aging tail.` : ''}
            </Callout>
          )}
          {mv.ratio != null && mv.ratio < 0.8 && (
            <Callout tone="ok" icon="✓">
              <b>Stock is drawing down.</b> Dispatches exceeded receipts over the last {mv.days} days — net {fmt(Math.abs(mv.net_kg))} kg released.
            </Callout>
          )}

          <div className="nd-grid2" style={{ marginTop: 26 }}>
            <div>
              <h3>Top 10 products dispatched</h3>
              <p className="nd-note">kilograms out, last {mv.days} days</p>
              <HBar
                rows={mv.top_dispatched.map((p) => ({ name: p.name, value: p.kg, extra: `${fmt(p.mc)} MC` }))}
                color="var(--nd-s2)" unit="kg" hover={hover} isMobile={isMobile} emptyText="No dispatches in this period."
              />
            </div>
            <div>
              <h3>Withdrawal requests by status</h3>
              <p className="nd-note">{fmt(wd.total)} requests on record</p>
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr><th>Status</th><th className="n">Requests</th><th className="n">MC requested</th></tr>
                </thead>
                <tbody>
                  {wd.by_status.map((s) => (
                    <tr key={s.status}>
                      <td><span className={`nd-pill ${statusPill(s.status)}`}>{statusLabel(s.status)}</span></td>
                      <td className="n">{fmt(s.requests)}</td>
                      <td className="n">{fmt(s.requested_mc)}</td>
                    </tr>
                  ))}
                  {!wd.by_status.length && <tr><td colSpan={3} className="nd-empty">No withdrawal requests yet.</td></tr>}
                </tbody>
              </table>
              {takingOut && takingOut.requests > 0 && takingOutPct >= 10 && (
                <Callout tone="warn" icon="◆">
                  <b>{fmt(takingOut.requests)} request{takingOut.requests > 1 ? 's sit' : ' sits'} in "taking out".</b> That is{' '}
                  {fmt(takingOut.requested_mc)} MC — about {fmt(takingOutPct)}% of the whole warehouse — logged as in-progress but not closed off.
                  Worth checking whether these are genuinely open or just never marked finished.
                </Callout>
              )}
            </div>
          </div>
        </div>

        <footer className="nd-footer">
          Built from live CK Thailand WMS data · inventory, movements, withdrawals, import stock and location master ·
          generated {bangkokLocaleString(new Date(data.generated_at))}
        </footer>
      </div>

      <div className="nd-tip" ref={tipRef} style={{ opacity: 0 }}>{tipContent}</div>
    </div>
  );
}

export default NewDashboard;
