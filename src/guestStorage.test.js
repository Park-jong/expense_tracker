import {
  GUEST_KEY,
  loadGuestTransactions,
  saveGuestTransactions,
  clearGuestTransactions,
  mergeTransactions,
} from './guestStorage';

const sample = (over = {}) => ({
  id: 1,
  date: '2024-05-01',
  type: 'expense',
  category: '식비',
  description: '점심',
  amount: 8000,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('게스트 저장소 왕복', () => {
  test('저장 후 그대로 읽는다', () => {
    const list = [sample(), sample({ id: 2, type: 'income', amount: 100 })];
    expect(saveGuestTransactions(list)).toBe(true);
    expect(loadGuestTransactions()).toEqual(list);
  });

  test('저장된 값이 없으면 빈 배열', () => {
    expect(loadGuestTransactions()).toEqual([]);
  });

  test('clear 후에는 빈 배열', () => {
    saveGuestTransactions([sample()]);
    clearGuestTransactions();
    expect(loadGuestTransactions()).toEqual([]);
  });
});

describe('손상된 데이터', () => {
  test('손상된 JSON은 빈 배열', () => {
    localStorage.setItem(GUEST_KEY, '{not json');
    expect(loadGuestTransactions()).toEqual([]);
  });

  test('배열이 아니면 빈 배열', () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify({ a: 1 }));
    expect(loadGuestTransactions()).toEqual([]);
  });

  test('유효하지 않은 항목은 제외', () => {
    const good = sample();
    localStorage.setItem(
      GUEST_KEY,
      JSON.stringify([
        good,
        null,
        'x',
        sample({ id: '2' }),
        sample({ type: 'etc' }),
        sample({ amount: '100' }),
        sample({ date: 20240501 }),
        { id: 3 },
      ])
    );
    expect(loadGuestTransactions()).toEqual([good]);
  });
});

describe('localStorage 예외', () => {
  test('읽기 예외 시 빈 배열', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadGuestTransactions()).toEqual([]);
  });

  test('쓰기 예외 시 false 반환(throw 하지 않음)', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(saveGuestTransactions([sample()])).toBe(false);
  });

  test('삭제 예외 시 false 반환(throw 하지 않음)', () => {
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(clearGuestTransactions()).toBe(false);
  });
});

describe('mergeTransactions', () => {
  test('id 기준 합집합, 같은 id는 Drive 우선', () => {
    const drive = [sample({ id: 1, description: 'drive' }), sample({ id: 2 })];
    const guest = [sample({ id: 1, description: 'guest' }), sample({ id: 3 })];
    const merged = mergeTransactions(drive, guest);
    expect(merged.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(merged[0].description).toBe('drive');
  });

  test('한쪽이 비어 있어도 동작', () => {
    expect(mergeTransactions([], [sample()])).toEqual([sample()]);
    expect(mergeTransactions([sample()], [])).toEqual([sample()]);
    expect(mergeTransactions(null, undefined)).toEqual([]);
  });
});
