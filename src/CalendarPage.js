import { useState, useEffect } from 'react';
import { formatKRW, compactKRW, today, parseMonth, shiftMonth } from './utils';

const DAYS = ['일', '월', '화', '수', '목', '금', '토'];

export default function CalendarPage({ transactions, month, onMonthChange }) {
  const todayStr = today();
  // month가 올바르지 않으면 오늘이 속한 달로 대체
  const parsed = parseMonth(month) ?? parseMonth(todayStr.slice(0, 7));
  const currentYear = parsed.year;
  const currentMonth = parsed.month;
  const [selectedDate, setSelectedDate] = useState(null);

  const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

  // 월 이동 시 선택된 날짜는 초기화
  const moveMonth = (delta) => {
    setSelectedDate(null);
    onMonthChange(shiftMonth(monthStr, delta));
  };
  const prevMonth = () => moveMonth(-1);
  const nextMonth = () => moveMonth(1);

  // 바깥(목록 탭 등)에서 월이 바뀌어도 선택 해제
  useEffect(() => {
    setSelectedDate(null);
  }, [monthStr]);

  // 해당 월 거래 맵 { 'YYYY-MM-DD': { income, expense, items } }
  const dayMap = {};
  transactions
    .filter((t) => t.date.startsWith(monthStr))
    .forEach((t) => {
      if (!dayMap[t.date]) dayMap[t.date] = { income: 0, expense: 0, items: [] };
      dayMap[t.date][t.type] += t.amount;
      dayMap[t.date].items.push(t);
    });

  // 달력 그리드 생성
  const firstDay = new Date(currentYear, currentMonth - 1, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const selectedKey = selectedDate
    ? `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(selectedDate).padStart(2, '0')}`
    : null;
  const selectedData = selectedKey ? dayMap[selectedKey] : null;

  return (
    <div className="calendar-page">
      {/* 월 네비게이션 */}
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={prevMonth}>&#8249;</button>
        <span className="cal-nav-title">{currentYear}년 {currentMonth}월</span>
        <button className="cal-nav-btn" onClick={nextMonth}>&#8250;</button>
      </div>

      {/* 요일 헤더 */}
      <div className="cal-grid">
        {DAYS.map((d, i) => (
          <div key={d} className={`cal-weekday ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}`}>
            {d}
          </div>
        ))}

        {/* 날짜 셀 */}
        {cells.map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} className="cal-cell empty" />;

          const dateKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const data = dayMap[dateKey];
          const isToday = dateKey === todayStr;
          const isSelected = day === selectedDate;
          const dow = (idx) % 7;

          return (
            <div
              key={dateKey}
              className={[
                'cal-cell',
                isToday ? 'today' : '',
                isSelected ? 'selected' : '',
                dow === 0 ? 'sun' : dow === 6 ? 'sat' : '',
              ].join(' ')}
              onClick={() => setSelectedDate(day === selectedDate ? null : day)}
            >
              <span className="cal-day-num">{day}</span>
              {/* 합계 span 의 aria-label 이 전체 금액을 전달하고, 안쪽 표기 span 은 시각용 */}
              {data && (
                <div className="cal-amounts">
                  {data.income > 0 && (
                    <span
                      className="cal-income"
                      title={`수입 ${formatKRW(data.income)}`}
                      aria-label={`수입 ${formatKRW(data.income)}`}
                    >
                      <span className="cal-amt-full" aria-hidden="true">+{formatKRW(data.income)}</span>
                      <span className="cal-amt-compact" aria-hidden="true">+{compactKRW(data.income)}</span>
                    </span>
                  )}
                  {data.expense > 0 && (
                    <span
                      className="cal-expense"
                      title={`지출 ${formatKRW(data.expense)}`}
                      aria-label={`지출 ${formatKRW(data.expense)}`}
                    >
                      <span className="cal-amt-full" aria-hidden="true">-{formatKRW(data.expense)}</span>
                      <span className="cal-amt-compact" aria-hidden="true">-{compactKRW(data.expense)}</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 선택한 날 상세 */}
      {selectedDate && (
        <div className="cal-detail">
          <div className="cal-detail-header">
            <span>{currentMonth}월 {selectedDate}일</span>
            <button className="cal-detail-close" onClick={() => setSelectedDate(null)}>✕</button>
          </div>
          {!selectedData ? (
            <p className="cal-detail-empty">거래 내역이 없습니다.</p>
          ) : (
            <ul className="cal-detail-list">
              {selectedData.items.map((t) => (
                <li key={t.id} className={`cal-detail-item ${t.type}`}>
                  <div className="cal-detail-left">
                    <span className="cal-detail-category">{t.category}</span>
                    <span className="cal-detail-desc">{t.description}</span>
                  </div>
                  <span className="cal-detail-amount">
                    {t.type === 'income' ? '+' : '-'}{formatKRW(t.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
