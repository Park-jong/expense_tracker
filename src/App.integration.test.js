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

test('(xvii) CSV 가져오기: 헤더 없는 파일도 읽고, 내용이 같은 거래는 id가 달라도 제외하며 id 충돌은 새 id로 저장한다', async () => {
  localStorage.setItem(GUEST_KEY, JSON.stringify([tx(1, '점심', 8000)]));
  jest.spyOn(window, 'confirm').mockReturnValue(true);
  render(<App />);
  expect(await screen.findByText('점심')).toBeInTheDocument();

  const d = today();
  const text = `7,${d},expense,식비,점심,8000\n1,${d},expense,식비,저녁,9000\n`; // 헤더 없음
  fireEvent.change(screen.getByTestId('csv-file-input'), {
    target: { files: [new File([text], 'in.csv', { type: 'text/csv' })] },
  });

  expect(await screen.findByText('저녁')).toBeInTheDocument();
  await waitFor(() => {
    const saved = readGuest();
    expect(saved).toHaveLength(2);
    expect(new Set(saved.map((t) => t.id)).size).toBe(2);
    expect(saved.find((t) => t.description === '저녁').id).toBe(2);
  }, WAIT);
  window.confirm.mockRestore();
});

describe('반복 거래 자동 생성', () => {
  const RKEY = 'guest_recurring';
  const rec = (over = {}) => ({
    id: 'rec1',
    type: 'expense',
    category: '주거',
    description: '월세자동',
    amount: 12345,
    cycle: 'weekly',
    weekday: new Date().getDay(),
    startDate: today(),
    endDate: null,
    lastGenerated: null,
    ...over,
  });
  const seedRule = (r = rec()) => localStorage.setItem(RKEY, JSON.stringify({ version: 1, rules: [r] }));
  const readRules = () => JSON.parse(localStorage.getItem(RKEY)).rules;

  test('(a) 비로그인: 오늘 발생분이 목록에 생기고 lastGenerated 가 저장되며 다시 열어도 중복되지 않는다', async () => {
    seedRule();
    const { unmount } = render(<App />);
    expect(await screen.findByText('월세자동')).toBeInTheDocument();
    expect(screen.getByText(/반복 거래 1건을 자동으로 등록했습니다/)).toBeInTheDocument();
    await waitFor(() => expect(readRules()[0].lastGenerated).toBe(today()), WAIT);
    expect(readGuest()).toHaveLength(1);
    unmount();

    render(<App />);
    expect(await screen.findByText('월세자동')).toBeInTheDocument();
    expect(readGuest()).toHaveLength(1);
  });

  test('(b) 생성된 거래를 삭제해도 되살아나지 않는다', async () => {
    seedRule();
    const { unmount } = render(<App />);
    expect(await screen.findByText('월세자동')).toBeInTheDocument();
    await waitFor(() => expect(readRules()[0].lastGenerated).toBe(today()), WAIT);
    fireEvent.click(screen.getByRole('button', { name: '삭제: 월세자동' }));
    await waitFor(() => expect(readGuest()).toHaveLength(0), WAIT);
    unmount();

    render(<App />);
    expect(await screen.findByText('이 기기에만 저장됨', { selector: '.sync-status' })).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText('월세자동')).not.toBeInTheDocument();
    expect(readGuest()).toHaveLength(0);
  });

  test('(c) 같은 내용 거래가 이미 있으면 중복 생성하지 않는다', async () => {
    seedRule();
    localStorage.setItem(GUEST_KEY, JSON.stringify([{ ...tx(1, '월세자동', 12345), category: '주거' }]));
    render(<App />);
    expect(await screen.findByText('월세자동')).toBeInTheDocument();
    await waitFor(() => expect(readRules()[0].lastGenerated).toBe(today()), WAIT);
    expect(readGuest()).toHaveLength(1);
  });

  test('(e) 거래 불러오기가 실패하면 생성하지 않고 규칙도 저장하지 않는다', async () => {
    startSignedIn();
    drive.loadTransactions.mockRejectedValue(new Error('net'));
    drive.loadRecurring.mockResolvedValue([rec()]);
    render(<App />);
    expect(await screen.findByText('⚠ 불러오기 실패', {}, WAIT)).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByText('월세자동')).not.toBeInTheDocument();
    expect(drive.saveRecurring).not.toHaveBeenCalled();
    expect(drive.saveTransactions).not.toHaveBeenCalled();
  });

  test('(f) 규칙 불러오기가 실패하면 거래를 생성하지 않는다', async () => {
    startSignedIn();
    drive.loadTransactions.mockResolvedValue([tx(1, '기존')]);
    drive.loadRecurring.mockRejectedValue(new Error('net'));
    localStorage.setItem(RKEY, JSON.stringify({ version: 1, rules: [rec()] }));
    render(<App />);
    expect(await screen.findByText('기존', {}, WAIT)).toBeInTheDocument();
    // 거래 자동 저장이 끝날 때까지 기다린다(act 밖 상태 갱신 경고 방지)
    await waitFor(() => expect(drive.saveTransactions).toHaveBeenCalled(), WAIT);
    expect(await screen.findByText('✓ 저장됨', { selector: '.sync-status' }, WAIT)).toBeInTheDocument();
    expect(screen.queryByText('월세자동')).not.toBeInTheDocument();
    expect(drive.saveRecurring).not.toHaveBeenCalled();
  });

  test('(g) 로그아웃 직후 이전 세션의 Drive 규칙으로 게스트 거래를 만들지 않고, 게스트 규칙으로만 생성한다', async () => {
    startSignedIn();
    // 지금 시점에는 만들 거래가 없는(오늘 이미 생성됨) Drive 규칙
    drive.loadTransactions.mockResolvedValue([]);
    drive.loadRecurring.mockResolvedValue([rec({ id: 'drv', description: 'Drive규칙', lastGenerated: today() })]);
    drive.saveTransactions.mockResolvedValue(undefined);
    drive.saveRecurring.mockResolvedValue(undefined);
    render(<App />);
    expect(await screen.findByText('로그아웃', {}, WAIT)).toBeInTheDocument();
    await screen.findByText('✓ 저장됨', { selector: '.sync-status' }, WAIT);

    // 날짜만 7일 뒤로 이동(Drive 규칙에는 미생성 발생일이 생김) + 게스트 저장소에는 별도 규칙을 준비
    // 타이머는 건드리지 않고 Date 만 7일 뒤로 옮긴다(가짜 타이머는 이미 등록된 실제 타이머 정리 시 경고를 낸다)
    const RealDate = Date;
    const offset = 7 * 24 * 60 * 60 * 1000;
    global.Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(RealDate.now() + offset);
        else super(...args);
      }

      static now() {
        return RealDate.now() + offset;
      }
    };
    try {
      localStorage.setItem(RKEY, JSON.stringify({ version: 1, rules: [rec({ id: 'gst', description: '게스트규칙', lastGenerated: '2000-01-01' })] }));
      fireEvent.click(screen.getByText('로그아웃'));
      expect(await screen.findByText('게스트규칙', {}, WAIT)).toBeInTheDocument();
      await waitFor(() => expect(readGuest().map((t) => t.description)).toEqual(['게스트규칙']), WAIT);
      expect(screen.queryByText('Drive규칙')).not.toBeInTheDocument();
    } finally {
      global.Date = RealDate;
    }
  });

  // ---- 로그인 모드: 규칙(lastGenerated) 저장은 '생성 거래를 포함한 거래 저장이 성공한 뒤'에만 (fake timers) ----
  describe('규칙 저장 시점 (저장 성공 신호)', () => {
    const GEN = '월세자동';
    // 가짜 타이머를 50ms 씩 전진시킨다. React 의 effect(타이머 등록)는 act 가 끝나야 반영되므로 단계마다 act 를 따로 돈다
    // (구버전 jest 에는 advanceTimersByTimeAsync 가 없음)
    const advance = async (ms) => {
      for (let t = 0; t < ms; t += 50) {
        await act(async () => {
          jest.advanceTimersByTime(Math.min(50, ms - t));
          for (let i = 0; i < 10; i += 1) await Promise.resolve();
        });
      }
    };
    const hasGen = (arr) => arr.some((t) => t.description === GEN);

    // 거래 저장 mock: behavior(arr, n)가 거부 없이 끝나면 성공으로 기록한다. 규칙 저장 호출 시점에
    // '생성 거래를 포함한 저장이 이미 성공했는가'를 그때그때 기록해 둔다.
    const trackSaves = (behavior = () => undefined) => {
      const st = { txCalls: [], okSaves: [], ruleCalls: [] };
      drive.saveTransactions.mockImplementation(async (arr) => {
        const n = st.txCalls.push(arr) - 1;
        await behavior(arr, n);
        st.okSaves.push(arr);
      });
      drive.saveRecurring.mockImplementation(async (rules) => {
        st.ruleCalls.push({ rules, genSavedBefore: st.okSaves.some(hasGen) });
      });
      return st;
    };
    const expectRuleSavedAfterGenSave = (st, count = 1) => {
      expect(st.ruleCalls).toHaveLength(count);
      st.ruleCalls.forEach((c) => {
        expect(c.genSavedBefore).toBe(true);
        expect(c.rules[0].lastGenerated).toBe(today());
      });
    };
    const deferred = () => {
      const d = {};
      d.promise = new Promise((res, rej) => { d.resolve = res; d.reject = rej; });
      return d;
    };

    beforeEach(() => {
      jest.useFakeTimers('modern');
      startSignedIn();
      drive.loadTransactions.mockResolvedValue([tx(1, '기존')]);
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    test('(d) 로그인: 거래·규칙 불러오기에 성공하면 생성하고, 거래 저장 성공 뒤에 규칙을 저장한다', async () => {
      drive.loadRecurring.mockResolvedValue([rec()]);
      const st = trackSaves();
      render(<App />);
      await advance(2000);
      expect(screen.getByText(GEN)).toBeInTheDocument();
      expectRuleSavedAfterGenSave(st, 1);
      const saved = st.okSaves.at(-1);
      expect(saved.map((t) => t.description).sort()).toEqual(['기존', GEN]);
      expect(new Set(saved.map((t) => t.id)).size).toBe(2);
    });

    test('(h) 거래 저장이 실패하면 규칙 저장 없음, 이후 성공하면 규칙을 한 번 저장한다', async () => {
      drive.loadRecurring.mockResolvedValue([rec()]);
      let fail = true;
      const st = trackSaves(() => { if (fail) throw new Error('tx fail'); });
      render(<App />);
      await advance(2000);
      expect(screen.getByText(GEN)).toBeInTheDocument();
      expect(screen.getByText('⚠ 저장 실패')).toBeInTheDocument();
      expect(st.ruleCalls).toHaveLength(0);

      fail = false;
      addTransaction('추가거래', 1000);
      await advance(2000);
      expectRuleSavedAfterGenSave(st, 1);
      await advance(3000);
      expect(st.ruleCalls).toHaveLength(1);
    });

    test('(H3) 생성 거래 저장이 연속 2회 실패해도 규칙 저장 없음, 이후 성공하면 1회만 저장', async () => {
      drive.loadRecurring.mockResolvedValue([rec()]);
      let failures = 0;
      const st = trackSaves((arr) => { if (hasGen(arr) && failures < 2) { failures += 1; throw new Error('fail'); } });
      render(<App />);
      await advance(2000);
      expect(failures).toBe(1);
      expect(st.ruleCalls).toHaveLength(0);

      addTransaction('두번째', 1000);
      await advance(2000);
      expect(failures).toBe(2);
      expect(st.ruleCalls).toHaveLength(0);

      addTransaction('세번째', 1000);
      await advance(2000);
      expectRuleSavedAfterGenSave(st, 1);
      await advance(3000);
      expect(st.ruleCalls).toHaveLength(1);
    });

    test('(i) 거래 저장이 성공한 뒤에만 규칙이 저장되고 알림은 닫을 수 있다', async () => {
      drive.loadTransactions.mockResolvedValue([]);
      drive.loadRecurring.mockResolvedValue([rec()]);
      const first = deferred();
      const st = trackSaves(() => first.promise);
      render(<App />);
      await advance(2000);
      expect(st.txCalls).toHaveLength(1);
      expect(st.ruleCalls).toHaveLength(0);
      first.resolve();
      await advance(1500);
      expectRuleSavedAfterGenSave(st, 1);

      expect(screen.getByText(/반복 거래 1건을 자동으로 등록했습니다/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '알림 닫기' }));
      expect(screen.queryByText(/반복 거래 1건을 자동으로 등록했습니다/)).not.toBeInTheDocument();
    });

    test('(j) 첫 저장 전송 중 규칙 로드로 생성돼도, 그 저장의 성공으로는 규칙을 저장하지 않고 생성 거래 저장 성공 뒤에만 1회 저장한다', async () => {
      let resolveRules;
      drive.loadRecurring.mockImplementation(() => new Promise((r) => { resolveRules = r; }));
      const first = deferred();
      const second = deferred(); // 생성 거래 저장: 규칙 저장 디바운스(800ms)보다 오래 응답을 지연시켜 조기 규칙 저장을 드러낸다
      const st = trackSaves((arr, n) => (n === 0 ? first.promise : second.promise));
      render(<App />);
      await advance(1000);
      expect(st.txCalls).toHaveLength(1); // 첫 저장 전송 중
      await act(async () => { resolveRules([rec()]); });
      await advance(10);
      expect(screen.getByText(GEN)).toBeInTheDocument();
      first.resolve(); // 첫 저장 성공(생성 거래 미포함)
      await advance(100); // 생성 거래 저장(디바운스 800ms) 전
      expect(st.ruleCalls).toHaveLength(0);
      await advance(2000); // 생성 거래 저장은 전송 중(응답 전) -> 규칙 디바운스 시간이 지나도 규칙 저장 없음
      expect(st.txCalls).toHaveLength(2);
      expect(st.ruleCalls).toHaveLength(0);
      second.resolve();
      await advance(1500);
      expectRuleSavedAfterGenSave(st, 1);
      expect(st.txCalls).toHaveLength(2); // 재저장 유도 없이 생성 거래 저장 1회만 추가
      await advance(3000);
      expect(st.ruleCalls).toHaveLength(1);
      expect(st.txCalls).toHaveLength(2);
    });

    test('(H1) 첫 저장 전송 중 거래를 추가하고 700ms 이내에 규칙 로드로 생성돼도 생성 거래 저장 성공 뒤에만 규칙을 저장한다', async () => {
      let resolveRules;
      drive.loadRecurring.mockImplementation(() => new Promise((r) => { resolveRules = r; }));
      const first = deferred();
      const second = deferred();
      const st = trackSaves((arr, n) => (n === 0 ? first.promise : n === 1 ? second.promise : undefined));
      render(<App />);
      await advance(1000);
      expect(st.txCalls).toHaveLength(1);
      addTransaction('수동', 500);
      await advance(300);
      await act(async () => { resolveRules([rec()]); });
      await advance(10);
      expect(screen.getByText(GEN)).toBeInTheDocument();
      first.resolve();
      await advance(100);
      expect(st.ruleCalls).toHaveLength(0);
      await advance(2000); // 생성 포함 저장 전송 중(응답 전)에는 규칙 저장 없음
      expect(st.txCalls).toHaveLength(2);
      expect(hasGen(st.txCalls[1])).toBe(true);
      expect(st.ruleCalls).toHaveLength(0);
      second.resolve();
      await advance(1500);
      expectRuleSavedAfterGenSave(st, 1);
      expect(st.okSaves.some((a) => hasGen(a) && a.some((t) => t.description === '수동'))).toBe(true);
    });

    test('(H2) 전송 중 저장이 여럿일 때 오래된 저장이 먼저 성공해도 규칙은 생성 포함 저장 성공 뒤에만 저장된다', async () => {
      let resolveRules;
      drive.loadRecurring.mockImplementation(() => new Promise((r) => { resolveRules = r; }));
      const ds = [deferred(), deferred(), deferred()];
      const st = trackSaves((arr, n) => ds[n].promise);
      render(<App />);
      await advance(1000);
      expect(st.txCalls).toHaveLength(1); // S0 전송 중
      addTransaction('수동', 500);
      await advance(900);
      expect(st.txCalls).toHaveLength(2); // S1(사용자 편집) 전송 중
      await act(async () => { resolveRules([rec()]); });
      await advance(900);
      expect(st.txCalls).toHaveLength(3); // S2(생성 포함) 전송 중
      expect(hasGen(st.txCalls[2])).toBe(true);
      expect(hasGen(st.txCalls[1])).toBe(false);

      ds[0].resolve();
      await advance(100);
      ds[1].resolve();
      await advance(2000);
      expect(st.ruleCalls).toHaveLength(0); // 오래된 저장 성공만으로는 저장하지 않음
      ds[2].resolve();
      await advance(1500);
      expectRuleSavedAfterGenSave(st, 1);
    });

    test('(M1) 오래된 저장이 실패해도 생성 포함 저장이 성공하면 규칙이 저장된다', async () => {
      let resolveRules;
      drive.loadRecurring.mockImplementation(() => new Promise((r) => { resolveRules = r; }));
      const first = deferred();
      const st = trackSaves((arr, n) => (n === 0 ? first.promise : undefined));
      render(<App />);
      await advance(1000);
      expect(st.txCalls).toHaveLength(1);
      await act(async () => { resolveRules([rec()]); });
      await advance(10);
      first.reject(new Error('old fail'));
      await advance(2500);
      expect(screen.getByText(GEN)).toBeInTheDocument();
      expectRuleSavedAfterGenSave(st, 1);
    });

    test('(M1b) 생성 직후 사용자가 생성 거래를 삭제해도 다음 저장 성공 뒤 규칙이 저장된다', async () => {
      drive.loadRecurring.mockResolvedValue([rec()]);
      const st = trackSaves();
      render(<App />);
      await advance(10);
      fireEvent.click(screen.getByRole('button', { name: `삭제: ${GEN}` }));
      await advance(2500);
      expect(screen.queryByText(GEN)).not.toBeInTheDocument();
      expect(st.okSaves.some(hasGen)).toBe(false);
      expect(st.ruleCalls).toHaveLength(1);
      expect(st.ruleCalls[0].rules[0].lastGenerated).toBe(today());
    });

    test('(M2) 로그아웃하면 보류 중이던 규칙 저장은 폐기되고, 늦게 성공한 저장도 규칙을 저장하지 않는다', async () => {
      drive.loadRecurring.mockResolvedValue([rec()]);
      const first = deferred();
      const st = trackSaves(() => first.promise);
      render(<App />);
      await advance(2000);
      expect(st.txCalls).toHaveLength(1);
      expect(hasGen(st.txCalls[0])).toBe(true);
      fireEvent.click(screen.getByText('로그아웃'));
      await advance(10);
      first.resolve();
      await advance(3000);
      expect(st.ruleCalls).toHaveLength(0);
      expect(drive.saveRecurring).not.toHaveBeenCalled();
    });

    test('(M3) 로그아웃 후 재로그인해도 이전 세션의 보류분으로 규칙이 일찍 저장되지 않는다', async () => {
      drive.loadRecurring.mockResolvedValue([rec()]);
      drive.signIn.mockImplementation(async () => { signedIn = true; });
      const first = deferred();
      const st = trackSaves((arr, n) => (n === 0 ? first.promise : undefined));
      render(<App />);
      await advance(2000);
      expect(hasGen(st.txCalls[0])).toBe(true); // 이전 세션: 생성 포함 저장이 전송 중
      fireEvent.click(screen.getByText('로그아웃'));
      await advance(10);
      fireEvent.click(screen.getByText('Google Drive 연결'));
      await advance(3000);
      first.resolve();
      await advance(3000);
      // 새 세션에서 어떤 저장이 성공했더라도 규칙은 생성 거래를 포함한 저장 성공 뒤에만 저장된다
      expect(st.ruleCalls.length).toBeGreaterThan(0);
      st.ruleCalls.forEach((c) => expect(c.genSavedBefore).toBe(true));
    });

    test('(M4) 렌더와 effect 사이 사용자 추가가 먼저 반영돼도 생성 거래 저장 성공 뒤에만 규칙을 저장한다', async () => {
      let resolveRules;
      drive.loadRecurring.mockImplementation(() => new Promise((r) => { resolveRules = r; }));
      const st = trackSaves();
      render(<App />);
      await advance(2000);
      // 같은 act 안에서 규칙 로드와 사용자 추가를 함께 반영(생성 id 예측이 어긋나는 상황)
      fireEvent.click(screen.getByText('+ 거래 추가'));
      fireEvent.change(screen.getByPlaceholderText('거래 내용을 입력하세요'), { target: { value: '수동' } });
      fireEvent.change(screen.getByPlaceholderText('금액 (원)'), { target: { value: '500' } });
      await act(async () => {
        resolveRules([rec()]);
        fireEvent.click(screen.getByRole('button', { name: '저장' }));
      });
      await advance(3000);
      expect(screen.getByText(GEN)).toBeInTheDocument();
      expectRuleSavedAfterGenSave(st, 1);
    });

    test('(M5) 규칙 불러오기가 실패한 채 저장이 여러 번 성공해도 규칙은 저장되지 않는다', async () => {
      drive.loadRecurring.mockRejectedValue(new Error('net'));
      const st = trackSaves();
      render(<App />);
      await advance(2000);
      for (let i = 0; i < 8; i += 1) {
        addTransaction('추가' + i, 100 + i);
        await advance(1500);
      }
      expect(st.okSaves.length).toBeGreaterThanOrEqual(8);
      expect(st.ruleCalls).toHaveLength(0);
      expect(screen.queryByText(GEN)).not.toBeInTheDocument();
    });
  });
});
