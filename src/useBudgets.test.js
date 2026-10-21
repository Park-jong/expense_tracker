import { renderHook, act } from '@testing-library/react';
import { useBudgets } from './useBudgets';
import { loadBudgets, saveBudgets } from './googleDrive';
import { BudgetFileCorruptError } from './budget';

jest.mock('./googleDrive', () => ({
  loadBudgets: jest.fn(),
  saveBudgets: jest.fn(),
}));

const KEY = 'guest_budgets';
const B = (total, categories = {}) => ({ version: 1, total, categories });
const guest = () => JSON.parse(localStorage.getItem(KEY));

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};

const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const advance = async (ms = 800) => {
  await act(async () => { jest.advanceTimersByTime(ms); });
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  loadBudgets.mockReset();
  saveBudgets.mockReset();
  loadBudgets.mockResolvedValue(null);
  saveBudgets.mockResolvedValue(undefined);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

const mount = (initial = 'idle') =>
  renderHook(({ auth }) => useBudgets(auth), { initialProps: { auth: initial } });

describe('useBudgets', () => {
  it('(i) 비로그인 변경이 guest_budgets 에 저장되고 리마운트 후에도 유지', () => {
    const { result, unmount } = mount();
    act(() => result.current.setBudgets(B(1000, { 식비: 300 })));
    expect(guest()).toEqual(B(1000, { 식비: 300 }));
    unmount();
    const again = mount();
    expect(again.result.current.budgets).toEqual(B(1000, { 식비: 300 }));
    expect(loadBudgets).not.toHaveBeenCalled();
  });

  it('setBudgets 는 updater 를 받는다', () => {
    const { result } = mount();
    act(() => result.current.setBudgets(B(100)));
    act(() => result.current.setBudgets((prev) => ({ ...prev, total: prev.total + 1 })));
    expect(result.current.budgets.total).toBe(101);
  });

  it('(ii) 로그인 시 병합 후 저장하고, 저장 성공 뒤에만 게스트 저장소를 비운다', async () => {
    localStorage.setItem(KEY, JSON.stringify(B(900, { 교통: 50 })));
    const save = deferred();
    saveBudgets.mockReturnValue(save.promise);
    loadBudgets.mockResolvedValue(B(100, { 식비: 10 }));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    const expected = B(100, { 식비: 10, 교통: 50 });
    expect(result.current.budgets).toEqual(expected);
    await advance();
    expect(saveBudgets).toHaveBeenCalledTimes(1);
    expect(saveBudgets).toHaveBeenCalledWith(expected);
    expect(localStorage.getItem(KEY)).not.toBeNull(); // 아직 저장 중
    await act(async () => { save.resolve(); });
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.syncState).toBe('saved');
  });

  it('(iii) 저장 실패 시 게스트 저장소 유지, syncState error', async () => {
    localStorage.setItem(KEY, JSON.stringify(B(900)));
    saveBudgets.mockRejectedValue(new Error('fail'));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    await advance();
    expect(saveBudgets).toHaveBeenCalled();
    expect(result.current.syncState).toBe('error');
    expect(guest()).toEqual(B(900));
  });

  it('(iv) 불러오기 실패 시 저장하지 않고 게스트 저장을 계속, retry 성공 시 병합', async () => {
    loadBudgets.mockRejectedValueOnce(new Error('예산 파일을 읽을 수 없습니다: 손상'));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.syncState).toBe('error');
    act(() => result.current.setBudgets(B(777)));
    await advance(2000);
    expect(saveBudgets).not.toHaveBeenCalled();
    expect(guest()).toEqual(B(777));

    loadBudgets.mockResolvedValueOnce(B(null, { 식비: 5 }));
    act(() => result.current.retry());
    await flush();
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.budgets).toEqual(B(777, { 식비: 5 }));
    await advance();
    expect(saveBudgets).toHaveBeenCalledWith(B(777, { 식비: 5 }));
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('(v) 불러오는 중 로그아웃하면 늦은 응답이 상태를 오염시키지 않는다', async () => {
    localStorage.setItem(KEY, JSON.stringify(B(10)));
    const load = deferred();
    loadBudgets.mockReturnValue(load.promise);
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    rerender({ auth: 'idle' });
    await act(async () => { load.resolve(B(555, { 식비: 1 })); });
    await advance(2000);
    expect(result.current.budgets).toEqual(B(10));
    expect(result.current.syncState).toBe('idle');
    expect(saveBudgets).not.toHaveBeenCalled();
    expect(guest()).toEqual(B(10));
  });

  it('(vi) 로그아웃 후 즉시 재로그인해도 이전 세션의 늦은 저장 성공이 게스트를 일찍 비우지 않는다', async () => {
    localStorage.setItem(KEY, JSON.stringify(B(900)));
    const oldSave = deferred();
    saveBudgets.mockReturnValueOnce(oldSave.promise);
    const load2 = deferred();
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    await advance();
    expect(saveBudgets).toHaveBeenCalledTimes(1);

    loadBudgets.mockReturnValue(load2.promise);
    rerender({ auth: 'idle' });
    rerender({ auth: 'signed-in' });
    await act(async () => { oldSave.resolve(); });
    expect(guest()).toEqual(B(900));
    expect(result.current.syncState).toBe('saving');
  });

  it('(vii) 로그인 후 변경이 없으면 저장하지 않고, 변경하면 디바운스 후 저장', async () => {
    loadBudgets.mockResolvedValue(B(100));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    await advance(3000);
    expect(saveBudgets).not.toHaveBeenCalled();

    act(() => result.current.setBudgets(B(200)));
    await advance(799);
    expect(saveBudgets).not.toHaveBeenCalled();
    await advance(1);
    expect(saveBudgets).toHaveBeenCalledTimes(1);
    expect(saveBudgets).toHaveBeenCalledWith(B(200));
    // 로드 성공 후 로그인 상태에서는 게스트 저장소에 쓰지 않는다
    // (마운트 시 비로그인 상태에서 쓴 빈 예산만 남아 있어야 함)
    expect(guest()).toEqual(B(null));
  });

  it('(viii) 로그아웃 후 Drive 예산이 guest_budgets 에 복사되지 않는다', async () => {
    loadBudgets.mockResolvedValue(B(100, { 식비: 10 }));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    expect(result.current.budgets).toEqual(B(100, { 식비: 10 }));
    rerender({ auth: 'idle' });
    await advance(2000);
    expect(result.current.budgets).toEqual(B(null));
    const stored = localStorage.getItem(KEY);
    expect(stored === null || JSON.parse(stored).total === null).toBe(true);
  });

  it('(ix) 로그아웃 커밋에서 Drive 예산이 guest_budgets 에 일시적으로도 기록되지 않는다', async () => {
    loadBudgets.mockResolvedValue(B(100, { 식비: 10 }));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    expect(result.current.budgets.total).toBe(100);
    const spy = jest.spyOn(Storage.prototype, 'setItem');
    try {
      rerender({ auth: 'idle' });
      await advance(2000);
      const written = spy.mock.calls.filter(([k]) => k === KEY).map(([, v]) => JSON.parse(v));
      expect(written.some((w) => w.total === 100 || w.categories['식비'] === 10)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('(x) 로그아웃 후 늦게 reject 되는 불러오기는 상태를 바꾸지 않는다', async () => {
    const load = deferred();
    loadBudgets.mockReturnValue(load.promise);
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    rerender({ auth: 'idle' });
    await act(async () => { load.reject(new Error('예산 파일을 읽을 수 없습니다: 손상')); });
    await flush();
    expect(result.current.syncState).toBe('idle');
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadError).toBeNull();
  });

  it('(xi) 로그아웃 후 늦게 reject 되는 저장은 상태를 바꾸지 않는다', async () => {
    localStorage.setItem(KEY, JSON.stringify(B(900)));
    const save = deferred();
    saveBudgets.mockReturnValue(save.promise);
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    await advance();
    expect(saveBudgets).toHaveBeenCalledTimes(1);
    rerender({ auth: 'idle' });
    await act(async () => { save.reject(new Error('fail')); });
    await flush();
    expect(result.current.syncState).toBe('idle');
    expect(result.current.loadFailed).toBe(false);
    await advance(3000);
    expect(saveBudgets).toHaveBeenCalledTimes(1);
  });

  it('(xii) 저장 중 변경은 끝난 뒤 최신 값으로 한 번만 이어서 저장하고, 마지막 성공 뒤에만 게스트를 비운다', async () => {
    localStorage.setItem(KEY, JSON.stringify(B(900)));
    let active = 0;
    let maxActive = 0;
    const saves = [];
    saveBudgets.mockImplementation(() => {
      active++;
      maxActive = Math.max(maxActive, active);
      const d = deferred();
      saves.push(d);
      return d.promise.finally(() => { active--; });
    });
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    await advance();
    expect(saveBudgets).toHaveBeenCalledTimes(1);

    act(() => result.current.setBudgets(B(901)));
    await advance();
    act(() => result.current.setBudgets(B(902)));
    await advance();
    expect(saveBudgets).toHaveBeenCalledTimes(1); // 진행 중에는 겹쳐 호출하지 않음
    expect(result.current.syncState).toBe('saving');

    await act(async () => { saves[0].resolve(); });
    await flush();
    expect(saveBudgets).toHaveBeenCalledTimes(2);
    expect(saveBudgets).toHaveBeenLastCalledWith(B(902));
    expect(localStorage.getItem(KEY)).not.toBeNull(); // 아직 최신 값 저장 전
    expect(result.current.syncState).toBe('saving');

    await act(async () => { saves[1].resolve(); });
    await flush();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.syncState).toBe('saved');
    expect(saveBudgets).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('(xiii) 저장 전 sanitize 로 잘못된 값이 saveBudgets 로 가지 않는다', async () => {
    loadBudgets.mockResolvedValue(B(100));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    act(() => result.current.setBudgets({
      version: 1, total: -5, categories: { 식비: 10, 없는카테고리: 3, 교통: 1.5 },
    }));
    expect(result.current.budgets).toEqual(B(null, { 식비: 10 }));
    await advance();
    expect(saveBudgets).toHaveBeenCalledTimes(1);
    expect(saveBudgets).toHaveBeenCalledWith(B(null, { 식비: 10 }));
  });

  it('유효한 값과 같은 값을 다시 설정해도 변경으로 보지 않는다', async () => {
    loadBudgets.mockResolvedValue(B(100, { 식비: 10 }));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    const before = result.current.budgets;
    act(() => result.current.setBudgets(B(100, { 식비: 10 })));
    expect(result.current.budgets).toBe(before);
    await advance(3000);
    expect(saveBudgets).not.toHaveBeenCalled();
  });

  it('(xiv) retrySave: 저장 실패 후 수동 재시도로 성공하고, 자동 재시도는 없다', async () => {
    loadBudgets.mockResolvedValue(B(100));
    saveBudgets.mockRejectedValueOnce(new Error('fail'));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    act(() => result.current.setBudgets(B(200)));
    await advance();
    expect(result.current.syncState).toBe('error');
    await advance(5000);
    expect(saveBudgets).toHaveBeenCalledTimes(1);

    await act(async () => { result.current.retrySave(); });
    await flush();
    expect(saveBudgets).toHaveBeenCalledTimes(2);
    expect(saveBudgets).toHaveBeenLastCalledWith(B(200));
    expect(result.current.syncState).toBe('saved');
  });

  it('retrySave: 다시 실패하면 error 를 유지하고, error 가 아니면 아무것도 하지 않는다', async () => {
    loadBudgets.mockResolvedValue(B(100));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    await act(async () => { result.current.retrySave(); }); // saved 상태 -> 무시
    await flush();
    expect(saveBudgets).not.toHaveBeenCalled();

    saveBudgets.mockRejectedValue(new Error('fail'));
    act(() => result.current.setBudgets(B(200)));
    await advance();
    expect(result.current.syncState).toBe('error');
    await act(async () => { result.current.retrySave(); });
    await flush();
    expect(saveBudgets).toHaveBeenCalledTimes(2);
    expect(result.current.syncState).toBe('error');
  });

  it('(xv) loadError: 전용 오류 타입만 corrupt, 그 외(검색 단계 JSON 오류 포함)는 network', async () => {
    loadBudgets.mockRejectedValueOnce(new BudgetFileCorruptError('예산 파일을 읽을 수 없습니다: 형식'));
    const a = mount();
    a.rerender({ auth: 'signed-in' });
    await flush();
    expect(a.result.current.loadError).toBe('corrupt');
    expect(a.result.current.loadFailed).toBe(true);

    // 메시지가 같아도 타입이 다르면 network
    loadBudgets.mockRejectedValueOnce(new Error('예산 파일을 읽을 수 없습니다: 형식'));
    const b = mount();
    b.rerender({ auth: 'signed-in' });
    await flush();
    expect(b.result.current.loadError).toBe('network');

    loadBudgets.mockRejectedValueOnce(new Error('HTTP 500'));
    const c = mount();
    c.rerender({ auth: 'signed-in' });
    await flush();
    expect(c.result.current.loadError).toBe('network');
    expect(c.result.current.loadFailed).toBe(true);
  });

  it('(xvi) network 오류에서는 overwriteDrive 가 아무것도 하지 않는다', async () => {
    loadBudgets.mockRejectedValue(new Error('HTTP 500'));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    await act(async () => { await result.current.overwriteDrive(); });
    await advance(2000);
    expect(saveBudgets).not.toHaveBeenCalled();
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.loadError).toBe('network');
  });

  it('(xvii) corrupt 에서 overwriteDrive 는 현재 예산으로 덮어써 복구하고 성공 뒤에만 게스트를 비운다', async () => {
    localStorage.setItem(KEY, JSON.stringify(B(900, { 식비: 5 })));
    loadBudgets.mockRejectedValue(new BudgetFileCorruptError('예산 파일을 읽을 수 없습니다: 손상'));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    expect(result.current.loadError).toBe('corrupt');

    saveBudgets.mockRejectedValueOnce(new Error('fail'));
    let r;
    await act(async () => { r = await result.current.overwriteDrive(); });
    expect(r).toBe(false);
    expect(saveBudgets).toHaveBeenCalledWith(B(900, { 식비: 5 }));
    expect(result.current.loadFailed).toBe(true); // 실패 시 상태 유지
    expect(result.current.loadError).toBe('corrupt');
    expect(guest()).toEqual(B(900, { 식비: 5 }));

    await act(async () => { r = await result.current.overwriteDrive(); });
    expect(r).toBe(true);
    expect(saveBudgets).toHaveBeenCalledTimes(2);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadError).toBeNull();
    expect(result.current.syncState).toBe('saved');
    expect(localStorage.getItem(KEY)).toBeNull();
    await advance(3000);
    expect(saveBudgets).toHaveBeenCalledTimes(2); // 불필요한 재저장 없음
  });

  it('(xviii) loading 플래그 전이', async () => {
    const load = deferred();
    loadBudgets.mockReturnValue(load.promise);
    const { result, rerender } = mount('loading');
    expect(result.current.loading).toBe(true);
    rerender({ auth: 'idle' });
    expect(result.current.loading).toBe(false);
    rerender({ auth: 'signed-in' });
    expect(result.current.loading).toBe(true);
    await act(async () => { load.resolve(null); });
    expect(result.current.loading).toBe(false);

    loadBudgets.mockRejectedValue(new Error('HTTP 500'));
    rerender({ auth: 'idle' });
    rerender({ auth: 'signed-in' });
    expect(result.current.loading).toBe(true);
    await flush();
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  // ── 2-11 추가: 분류 타입, 덮어쓰기 직렬화, 반환값, 변이 방지 ──────────────

  const corrupt = () => new BudgetFileCorruptError('예산 파일을 읽을 수 없습니다: 손상');
  const signInCorrupt = async () => {
    loadBudgets.mockRejectedValueOnce(corrupt());
    const h = mount();
    h.rerender({ auth: 'signed-in' });
    await flush();
    expect(h.result.current.loadError).toBe('corrupt');
    return h;
  };

  it('검색 단계 JSON 오류는 network 로 분류되어 overwriteDrive 가 저장하지 않는다', async () => {
    loadBudgets.mockRejectedValue(new SyntaxError('Unexpected token < in JSON'));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    expect(result.current.loadError).toBe('network');
    let r;
    await act(async () => { r = await result.current.overwriteDrive(); });
    await advance(2000);
    expect(r).toBe(false);
    expect(saveBudgets).not.toHaveBeenCalled();
    expect(result.current.loadFailed).toBe(true);
  });

  it('overwriteDrive: 저장 진행 중 중복 호출은 false 로 무시되고, 실행된 호출은 true', async () => {
    const { result } = await signInCorrupt();
    const ow = deferred();
    saveBudgets.mockReturnValueOnce(ow.promise);
    let first, second;
    await act(async () => {
      first = result.current.overwriteDrive();
      second = await result.current.overwriteDrive();
    });
    expect(second).toBe(false);
    expect(saveBudgets).toHaveBeenCalledTimes(1);
    expect(result.current.syncState).toBe('saving'); // UI 는 이 값으로 버튼을 막을 수 있다
    await act(async () => { ow.resolve(); });
    await expect(first).resolves.toBe(true);
  });

  it('(a) 저장 #1 진행 중 새 변경이 있으면 #1 성공 직후 게스트를 비우지 않고 마지막 성공 뒤에 비운다', async () => {
    localStorage.setItem(KEY, JSON.stringify(B(900)));
    const s1 = deferred();
    saveBudgets.mockReturnValueOnce(s1.promise);
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    await advance();
    expect(saveBudgets).toHaveBeenCalledTimes(1);
    act(() => result.current.setBudgets(B(901))); // 디바운스 타이머가 아직 대기 중
    await act(async () => { s1.resolve(); });
    await flush();
    expect(localStorage.getItem(KEY)).not.toBeNull();
    await advance();
    expect(saveBudgets).toHaveBeenCalledTimes(2);
    expect(saveBudgets).toHaveBeenLastCalledWith(B(901));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.syncState).toBe('saved');
  });

  it('(b) retrySave 는 불러오기 실패 상태(error)에서 saveBudgets 를 호출하지 않는다', async () => {
    loadBudgets.mockRejectedValue(new Error('HTTP 500'));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    expect(result.current.syncState).toBe('error');
    await act(async () => { result.current.retrySave(); });
    await flush();
    await advance(2000);
    expect(saveBudgets).not.toHaveBeenCalled();
    expect(result.current.syncState).toBe('error');
  });

  it('(c) 세대가 바뀐 뒤 이전 세대가 큐에 남긴 저장은 실행되지 않는다', async () => {
    const s1 = deferred();
    saveBudgets.mockReturnValueOnce(s1.promise);
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    act(() => result.current.setBudgets(B(5)));
    await advance();
    expect(saveBudgets).toHaveBeenCalledTimes(1);
    act(() => result.current.setBudgets(B(6)));
    await advance(); // 이전 세대 저장이 대기열에 남음
    rerender({ auth: 'idle' });
    await act(async () => { s1.resolve(); });
    await flush();
    await advance(3000);
    expect(saveBudgets).toHaveBeenCalledTimes(1);
    expect(result.current.syncState).toBe('idle');
  });

  it('(d) 덮어쓰기 진행 중 새 변경이 있으면 이어지는 저장 성공 전에는 게스트를 비우지 않는다', async () => {
    localStorage.setItem(KEY, JSON.stringify(B(900)));
    const { result } = await signInCorrupt();
    const ow = deferred();
    saveBudgets.mockReturnValueOnce(ow.promise);
    let p;
    await act(async () => { p = result.current.overwriteDrive(); });
    expect(saveBudgets).toHaveBeenLastCalledWith(B(900));
    act(() => result.current.setBudgets(B(901)));
    await act(async () => { ow.resolve(); });
    await expect(p).resolves.toBe(true);
    expect(result.current.loadFailed).toBe(false);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    await advance();
    expect(saveBudgets).toHaveBeenCalledTimes(2);
    expect(saveBudgets).toHaveBeenLastCalledWith(B(901));
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(result.current.syncState).toBe('saved');
  });

  it('(e) 덮어쓰기 진행 중 로그아웃하면 늦은 결과가 상태를 바꾸지 않고 게스트를 유지한다', async () => {
    localStorage.setItem(KEY, JSON.stringify(B(900)));
    const { result, rerender } = await signInCorrupt();
    const ow = deferred();
    saveBudgets.mockReturnValueOnce(ow.promise);
    let p;
    await act(async () => { p = result.current.overwriteDrive(); });
    rerender({ auth: 'idle' });
    await act(async () => { ow.resolve(); });
    await flush();
    await expect(p).resolves.toBe(false);
    expect(result.current.syncState).toBe('idle');
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.loadError).toBeNull();
    expect(guest()).toEqual(B(900));
    await advance(3000);
    expect(saveBudgets).toHaveBeenCalledTimes(1);
  });

  it('회귀: 덮어쓰기 중 재로그인 후 새 세션의 변경은 결국 저장되고 saving 에 고정되지 않는다', async () => {
    const { result, rerender } = await signInCorrupt();
    const ow = deferred();
    saveBudgets.mockReturnValueOnce(ow.promise);
    let p;
    await act(async () => { p = result.current.overwriteDrive(); });
    rerender({ auth: 'idle' });
    loadBudgets.mockResolvedValue(B(100));
    rerender({ auth: 'signed-in' });
    await flush();
    act(() => result.current.setBudgets(B(200)));
    await advance(); // 이전 세대 덮어쓰기가 진행 중이라 대기열에만 올라감
    expect(saveBudgets).toHaveBeenCalledTimes(1);
    expect(result.current.syncState).toBe('saving');

    await act(async () => { ow.resolve(); });
    await flush();
    await expect(p).resolves.toBe(false); // 오래된 세대의 결과
    expect(saveBudgets).toHaveBeenCalledTimes(2);
    expect(saveBudgets).toHaveBeenLastCalledWith(B(200));
    expect(result.current.syncState).toBe('saved');
    await advance(3000);
    expect(saveBudgets).toHaveBeenCalledTimes(2);
  });
});
