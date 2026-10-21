import { render, screen, fireEvent, within } from '@testing-library/react';
import CalendarPage from './CalendarPage';
import { compactKRW } from './utils';

const txs = [
  { id: 1, date: '2026-10-15', type: 'expense', category: '식비', description: '점심', amount: 8000 },
  { id: 2, date: '2026-10-15', type: 'income', category: '급여', description: '월급', amount: 3000000 },
  { id: 3, date: '2026-11-02', type: 'expense', category: '교통', description: '택시', amount: 5000 },
];

const setup = (props = {}) => {
  const onMonthChange = jest.fn();
  const utils = render(
    <CalendarPage transactions={txs} month="2026-10" onMonthChange={onMonthChange} {...props} />
  );
  return { onMonthChange, ...utils };
};

// 날짜 숫자가 들어 있는 셀 찾기
const cell = (day) => screen.getByText(String(day), { selector: '.cal-day-num' }).closest('.cal-cell');

test('month prop 에 맞는 제목과 요일 헤더를 보여 준다', () => {
  setup();
  expect(screen.getByText('2026년 10월')).toBeInTheDocument();
  ['일', '월', '화', '수', '목', '금', '토'].forEach((d) => {
    expect(screen.getAllByText(d).length).toBeGreaterThan(0);
  });
});

test('이전/다음 버튼이 onMonthChange 를 올바른 월로 호출한다', () => {
  const { onMonthChange } = setup();
  fireEvent.click(screen.getByText('‹'));
  expect(onMonthChange).toHaveBeenLastCalledWith('2026-09');
  fireEvent.click(screen.getByText('›'));
  expect(onMonthChange).toHaveBeenLastCalledWith('2026-11');
});

test('연말/연초 경계에서도 올바른 월로 호출한다', () => {
  const { onMonthChange, rerender } = setup({ month: '2026-12' });
  fireEvent.click(screen.getByText('›'));
  expect(onMonthChange).toHaveBeenLastCalledWith('2027-01');
  rerender(<CalendarPage transactions={txs} month="2026-01" onMonthChange={onMonthChange} />);
  fireEvent.click(screen.getByText('‹'));
  expect(onMonthChange).toHaveBeenLastCalledWith('2025-12');
});

test('거래 합계가 날짜 셀에 표시된다', () => {
  setup();
  const c = cell(15);
  expect(within(c).getByText('+3,000,000원')).toBeInTheDocument();
  expect(within(c).getByText('-8,000원')).toBeInTheDocument();
  // 다른 달 거래는 표시되지 않음
  expect(screen.queryByText('-5,000원')).not.toBeInTheDocument();
});

// 주의: jsdom 은 CSS 미디어쿼리를 적용하지 않으므로 어느 표기가 보이는지는 검증하지 않는다 (DOM 구조와 문구만 확인)
test('합계 요소의 title/aria-label 은 전체 금액이다', () => {
  setup();
  const c = cell(15);
  const income = c.querySelector('.cal-income');
  const expense = c.querySelector('.cal-expense');
  expect(income).toHaveAttribute('title', '수입 3,000,000원');
  expect(income).toHaveAttribute('aria-label', '수입 3,000,000원');
  expect(expense).toHaveAttribute('title', '지출 8,000원');
  expect(expense).toHaveAttribute('aria-label', '지출 8,000원');
});

test('합계마다 전체 표기와 축약 표기 span 이 모두 있고 축약은 compactKRW 결과와 같다', () => {
  setup();
  const c = cell(15);
  const income = c.querySelector('.cal-income');
  const expense = c.querySelector('.cal-expense');
  expect(income.querySelector('.cal-amt-full')).toHaveTextContent('+3,000,000원');
  expect(income.querySelector('.cal-amt-compact')).toHaveTextContent('+' + compactKRW(3000000));
  expect(income.querySelector('.cal-amt-compact').textContent).toBe('+300만');
  expect(expense.querySelector('.cal-amt-full')).toHaveTextContent('-8,000원');
  expect(expense.querySelector('.cal-amt-compact').textContent).toBe('-' + compactKRW(8000));
  expect(expense.querySelector('.cal-amt-compact').textContent).toBe('-8,000');
});

test('날짜를 누르면 상세가 표시되고 다시 누르면 닫힌다', () => {
  setup();
  fireEvent.click(cell(15));
  expect(screen.getByText('10월 15일')).toBeInTheDocument();
  expect(screen.getByText('점심')).toBeInTheDocument();
  expect(screen.getByText('월급')).toBeInTheDocument();
  fireEvent.click(cell(15));
  expect(screen.queryByText('10월 15일')).not.toBeInTheDocument();
});

test('거래가 없는 날짜를 누르면 안내 문구가 나온다', () => {
  setup();
  fireEvent.click(cell(3));
  expect(screen.getByText('거래 내역이 없습니다.')).toBeInTheDocument();
});

test('month 가 바뀌면 선택이 해제된다', () => {
  const { onMonthChange, rerender } = setup();
  fireEvent.click(cell(15));
  expect(screen.getByText('10월 15일')).toBeInTheDocument();
  rerender(<CalendarPage transactions={txs} month="2026-11" onMonthChange={onMonthChange} />);
  expect(screen.getByText('2026년 11월')).toBeInTheDocument();
  expect(document.querySelector('.cal-detail')).toBeNull();
});

test('month 가 올바르지 않아도 죽지 않는다', () => {
  setup({ month: '' });
  expect(screen.getByText(/^\d{4}년 \d{1,2}월$/)).toBeInTheDocument();
});
