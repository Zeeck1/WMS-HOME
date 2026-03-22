import React from 'react';
import { FiCalendar } from 'react-icons/fi';

function Calendar() {
  return (
    <>
      <div className="page-header">
        <h2><FiCalendar style={{ color: 'var(--primary)' }} /> Calendar</h2>
      </div>
      <div className="page-body">
        <div className="card" style={{ overflow: 'hidden', padding: 0 }}>
          <div className="calendar-embed-wrap">
            <iframe
              title="WMS Calendar"
              src="https://calendar.google.com/calendar/embed?src=43fc401935073480d71aef1792ee5dfe9d22a0056561823d90372856c6011e35%40group.calendar.google.com&ctz=Asia%2FBangkok"
              style={{ border: 0 }}
              width="100%"
              height="600"
              frameBorder="0"
              scrolling="no"
            />
          </div>
        </div>
      </div>
    </>
  );
}

export default Calendar;
