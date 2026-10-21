import { monthOfDate, shiftMonth, parseMonth } from './utils';

// 집계 대상으로 쓸 수 있는 거래인지 확인 (금액이 유한한 양수, 날짜가 올바른 형식)
const isValid = (t) =>
  t != null &&
  typeof t.amount === 'number' &&
  Number.isFinite(t.amount) &&
  t.amount > 0 &&
  monthOfDate(t.date) !== null;

// 해당 월(YYYY-MM)·유형('expense'|'income')의 카테고리별 합계. 금액 내림차순, ratio 는 합계 대비 0~1
export const categoryBreakdown = (transactions, month, type) => {
  const sums = new Map();
  (Array.isArray(transactions) ? transactions : []).forEach((t) => {
    if (!isValid(t) || t.type !== type || monthOfDate(t.date) !== month) return;
    const category = typeof t.category === 'string' && t.category.trim() ? t.category : '미분류';
    sums.set(category, (sums.get(category) ?? 0) + t.amount);
  });
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return [];
  return [...sums.entries()]
    .map(([category, amount]) => ({ category, amount, ratio: amount / total }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, 'ko'));
};

// 선택 월을 마지막으로 하는 최근 count개월의 수입·지출 합계 (오래된 달부터, 거래 없는 달은 0)
export const monthlyTrend = (transactions, month, count = 6) => {
  if (!parseMonth(month) || !(count >= 1)) return [];
  const rows = [];
  for (let i = count - 1; i >= 0; i--) rows.push({ month: shiftMonth(month, -i), income: 0, expense: 0 });
  const byMonth = new Map(rows.map((r) => [r.month, r]));
  (Array.isArray(transactions) ? transactions : []).forEach((t) => {
    if (!isValid(t) || (t.type !== 'income' && t.type !== 'expense')) return;
    const row = byMonth.get(monthOfDate(t.date));
    if (row) row[t.type] += t.amount;
  });
  return rows;
};

// 0에서 시작하는 깔끔한 Y축 눈금 (예: 최대 1,011,000 -> 0, 50만, 100만, 150만). 최대값이 0 이하거나 비정상이면 []
// 간격은 1·2·5×10^k 중 정수만 써서 소수 눈금이나 축약 라벨 중복('1', '1')이 생기지 않게 한다
export const niceTicks = (max, target = 4) => {
  if (!(max > 0) || !Number.isFinite(max)) return [];
  const raw = max / target;
  const pow = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw))));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw);
  const ticks = [];
  for (let i = 0; i <= Math.ceil(max / step - 1e-9); i++) ticks.push(i * step);
  return ticks;
};

// 비율(0~1)을 '12.3%'로 표기. 0 초과 0.1% 미만은 '<0.1%' (0.0% 로 보이지 않게)
export const formatPercent = (ratio) => {
  const pct = ratio * 100;
  if (pct > 0 && pct < 0.1) return '<0.1%';
  return `${pct.toFixed(1)}%`;
};
