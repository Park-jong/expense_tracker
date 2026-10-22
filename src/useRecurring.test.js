import { renderHook, act } from '@testing-library/react';
import { useRecurring } from './useRecurring';
import { loadRecurring, saveRecurring } from './googleDrive';
import { RecurringFileCorruptError } from './recurring';

jest.mock('./googleDrive', () => ({
  loadRecurring: jest.fn(),
  saveRecurring: jest.fn(),
}));

const KEY = 'guest_recurring';
const R = (id, over = {}) => ({
  id,
  type: 'expense',
  category: '주거',
  description: `월세${id}`,
  amount: 1000,
  cycle: 'monthly',
  day: 5,
  startDate: '2024-01-01',
  endDate: null,
  lastGenerated: null,
  ...over,
});
const guest = () => JSON.parse(localStorage.getItem(KEY));

const flush = async () => { await act(async () => { await Promise.resolve(); }); };
const advance = async (ms = 800) => {
  await act(async () => { jest.advanceTimersByTime(ms); });
  await flush();
};

beforeEach(() => {
  localStorage.clear();
  loadRecurring.mockReset();
  saveRecurring.mockReset();
  loadRecurring.mockResolvedValue(null);
  saveRecurring.mockResolvedValue(undefined);
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

const mount = (initial = 'idle') => renderHook(({ auth }) => useRecurring(auth), { initialProps: { auth: initial } });

describe('useRecurring', () => {
  it('비로그인 변경은 guest_recurring 에 저장되고 리마운트 후에도 유지, 생성 가능 상태(ready)', () => {
    const { result, unmount } = mount();
    expect(result.current.ready).toBe(true);
    act(() => result.current.setRules([R('a')]));
    expect(guest().rules).toHaveLength(1);
    unmount();
    expect(mount().result.current.rules.map((r) => r.id)).toEqual(['a']);
  });

  it('잘못된 규칙은 setRules 에서 걸러진다', () => {
    const { result } = mount();
    act(() => result.current.setRules([R('a'), { id: 'bad' }]));
    expect(result.current.rules).toHaveLength(1);
  });

  it('로그인 시 Drive 우선으로 id 별 병합하고 저장 성공 후에만 게스트 저장소를 비운다', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, rules: [R('a', { amount: 5 }), R('g')] }));
    loadRecurring.mockResolvedValue([R('a', { amount: 1 })]);
    let resolveSave;
    saveRecurring.mockImplementation(() => new Promise((r) => { resolveSave = r; }));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    expect(result.current.ready).toBe(true);
    expect(result.current.rules.map((r) => [r.id, r.amount])).toEqual([['a', 1], ['g', 1000]]);
    await advance();
    expect(saveRecurring).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    await act(async () => { resolveSave(); });
    await flush();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('저장이 실패하면 게스트 저장소를 유지한다', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, rules: [R('g')] }));
    saveRecurring.mockRejectedValue(new Error('x'));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    await advance();
    expect(result.current.syncState).toBe('error');
    expect(localStorage.getItem(KEY)).not.toBeNull();
  });

  it('불러오기 실패 시 ready 가 아니고 저장하지 않는다', async () => {
    loadRecurring.mockRejectedValue(new Error('net'));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.loadError).toBe('network');
    expect(result.current.ready).toBe(false);
    act(() => result.current.setRules([R('a')]));
    await advance(2000);
    expect(saveRecurring).not.toHaveBeenCalled();
    expect(guest().rules).toHaveLength(1); // 실패 중 변경은 이 기기에 임시 저장
  });

  it('손상된 파일은 corrupt 로 분류되고 덮어쓰기하면 복구된다', async () => {
    loadRecurring.mockRejectedValue(new RecurringFileCorruptError());
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    expect(result.current.loadError).toBe('corrupt');
    expect(result.current.ready).toBe(false);
    act(() => result.current.setRules([R('a')]));
    let ok;
    await act(async () => { ok = await result.current.overwriteDrive(); });
    expect(ok).toBe(true);
    expect(saveRecurring).toHaveBeenCalledTimes(1);
    expect(result.current.loadFailed).toBe(false);
    expect(result.current.ready).toBe(true);
  });

  it('로그아웃 중 늦게 도착한 불러오기 응답은 무시한다', async () => {
    let resolveLoad;
    loadRecurring.mockImplementation(() => new Promise((r) => { resolveLoad = r; }));
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    rerender({ auth: 'idle' });
    await act(async () => { resolveLoad([R('late')]); });
    expect(result.current.rules).toEqual([]);
  });

  it('markGenerated 는 lastGenerated 를 갱신하고 저장 대상이 된다', async () => {
    loadRecurring.mockResolvedValue([R('a')]);
    const { result, rerender } = mount();
    rerender({ auth: 'signed-in' });
    await flush();
    act(() => result.current.markGenerated({ a: '2024-05-05' }));
    expect(result.current.rules[0].lastGenerated).toBe('2024-05-05');
    await advance();
    expect(saveRecurring).toHaveBeenCalledWith([expect.objectContaining({ id: 'a', lastGenerated: '2024-05-05' })]);
  });

  it('로그아웃 직후 첫 렌더에서는 Drive 규칙이 남아 있으므로 ready 가 false, 이후 게스트 규칙으로 ready', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, rules: [R('guestRule')] }));
    loadRecurring.mockResolvedValue([R('drv')]);
    const renders = [];
    const { rerender } = renderHook(({ auth }) => {
      const r = useRecurring(auth);
      renders.push({ auth, ready: r.ready, ids: r.rules.map((x) => x.id), source: r.rulesSource });
      return r;
    }, { initialProps: { auth: 'idle' } });
    rerender({ auth: 'signed-in' });
    await flush();
    expect(renders.at(-1)).toMatchObject({ auth: 'signed-in', ready: true, source: 'drive' });
    renders.length = 0;
    rerender({ auth: 'idle' });
    await flush();
    // 로그아웃 커밋: 규칙이 아직 Drive 규칙이면 ready 가 true 인 렌더가 없어야 한다
    const staleReady = renders.filter((x) => x.auth === 'idle' && x.ready && x.ids.includes('drv'));
    expect(staleReady).toEqual([]);
    expect(renders.at(-1)).toMatchObject({ auth: 'idle', ready: true, source: 'guest' });
  });
});
