import { emptyBudgets, parseBudgets, sanitizeBudgets, isEmptyBudgets, mergeBudgets, budgetStatus, formatBudgetPercent } from './budget';

const valid = (extra = {}) => ({ version: 1, total: 500000, categories: { 식비: 200000 }, ...extra });

describe('parseBudgets', () => {
  it('유효한 데이터를 그대로 돌려준다', () => {
    expect(parseBudgets(valid())).toEqual(valid());
    expect(parseBudgets({ version: 1, total: null, categories: {} })).toEqual(emptyBudgets());
  });

  it.each([
    ['null', null],
    ['배열', []],
    ['문자열', 'x'],
    ['버전 불일치', valid({ version: 2 })],
    ['버전 없음', { total: null, categories: {} }],
    ['total 0', valid({ total: 0 })],
    ['total 음수', valid({ total: -1 })],
    ['total 소수', valid({ total: 1.5 })],
    ['total 문자열', valid({ total: '1000' })],
    ['total 없음', { version: 1, categories: {} }],
    ['categories 없음', { version: 1, total: null }],
    ['categories 배열', valid({ categories: [] })],
    ['금액 0', valid({ categories: { 식비: 0 } })],
    ['금액 음수', valid({ categories: { 식비: -5 } })],
    ['금액 소수', valid({ categories: { 식비: 1.2 } })],
    ['금액 문자열', valid({ categories: { 식비: '100' } })],
    ['알 수 없는 카테고리', valid({ categories: { 급여: 1000 } })],
  ])('잘못된 데이터는 에러: %s', (_name, raw) => {
    expect(() => parseBudgets(raw)).toThrow('예산 파일을 읽을 수 없습니다');
  });
});

describe('sanitizeBudgets', () => {
  it('유효한 항목만 남긴다', () => {
    expect(
      sanitizeBudgets({ total: -1, categories: { 식비: 1000, 교통: 0, 급여: 5, 쇼핑: 'a' } })
    ).toEqual({ version: 1, total: null, categories: { 식비: 1000 } });
  });

  it('객체가 아니면 빈 예산', () => {
    expect(sanitizeBudgets(null)).toEqual(emptyBudgets());
    expect(sanitizeBudgets('x')).toEqual(emptyBudgets());
    expect(sanitizeBudgets({ categories: 3 })).toEqual(emptyBudgets());
  });
});

describe('isEmptyBudgets', () => {
  it('예산이 하나도 없으면 true', () => {
    expect(isEmptyBudgets(emptyBudgets())).toBe(true);
    expect(isEmptyBudgets(valid())).toBe(false);
    expect(isEmptyBudgets({ version: 1, total: 1000, categories: {} })).toBe(false);
  });
});

describe('mergeBudgets', () => {
  it('키별로 Drive 값이 우선이고 게스트 전용 키만 추가', () => {
    const drive = { version: 1, total: 100, categories: { 식비: 10 } };
    const guest = { version: 1, total: 999, categories: { 식비: 99, 교통: 20 } };
    const { merged, guestOnly } = mergeBudgets(drive, guest);
    expect(merged).toEqual({ version: 1, total: 100, categories: { 식비: 10, 교통: 20 } });
    expect(guestOnly).toBe(true);
  });

  it('Drive 에 total 이 없으면 게스트 total 을 추가', () => {
    const { merged, guestOnly } = mergeBudgets(emptyBudgets(), { version: 1, total: 300, categories: {} });
    expect(merged.total).toBe(300);
    expect(guestOnly).toBe(true);
  });

  it('게스트가 Drive 의 부분집합이면 guestOnly false', () => {
    const drive = valid();
    const { merged, guestOnly } = mergeBudgets(drive, { version: 1, total: 1, categories: { 식비: 1 } });
    expect(merged).toEqual(drive);
    expect(guestOnly).toBe(false);
  });

  it('게스트가 비어 있으면 guestOnly false', () => {
    expect(mergeBudgets(valid(), emptyBudgets()).guestOnly).toBe(false);
  });
});

describe('budgetStatus', () => {
  const tx = (o) => ({ id: 1, date: '2024-05-10', type: 'expense', category: '식비', description: '', amount: 100, ...o });

  it('예산이 없으면 total null, categories []', () => {
    expect(budgetStatus([tx()], '2024-05', emptyBudgets())).toEqual({ total: null, categories: [] });
  });

  it('경계 0.8 / 1.0 / 초과', () => {
    const b = { version: 1, total: null, categories: { 식비: 1000, 교통: 1000, 쇼핑: 1000, 의료: 1000 } };
    const list = [
      tx({ category: '식비', amount: 799 }),
      tx({ category: '교통', amount: 800 }),
      tx({ category: '쇼핑', amount: 1000 }),
      tx({ category: '의료', amount: 1001 }),
    ];
    const { categories } = budgetStatus(list, '2024-05', b);
    const by = Object.fromEntries(categories.map((c) => [c.category, c]));
    expect(by.식비.status).toBe('ok');
    expect(by.교통.status).toBe('warn');
    expect(by.쇼핑.status).toBe('warn');
    expect(by.의료.status).toBe('over');
    expect(by.의료.remaining).toBe(-1);
    expect(by.의료.ratio).toBeCloseTo(1.001);
  });

  it('카테고리는 지출 목록 순서이고 예산 있는 것만 나온다', () => {
    const b = { version: 1, total: null, categories: { 문화: 10, 식비: 10 } };
    expect(budgetStatus([], '2024-05', b).categories.map((c) => c.category)).toEqual(['식비', '문화']);
  });

  it('total 은 예산 없는 카테고리 지출도 포함, 다른 달/수입/이상 거래 제외', () => {
    const b = { version: 1, total: 1000, categories: { 식비: 500 } };
    const list = [
      tx({ amount: 100 }),
      tx({ category: '교통', amount: 200 }),
      tx({ date: '2024-06-01', amount: 9999 }),
      tx({ type: 'income', amount: 9999 }),
      tx({ amount: NaN }),
      tx({ amount: -5 }),
      tx({ amount: '50' }),
      tx({ date: 'bad' }),
      null,
    ];
    const s = budgetStatus(list, '2024-05', b);
    expect(s.total).toEqual({ budget: 1000, spent: 300, remaining: 700, ratio: 0.3, status: 'ok' });
    expect(s.categories).toHaveLength(1);
    expect(s.categories[0].spent).toBe(100);
  });

  it('거래 목록이 배열이 아니어도 안전', () => {
    expect(budgetStatus(undefined, '2024-05', valid()).total.spent).toBe(0);
  });
});

describe('formatBudgetPercent', () => {
  it.each([
    [0, '0%'],
    [0.0001, '0%'],
    [0.7996, '79.9%'],
    [0.7999, '79.9%'],
    [0.8, '80%'],
    [0.85, '85%'],
    [0.9996, '99.9%'],
    [1, '100%'],
    [1.0004, '100.1%'],
    [1.0006, '100.1%'],
    [1.6, '160%'],
    [2.5, '250%'],
    [0.875, '87.5%'],
  ])('ratio %p -> %s', (ratio, expected) => {
    expect(formatBudgetPercent(ratio)).toBe(expected);
  });

  it('부동소수 오차가 있어도 정수 경계를 잘못 내림/올림하지 않는다', () => {
    expect(formatBudgetPercent(7 / 100)).toBe('7%');
    expect(formatBudgetPercent(29 / 100)).toBe('29%');
    expect(formatBudgetPercent(58 / 100)).toBe('58%');
    expect(formatBudgetPercent(0.57)).toBe('57%');
    expect(formatBudgetPercent(0.1 + 0.2)).toBe('30%');
    expect(formatBudgetPercent(0.7)).toBe('70%');
    expect(formatBudgetPercent(1.1)).toBe('110%');
  });

  it('초과 구간에서 안정화 없이는 올림이 어긋나는 비율도 정확히 표시한다', () => {
    // 403/200*1000 = 2015.0000000000002 (안정화가 없으면 올림되어 201.6%)
    expect(403 / 200 * 1000).toBeGreaterThan(2015);
    expect(formatBudgetPercent(403 / 200)).toBe('201.5%');
    // 161/5*1000 = 32200.000000000004 (안정화가 없으면 3220.1%)
    expect(161 / 5 * 1000).toBeGreaterThan(32200);
    expect(formatBudgetPercent(161 / 5)).toBe('3220%');
    expect(formatBudgetPercent(327 / 10)).toBe('3270%');
  });

  it.each([NaN, -0.5, Infinity, -Infinity])('잘못된 값 %p 는 0%%', (ratio) => {
    expect(formatBudgetPercent(ratio)).toBe('0%');
  });

  it('상태와 표시가 모순되지 않는다 (예산·지출 정수 쌍 1~200)', () => {
    for (let budget = 1; budget <= 200; budget += 1) {
      for (let spent = 1; spent <= 200; spent += 1) {
        const { total } = budgetStatus(
          [{ type: 'expense', category: '식비', amount: spent, date: '2026-10-01' }],
          '2026-10',
          { version: 1, total: budget, categories: {} }
        );
        const value = parseFloat(formatBudgetPercent(total.ratio));
        const label = `${spent}/${budget}`;
        if (total.status === 'ok') expect([label, value < 80]).toEqual([label, true]);
        else if (total.status === 'warn') expect([label, value >= 80 && value <= 100]).toEqual([label, true]);
        else expect([label, value > 100]).toEqual([label, true]);
      }
    }
  });
});
