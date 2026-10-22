import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ListPage from './ListPage';
import { today } from './utils';

const sample = {
  id: 11,
  date: today(),
  type: 'expense',
  category: '교통',
  description: '점심 식사',
  amount: 8000,
};

const setup = (props = {}) => {
  const handlers = { onAdd: jest.fn(), onEdit: jest.fn(), onDelete: jest.fn(), onRestore: jest.fn() };
  render(
    <ListPage
      transactions={[sample]}
      filterMonth={today().slice(0, 7)}
      onFilterMonthChange={() => {}}
      {...handlers}
      {...props}
    />
  );
  return handlers;
};

afterEach(() => {
  jest.useRealTimers();
});

test('(a) 수정을 누르면 폼이 기존 값으로 채워진다', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: '수정: 점심 식사' }));

  expect(screen.getByPlaceholderText('거래 내용을 입력하세요')).toHaveValue('점심 식사');
  expect(screen.getByPlaceholderText('금액 (원)')).toHaveValue(8000);
  expect(screen.getByDisplayValue('교통')).toBeInTheDocument(); // 기존 카테고리 유지
  expect(screen.getByDisplayValue(sample.date)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '수정 저장' })).toBeInTheDocument();
});

test('(b) 수정 저장 시 onEdit 가 같은 id 와 변경된 값으로 호출된다', () => {
  const { onEdit, onAdd } = setup();
  fireEvent.click(screen.getByRole('button', { name: '수정: 점심 식사' }));
  fireEvent.change(screen.getByPlaceholderText('거래 내용을 입력하세요'), { target: { value: ' 저녁 식사 ' } });
  fireEvent.change(screen.getByPlaceholderText('금액 (원)'), { target: { value: '12000' } });
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));

  expect(onEdit).toHaveBeenCalledTimes(1);
  expect(onEdit).toHaveBeenCalledWith(11, {
    date: sample.date,
    type: 'expense',
    category: '교통',
    description: '저녁 식사',
    amount: 12000,
  });
  expect(onAdd).not.toHaveBeenCalled();
  expect(screen.queryByPlaceholderText('금액 (원)')).not.toBeInTheDocument();
});

test('(c) 수정 취소 시 폼이 닫히고 입력값이 초기화된다', () => {
  const { onEdit } = setup();
  fireEvent.click(screen.getByRole('button', { name: '수정: 점심 식사' }));
  fireEvent.click(screen.getByRole('button', { name: '취소' }));

  expect(screen.queryByPlaceholderText('금액 (원)')).not.toBeInTheDocument();
  expect(onEdit).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '+ 거래 추가' }));
  expect(screen.getByPlaceholderText('거래 내용을 입력하세요')).toHaveValue('');
  expect(screen.getByRole('button', { name: '저장' })).toBeInTheDocument();
});

test('(d) 삭제하면 알림이 표시되고 실행 취소로 onRestore 가 호출된다', () => {
  const { onDelete, onRestore } = setup();
  fireEvent.click(screen.getByRole('button', { name: '삭제: 점심 식사' }));

  expect(onDelete).toHaveBeenCalledWith(11);
  expect(screen.getByRole('status')).toHaveTextContent('거래를 삭제했습니다');

  fireEvent.click(screen.getByRole('button', { name: '실행 취소' }));
  expect(onRestore).toHaveBeenCalledWith(sample);
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('(e) 6초 후 알림이 사라진다', () => {
  jest.useFakeTimers();
  setup();
  fireEvent.click(screen.getByRole('button', { name: '삭제: 점심 식사' }));
  expect(screen.getByRole('status')).toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(5900);
  });
  expect(screen.getByRole('status')).toBeInTheDocument();

  act(() => {
    jest.advanceTimersByTime(200);
  });
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('수정 중인 항목을 삭제하면 폼이 닫힌다', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: '수정: 점심 식사' }));
  fireEvent.click(screen.getByRole('button', { name: '삭제: 점심 식사' }));
  expect(screen.queryByPlaceholderText('금액 (원)')).not.toBeInTheDocument();
});

// ---- 검색·필터 ----
const mk = (id, type, category, description, amount) => ({
  id, date: today(), type, category, description, amount,
});
const many = [
  mk(1, 'expense', '식비', '점심 식사', 8000),
  mk(2, 'expense', '교통', '지하철', 1500),
  mk(3, 'income', '급여', '월급', 3000000),
  mk(4, 'income', '기타수입', '중고 판매', 20000),
];
const setupMany = (props = {}) => setup({ transactions: many, ...props });
const typeFilter = () => screen.getByLabelText('유형 필터');
const categoryFilter = () => screen.getByLabelText('카테고리 필터');
const keywordInput = () => screen.getByLabelText('내용 검색');
const optionTexts = (el) => Array.from(el.querySelectorAll('option')).map((o) => o.textContent);

test('필터: 초기에는 초기화 버튼과 결과 요약 줄이 없다', () => {
  setupMany();
  expect(screen.queryByRole('button', { name: '필터 초기화' })).not.toBeInTheDocument();
  expect(screen.queryByText(/조건에 맞는 거래 \d+건/)).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText('내용 검색')).toBeInTheDocument();
});

test('유형 필터로 목록이 줄어든다', () => {
  setupMany();
  fireEvent.change(typeFilter(), { target: { value: 'income' } });
  expect(screen.getByText('월급')).toBeInTheDocument();
  expect(screen.getByText('중고 판매')).toBeInTheDocument();
  expect(screen.queryByText('지하철')).not.toBeInTheDocument();
});

test('카테고리 선택지: 전체 유형이면 수입·지출 모두(중복 없음), 유형을 고르면 해당 유형만', () => {
  setupMany();
  const all = optionTexts(categoryFilter());
  expect(all).toEqual(expect.arrayContaining(['전체 카테고리', '급여', '식비']));
  expect(new Set(all).size).toBe(all.length);

  fireEvent.change(typeFilter(), { target: { value: 'income' } });
  expect(optionTexts(categoryFilter())).toEqual(['전체 카테고리', '급여', '부업', '투자', '기타수입']);
});

test('카테고리 필터 적용 후 유형을 바꿔 목록에 없으면 전체로 리셋된다', () => {
  setupMany();
  fireEvent.change(categoryFilter(), { target: { value: '식비' } });
  expect(screen.getByText('점심 식사')).toBeInTheDocument();
  expect(screen.queryByText('지하철')).not.toBeInTheDocument();

  fireEvent.change(typeFilter(), { target: { value: 'income' } });
  expect(categoryFilter()).toHaveValue('all');
  expect(screen.getByText('월급')).toBeInTheDocument();
});

test('유형을 바꿔도 카테고리가 목록에 있으면 유지된다', () => {
  setupMany();
  fireEvent.change(categoryFilter(), { target: { value: '급여' } });
  fireEvent.change(typeFilter(), { target: { value: 'income' } });
  expect(categoryFilter()).toHaveValue('급여');
});

test('키워드 검색: 내용과 카테고리명, 앞뒤 공백 무시', () => {
  setupMany();
  userEvent.type(keywordInput(), ' 점심 ');
  expect(screen.getByText('점심 식사')).toBeInTheDocument();
  expect(screen.queryByText('월급')).not.toBeInTheDocument();

  userEvent.clear(keywordInput());
  userEvent.type(keywordInput(), '교통');
  expect(screen.getByText('지하철')).toBeInTheDocument();
  expect(screen.queryByText('점심 식사')).not.toBeInTheDocument();
});

test('요약 카드는 필터와 무관하고, 결과 요약 줄은 필터 결과를 보여 준다', () => {
  setupMany();
  fireEvent.change(typeFilter(), { target: { value: 'income' } });

  const summary = document.querySelector('.summary');
  expect(summary).toHaveTextContent('수입3,020,000원');
  expect(summary).toHaveTextContent('지출9,500원');
  expect(summary).toHaveTextContent('잔액3,010,500원');

  expect(document.querySelector('.filter-result')).toHaveTextContent(
    '조건에 맞는 거래 2건 · 수입 3,020,000원 · 지출 0원'
  );
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('필터 초기화 버튼으로 모든 조건이 해제된다', () => {
  setupMany();
  fireEvent.change(typeFilter(), { target: { value: 'expense' } });
  userEvent.type(keywordInput(), '지하');
  expect(screen.queryByText('점심 식사')).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '필터 초기화' }));
  expect(typeFilter()).toHaveValue('all');
  expect(categoryFilter()).toHaveValue('all');
  expect(keywordInput()).toHaveValue('');
  expect(screen.getByText('점심 식사')).toBeInTheDocument();
  expect(screen.getByText('월급')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '필터 초기화' })).not.toBeInTheDocument();
});

test('필터 결과가 비면 안내 문구를 보여 준다', () => {
  setupMany();
  userEvent.type(keywordInput(), '없는내용');
  expect(screen.getByText('조건에 맞는 거래가 없습니다.')).toBeInTheDocument();
  expect(document.querySelector('.filter-result')).toHaveTextContent('조건에 맞는 거래 0건');
});

test('월 자체가 비어 있고 필터가 없으면 기존 문구를 보여 준다', () => {
  setup({ transactions: [] });
  expect(screen.getByText('이 달의 거래 내역이 없습니다.')).toBeInTheDocument();
});

test('필터 중에도 수정·삭제가 동작한다', () => {
  const { onDelete, onEdit } = setupMany();
  fireEvent.change(typeFilter(), { target: { value: 'income' } });
  fireEvent.click(screen.getByRole('button', { name: '삭제: 월급' }));
  expect(onDelete).toHaveBeenCalledWith(3);
  fireEvent.click(screen.getByRole('button', { name: '수정: 중고 판매' }));
  fireEvent.click(screen.getByRole('button', { name: '수정 저장' }));
  expect(onEdit).toHaveBeenCalledWith(4, expect.objectContaining({ description: '중고 판매' }));
});

test('필터 적용 중 거래를 추가하면 필터가 초기화된다', () => {
  const { onAdd } = setupMany();
  fireEvent.change(typeFilter(), { target: { value: 'income' } });
  fireEvent.click(screen.getByRole('button', { name: '+ 거래 추가' }));
  fireEvent.change(screen.getByPlaceholderText('거래 내용을 입력하세요'), { target: { value: '커피' } });
  fireEvent.change(screen.getByPlaceholderText('금액 (원)'), { target: { value: '4000' } });
  fireEvent.click(screen.getByRole('button', { name: '저장' }));

  expect(onAdd).toHaveBeenCalledTimes(1);
  expect(typeFilter()).toHaveValue('all');
  expect(screen.queryByRole('button', { name: '필터 초기화' })).not.toBeInTheDocument();
  expect(screen.getByText('점심 식사')).toBeInTheDocument();
});

test('월을 바꿔도 필터 조건은 유지된다', () => {
  const noop = () => {};
  const props = { transactions: many, onFilterMonthChange: noop, onAdd: noop, onEdit: noop, onDelete: noop, onRestore: noop };
  const { rerender } = render(<ListPage {...props} filterMonth={today().slice(0, 7)} />);
  fireEvent.change(typeFilter(), { target: { value: 'income' } });
  rerender(<ListPage {...props} filterMonth="2000-01" />);
  expect(typeFilter()).toHaveValue('income');
});

describe('CSV 내보내기/가져오기', () => {
  const csvFile = (text, name = 'in.csv') => new File([text], name, { type: 'text/csv' });
  const header = 'id,date,type,category,description,amount\n';
  const pick = (file) => fireEvent.change(screen.getByTestId('csv-file-input'), { target: { files: [file] } });

  afterEach(() => {
    jest.restoreAllMocks();
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  test('내보내기는 전체 거래를 BOM 포함 Blob으로 다운로드하고 URL을 해제한다', async () => {
    let blob;
    URL.createObjectURL = jest.fn((b) => { blob = b; return 'blob:x'; });
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    // 다른 달 거래도 포함되어야 한다
    setup({ transactions: [sample, { ...sample, id: 12, date: '2020-01-01', description: '옛날' }], onImport: jest.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'CSV 내보내기' }));

    expect(click).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:x');
    const bytes = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(new Uint8Array(r.result));
      r.readAsArrayBuffer(blob);
    });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = Buffer.from(bytes).toString('utf8');
    expect(text).toContain('옛날');
    expect(text).toContain('점심 식사');
  });

  test('거래가 없으면 내보내기 버튼이 비활성화된다', () => {
    setup({ transactions: [], onImport: jest.fn() });
    expect(screen.getByRole('button', { name: 'CSV 내보내기' })).toBeDisabled();
  });

  test('가져오기: 확인하면 유효한 행을 onImport로 전달하고 결과를 안내한다', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const onImport = jest.fn();
    setup({ onImport });
    const text = header +
      `11,${sample.date},expense,교통,점심 식사,8000\n` +
      `12,${sample.date},income,급여,월급,1000\n` +
      `13,${sample.date},income,급여,오류,abc\n`;
    pick(csvFile('\uFEFF' + text));

    expect(await screen.findByRole('status')).toHaveTextContent('1건을 가져왔습니다');
    expect(confirm.mock.calls[0][0]).toContain('1건 추가, 1건 중복 제외');
    expect(confirm.mock.calls[0][0]).toContain('1건 잘못된 행');
    expect(confirm.mock.calls[0][0]).toContain('내용이 같은 거래는 중복으로 제외');
    expect(onImport).toHaveBeenCalledTimes(1);
    // 유효한 원시 행 전체를 넘기고 중복 제외는 App(prev 기준)에서 처리한다
    expect(onImport.mock.calls[0][0]).toHaveLength(2);
    expect(onImport.mock.calls[0][0][1]).toEqual({ id: '12', date: sample.date, type: 'income', category: '급여', description: '월급', amount: '1000' });
  });

  test('가져오기: 취소하면 반영하지 않는다', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
    const onImport = jest.fn();
    setup({ onImport });
    pick(csvFile(header + `12,${sample.date},income,급여,월급,1000\n`));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(onImport).not.toHaveBeenCalled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  test('가져오기: 빈 파일이나 형식 오류는 오류 메시지를 보이고 반영하지 않는다', async () => {
    const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
    const onImport = jest.fn();
    setup({ onImport });
    pick(csvFile(header));
    expect(await screen.findByRole('alert')).toHaveTextContent('가져올 수 있는 거래가 없습니다');
    pick(csvFile('a,"b\n'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('읽을 수 없습니다'));
    expect(confirm).not.toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });

  test('불러오기 실패 상태(importDisabled)에서는 가져오기 버튼이 비활성화된다', () => {
    setup({ onImport: jest.fn(), importDisabled: true });
    expect(screen.getByRole('button', { name: 'CSV 가져오기' })).toBeDisabled();
  });
});
