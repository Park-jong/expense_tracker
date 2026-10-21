import { render, screen } from '@testing-library/react';
import BudgetAlerts from './BudgetAlerts';

const MONTH = '2026-10';
const tx = (id, category, amount, date = '2026-10-10') => ({
  id, date, type: 'expense', category, description: `내역${id}`, amount,
});
const api = (total, categories = {}, over = {}) => ({
  budgets: { version: 1, total, categories },
  loading: false,
  ...over,
});
const renderAlerts = (transactions, budgetApi) =>
  render(<BudgetAlerts transactions={transactions} month={MONTH} budgetApi={budgetApi} />);

test('알림 대상이 없으면 아무것도 렌더하지 않는다', () => {
  const { container } = renderAlerts([tx(1, '식비', 1000)], api(null, { 식비: 100000 }));
  expect(container).toBeEmptyDOMElement();
});

test('예산이 없어도 렌더하지 않는다', () => {
  const { container } = renderAlerts([tx(1, '식비', 1000)], api(null));
  expect(container).toBeEmptyDOMElement();
});

test('초과/주의 항목 문구', () => {
  renderAlerts(
    [tx(1, '식비', 112000), tx(2, '교통', 85000)],
    api(null, { 식비: 100000, 교통: 100000 })
  );
  const region = screen.getByLabelText('예산 알림');
  expect(region).toHaveTextContent('⛔ 식비 예산 초과 · 12,000원 더 사용');
  expect(region).toHaveTextContent('⚠ 교통 예산 주의 · 85% 사용');
});

test('전체 예산 항목', () => {
  renderAlerts([tx(1, '식비', 9000)], api(10000));
  expect(screen.getByLabelText('예산 알림')).toHaveTextContent('⚠ 전체 예산 주의 · 90% 사용');
});

test('정상 항목은 표시하지 않는다', () => {
  renderAlerts([tx(1, '식비', 112000), tx(2, '교통', 1000)], api(null, { 식비: 100000, 교통: 100000 }));
  expect(screen.queryByText(/교통/)).not.toBeInTheDocument();
});

test('다른 달 거래는 제외한다', () => {
  const { container } = renderAlerts([tx(1, '식비', 999999, '2026-09-30')], api(null, { 식비: 100000 }));
  expect(container).toBeEmptyDOMElement();
});

test('loading 이면 렌더하지 않는다', () => {
  const { container } = renderAlerts([tx(1, '식비', 999999)], api(null, { 식비: 100000 }, { loading: true }));
  expect(container).toBeEmptyDOMElement();
});

test('role=alert / aria-live 를 쓰지 않는다', () => {
  const { container } = renderAlerts([tx(1, '식비', 999999)], api(null, { 식비: 100000 }));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(container.querySelector('[aria-live]')).toBeNull();
});
