import { loadGuestBudgets, saveGuestBudgets, clearGuestBudgets, GUEST_BUDGET_KEY } from './guestBudgetStorage';
import { emptyBudgets } from './budget';

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

describe('guestBudgetStorage', () => {
  it('저장 후 다시 읽으면 같다', () => {
    const b = { version: 1, total: 1000, categories: { 식비: 300 } };
    expect(saveGuestBudgets(b)).toBe(true);
    expect(loadGuestBudgets()).toEqual(b);
  });

  it('저장된 값이 없으면 빈 예산', () => {
    expect(loadGuestBudgets()).toEqual(emptyBudgets());
  });

  it('손상된 JSON 이면 빈 예산', () => {
    localStorage.setItem(GUEST_BUDGET_KEY, '{oops');
    expect(loadGuestBudgets()).toEqual(emptyBudgets());
  });

  it('무효 항목은 걸러낸다', () => {
    localStorage.setItem(
      GUEST_BUDGET_KEY,
      JSON.stringify({ version: 1, total: 0, categories: { 식비: 100, 교통: -1, 급여: 5 } })
    );
    expect(loadGuestBudgets()).toEqual({ version: 1, total: null, categories: { 식비: 100 } });
  });

  it('clear 는 항목을 지운다', () => {
    saveGuestBudgets({ version: 1, total: 1, categories: {} });
    expect(clearGuestBudgets()).toBe(true);
    expect(localStorage.getItem(GUEST_BUDGET_KEY)).toBeNull();
  });

  it('localStorage 예외 시 안전하게 처리', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('x'); });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('x'); });
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('x'); });
    expect(loadGuestBudgets()).toEqual(emptyBudgets());
    expect(saveGuestBudgets(emptyBudgets())).toBe(false);
    expect(clearGuestBudgets()).toBe(false);
  });
});
