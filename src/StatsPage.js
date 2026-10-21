import { useState, useRef, useLayoutEffect, useEffect } from 'react';
import { formatKRW, compactKRW, today, parseMonth, shiftMonth } from './utils';
import {
  categoryBreakdown, monthlyTrend, niceTicks, formatPercent,
} from './stats';

import BudgetPanel from './BudgetPanel';

const TYPE_LABEL = { expense: '지출', income: '수입' };

// 월별 추이 SVG 규격 (실제 픽셀 기준). 폭은 컨테이너 폭을 측정해 쓰고, 측정할 수 없으면 480
const FALLBACK_W = 480;
const H = 240;
const PAD_TOP = 24;
const PAD_RIGHT = 8;
const PAD_BOTTOM = 28;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;
const MAX_BAR_W = 20; // 막대 두께 (24px 이하)
const BAR_GAP = 2; // 그룹 내 두 막대 사이 간격 (최소 2px)
const GROUP_GAP = 6; // 그룹 사이 최소 여백
const HBAR_THICKNESS = 14; // 가로 막대 두께 (24px 이하)

const percent = formatPercent;

// Y축 눈금 라벨 폭 추정 (12px 기준): 한글은 12px, 숫자·기호는 약 7px
const axisLabelWidth = (text) =>
  [...text].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x7f ? 12 : 7), 0);

// 기준선 쪽은 직각, 데이터 끝(위쪽) 4px 둥글림인 세로 막대 경로
const columnPath = (x, base, h, w) => {
  const r = Math.min(4, h, w / 2);
  return `M${x},${base} V${base - h + r} a${r},${r} 0 0 1 ${r},${-r} H${x + w - r} a${r},${r} 0 0 1 ${r},${r} V${base} Z`;
};

// 요소의 실제 픽셀 폭을 측정. ResizeObserver 가 없는 환경(jsdom 등)에서는 폴백 폭을 쓴다
const useContainerWidth = (ref) => {
  const [width, setWidth] = useState(FALLBACK_W);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const w = Math.floor(el.getBoundingClientRect().width);
      if (w > 0) setWidth(w);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
};

export default function StatsPage({ transactions, month, onMonthChange, authState, budgetApi }) {
  // month가 올바르지 않으면 오늘이 속한 달로 대체
  const parsed = parseMonth(month) ?? parseMonth(today().slice(0, 7));
  const monthStr = `${parsed.year}-${String(parsed.month).padStart(2, '0')}`;
  const [type, setType] = useState('expense');
  const [tableView, setTableView] = useState(false);
  const [tooltip, setTooltip] = useState(null); // 월별 추이에서 호버 중인 그룹 인덱스

  // 월 이동·유형 전환·보기 전환 시 툴팁 상태를 초기화
  const changeMonth = (delta) => {
    setTooltip(null);
    onMonthChange(shiftMonth(monthStr, delta));
  };
  const changeType = (t) => {
    setTooltip(null);
    setType(t);
  };

  const breakdown = categoryBreakdown(transactions, monthStr, type);
  const trend = monthlyTrend(transactions, monthStr, 6);
  const current = trend[trend.length - 1];
  const balance = current.income - current.expense;
  const trendEmpty = trend.every((r) => r.income === 0 && r.expense === 0);

  return (
    <div className="stats-page">
      {/* 월 네비게이션 (달력과 동일) */}
      <div className="cal-nav">
        <button className="cal-nav-btn" onClick={() => changeMonth(-1)}>&#8249;</button>
        <span className="cal-nav-title">{parsed.year}년 {parsed.month}월</span>
        <button className="cal-nav-btn" onClick={() => changeMonth(1)}>&#8250;</button>
      </div>

      <section className="summary">
        <div className="card income-card">
          <span className="card-label">수입</span>
          <span className="card-amount">{formatKRW(current.income)}</span>
        </div>
        <div className="card expense-card">
          <span className="card-label">지출</span>
          <span className="card-amount">{formatKRW(current.expense)}</span>
        </div>
        <div className={`card balance-card ${balance >= 0 ? 'positive' : 'negative'}`}>
          <span className="card-label">잔액</span>
          <span className="card-amount">{formatKRW(balance)}</span>
        </div>
      </section>

      <BudgetPanel transactions={transactions} month={monthStr} authState={authState} budgetApi={budgetApi} />

      <div className="stats-toolbar">
        <span className="stats-toolbar-label">차트 보기 방식</span>
        <button
          type="button"
          className="stats-toggle"
          aria-pressed={tableView}
          aria-label={tableView ? '차트로 돌아가기' : '차트를 표로 보기 (차트의 숫자를 표로 확인)'}
          onClick={() => {
            setTooltip(null);
            setTableView((v) => !v);
          }}
        >
          {tableView ? '차트로 돌아가기' : '차트를 표로 보기'}
        </button>
      </div>

      <section className="stats-card" aria-labelledby="stats-category-title">
        <div className="stats-card-head">
          <h2 id="stats-category-title" className="stats-title">카테고리별</h2>
          <div className="stats-segment" role="group" aria-label="유형 선택">
            {['expense', 'income'].map((t) => (
              <button
                key={t}
                type="button"
                className={`stats-segment-btn ${type === t ? 'active' : ''}`}
                aria-pressed={type === t}
                onClick={() => changeType(t)}
              >
                {TYPE_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        {breakdown.length === 0 ? (
          <p className="empty">이 달의 {TYPE_LABEL[type]} 내역이 없습니다.</p>
        ) : tableView ? (
          <table className="stats-table">
            <thead>
              <tr><th>카테고리</th><th>금액</th><th>비율</th></tr>
            </thead>
            <tbody>
              {breakdown.map((b) => (
                <tr key={b.category}>
                  <td>{b.category}</td>
                  <td>{formatKRW(b.amount)}</td>
                  <td>{percent(b.ratio)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <CategoryChart
            breakdown={breakdown}
            label={`${parsed.year}년 ${parsed.month}월 ${TYPE_LABEL[type]} 카테고리별 막대 차트, ` +
              breakdown.slice(0, 3).map((b, i) => `${i + 1}위 ${b.category} ${formatKRW(b.amount)}`).join(', ')}
          />
        )}
      </section>

      <section className="stats-card" aria-labelledby="stats-trend-title">
        <div className="stats-card-head">
          <h2 id="stats-trend-title" className="stats-title">월별 추이</h2>
          <ul className="stats-legend">
            <li><span className="legend-dot income" aria-hidden="true" />수입</li>
            <li><span className="legend-dot expense" aria-hidden="true" />지출</li>
          </ul>
        </div>

        {trendEmpty ? (
          <p className="empty">표시할 거래가 없습니다.</p>
        ) : tableView ? (
          <table className="stats-table">
            <thead>
              <tr><th>월</th><th>수입</th><th>지출</th></tr>
            </thead>
            <tbody>
              {trend.map((r) => (
                <tr key={r.month}>
                  <td>{r.month}</td>
                  <td>{formatKRW(r.income)}</td>
                  <td>{formatKRW(r.expense)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <TrendChart
            trend={trend}
            active={tooltip}
            setActive={setTooltip}
            label={`최근 6개월 수입·지출 추이 막대 차트, ${current.month} 수입 ${formatKRW(current.income)}, 지출 ${formatKRW(current.expense)}`}
          />
        )}
      </section>
    </div>
  );
}

// 카테고리별 가로 막대 차트: 윗줄에 이름·값, 아랫줄에 전체 폭 트랙. 길이는 최대값 기준 상대 길이(최대값 행 100%)
// 툴팁 없이 각 행의 aria-label 로 읽힌다
function CategoryChart({ breakdown, label }) {
  const max = breakdown[0].amount;

  return (
    <div className="hbar-chart" role="img" aria-label={label}>
      {breakdown.map((b) => (
        <div
          key={b.category}
          className="hbar-row"
          aria-label={`${b.category} ${formatKRW(b.amount)} ${percent(b.ratio)}`}
        >
          <div className="hbar-head">
            <span className="hbar-name" title={b.category}>{b.category}</span>
            <span className="hbar-label">{formatKRW(b.amount)} · {percent(b.ratio)}</span>
          </div>
          <div className="hbar-track">
            <div
              className="hbar-bar"
              style={{ width: `${(b.amount / max) * 100}%`, height: HBAR_THICKNESS }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

// 월별 수입·지출 세로 막대 차트 (월마다 막대 2개). 마지막 그룹이 선택 월
// 컨테이너의 실제 폭으로 그려 글자 크기가 항상 12px 로 유지된다
function TrendChart({ trend, label, active, setActive }) {
  const wrapRef = useRef(null);
  const tipRef = useRef(null);
  const [tipSize, setTipSize] = useState({ w: 0, h: 0 });
  const width = useContainerWidth(wrapRef);

  const maxValue = Math.max(...trend.map((r) => Math.max(r.income, r.expense)));
  const ticks = niceTicks(maxValue);
  const top = ticks[ticks.length - 1];
  const base = PAD_TOP + PLOT_H;
  const padLeft = Math.max(
    36,
    Math.ceil(Math.max(...ticks.map((t) => axisLabelWidth(compactKRW(t))))) + 12
  );
  const plotW = Math.max(width - padLeft - PAD_RIGHT, trend.length * 10);
  const slot = plotW / trend.length;
  const barW = Math.max(2, Math.min(MAX_BAR_W, Math.floor((slot - GROUP_GAP - BAR_GAP) / 2)));
  const lastIdx = trend.length - 1;
  const scale = (v) => (v / top) * PLOT_H;

  // 툴팁 실제 크기 측정 (렌더 직후, 화면에 그려지기 전)
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setTipSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, [active, width]);

  return (
    <div className="trend-chart" ref={wrapRef}>
      {/* 선택 월 요약: 막대 위 라벨 대신 일반 텍스트로 표시 */}
      <p className="trend-summary">
        {Number(trend[lastIdx].month.slice(0, 4))}년 {Number(trend[lastIdx].month.slice(5))}월 기준
        <span className="trend-item"><span className="legend-dot income" aria-hidden="true" />수입 {compactKRW(trend[lastIdx].income)}</span>
        <span className="trend-item"><span className="legend-dot expense" aria-hidden="true" />지출 {compactKRW(trend[lastIdx].expense)}</span>
      </p>
      <svg viewBox={`0 0 ${width} ${H}`} width={width} height={H} role="img" aria-label={label} className="trend-svg">
        {/* 가로 격자 + Y축 눈금 라벨 */}
        {ticks.map((t) => {
          const y = base - scale(t);
          return (
            <g key={t}>
              <line className="chart-grid" x1={padLeft} x2={width - PAD_RIGHT} y1={y} y2={y} />
              <text className="chart-axis-text" x={padLeft - 6} y={y + 4} textAnchor="end">
                {compactKRW(t)}
              </text>
            </g>
          );
        })}

        {trend.map((r, i) => {
          const cx = padLeft + slot * i + slot / 2;
          const selected = i === lastIdx;
          const dim = active === null ? !selected : active !== i;
          const incomeX = cx - BAR_GAP / 2 - barW;
          const expenseX = cx + BAR_GAP / 2;
          const bars = [
            { key: 'income', x: incomeX, value: r.income },
            { key: 'expense', x: expenseX, value: r.expense },
          ];
          return (
            <g key={r.month}>
              {bars.map((b) =>
                b.value > 0 ? (
                  <path
                    key={b.key}
                    className={`bar-${b.key}`}
                    d={columnPath(b.x, base, Math.max(scale(b.value), 1), barW)}
                    data-bar-width={barW}
                    opacity={dim ? 0.55 : 1}
                  />
                ) : null
              )}
              <text
                className={`chart-axis-text ${selected ? 'selected' : ''}`}
                x={cx}
                y={H - 8}
                textAnchor="middle"
              >
                {Number(r.month.slice(5))}월
              </text>
              {/* 호버 영역: 그룹 전체 칸(막대보다 넓음). 키보드 대체 수단은 '차트를 표로 보기' */}
              <rect
                className="chart-hit"
                x={padLeft + slot * i}
                y={PAD_TOP}
                width={slot}
                height={PLOT_H + 24}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            </g>
          );
        })}
      </svg>

      {active !== null && trend[active] && (() => {
        const r = trend[active];
        const cx = padLeft + slot * active + slot / 2;
        const tipTop = base - scale(Math.max(r.income, r.expense));
        const left = Math.max(4, Math.min(cx - tipSize.w / 2, width - tipSize.w - 4));
        return (
          <div
            ref={tipRef}
            className="chart-tooltip"
            role="tooltip"
            style={{ left, top: Math.max(tipTop - tipSize.h - 6, 0) }}
          >
            {r.month} · 수입 {formatKRW(r.income)} · 지출 {formatKRW(r.expense)}
          </div>
        );
      })()}
    </div>
  );
}
