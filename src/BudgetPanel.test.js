import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import BudgetPanel from './BudgetPanel';

const MONTH = '2026-10';
const tx = (id, category, amount, date = '2026-10-10') => ({
  id, date, type: 'expense', category, description: `내역${id}`, amount,
});
const budgets = (total, categories = {}) => ({ version: 1, total, categories });

const makeApi = (over = {}) => ({
  budgets: budgets(null),
  setBudgets: jest.fn(),
  loading: false,
  loadFailed: false,
  loadError: null,
  syncState: 'idle',
  retry: jest.fn(),
  retrySave: jest.fn(),
  overwriteDrive: jest.fn().mockResolvedValue(true),
  ...over,
});

const setup = ({ transactions = [], authState = 'idle', ...api } = {}) => {
  const budgetApi = makeApi(api);
  const utils = render(
    <BudgetPanel transactions={transactions} month={MONTH} authState={authState} budgetApi={budgetApi} />
  );
  return { budgetApi, ...utils };
};

const openForm = () => fireEvent.click(screen.getByRole('button', { name: '예산 설정' }));
const input = (label) => screen.getByLabelText(label);
const statusText = () => document.querySelector('.budget-status').textContent;

test('예산이 없으면 빈 상태 문구를 보여 준다', () => {
  setup();
  expect(screen.getByText('설정된 예산이 없습니다. 예산 설정에서 카테고리별 월 예산을 정해 보세요.')).toBeInTheDocument();
  expect(screen.queryByRole('meter')).not.toBeInTheDocument();
});

test('정상 상태: 채움 폭, aria 값, 문구', () => {
  setup({ transactions: [tx(1, '식비', 50000)], budgets: budgets(null, { 식비: 100000 }) });
  const meter = screen.getByRole('meter');
  expect(meter).toHaveAttribute('aria-valuemin', '0');
  expect(meter).toHaveAttribute('aria-valuemax', '100000');
  expect(meter).toHaveAttribute('aria-valuenow', '50000');
  expect(meter).toHaveAttribute('aria-label', '식비 예산, 사용 50,000원 / 예산 100,000원, 50%');
  expect(meter.firstChild).toHaveStyle({ width: '50%' });
  expect(statusText()).toBe('50% 사용 · 남은 50,000원');
  expect(screen.getByText('50,000원 / 100,000원')).toBeInTheDocument();
});

test('주의 상태: 소수 1자리 퍼센트와 아이콘 + 문구', () => {
  setup({ transactions: [tx(1, '식비', 87500)], budgets: budgets(null, { 식비: 100000 }) });
  const meter = screen.getByRole('meter');
  expect(meter).toHaveAttribute('aria-label', '식비 예산, 사용 87,500원 / 예산 100,000원, 87.5%');
  expect(meter.firstChild).toHaveStyle({ width: '87.5%' });
  expect(statusText()).toBe('⚠ 주의 · 87.5% 사용 · 남은 12,500원');
});

test('ok 상태의 소수 퍼센트와 정확히 80% 경계', () => {
  const { unmount } = setup({ transactions: [tx(1, '식비', 79900)], budgets: budgets(null, { 식비: 100000 }) });
  expect(statusText()).toBe('79.9% 사용 · 남은 20,100원');
  unmount();
  setup({ transactions: [tx(1, '식비', 80000)], budgets: budgets(null, { 식비: 100000 }) });
  expect(statusText()).toBe('⚠ 주의 · 80% 사용 · 남은 20,000원');
});

test('정확히 100% 는 주의 상태이고 100% 로 표시한다', () => {
  setup({ transactions: [tx(1, '식비', 100000)], budgets: budgets(null, { 식비: 100000 }) });
  expect(screen.getByRole('meter')).toHaveAttribute('aria-label', expect.stringContaining(', 100%'));
  expect(statusText()).toBe('⚠ 주의 · 100% 사용 · 남은 0원');
});

test('초과 상태: 실제 값 유지, 채움 100% 상한, 아이콘 + 문구', () => {
  setup({ transactions: [tx(1, '식비', 112000)], budgets: budgets(null, { 식비: 100000 }) });
  const meter = screen.getByRole('meter');
  expect(meter).toHaveAttribute('aria-valuenow', '112000');
  expect(meter.firstChild).toHaveStyle({ width: '100%' });
  expect(statusText()).toBe('⛔ 초과 · 12,000원 더 사용');
});

test('사용액이 0 이면 채움 폭 0', () => {
  setup({ budgets: budgets(null, { 교통: 30000 }) });
  expect(screen.getByRole('meter').firstChild).toHaveStyle({ width: '0%' });
  expect(statusText()).toBe('0% 사용 · 남은 30,000원');
});

test('전체 예산 행이 맨 위, 카테고리는 지출 카테고리 순서, 다른 달 거래는 제외', () => {
  setup({
    transactions: [tx(1, '식비', 1000), tx(2, '교통', 2000), tx(3, '식비', 99999, '2026-09-30')],
    budgets: budgets(10000, { 교통: 5000, 식비: 4000 }),
  });
  const meters = screen.getAllByRole('meter');
  expect(meters.map((m) => m.getAttribute('aria-label').split(' 예산')[0])).toEqual(['전체', '식비', '교통']);
  expect(meters[0]).toHaveAttribute('aria-valuenow', '3000');
  expect(meters[1]).toHaveAttribute('aria-valuenow', '1000');
});

test('예산 설정 폼: 값 입력 후 저장하면 setBudgets 에 정확한 인자(미설정 키 제외)', () => {
  const { budgetApi } = setup();
  openForm();
  fireEvent.change(input('전체 월 예산'), { target: { value: '500000' } });
  fireEvent.change(input('식비'), { target: { value: '100000' } });
  fireEvent.change(input('교통'), { target: { value: '30000' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(budgetApi.setBudgets).toHaveBeenCalledTimes(1);
  expect(budgetApi.setBudgets).toHaveBeenCalledWith({
    version: 1, total: 500000, categories: { 식비: 100000, 교통: 30000 },
  });
  expect(screen.queryByLabelText('전체 월 예산')).not.toBeInTheDocument();
});

test('모두 비우고 저장하면 total null, 빈 categories', () => {
  const { budgetApi } = setup({ budgets: budgets(1000, { 식비: 500 }) });
  openForm();
  fireEvent.change(input('전체 월 예산'), { target: { value: '' } });
  fireEvent.change(input('식비'), { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(budgetApi.setBudgets).toHaveBeenCalledWith({ version: 1, total: null, categories: {} });
});

test.each(['0', '-1', '1.5', '9007199254740993'])('잘못된 값 %s 는 저장을 막고 오류를 표시한다', (value) => {
  const { budgetApi } = setup();
  openForm();
  fireEvent.change(input('식비'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
  expect(budgetApi.setBudgets).not.toHaveBeenCalled();
  const msg = screen.getByText('1 이상의 정수를 입력해 주세요.');
  const field = input('식비');
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(field.getAttribute('aria-describedby')).toBe(msg.id);
  expect(input('전체 월 예산')).not.toHaveAttribute('aria-invalid');
});

test('폼을 열 때 현재 값으로 초기화한다', () => {
  setup({ budgets: budgets(300000, { 식비: 100000 }) });
  openForm();
  expect(input('전체 월 예산')).toHaveValue(300000);
  expect(input('식비')).toHaveValue(100000);
  expect(input('교통')).toHaveValue(null);
});

test('폼이 열려 있는 동안 budgets 가 바뀌어도 입력값을 유지한다', () => {
  const api = makeApi({ budgets: budgets(null, { 식비: 100000 }) });
  const props = { transactions: [], month: MONTH, authState: 'idle' };
  const { rerender } = render(<BudgetPanel {...props} budgetApi={api} />);
  openForm();
  fireEvent.change(input('식비'), { target: { value: '777' } });
  rerender(<BudgetPanel {...props} budgetApi={{ ...api, budgets: budgets(5000, { 식비: 1, 교통: 2 }) }} />);
  expect(input('식비')).toHaveValue(777);
  expect(input('전체 월 예산')).toHaveValue(null);
  expect(input('교통')).toHaveValue(null);
});

test('취소하면 입력을 버리고 접으며 다시 열면 현재 값으로 돌아간다', () => {
  const { budgetApi } = setup({ budgets: budgets(null, { 식비: 100000 }) });
  openForm();
  fireEvent.change(input('식비'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: '취소' }));
  expect(screen.queryByLabelText('식비')).not.toBeInTheDocument();
  expect(budgetApi.setBudgets).not.toHaveBeenCalled();
  openForm();
  expect(input('식비')).toHaveValue(100000);
});

test('loading 이면 예산 설정 버튼이 비활성이고 불러오는 중 문구', () => {
  setup({ loading: true, authState: 'loading' });
  expect(screen.getByRole('button', { name: '예산 설정' })).toBeDisabled();
  expect(screen.getByText('예산을 불러오는 중…')).toBeInTheDocument();
});

describe('동기화 상태 문구', () => {
  test('비로그인: 이 기기에만 저장됨', () => {
    setup({ authState: 'idle' });
    expect(screen.getByText('이 기기에만 저장됨')).toBeInTheDocument();
  });

  test('로그인: saving / saved', () => {
    const { unmount } = setup({ authState: 'signed-in', syncState: 'saving' });
    expect(screen.getByText('저장 중…')).toBeInTheDocument();
    unmount();
    setup({ authState: 'signed-in', syncState: 'saved' });
    expect(screen.getByText('✓ 저장됨')).toBeInTheDocument();
  });

  test('저장 실패: 다시 시도가 retrySave 를 호출', () => {
    const { budgetApi } = setup({ authState: 'signed-in', syncState: 'error' });
    expect(screen.getByText('⚠ 저장 실패')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
    expect(budgetApi.retrySave).toHaveBeenCalledTimes(1);
  });
});

test('불러오기 실패(network): 다시 불러오기만 있고 덮어쓰기 버튼은 없다', () => {
  const { budgetApi } = setup({ authState: 'signed-in', loadFailed: true, loadError: 'network', syncState: 'error' });
  expect(screen.getByText('⚠ Drive 예산을 불러오지 못했습니다. 변경은 이 기기에만 임시 저장됩니다.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
  expect(budgetApi.retry).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('button', { name: '예산 파일 덮어쓰기' })).not.toBeInTheDocument();
  expect(screen.queryByText(/덮어/)).not.toBeInTheDocument();
});

describe('불러오기 실패(corrupt)', () => {
  const corrupt = (over = {}) =>
    setup({ authState: 'signed-in', loadFailed: true, loadError: 'corrupt', syncState: 'error', ...over });
  let confirmSpy;
  beforeEach(() => {
    confirmSpy = jest.spyOn(window, 'confirm');
  });
  afterEach(() => confirmSpy.mockRestore());

  test('안내 문구', () => {
    corrupt();
    expect(screen.getByText('⚠ Drive의 예산 파일이 손상되어 읽을 수 없습니다.')).toBeInTheDocument();
    expect(screen.getByText('덮어쓰면 현재 화면의 예산으로 Drive 예산 파일이 교체됩니다.')).toBeInTheDocument();
  });

  test('confirm 취소 시 overwriteDrive 를 호출하지 않는다', () => {
    confirmSpy.mockReturnValue(false);
    const { budgetApi } = corrupt();
    fireEvent.click(screen.getByRole('button', { name: '예산 파일 덮어쓰기' }));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(budgetApi.overwriteDrive).not.toHaveBeenCalled();
  });

  test('confirm 확인 시 overwriteDrive 호출, 성공하면 안내 없음', async () => {
    confirmSpy.mockReturnValue(true);
    const { budgetApi } = corrupt();
    fireEvent.click(screen.getByRole('button', { name: '예산 파일 덮어쓰기' }));
    await waitFor(() => expect(budgetApi.overwriteDrive).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/지금은 덮어쓸 수 없습니다/)).not.toBeInTheDocument();
  });

  test('false 반환 시 안내 문구', async () => {
    confirmSpy.mockReturnValue(true);
    corrupt({ overwriteDrive: jest.fn().mockResolvedValue(false) });
    fireEvent.click(screen.getByRole('button', { name: '예산 파일 덮어쓰기' }));
    expect(await screen.findByText('지금은 덮어쓸 수 없습니다. 저장이 끝난 뒤 다시 시도해 주세요.')).toBeInTheDocument();
  });

  test('saving 중에는 덮어쓰기 버튼이 비활성', () => {
    corrupt({ syncState: 'saving' });
    expect(screen.getByRole('button', { name: '예산 파일 덮어쓰기' })).toBeDisabled();
  });
});

test('budgetApi 가 없으면 아무것도 렌더하지 않는다', () => {
  const { container } = render(<BudgetPanel transactions={[]} month={MONTH} authState="idle" />);
  expect(container).toBeEmptyDOMElement();
});
