import { render, screen, fireEvent, within } from '@testing-library/react';
import StatsPage from './StatsPage';

const txs = [
  { id: 1, date: '2026-10-15', type: 'expense', category: '교통', description: '택시', amount: 12500 },
  { id: 2, date: '2026-10-16', type: 'expense', category: '식비', description: '점심', amount: 87500 },
  { id: 3, date: '2026-10-01', type: 'income', category: '급여', description: '월급', amount: 3600000 },
  { id: 4, date: '2026-10-02', type: 'income', category: '부업', description: '외주', amount: 400000 },
  { id: 5, date: '2026-09-10', type: 'expense', category: '쇼핑', description: '옷', amount: 50000 },
];

const setup = (props = {}) => {
  const onMonthChange = jest.fn();
  const utils = render(
    <StatsPage transactions={txs} month="2026-10" onMonthChange={onMonthChange} {...props} />
  );
  return { onMonthChange, ...utils };
};

// 카테고리 막대 행의 이름 순서
const categoryOrder = () =>
  [...document.querySelectorAll('.hbar-name')].map((el) => el.textContent);

test('월 제목과 요약(수입·지출·잔액)을 보여 준다', () => {
  setup();
  expect(screen.getByText('2026년 10월')).toBeInTheDocument();
  const summary = document.querySelector('.summary');
  expect(within(summary).getByText('4,000,000원')).toBeInTheDocument();
  expect(within(summary).getByText('100,000원')).toBeInTheDocument();
  expect(within(summary).getByText('3,900,000원')).toBeInTheDocument();
});

test('이전/다음 버튼이 onMonthChange 를 호출한다', () => {
  const { onMonthChange } = setup({ month: '2026-01' });
  fireEvent.click(screen.getByText('‹'));
  expect(onMonthChange).toHaveBeenLastCalledWith('2025-12');
  fireEvent.click(screen.getByText('›'));
  expect(onMonthChange).toHaveBeenLastCalledWith('2026-02');
});

test('기본은 지출이고 수입으로 전환하면 카테고리 순서가 바뀐다', () => {
  setup();
  expect(categoryOrder()).toEqual(['식비', '교통']);
  fireEvent.click(screen.getByRole('button', { name: '수입' }));
  expect(categoryOrder()).toEqual(['급여', '부업']);
  fireEvent.click(screen.getByRole('button', { name: '지출' }));
  expect(categoryOrder()).toEqual(['식비', '교통']);
});

test('막대 라벨에 금액과 비율이 표시된다', () => {
  setup();
  expect(screen.getByText('87,500원 · 87.5%')).toBeInTheDocument();
  expect(screen.getByText('12,500원 · 12.5%')).toBeInTheDocument();
});

test('카테고리 가로 막대는 툴팁이 없고 각 행이 aria-label 로 읽힌다', () => {
  setup();
  const row = document.querySelector('.hbar-row');
  fireEvent.mouseEnter(row);
  fireEvent.focus(row);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  expect(screen.getByLabelText('식비 87,500원 87.5%')).toBeInTheDocument();
  expect(screen.getByLabelText('교통 12,500원 12.5%')).toBeInTheDocument();
});

test('월별 추이 그룹에 마우스를 올리면 수입·지출 툴팁이 나오고 벗어나면 사라진다', () => {
  setup();
  const hits = document.querySelectorAll('.chart-hit');
  fireEvent.mouseEnter(hits[5]);
  expect(screen.getByRole('tooltip')).toHaveTextContent('2026-10 · 수입 4,000,000원 · 지출 100,000원');
  fireEvent.mouseLeave(hits[5]);
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

test('월 이동·유형 전환·보기 전환 시 툴팁이 초기화된다', () => {
  setup();
  const hover = () => fireEvent.mouseEnter(document.querySelectorAll('.chart-hit')[0]);
  hover();
  fireEvent.click(screen.getByRole('button', { name: '수입' }));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  hover();
  fireEvent.click(screen.getByText('‹'));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});

test('데이터가 없으면 안내 문구를 보여 준다', () => {
  setup({ month: '2030-01' });
  expect(screen.getByText('이 달의 지출 내역이 없습니다.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '수입' }));
  expect(screen.getByText('이 달의 수입 내역이 없습니다.')).toBeInTheDocument();
  expect(screen.getByText('표시할 거래가 없습니다.')).toBeInTheDocument();
});

test('차트를 표로 보기를 누르면 금액이 포맷된 테이블이 보이고 다시 누르면 차트로 돌아온다', () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: '차트를 표로 보기 (차트의 숫자를 표로 확인)' }));
  const [catTable, trendTable] = screen.getAllByRole('table');
  expect(within(catTable).getByText('식비')).toBeInTheDocument();
  expect(within(catTable).getByText('87,500원')).toBeInTheDocument();
  expect(within(catTable).getByText('87.5%')).toBeInTheDocument();
  expect(within(trendTable).getByText('2026-09')).toBeInTheDocument();
  expect(within(trendTable).getByText('4,000,000원')).toBeInTheDocument();
  expect(within(trendTable).getByText('50,000원')).toBeInTheDocument();
  expect(document.querySelector('.hbar-chart')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '차트로 돌아가기' }));
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(document.querySelector('.hbar-chart')).not.toBeNull();
});

test('범례에 수입/지출이 있고 차트는 role=img 와 요약 라벨을 가진다', () => {
  setup();
  const legend = document.querySelector('.stats-legend');
  expect(within(legend).getByText('수입')).toBeInTheDocument();
  expect(within(legend).getByText('지출')).toBeInTheDocument();

  const imgs = screen.getAllByRole('img');
  expect(imgs.length).toBeGreaterThanOrEqual(2);
  expect(screen.getByRole('img', { name: /2026년 10월 지출 카테고리별 막대 차트, 1위 식비 87,500원/ })).toBeInTheDocument();
});

test('month 가 올바르지 않아도 죽지 않는다', () => {
  setup({ month: '' });
  expect(screen.getByText(/^\d{4}년 \d{1,2}월$/)).toBeInTheDocument();
});

describe('시각 규범 보호', () => {
  const trendBars = () => [...document.querySelectorAll('.trend-svg path')];

  test('추이는 6개 그룹(월 라벨 6개)을 그린다', () => {
    setup();
    expect(document.querySelectorAll('.trend-svg .chart-hit')).toHaveLength(6);
    const months = [...document.querySelectorAll('.trend-svg text.chart-axis-text')]
      .map((t) => t.textContent)
      .filter((t) => /월$/.test(t));
    expect(months).toEqual(['5월', '6월', '7월', '8월', '9월', '10월']);
  });

  test('월별 추이 막대 위에는 값 라벨이 없고 선택 월 요약 줄에 수입/지출 값이 있다', () => {
    setup();
    // 차트 안의 text 는 축 눈금·월 라벨뿐 (막대 위 값 라벨 없음)
    document.querySelectorAll('.trend-svg text').forEach((t) => expect(t).toHaveClass('chart-axis-text'));
    expect(document.querySelectorAll('.chart-value-text')).toHaveLength(0);
    const summary = document.querySelector('.trend-summary');
    expect(summary).toHaveTextContent('2026년 10월');
    expect(summary).toHaveTextContent('수입 400만');
    expect(summary).toHaveTextContent('지출 10만');
  });

  test('표로 보기로 전환하면 열려 있던 추이 툴팁이 사라진다', () => {
    setup();
    fireEvent.mouseEnter(document.querySelectorAll('.chart-hit')[5]);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '차트를 표로 보기 (차트의 숫자를 표로 확인)' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '차트로 돌아가기' }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  test('가로 막대 행: 윗줄에 이름·값, 아랫줄 트랙의 막대 요소가 렌더되고 퍼센트 폭이 값에 비례한다', () => {
    setup({
      transactions: [
        { id: 1, date: '2026-10-01', type: 'expense', category: '식비', description: 'a', amount: 1000000 },
        { id: 2, date: '2026-10-02', type: 'expense', category: '교통', description: 'b', amount: 500000 },
        { id: 3, date: '2026-10-03', type: 'expense', category: '기타', description: 'c', amount: 1 },
      ],
    });
    const rows = [...document.querySelectorAll('.hbar-row')];
    expect(rows).toHaveLength(3);
    rows.forEach((row) => {
      const [head, track] = row.children;
      expect(head).toHaveClass('hbar-head');
      expect(head.querySelector('.hbar-name')).not.toBeNull();
      expect(head.querySelector('.hbar-label')).not.toBeNull();
      expect(track).toHaveClass('hbar-track');
      expect(track.querySelector('.hbar-bar')).not.toBeNull();
    });
    expect(rows[0].querySelector('.hbar-name')).toHaveAttribute('title', '식비');
    expect(rows[0].querySelector('.hbar-label')).toHaveTextContent('1,000,000원 · 66.7%');
    const widths = rows.map((r) => r.querySelector('.hbar-bar').style.width);
    expect(widths[0]).toBe('100%');
    expect(widths[1]).toBe('50%');
    // 극소값의 최소 폭(2px)은 CSS(.hbar-bar min-width)가 보장하며 jsdom 에서는 검증할 수 없다
    expect(parseFloat(widths[2])).toBeGreaterThan(0);
    expect(parseFloat(widths[2])).toBeLessThan(0.01);
  });

  test('비선택 월 막대 불투명도는 0.55, 선택 월은 1', () => {
    setup();
    const bars = trendBars();
    // 9월 지출 1개, 10월 수입·지출 2개 순서
    const opacities = bars.map((p) => p.getAttribute('opacity'));
    expect(opacities).toEqual(['0.55', '1', '1']);
  });

  test('호버한 그룹은 불투명해지고 선택 월은 흐려진다', () => {
    setup();
    fireEvent.mouseEnter(document.querySelectorAll('.chart-hit')[4]);
    expect(trendBars().map((p) => p.getAttribute('opacity'))).toEqual(['1', '0.55', '0.55']);
  });

  test('가로 막대: 최대값 행은 100%, 나머지는 비례하고 두께는 24px 이하', () => {
    setup({
      transactions: [
        { id: 1, date: '2026-10-01', type: 'expense', category: '식비', description: 'a', amount: 100 },
        { id: 2, date: '2026-10-02', type: 'expense', category: '교통', description: 'b', amount: 50 },
      ],
    });
    const bars = [...document.querySelectorAll('.hbar-bar')];
    expect(bars.map((b) => b.style.width)).toEqual(['100%', '50%']);
    bars.forEach((b) => expect(parseFloat(b.style.height)).toBeLessThanOrEqual(24));
  });

  test('세로 막대 두께도 24px 이하', () => {
    setup();
    trendBars().forEach((p) => expect(Number(p.getAttribute('data-bar-width'))).toBeLessThanOrEqual(24));
  });

  test('role=img 내부에 tabIndex 를 가진 요소가 없다', () => {
    setup();
    screen.getAllByRole('img').forEach((img) => {
      expect(img.querySelector('[tabindex]')).toBeNull();
    });
  });

  test('표로 보기 버튼이 키보드 대체 수단임을 aria-label 로 알린다', () => {
    setup();
    expect(screen.getByRole('button', { name: '차트를 표로 보기 (차트의 숫자를 표로 확인)' })).toBeInTheDocument();
  });

  test('0.1% 미만 비율은 <0.1% 로 표시한다', () => {
    setup({
      transactions: [
        { id: 1, date: '2026-10-01', type: 'expense', category: '식비', description: 'a', amount: 1000000 },
        { id: 2, date: '2026-10-02', type: 'expense', category: '교통', description: 'b', amount: 1 },
      ],
    });
    expect(screen.getByText('1원 · <0.1%')).toBeInTheDocument();
  });
});
