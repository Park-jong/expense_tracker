import {
  dueOccurrences,
  nextOccurrence,
  planGeneration,
  applyDrafts,
  draftKeys,
  isGenerationSaved,
  applyGenerationUpdates,
  normalizeRule,
  parseRecurring,
  sanitizeRecurring,
  mergeRecurring,
  describeCycle,
  addDays,
  RecurringFileCorruptError,
} from './recurring';

const rule = (over = {}) => ({
  id: 'r1',
  type: 'expense',
  category: '주거',
  description: '월세',
  amount: 500000,
  cycle: 'monthly',
  day: 5,
  startDate: '2024-01-01',
  endDate: null,
  lastGenerated: null,
  ...over,
});

describe('dueOccurrences - 매월', () => {
  it('시작일~오늘 사이 발생일을 만들고 미래는 만들지 않는다', () => {
    const { dates } = dueOccurrences(rule({ startDate: '2024-01-10' }), '2024-04-04');
    expect(dates).toEqual(['2024-02-05', '2024-03-05']);
    expect(dueOccurrences(rule(), '2024-04-05').dates.at(-1)).toBe('2024-04-05');
  });

  it('31일 규칙은 짧은 달에는 말일', () => {
    const { dates } = dueOccurrences(rule({ day: 31 }), '2024-05-01');
    expect(dates).toEqual(['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
    expect(dueOccurrences(rule({ day: 31, startDate: '2023-02-01' }), '2023-03-01').dates).toEqual(['2023-02-28']);
  });

  it('lastGenerated 이후만 만든다', () => {
    const { dates } = dueOccurrences(rule({ lastGenerated: '2024-02-05' }), '2024-04-10');
    expect(dates).toEqual(['2024-03-05', '2024-04-05']);
  });

  it('종료일이 오늘보다 앞이면 종료일까지만', () => {
    const { dates } = dueOccurrences(rule({ endDate: '2024-03-04' }), '2024-12-31');
    expect(dates).toEqual(['2024-01-05', '2024-02-05']);
  });

  it('시작일이 미래이면 아무것도 만들지 않는다', () => {
    expect(dueOccurrences(rule({ startDate: '2025-01-01' }), '2024-12-31')).toEqual({ dates: [], skipped: 0 });
  });

  it('오래 안 열어 누락된 과거분은 소급하되 상한을 넘으면 최근 것만 남기고 건수를 알린다', () => {
    const weekly = rule({ cycle: 'weekly', weekday: 1, day: undefined, startDate: '2000-01-01' });
    const r = dueOccurrences(weekly, '2024-01-01');
    expect(r.dates).toHaveLength(366);
    expect(r.dates.at(-1)).toBe('2024-01-01');
    expect(r.skipped).toBeGreaterThan(0);
    const small = dueOccurrences(rule(), '2024-06-30', 3);
    expect(small.dates).toEqual(['2024-04-05', '2024-05-05', '2024-06-05']);
    expect(small.skipped).toBe(3);
  });
});

describe('dueOccurrences - 매주/매년', () => {
  it('매주는 지정 요일마다 (2024-01-01 은 월요일)', () => {
    const { dates } = dueOccurrences(rule({ cycle: 'weekly', weekday: 3, startDate: '2024-01-01' }), '2024-01-20');
    expect(dates).toEqual(['2024-01-03', '2024-01-10', '2024-01-17']);
  });

  it('매년 2/29 는 평년에는 2/28', () => {
    const { dates } = dueOccurrences(rule({ cycle: 'yearly', month: 2, day: 29, startDate: '2023-01-01' }), '2025-03-01');
    expect(dates).toEqual(['2023-02-28', '2024-02-29', '2025-02-28']);
  });

  it('매년 규칙은 시작일 이전/오늘 이후 해를 만들지 않는다', () => {
    const r = rule({ cycle: 'yearly', month: 3, day: 10, startDate: '2024-03-11' });
    expect(dueOccurrences(r, '2025-03-09').dates).toEqual([]);
    expect(dueOccurrences(r, '2025-03-10').dates).toEqual(['2025-03-10']);
  });
});

describe('nextOccurrence / describeCycle', () => {
  it('오늘 이후 첫 발생일, 종료되면 null', () => {
    expect(nextOccurrence(rule(), '2024-03-10')).toBe('2024-04-05');
    expect(nextOccurrence(rule({ day: 31 }), '2024-01-31')).toBe('2024-02-29');
    expect(nextOccurrence(rule({ endDate: '2024-03-31' }), '2024-03-10')).toBeNull();
    expect(nextOccurrence(rule({ startDate: '2030-01-01' }), '2024-03-10')).toBe('2030-01-05');
  });

  it('주기 요약 문구', () => {
    expect(describeCycle(rule())).toBe('매월 5일');
    expect(describeCycle(rule({ cycle: 'weekly', weekday: 1 }))).toBe('매주 월요일');
    expect(describeCycle(rule({ cycle: 'yearly', month: 3, day: 5 }))).toBe('매년 3월 5일');
  });

  it('addDays 는 월/연 경계를 로컬 달력으로 넘는다', () => {
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
    expect(addDays('2024-12-31', 1)).toBe('2025-01-01');
  });
});

describe('planGeneration / applyDrafts / applyGenerationUpdates', () => {
  it('초안은 거래와 같은 필드이고 lastGenerated 갱신값을 돌려준다', () => {
    const { drafts, updates } = planGeneration([rule({ startDate: '2024-03-01' })], '2024-04-20');
    expect(drafts).toEqual([
      { date: '2024-03-05', type: 'expense', category: '주거', description: '월세', amount: 500000 },
      { date: '2024-04-05', type: 'expense', category: '주거', description: '월세', amount: 500000 },
    ]);
    expect(updates).toEqual({ r1: '2024-04-05' });
  });

  it('id 는 기존 최대 id 다음부터 결정적으로 부여하고 입력 배열은 바꾸지 않는다', () => {
    const prev = [{ id: 7, date: '2024-01-01', type: 'income', category: '급여', description: 'x', amount: 1 }];
    const { drafts } = planGeneration([rule({ startDate: '2024-03-01' })], '2024-04-20');
    const a = applyDrafts(prev, drafts);
    const b = applyDrafts(prev, drafts);
    expect(a).toEqual(b);
    expect(a.map((t) => t.id)).toEqual([7, 8, 9]);
    expect(prev).toHaveLength(1);
  });

  it('같은 날짜·유형·카테고리·내용·금액 거래가 있으면 건너뛰고, 다시 적용해도 중복이 없다', () => {
    const existing = { id: 1, date: '2024-03-05', type: 'expense', category: '주거', description: '월세', amount: 500000 };
    const { drafts } = planGeneration([rule({ startDate: '2024-03-01' })], '2024-04-20');
    const once = applyDrafts([existing], drafts);
    expect(once).toHaveLength(2);
    expect(applyDrafts(once, drafts)).toBe(once);
  });

  it('금액이 다르면 중복이 아니다', () => {
    const existing = { id: 1, date: '2024-03-05', type: 'expense', category: '주거', description: '월세', amount: 1 };
    const { drafts } = planGeneration([rule({ startDate: '2024-03-01', endDate: '2024-03-31' })], '2024-04-20');
    expect(applyDrafts([existing], drafts)).toHaveLength(2);
  });

  it('lastGenerated 갱신은 앞선 값/삭제된 규칙을 건드리지 않는다', () => {
    const rules = [rule({ lastGenerated: '2024-05-05' })];
    expect(applyGenerationUpdates(rules, { r1: '2024-04-05' })).toBe(rules);
    expect(applyGenerationUpdates(rules, { zzz: '2024-06-05' })).toBe(rules);
    expect(applyGenerationUpdates(rules, { r1: '2024-06-05' })[0].lastGenerated).toBe('2024-06-05');
  });

  it('생성 후 같은 규칙으로 다시 계산하면 만들 것이 없다 (삭제한 거래가 되살아나지 않음)', () => {
    const { updates } = planGeneration([rule()], '2024-04-20');
    const updated = applyGenerationUpdates([rule()], updates);
    expect(planGeneration(updated, '2024-04-20').drafts).toEqual([]);
  });
});

describe('검증/병합', () => {
  it('normalizeRule 은 잘못된 값을 거부한다', () => {
    expect(normalizeRule(rule())).not.toBeNull();
    expect(normalizeRule(rule({ amount: 0 }))).toBeNull();
    expect(normalizeRule(rule({ amount: 1.5 }))).toBeNull();
    expect(normalizeRule(rule({ day: 32 }))).toBeNull();
    expect(normalizeRule(rule({ category: '급여' }))).toBeNull();
    expect(normalizeRule(rule({ startDate: '2024-02-30' }))).toBeNull();
    expect(normalizeRule(rule({ endDate: '2023-12-31' }))).toBeNull();
    expect(normalizeRule(rule({ cycle: 'daily' }))).toBeNull();
    expect(normalizeRule(rule({ cycle: 'yearly', month: 2, day: 30 }))).toBeNull();
    expect(normalizeRule(rule({ cycle: 'yearly', month: 2, day: 29 }))).not.toBeNull();
    expect(normalizeRule(rule({ cycle: 'weekly', weekday: 7 }))).toBeNull();
  });

  it('parseRecurring 은 하나라도 이상하면 던지고 sanitizeRecurring 은 걸러낸다', () => {
    expect(() => parseRecurring(null)).toThrow();
    expect(() => parseRecurring({ version: 2, rules: [] })).toThrow();
    expect(() => parseRecurring({ version: 1, rules: [rule(), { bad: 1 }] })).toThrow();
    expect(() => parseRecurring({ version: 1, rules: [rule(), rule()] })).toThrow();
    expect(parseRecurring({ version: 1, rules: [rule()] })).toHaveLength(1);
    expect(sanitizeRecurring({ version: 1, rules: [rule(), { bad: 1 }, rule()] })).toHaveLength(1);
    expect(sanitizeRecurring('x')).toEqual([]);
    expect(new RecurringFileCorruptError().name).toBe('RecurringFileCorruptError');
  });

  it('mergeRecurring: id 별 Drive 우선, 게스트에만 있는 것만 추가', () => {
    const drive = [rule({ amount: 1 })];
    const guest = [rule({ amount: 2 }), rule({ id: 'r2' })];
    const { merged, guestOnly } = mergeRecurring(drive, guest);
    expect(guestOnly).toBe(true);
    expect(merged.map((r) => [r.id, r.amount])).toEqual([['r1', 1], ['r2', 500000]]);
    expect(mergeRecurring(drive, [rule({ amount: 2 })]).guestOnly).toBe(false);
    expect(mergeRecurring(null, []).merged).toEqual([]);
  });
});

describe('id 부여와 연도 경계', () => {
  const d = { date: '2024-01-01', type: 'expense', category: '식비', description: 'x', amount: 1 };
  it('applyDrafts 는 max(기존 최대 id, minId) + 1 부터 id 를 부여한다', () => {
    const out = applyDrafts([{ id: 5, ...d, description: 'old' }], [d, { ...d, date: '2024-01-02' }], 1000);
    expect(out.slice(1).map((t) => t.id)).toEqual([1001, 1002]);
    const out2 = applyDrafts([{ id: 5000, ...d, description: 'old' }], [d], 1000);
    expect(out2[1].id).toBe(5001);
  });

  it('nextOccurrence 는 2999년 경계에서도 예외 없이 null 을 돌려준다', () => {
    const r = { id: 'a', type: 'expense', category: '식비', description: 'x', amount: 1, cycle: 'monthly', day: 5, startDate: '2024-01-01', endDate: null, lastGenerated: null };
    expect(() => nextOccurrence(r, '2999-12-31')).not.toThrow();
    expect(nextOccurrence(r, '2999-12-31')).toBeNull();
    expect(nextOccurrence({ ...r, lastGenerated: '2999-12-31' }, '2999-06-01')).toBeNull();
    expect(nextOccurrence(r, '2995-01-01')).toBe('2995-01-05');
    expect(nextOccurrence(r, '3000-01-01')).toBeNull();
  });
});

describe('applyDrafts 안전 정수 경계', () => {
  const base = { type: 'expense', category: '주거', description: 'x', amount: 1 };
  const MAX = Number.MAX_SAFE_INTEGER;

  test('기존 최대 id 가 안전 정수 상한이면 초안을 만들지 않고 prev 를 그대로 돌려준다', () => {
    const prev = [{ id: MAX, date: '2024-01-01', ...base }];
    expect(applyDrafts(prev, [{ date: '2024-02-01', ...base }])).toBe(prev);
  });

  test('상한 직전이면 가능한 만큼만 만들고 모든 id 는 안전 정수이며 고유하다', () => {
    const prev = [{ id: MAX - 1, date: '2024-01-01', ...base }];
    const next = applyDrafts(prev, [{ date: '2024-02-01', ...base }, { date: '2024-03-01', ...base }]);
    expect(next).toHaveLength(2);
    expect(next[1].id).toBe(MAX);
    expect(next.every((t) => Number.isSafeInteger(t.id))).toBe(true);
    expect(new Set(next.map((t) => t.id)).size).toBe(next.length);
  });
});

describe('draftKeys / isGenerationSaved (내용 키 기준 저장 판정)', () => {
  const d = (over = {}) => ({ date: '2026-03-05', type: 'expense', category: '주거', description: '월세', amount: 100, ...over });
  const t = (id, over) => ({ id, ...d(over) });

  test('draftKeys 는 같은 내용 초안을 하나로 합친다', () => {
    expect(draftKeys([d(), d(), d({ amount: 200 })])).toHaveLength(2);
    expect(draftKeys(null)).toEqual([]);
  });

  test('id 가 달라도 같은 내용이 저장 배열에 있으면 충족', () => {
    const keys = draftKeys([d()]);
    expect(isGenerationSaved(keys, [t(999)], [t(1)])).toBe(true);
  });

  test('현재 목록에 있는데 저장 배열에 없으면 미충족', () => {
    const keys = draftKeys([d()]);
    expect(isGenerationSaved(keys, [t(5, { description: '다른' })], [t(1)])).toBe(false);
  });

  test('현재 목록에서 사라진(삭제·수정된) 키는 충족으로 본다', () => {
    const keys = draftKeys([d()]);
    expect(isGenerationSaved(keys, [], [t(1, { amount: 777 })])).toBe(true);
  });

  test('여러 키 중 하나라도 미충족이면 미충족', () => {
    const keys = draftKeys([d(), d({ date: '2026-03-12' })]);
    const current = [t(1), t(2, { date: '2026-03-12' })];
    expect(isGenerationSaved(keys, [t(1)], current)).toBe(false);
    expect(isGenerationSaved(keys, current, current)).toBe(true);
  });
});
