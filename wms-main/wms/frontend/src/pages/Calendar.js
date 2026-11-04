import React from 'react';
import { FiCalendar } from 'react-icons/fi';

const CALENDARS = [
  {
    key: 'chachoengsao',
    title: 'Chachoengsao',
    src: 'https://calendar.google.com/calendar/embed?src=43fc401935073480d71aef1792ee5dfe9d22a0056561823d90372856c6011e35%40group.calendar.google.com&ctz=Asia%2FBangkok',
  },
  {
    key: 'samut-prakarn',
    title: 'Samut Prakarn',
    src: 'https://calendar.google.com/calendar/embed?height=600&wkst=1&ctz=Asia%2FBangkok&showPrint=0&src=YTY2OGMyZDQ0MWZiMTU5N2I5YmVkYzE0MzNkODI3Y2RkYWQyMDQxNWMzOWFmNWViYjdjMjBlZWE3NmE3M2Y3N0Bncm91cC5jYWxlbmRhci5nb29nbGUuY29t&src=NTZlOWM1YzBjNDhiMmRiOTM0OWM5MTgwZDc0OGE1MjA1OTU3YTg5NDJhYWVlMzQ5YmJjZmQ3YWVmYzhkNTAyYUBncm91cC5jYWxlbmRhci5nb29nbGUuY29t&color=%23c0ca33&color=%23009688',
  },
];

function Calendar() {
  return (
    <>
      <div className="page-header">
        <h2><FiCalendar style={{ color: 'var(--primary)' }} /> Calendar</h2>
      </div>
      <div className="page-body">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))',
            gap: 18,
          }}
        >
          {CALENDARS.map((cal) => (
            <div key={cal.key} className="card" style={{ overflow: 'hidden', padding: 0 }}>
              <div
                style={{
                  padding: '12px 16px',
                  borderBottom: '1px solid var(--gray-200)',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span>{cal.title}</span>
                <a
                  href={cal.src}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--primary)', textDecoration: 'none' }}
                >
                  Open ↗
                </a>
              </div>
              <div className="calendar-embed-wrap">
                <iframe
                  title={`WMS Calendar — ${cal.title}`}
                  src={cal.src}
                  style={{ border: 0 }}
                  width="100%"
                  height="600"
                  frameBorder="0"
                  scrolling="no"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default Calendar;
