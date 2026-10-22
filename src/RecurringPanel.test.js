import { render, screen, fireEvent, within } from '@testing-library/react';
import RecurringPanel from './RecurringPanel';

const R = (over = {}) => ({
  id: 'a',
  type: 'expense',
  category: '주거',
  description: '월세',
  amount: 500000,
  cycle: 'monthly',
  day: 5,
  startDate: '2024-01-01',
  endDate: null,
  lastGenerated: '2024-01-05',
  ...over,
});

const api = (over = {}) => ({
  rules: [],
  setRules: jest.fn(),
  loading: false,
  loadFailed: false,
  loadError: null,
  syncState: 'idle',
  retry: jest.fn(),
  retrySave: jest.fn(),
  overwriteDrive: jest.fn().mockResolvedValue(true),
  ...over,
});

const open = () => fireEvent.click(screen.getByRole('button', { name: '펼치기' }));
const applySetter = (fn, prev) => fn.mock.calls[0][0](prev);

afterEach(() => jest.restoreAllMocks());

test('recurringApi 가 없으면 아무것도 그리지 않는다', () => {
  const { container } = render(<RecurringPanel />);
  expect(container).toBeEmptyDOMElement();
});

test('접이식이며 규칙의 내용·금액·주기·다음 발생일을 보여준다', () => {
  render(<RecurringPanel recurringApi={api({ rules: [R()] })} authState="idle" />);
  expect(screen.queryByText('월세')).not.toBeInTheDocument();
  open();
  expect(screen.getByRole('button', { name: '접기' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText('월세')).toBeInTheDocument();
  expect(screen.getByText('-500,000원')).toBeInTheDocument();
  expect(screen.getByText(/매월 5일/)).toHaveTextContent(/다음 \d{4}-\d{2}-\d{2}/);
  expect(screen.getByText(/삭제해도 이미 생성된 거래는 삭제되지 않습니다/)).toBeInTheDocument();
});

test('규칙을 추가한다', () => {
  const a = api();
  render(<RecurringPanel recurringApi={a} authState="idle" />);
  open();
  fireEvent.click(screen.getByRole('button', { name: '+ 반복 규칙 추가' }));
  fireEvent.change(screen.getByLabelText('내용'), { target: { value: '넷플릭스' } });
  fireEvent.change(screen.getByLabelText('금액 (원)'), { target: { value: '17000' } });
  fireEvent.change(screen.getByLabelText('기준일 (일)'), { target: { value: '31' } });
  fireEvent.click(screen.getByRole('button', { name: '규칙 저장' }));
  const next = applySetter(a.setRules, []);
  expect(next).toHaveLength(1);
  expect(next[0]).toMatchObject({ description: '넷플릭스', amount: 17000, cycle: 'monthly', day: 31, lastGenerated: null, endDate: null });
  expect(typeof next[0].id).toBe('string');
});

test('주기를 매주로 바꾸면 요일을 고를 수 있다', () => {
  const a = api();
  render(<RecurringPanel recurringApi={a} authState="idle" />);
  open();
  fireEvent.click(screen.getByRole('button', { name: '+ 반복 규칙 추가' }));
  fireEvent.change(screen.getByLabelText('주기'), { target: { value: 'weekly' } });
  expect(screen.queryByLabelText('기준일 (일)')).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('요일'), { target: { value: '3' } });
  fireEvent.change(screen.getByLabelText('내용'), { target: { value: '운동' } });
  fireEvent.change(screen.getByLabelText('금액 (원)'), { target: { value: '1000' } });
  fireEvent.click(screen.getByRole('button', { name: '규칙 저장' }));
  expect(applySetter(a.setRules, [])[0]).toMatchObject({ cycle: 'weekly', weekday: 3 });
});

test('잘못된 입력은 role=alert 로 안내하고 저장하지 않는다', () => {
  const a = api();
  render(<RecurringPanel recurringApi={a} authState="idle" />);
  open();
  fireEvent.click(screen.getByRole('button', { name: '+ 반복 규칙 추가' }));
  fireEvent.change(screen.getByLabelText('금액 (원)'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('기준일 (일)'), { target: { value: '40' } });
  fireEvent.change(screen.getByLabelText('종료일 (선택)'), { target: { value: '2000-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: '규칙 저장' }));
  const alert = screen.getByRole('alert');
  expect(within(alert).getByText('내용을 입력해 주세요.')).toBeInTheDocument();
  expect(within(alert).getByText('금액은 1 이상의 정수로 입력해 주세요.')).toBeInTheDocument();
  expect(within(alert).getByText('기준일은 1~31 사이의 숫자로 입력해 주세요.')).toBeInTheDocument();
  expect(within(alert).getByText('종료일은 시작일보다 빠를 수 없습니다.')).toBeInTheDocument();
  expect(a.setRules).not.toHaveBeenCalled();
});

test('수정은 id 와 lastGenerated 를 유지한다', () => {
  const a = api({ rules: [R()] });
  render(<RecurringPanel recurringApi={a} authState="idle" />);
  open();
  fireEvent.click(screen.getByRole('button', { name: '반복 규칙 수정: 월세' }));
  fireEvent.change(screen.getByLabelText('금액 (원)'), { target: { value: '600000' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  expect(applySetter(a.setRules, [R()])).toEqual([R({ amount: 600000 })]);
});

test('삭제는 확인창 승인 후에만 하고 거래 보존 안내를 포함한다', () => {
  const a = api({ rules: [R()] });
  const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(<RecurringPanel recurringApi={a} authState="idle" />);
  open();
  fireEvent.click(screen.getByRole('button', { name: '반복 규칙 삭제: 월세' }));
  expect(a.setRules).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '반복 규칙 삭제: 월세' }));
  expect(confirm.mock.calls[1][0]).toMatch(/이미 생성된 거래는 삭제되지 않습니다/);
  expect(applySetter(a.setRules, [R()])).toEqual([]);
});

test('불러오기 실패 시 안내와 다시 불러오기 버튼', () => {
  const a = api({ loadFailed: true, loadError: 'network', syncState: 'error' });
  render(<RecurringPanel recurringApi={a} authState="signed-in" />);
  expect(screen.getByText(/반복 거래 규칙을 불러오지 못했습니다/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
  expect(a.retry).toHaveBeenCalled();
});

test('손상된 파일은 확인창을 거쳐야 덮어쓴다', () => {
  const a = api({ loadFailed: true, loadError: 'corrupt', syncState: 'error' });
  const confirm = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  render(<RecurringPanel recurringApi={a} authState="signed-in" />);
  const btn = screen.getByRole('button', { name: '반복 거래 파일 덮어쓰기' });
  fireEvent.click(btn);
  expect(a.overwriteDrive).not.toHaveBeenCalled();
  fireEvent.click(btn);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(a.overwriteDrive).toHaveBeenCalledTimes(1);
});

test('저장 실패 시 다시 시도, 자동 등록 알림 표시', () => {
  const a = api({ syncState: 'error' });
  render(<RecurringPanel recurringApi={a} authState="signed-in" notice="반복 거래 2건을 자동으로 등록했습니다." />);
  expect(screen.getByRole('status')).toHaveTextContent('2건을 자동으로 등록');
  open();
  fireEvent.click(screen.getByRole('button', { name: '다시 시도' }));
  expect(a.retrySave).toHaveBeenCalled();
});

test('알림 닫기 버튼이 onDismissNotice 를 호출하고, 종료일 없는 규칙의 다음 날짜가 없으면 종료됨 대신 - 로 표시', () => {
  const onDismiss = jest.fn();
  const rule = R({ startDate: '2999-12-31', lastGenerated: '2999-12-31' });
  render(<RecurringPanel recurringApi={api({ rules: [rule] })} authState="idle" notice="알림" onDismissNotice={onDismiss} />);
  fireEvent.click(screen.getByRole('button', { name: '알림 닫기' }));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  open();
  expect(screen.queryByText(/종료됨/)).not.toBeInTheDocument();
  expect(screen.getByText(/다음 -/)).toBeInTheDocument();
});
