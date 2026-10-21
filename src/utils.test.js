import { parseMonth, shiftMonth, monthOfDate, filterTransactions, compactKRW } from './utils';

describe('compactKRW', () => {
  test('1만 미만은 천 단위 쉼표 숫자', () => {
    expect(compactKRW(0)).toBe('0');
    expect(compactKRW(1)).toBe('1');
    expect(compactKRW(999)).toBe('999');
    expect(compactKRW(1000)).toBe('1,000');
    expect(compactKRW(5000)).toBe('5,000');
    expect(compactKRW(9999)).toBe('9,999');
  });

  test('1만 이상 100만 미만은 만 단위 소수 첫째 자리(.0 생략)', () => {
    expect(compactKRW(10000)).toBe('1만');
    expect(compactKRW(15000)).toBe('1.5만');
    expect(compactKRW(12345)).toBe('1.2만');
    expect(compactKRW(120000)).toBe('12만');
    expect(compactKRW(500000)).toBe('50만');
    expect(compactKRW(999400)).toBe('99.9만');
    expect(compactKRW(999600)).toBe('100만');
  });

  test('100만 이상 1억 미만은 정수 만 단위 + 쉼표', () => {
    expect(compactKRW(1000000)).toBe('100만');
    expect(compactKRW(1200000)).toBe('120만');
    expect(compactKRW(12000000)).toBe('1,200만');
    expect(compactKRW(13905000)).toBe('1,391만');
    expect(compactKRW(99994999)).toBe('9,999만');
    expect(compactKRW(1234567)).toBe('123만');
    expect(compactKRW(1550000)).toBe('155만');
    expect(compactKRW(9999999)).toBe('1,000만');
    expect(compactKRW(1000000 - 1)).toBe('100만');
    expect(compactKRW(999499)).toBe('99.9만');
  });

  test('억·조 단위와 반올림 후 승급', () => {
    expect(compactKRW(99995000)).toBe('1억');
    expect(compactKRW(99999999)).toBe('1억');
    expect(compactKRW(100000000)).toBe('1억');
    expect(compactKRW(125000000)).toBe('1.3억');
    expect(compactKRW(150000000)).toBe('1.5억');
    expect(compactKRW(999949999999)).toBe('9,999.5억');
    expect(compactKRW(999999999999)).toBe('1조');
    expect(compactKRW(1000000000000)).toBe('1조');
    expect(compactKRW(1250000000000)).toBe('1.3조');
    expect(compactKRW(999999999999999)).not.toMatch(/10000/);
  });

  test('음수는 부호 + 절댓값 포맷, 이상 값은 0', () => {
    expect(compactKRW(-1200000)).toBe('-120만');
    expect(compactKRW(-5000)).toBe('-5,000');
    expect(compactKRW(-0.2)).toBe('0');
    expect(compactKRW(NaN)).toBe('0');
    expect(compactKRW(Infinity)).toBe('0');
    expect(compactKRW(-Infinity)).toBe('0');
    expect(compactKRW(undefined)).toBe('0');
    expect(compactKRW('abc')).toBe('0');
  });
});

test('parseMonth: YYYY-MM 을 연·월로 분해한다', () => {
  expect(parseMonth('2026-10')).toEqual({ year: 2026, month: 10 });
  expect(parseMonth('2026-01')).toEqual({ year: 2026, month: 1 });
});

test('parseMonth: 잘못된 형식은 null', () => {
  expect(parseMonth('')).toBeNull();
  expect(parseMonth(undefined)).toBeNull();
  expect(parseMonth('2026-13')).toBeNull();
  expect(parseMonth('2026-00')).toBeNull();
  expect(parseMonth('2026-1')).toBeNull();
  expect(parseMonth('abcd-ef')).toBeNull();
});

test('shiftMonth: 연말/연초 경계를 넘어 이동한다', () => {
  expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  expect(shiftMonth('2026-05', 1)).toBe('2026-06');
  expect(shiftMonth('2026-05', -1)).toBe('2026-04');
});

test('shiftMonth: 여러 달 이동과 0 이동', () => {
  expect(shiftMonth('2026-10', 3)).toBe('2027-01');
  expect(shiftMonth('2026-02', -14)).toBe('2024-12');
  expect(shiftMonth('2026-10', 24)).toBe('2028-10');
  expect(shiftMonth('2026-10', 0)).toBe('2026-10');
});

test('shiftMonth: 형식이 이상하면 그대로 반환', () => {
  expect(shiftMonth('', 1)).toBe('');
});

test('monthOfDate: 날짜에서 월을 안전하게 추출한다', () => {
  expect(monthOfDate('2026-03-15')).toBe('2026-03');
  expect(monthOfDate('')).toBeNull();
  expect(monthOfDate(undefined)).toBeNull();
  expect(monthOfDate('이상한값')).toBeNull();
});

describe('filterTransactions', () => {
  const list = [
    { id: 1, date: '2026-03-01', type: 'expense', category: '식비', description: 'Lunch 점심 식사', amount: 8000 },
    { id: 2, date: '2026-03-02', type: 'income', category: '급여', description: '3월 월급', amount: 3000000 },
    { id: 3, date: '2026-03-03', type: 'expense', category: '교통', description: '지하철', amount: 1500 },
    { id: 4, date: '2026-03-04', type: 'income', category: '기타수입', description: '중고 판매', amount: 20000 },
  ];
  const ids = (r) => r.map((t) => t.id);
  const all = { type: 'all', category: 'all', keyword: '' };

  test('조건이 모두 전체/빈 값이면 전부 반환한다', () => {
    expect(ids(filterTransactions(list, all))).toEqual([1, 2, 3, 4]);
  });

  test('유형 단독', () => {
    expect(ids(filterTransactions(list, { ...all, type: 'income' }))).toEqual([2, 4]);
    expect(ids(filterTransactions(list, { ...all, type: 'expense' }))).toEqual([1, 3]);
  });

  test('카테고리 단독', () => {
    expect(ids(filterTransactions(list, { ...all, category: '교통' }))).toEqual([3]);
  });

  test('키워드 단독: 대소문자 무시, 앞뒤 공백 제거', () => {
    expect(ids(filterTransactions(list, { ...all, keyword: '  LUNCH ' }))).toEqual([1]);
  });

  test('키워드는 카테고리명도 매칭한다', () => {
    expect(ids(filterTransactions(list, { ...all, keyword: '급여' }))).toEqual([2]);
    expect(ids(filterTransactions(list, { ...all, keyword: '수입' }))).toEqual([4]);
  });

  test('한글 부분 일치', () => {
    expect(ids(filterTransactions(list, { ...all, keyword: '식사' }))).toEqual([1]);
    expect(ids(filterTransactions(list, { ...all, keyword: '월' }))).toEqual([2]);
  });

  test('공백만 있는 키워드는 빈 키워드로 취급한다', () => {
    expect(ids(filterTransactions(list, { ...all, keyword: '   ' }))).toEqual([1, 2, 3, 4]);
  });

  test('조건 조합', () => {
    expect(ids(filterTransactions(list, { type: 'expense', category: '식비', keyword: '점심' }))).toEqual([1]);
    expect(ids(filterTransactions(list, { type: 'income', category: '식비', keyword: '' }))).toEqual([]);
  });

  test('일치하는 항목이 없으면 빈 배열', () => {
    expect(filterTransactions(list, { ...all, keyword: '없는내용' })).toEqual([]);
  });

  test('원본 배열과 항목을 변경하지 않는다', () => {
    const copy = JSON.parse(JSON.stringify(list));
    const result = filterTransactions(list, { ...all, type: 'income' });
    expect(list).toEqual(copy);
    expect(result).not.toBe(list);
  });
});
