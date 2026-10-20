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
