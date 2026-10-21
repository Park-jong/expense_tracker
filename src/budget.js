import { CATEGORIES } from './categories';
import { monthOfDate } from './utils';

// 예산 데이터: { version: 1, total: 양의 정수|null, categories: { [지출카테고리]: 양의 정수 } }
// 매달 같은 금액을 적용한다.
export const BUDGET_VERSION = 1;

const isPositiveInt = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isExpenseCategory = (c) => CATEGORIES.expense.includes(c);

export const emptyBudgets = () => ({ version: BUDGET_VERSION, total: null, categories: {} });

// 예산 파일 본문이 손상되었음을 나타내는 전용 오류. 이 타입만 '손상'으로 분류하고,
// 검색/다운로드 단계의 오류는 (JSON 오류라도) 일시적 문제로 취급해 덮어쓰기 복구를 노출하지 않는다.
export class BudgetFileCorruptError extends Error {
  constructor(message = '예산 파일을 읽을 수 없습니다') {
    super(message);
    this.name = 'BudgetFileCorruptError';
  }
}

const fail = (reason) => {
  throw new Error(`예산 파일을 읽을 수 없습니다: ${reason}`);
};

// 엄격한 검증. 하나라도 이상하면 에러를 던져 불러오기 실패로 이어지게 한다(덮어쓰기 차단)
export const parseBudgets = (raw) => {
  if (!isPlainObject(raw)) fail('형식이 올바르지 않습니다');
  if (raw.version !== BUDGET_VERSION) fail('지원하지 않는 버전입니다');
  if (raw.total !== null && !isPositiveInt(raw.total)) fail('전체 예산이 올바르지 않습니다');
  if (!isPlainObject(raw.categories)) fail('카테고리 예산 형식이 올바르지 않습니다');
  const categories = {};
  for (const [category, amount] of Object.entries(raw.categories)) {
    if (!isExpenseCategory(category)) fail(`알 수 없는 카테고리: ${category}`);
    if (!isPositiveInt(amount)) fail(`${category} 예산 금액이 올바르지 않습니다`);
    categories[category] = amount;
  }
  return { version: BUDGET_VERSION, total: raw.total, categories };
};

// 게스트 localStorage 용: 유효한 항목만 남기고 나머지는 버림. 항상 유효한 객체 반환
export const sanitizeBudgets = (raw) => {
  const result = emptyBudgets();
  if (!isPlainObject(raw)) return result;
  if (isPositiveInt(raw.total)) result.total = raw.total;
  if (isPlainObject(raw.categories)) {
    for (const category of CATEGORIES.expense) {
      if (Object.prototype.hasOwnProperty.call(raw.categories, category) && isPositiveInt(raw.categories[category])) {
        result.categories[category] = raw.categories[category];
      }
    }
  }
  return result;
};

export const isEmptyBudgets = (b) => {
  const s = sanitizeBudgets(b);
  return s.total === null && Object.keys(s.categories).length === 0;
};

// 키별로 Drive 값 우선, Drive 에 없는 게스트 값만 추가. guestOnly: 게스트에만 있던 값이 반영되었는지
export const mergeBudgets = (driveBudgets, guestBudgets) => {
  const drive = sanitizeBudgets(driveBudgets);
  const guest = sanitizeBudgets(guestBudgets);
  const merged = { version: BUDGET_VERSION, total: drive.total, categories: { ...drive.categories } };
  let guestOnly = false;
  if (merged.total === null && guest.total !== null) {
    merged.total = guest.total;
    guestOnly = true;
  }
  for (const [category, amount] of Object.entries(guest.categories)) {
    if (!(category in merged.categories)) {
      merged.categories[category] = amount;
      guestOnly = true;
    }
  }
  return { merged, guestOnly };
};

// 비율에 따른 상태: 0.8 미만 ok, 0.8~1 warn, 1 초과 over
const statusOf = (ratio) => (ratio > 1 ? 'over' : ratio >= 0.8 ? 'warn' : 'ok');

// 사용 비율 표시(소수 첫째 자리). 상태 경계를 넘지 않도록 초과는 올림, 그 외는 내림한다.
// 예: 0.7996 → '79.9%'(정상), 0.9996 → '99.9%'(주의), 1.0004 → '100.1%'(초과), 1 → '100%'
export const formatBudgetPercent = (ratio) => {
  if (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0) return '0%';
  if (ratio === 1) return '100%';
  // 부동소수 오차(0.07*1000 등)로 정수 경계가 어긋나지 않게 먼저 안정화
  const tenths = Math.round(ratio * 1000 * 1e6) / 1e6;
  let t;
  if (ratio > 1) t = Math.max(Math.ceil(tenths), 1001);
  else if (ratio >= 0.8) t = Math.min(Math.max(Math.floor(tenths), 800), 999);
  else t = Math.min(Math.floor(tenths), 799);
  const whole = Math.floor(t / 10);
  const frac = t % 10;
  return frac === 0 ? `${whole}%` : `${whole}.${frac}%`;
};

const makeEntry =(budget, spent) => {
  const ratio = spent / budget;
  return { budget, spent, remaining: budget - spent, ratio, status: statusOf(ratio) };
};

// 해당 월(YYYY-MM)의 예산 대비 지출 현황. 예산이 하나도 없으면 total null, categories []
export const budgetStatus = (transactions, month, budgets) => {
  const b = sanitizeBudgets(budgets);
  const byCategory = new Map();
  let totalSpent = 0;
  (Array.isArray(transactions) ? transactions : []).forEach((t) => {
    if (
      t == null ||
      t.type !== 'expense' ||
      typeof t.amount !== 'number' ||
      !Number.isFinite(t.amount) ||
      t.amount <= 0 ||
      monthOfDate(t.date) !== month
    ) {
      return;
    }
    totalSpent += t.amount;
    byCategory.set(t.category, (byCategory.get(t.category) ?? 0) + t.amount);
  });
  const categories = CATEGORIES.expense
    .filter((c) => c in b.categories)
    .map((category) => ({ category, ...makeEntry(b.categories[category], byCategory.get(category) ?? 0) }));
  const total = b.total !== null ? makeEntry(b.total, totalSpent) : null;
  return { total, categories };
};
