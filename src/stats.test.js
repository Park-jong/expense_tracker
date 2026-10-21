import {
  categoryBreakdown, monthlyTrend, niceTicks, formatPercent,
} from './stats';

const tx = (id, date, type, category, amount) => ({ id, date, type, category, description: 'x', amount });

const list = [
  tx(1, '2026-10-01', 'expense', '식비', 30000),
  tx(2, '2026-10-05', 'expense', '식비', 20000),
  tx(3, '2026-10-06', 'expense', '교통', 70000),
  tx(4, '2026-10-07', 'expense', '문화', 80000),
  tx(5, '2026-10-08', 'income', '급여', 3000000),
  tx(6, '2026-09-30', 'expense', '식비', 999999),
  tx(7, '2026-11-01', 'expense', '식비', 999999),
];

describe('categoryBreakdown', () => {
  test('금액 내림차순으로 정렬하고 같은 카테고리는 합산한다', () => {
    const r = categoryBreakdown(list, '2026-10', 'expense');
    expect(r.map((x) => x.category)).toEqual(['문화', '교통', '식비']);
    expect(r.map((x) => x.amount)).toEqual([80000, 70000, 50000]);
  });

  test('ratio 는 합계 대비 비율이며 합이 1에 가깝다', () => {
    const r = categoryBreakdown(list, '2026-10', 'expense');
    expect(r[0].ratio).toBeCloseTo(0.4);
    expect(r.reduce((s, x) => s + x.ratio, 0)).toBeCloseTo(1);
  });

  test('다른 달과 다른 유형은 제외한다', () => {
    expect(categoryBreakdown(list, '2026-10', 'income')).toEqual([
      { category: '급여', amount: 3000000, ratio: 1 },
    ]);
    expect(categoryBreakdown(list, '2026-09', 'income')).toEqual([]);
  });

  test('빈 데이터는 []', () => {
    expect(categoryBreakdown([], '2026-10', 'expense')).toEqual([]);
    expect(categoryBreakdown(undefined, '2026-10', 'expense')).toEqual([]);
  });

  test('비정상 거래(금액이 숫자 아님, 0, 음수, 날짜 이상)는 무시한다', () => {
    const bad = [
      tx(1, '2026-10-01', 'expense', '식비', '5000'),
      tx(2, '2026-10-01', 'expense', '식비', NaN),
      tx(3, '2026-10-01', 'expense', '식비', Infinity),
      tx(4, '2026-10-01', 'expense', '식비', 0),
      tx(5, '2026-10-01', 'expense', '식비', -100),
      tx(6, '', 'expense', '식비', 100),
      null,
      tx(7, '2026-10-02', 'expense', '교통', 1000),
    ];
    expect(categoryBreakdown(bad, '2026-10', 'expense')).toEqual([
      { category: '교통', amount: 1000, ratio: 1 },
    ]);
  });

  test('원본을 변경하지 않는다', () => {
    const copy = JSON.parse(JSON.stringify(list));
    categoryBreakdown(list, '2026-10', 'expense');
    expect(list).toEqual(copy);
  });
});

describe('monthlyTrend', () => {
  test('선택 월을 마지막으로 하는 6개월을 오래된 달부터 반환한다', () => {
    const r = monthlyTrend(list, '2026-10');
    expect(r.map((x) => x.month)).toEqual(['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']);
    expect(r[5]).toEqual({ month: '2026-10', income: 3000000, expense: 200000 });
    expect(r[4]).toEqual({ month: '2026-09', income: 0, expense: 999999 });
  });

  test('연도 경계: 2026-02 기준 6개월은 2025-09 ~ 2026-02', () => {
    const r = monthlyTrend([], '2026-02');
    expect(r.map((x) => x.month)).toEqual(['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02']);
  });

  test('거래가 없는 달도 0으로 포함한다', () => {
    const r = monthlyTrend([], '2026-10');
    expect(r).toHaveLength(6);
    expect(r.every((x) => x.income === 0 && x.expense === 0)).toBe(true);
  });

  test('범위 밖 달은 제외하고 count 를 지정할 수 있다', () => {
    const r = monthlyTrend(list, '2026-10', 2);
    expect(r.map((x) => x.month)).toEqual(['2026-09', '2026-10']);
    expect(monthlyTrend(list, '2026-09', 1)).toEqual([{ month: '2026-09', income: 0, expense: 999999 }]);
  });

  test('이상 값은 무시하고 월 형식이 틀리면 []', () => {
    const bad = [tx(1, '2026-10-01', 'expense', '식비', 'abc'), tx(2, '2026-10-01', 'transfer', '식비', 100)];
    expect(monthlyTrend(bad, '2026-10')[5]).toEqual({ month: '2026-10', income: 0, expense: 0 });
    expect(monthlyTrend(list, 'bad')).toEqual([]);
  });

  test('원본을 변경하지 않는다', () => {
    const copy = JSON.parse(JSON.stringify(list));
    monthlyTrend(list, '2026-10');
    expect(list).toEqual(copy);
  });
});

describe('niceTicks', () => {
  test('0에서 시작하는 깔끔한 눈금', () => {
    expect(niceTicks(1011000)).toEqual([0, 500000, 1000000, 1500000]);
    expect(niceTicks(100)).toEqual([0, 50, 100]);
  });

  test('마지막 눈금이 최대값 이상이고, 최대값이 0 이하면 []', () => {
    const t = niceTicks(3600000);
    expect(t[t.length - 1]).toBeGreaterThanOrEqual(3600000);
    expect(niceTicks(0)).toEqual([]);
  });

  test('비정상 값은 []', () => {
    expect(niceTicks(-5)).toEqual([]);
    expect(niceTicks(NaN)).toEqual([]);
    expect(niceTicks(Infinity)).toEqual([]);
  });

  test('눈금은 항상 정수이고 중복 없이 증가한다 (작은 값 포함)', () => {
    [1, 2, 3, 4, 5, 7, 9, 10, 13, 99, 1234, 87500, 13905000].forEach((max) => {
      const t = niceTicks(max);
      expect(t[0]).toBe(0);
      expect(t.every(Number.isInteger)).toBe(true);
      expect(new Set(t).size).toBe(t.length);
      expect(t[t.length - 1]).toBeGreaterThanOrEqual(max);
    });
    expect(niceTicks(1)).toEqual([0, 1]);
    expect(niceTicks(3)).toEqual([0, 1, 2, 3]);
  });
});

describe('formatPercent', () => {
  test('소수 첫째 자리까지 표기한다', () => {
    expect(formatPercent(0.875)).toBe('87.5%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(0)).toBe('0.0%');
  });

  test('0 초과 0.1% 미만은 <0.1% (0.0% 금지)', () => {
    expect(formatPercent(0.0004)).toBe('<0.1%');
    expect(formatPercent(0.00001)).toBe('<0.1%');
    expect(formatPercent(0.001)).toBe('0.1%');
  });
});
