import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import App from './App';
import { GUEST_KEY } from './guestStorage';
import { today } from './utils';
import * as drive from './googleDrive';

jest.mock('./googleDrive');

let signedIn;

const tx = (id, description, amount = 1000) => ({
  id,
  date: today(),
  type: 'expense',
  category: '식비',
  description,
  amount,
});

const readGuest = () => JSON.parse(localStorage.getItem(GUEST_KEY));

// 거래 추가 폼 입력
const addTransaction = (description, amount) => {
  fireEvent.click(screen.getByText('+ 거래 추가'));
  fireEvent.change(screen.getByPlaceholderText('거래 내용을 입력하세요'), { target: { value: description } });
  fireEvent.change(screen.getByPlaceholderText('금액 (원)'), { target: { value: String(amount) } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
};

const WAIT = { timeout: 3000 };

beforeEach(() => {
  localStorage.clear();
  jest.resetAllMocks();
  signedIn = false;
  drive.isSignedIn.mockImplementation(() => signedIn);
  drive.initAuth.mockResolvedValue(false);
  drive.signOut.mockImplementation(() => {
    signedIn = false;
  });
});

// 세션 복원으로 로그인된 상태로 시작
const startSignedIn = () => {
  signedIn = true;
  drive.initAuth.mockResolvedValue(true);
};

test('(i) 비로그인 거래 추가 후 리마운트해도 유지된다', async () => {
  const { unmount } = render(<App />);
  expect(await screen.findByText('이 기기에만 저장됨')).toBeInTheDocument();

  addTransaction('점심', 9000);
  expect(await screen.findByText('점심')).toBeInTheDocument();
  unmount();

  render(<App />);
  expect(await screen.findByText('점심')).toBeInTheDocument();
});

test('(ii) 게스트+Drive 병합 저장 후에만 localStorage가 비워진다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([tx(2, '게스트항목')]));
  startSignedIn();
  drive.loadTransactions.mockResolvedValue([tx(1, 'Drive항목')]);
  let resolveSave;
  drive.saveTransactions.mockImplementation(() => new Promise((res) => { resolveSave = res; }));

  render(<App />);

  await waitFor(() => expect(drive.saveTransactions).toHaveBeenCalled(), WAIT);
  const saved = drive.saveTransactions.mock.calls[0][0];
  expect(saved.map((t) => t.id).sort()).toEqual([1, 2]);
  // 저장이 끝나기 전에는 게스트 저장소 유지
  expect(localStorage.getItem(GUEST_KEY)).not.toBeNull();

  resolveSave();
  await waitFor(() => expect(localStorage.getItem(GUEST_KEY)).toBeNull(), WAIT);
});

test('(iii) Drive 저장 실패 시 localStorage가 유지된다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([tx(2, '게스트항목')]));
  startSignedIn();
  drive.loadTransactions.mockResolvedValue([tx(1, 'Drive항목')]);
  drive.saveTransactions.mockRejectedValue(new Error('save fail'));

  render(<App />);

  expect(await screen.findByText('⚠ 저장 실패', {}, WAIT)).toBeInTheDocument();
  expect(readGuest().map((t) => t.id)).toEqual([2]);
});

test('(vi) 이전 세션의 늦은 저장 성공이 새 세션의 게스트 저장소를 비우지 않는다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([tx(2, '게스트항목')]));
  startSignedIn();
  drive.signIn.mockImplementation(async () => {
    signedIn = true;
  });
  drive.loadTransactions.mockResolvedValue([tx(1, 'Drive항목')]);
  const saves = [];
  drive.saveTransactions.mockImplementation(
    () => new Promise((resolve, reject) => saves.push({ resolve, reject }))
  );

  render(<App />);

  // 저장 #1 시작 (pending)
  await waitFor(() => expect(saves).toHaveLength(1), WAIT);

  // 로그아웃 -> 재로그인 (새 불러오기/병합)
  fireEvent.click(screen.getByText('로그아웃'));
  fireEvent.click(await screen.findByText('Google Drive 연결'));

  // 저장 #2 시작
  await waitFor(() => expect(saves).toHaveLength(2), WAIT);

  // 저장 #1 이 뒤늦게 성공해도 게스트 저장소는 유지
  await act(async () => {
    saves[0].resolve();
  });
  expect(localStorage.getItem(GUEST_KEY)).not.toBeNull();

  // 저장 #2 실패 후에도 유지
  await act(async () => {
    saves[1].reject(new Error('save fail'));
  });
  expect(await screen.findByText('⚠ 저장 실패')).toBeInTheDocument();
  expect(readGuest().map((t) => t.id)).toEqual([2]);
});

test('(vii) 새 세션의 저장 #2 가 성공하면 게스트 저장소가 비워진다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([tx(2, '게스트항목')]));
  startSignedIn();
  drive.signIn.mockImplementation(async () => {
    signedIn = true;
  });
  drive.loadTransactions.mockResolvedValue([tx(1, 'Drive항목')]);
  const saves = [];
  drive.saveTransactions.mockImplementation(
    () => new Promise((resolve, reject) => saves.push({ resolve, reject }))
  );

  render(<App />);
  await waitFor(() => expect(saves).toHaveLength(1), WAIT);

  fireEvent.click(screen.getByText('로그아웃'));
  fireEvent.click(await screen.findByText('Google Drive 연결'));
  await waitFor(() => expect(saves).toHaveLength(2), WAIT);

  await act(async () => {
    saves[0].resolve();
  });
  expect(localStorage.getItem(GUEST_KEY)).not.toBeNull();

  await act(async () => {
    saves[1].resolve();
  });
  await waitFor(() => expect(localStorage.getItem(GUEST_KEY)).toBeNull(), WAIT);
});

test('(iv) 로드 실패 시 localStorage 유지, 저장 미호출, 실패 중 추가한 거래는 게스트 저장소에 저장된다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([tx(2, '게스트항목')]));
  startSignedIn();
  drive.loadTransactions.mockRejectedValue(new Error('load fail'));

  render(<App />);

  expect(await screen.findByText('⚠ 불러오기 실패')).toBeInTheDocument();
  expect(readGuest().map((t) => t.id)).toEqual([2]);

  addTransaction('실패중추가', 5000);
  await screen.findByText('실패중추가');
  await waitFor(() => expect(readGuest()).toHaveLength(2));
  expect(readGuest().some((t) => t.description === '실패중추가')).toBe(true);

  // 자동 저장 디바운스(800ms)보다 길게 기다려도 Drive 저장은 호출되지 않는다
  await new Promise((r) => setTimeout(r, 1200));
  expect(drive.saveTransactions).not.toHaveBeenCalled();
});

test('(v) 로그아웃 후 Drive 데이터가 localStorage에 남지 않는다', async () => {
  startSignedIn();
  drive.loadTransactions.mockResolvedValue([tx(1, 'Drive전용')]);
  drive.saveTransactions.mockResolvedValue();

  render(<App />);
  expect(await screen.findByText('Drive전용')).toBeInTheDocument();

  fireEvent.click(screen.getByText('로그아웃'));

  await waitFor(() => expect(screen.queryByText('Drive전용')).not.toBeInTheDocument());
  expect(await screen.findByText('이 기기에만 저장됨')).toBeInTheDocument();
  const raw = localStorage.getItem(GUEST_KEY);
  expect(raw === null || !raw.includes('Drive전용')).toBe(true);
});

test('(viii) 비로그인 거래 수정이 같은 id 로 localStorage 에 반영된다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([tx(7, '점심', 9000)]));
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: '수정: 점심' }));
  fireEvent.change(screen.getByPlaceholderText('거래 내용을 입력하세요'), { target: { value: '저녁' } });
  fireEvent.change(screen.getByPlaceholderText('금액 (원)'), { target: { value: '12000' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));

  expect(await screen.findByText('저녁')).toBeInTheDocument();
  await waitFor(() => expect(readGuest()).toHaveLength(1));
  expect(readGuest()[0]).toMatchObject({ id: 7, description: '저녁', amount: 12000 });
});

test('(ix) 삭제 후 실행 취소하면 localStorage 에서 복원된다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([tx(7, '점심', 9000)]));
  render(<App />);

  fireEvent.click(await screen.findByRole('button', { name: '삭제: 점심' }));
  await waitFor(() => expect(readGuest()).toEqual([]));

  fireEvent.click(screen.getByRole('button', { name: '실행 취소' }));
  expect(await screen.findByText('점심')).toBeInTheDocument();
  await waitFor(() => expect(readGuest()).toHaveLength(1));
  expect(readGuest()[0]).toMatchObject({ id: 7, description: '점심', amount: 9000 });
});

// ---- 목록/달력 월 공유 ----
const monthTx = (id, date, description) => ({
  id, date, type: 'expense', category: '식비', description, amount: 1000,
});

const setMonth = (value) => {
  fireEvent.change(document.querySelector('.month-picker'), { target: { value } });
};

// 날짜를 지정해 거래 추가
const addTransactionOn = (date, description, amount) => {
  fireEvent.click(screen.getByText('+ 거래 추가'));
  fireEvent.change(document.querySelector('input[name="date"]'), { target: { value: date } });
  fireEvent.change(screen.getByPlaceholderText('거래 내용을 입력하세요'), { target: { value: description } });
  fireEvent.change(screen.getByPlaceholderText('금액 (원)'), { target: { value: String(amount) } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));
};

test('(x) 목록에서 바꾼 월이 달력 탭에서도 유지된다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([monthTx(1, '2026-03-10', '삼월')]));
  render(<App />);
  setMonth('2026-03');
  fireEvent.click(screen.getByRole('button', { name: '달력' }));
  expect(screen.getByText('2026년 3월')).toBeInTheDocument();
  await screen.findByText('이 기기에만 저장됨');
});

test('(xi) 달력에서 이전 달로 이동하면 목록 month-picker 도 같은 월이다', async () => {
  render(<App />);
  setMonth('2026-03');
  fireEvent.click(screen.getByRole('button', { name: '달력' }));
  fireEvent.click(screen.getByText('‹'));
  expect(screen.getByText('2026년 2월')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '목록' }));
  expect(document.querySelector('.month-picker').value).toBe('2026-02');
  await screen.findByText('이 기기에만 저장됨');
});

test('(xii) 다른 달 날짜로 거래를 추가하면 그 달로 이동한다', async () => {
  render(<App />);
  setMonth('2026-03');
  addTransactionOn('2026-05-20', '오월거래', 4000);

  expect(await screen.findByText('오월거래')).toBeInTheDocument();
  expect(document.querySelector('.month-picker').value).toBe('2026-05');
});

test('(xiii) 같은 달 날짜로 추가하면 월이 바뀌지 않는다', async () => {
  render(<App />);
  setMonth('2026-03');
  addTransactionOn('2026-03-02', '삼월거래', 4000);

  expect(await screen.findByText('삼월거래')).toBeInTheDocument();
  expect(document.querySelector('.month-picker').value).toBe('2026-03');
});

test('(xiv) 거래를 다른 달 날짜로 수정하면 그 달로 이동한다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([monthTx(1, '2026-03-10', '삼월')]));
  render(<App />);
  setMonth('2026-03');
  fireEvent.click(screen.getByRole('button', { name: '수정: 삼월' }));
  fireEvent.change(document.querySelector('input[name="date"]'), { target: { value: '2026-07-01' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));

  expect(await screen.findByText('삼월')).toBeInTheDocument();
  expect(document.querySelector('.month-picker').value).toBe('2026-07');
});

test('(xvi) 목록에서 정한 월이 통계 탭에 반영되고 통계에서 이동하면 목록도 같은 월이다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([monthTx(1, '2026-03-10', '삼월')]));
  render(<App />);
  setMonth('2026-03');
  fireEvent.click(screen.getByRole('button', { name: '통계' }));
  expect(screen.getByText('2026년 3월')).toBeInTheDocument();
  expect(screen.getByText('식비')).toBeInTheDocument();

  fireEvent.click(screen.getByText('‹'));
  expect(screen.getByText('2026년 2월')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '목록' }));
  expect(document.querySelector('.month-picker').value).toBe('2026-02');
  await screen.findByText('이 기기에만 저장됨');
});

test('(xv) month-picker 를 비워도 목록과 달력이 직전 월을 유지한다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([monthTx(1, '2026-03-10', '삼월'), monthTx(2, '2026-04-10', '사월')]));
  render(<App />);
  setMonth('2026-03');
  expect(screen.getByText('삼월')).toBeInTheDocument();

  setMonth('');
  expect(document.querySelector('.month-picker').value).toBe('2026-03');
  expect(screen.getByText('삼월')).toBeInTheDocument();
  expect(screen.queryByText('사월')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '달력' }));
  expect(screen.getByText('2026년 3월')).toBeInTheDocument();
  await screen.findByText('이 기기에만 저장됨');
});

describe('월 예산 통합', () => {
  const BUDGET_KEY = 'guest_budgets';
  const seedBudget = (total, categories) =>
    localStorage.setItem(BUDGET_KEY, JSON.stringify({ version: 1, total, categories }));

  test('목록 탭 예산 알림이 선택 월 기준으로 표시된다', async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify([
      { ...monthTx(1, '2026-03-10', '삼월 식사'), amount: 112000 },
      { ...monthTx(2, '2026-04-10', '사월 식사'), amount: 1000 },
    ]));
    seedBudget(null, { 식비: 100000 });
    render(<App />);
    setMonth('2026-03');
    expect(await screen.findByLabelText('예산 알림')).toHaveTextContent('⛔ 식비 예산 초과 · 12,000원 더 사용');

    setMonth('2026-04');
    expect(screen.queryByLabelText('예산 알림')).not.toBeInTheDocument();
    await screen.findByText('이 기기에만 저장됨');
  });

  test('통계 탭 월 예산 패널에 meter 가 표시된다', async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify([{ ...monthTx(1, '2026-03-10', '식사'), amount: 87500 }]));
    seedBudget(null, { 식비: 100000 });
    render(<App />);
    setMonth('2026-03');
    fireEvent.click(screen.getByRole('button', { name: '통계' }));
    expect(screen.getByRole('heading', { name: '월 예산' })).toBeInTheDocument();
    expect(screen.getByRole('meter')).toHaveAttribute(
      'aria-label',
      '식비 예산, 사용 87,500원 / 예산 100,000원, 87.5%'
    );
    await waitFor(() => expect(screen.getAllByText('이 기기에만 저장됨').length).toBeGreaterThan(0));
  });

  test('통계 탭에서 예산을 설정하면 localStorage 에 저장되고 목록 알림이 갱신된다', async () => {
    localStorage.setItem(GUEST_KEY, JSON.stringify([{ ...monthTx(1, '2026-03-10', '식사'), amount: 9000 }]));
    render(<App />);
    setMonth('2026-03');
    await screen.findByText('이 기기에만 저장됨'); // 인증 초기화(예산 loading) 종료 대기
    expect(screen.queryByLabelText('예산 알림')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '통계' }));
    fireEvent.click(screen.getByRole('button', { name: '예산 설정' }));
    fireEvent.change(screen.getByLabelText('식비'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(BUDGET_KEY))).toEqual({
        version: 1, total: null, categories: { 식비: 10000 },
      })
    );

    fireEvent.click(screen.getByRole('button', { name: '목록' }));
    expect(screen.getByLabelText('예산 알림')).toHaveTextContent('⚠ 식비 예산 주의 · 90% 사용');
  });
});
