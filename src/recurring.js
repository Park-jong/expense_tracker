import { CATEGORIES } from './categories';

// 반복 거래 규칙 (순수 로직). 날짜는 모두 로컬 기준 'YYYY-MM-DD' 문자열로 다루며 toISOString 은 쓰지 않는다.
// 규칙: { id, type, category, description, amount, cycle, day?, weekday?, month?, startDate, endDate, lastGenerated }
//   cycle 'monthly': day(1~31), 'weekly': weekday(0=일~6=토), 'yearly': month(1~12) + day
// 파일: { version: 1, rules: [규칙...] }  (거래 CSV 와는 별도 파일)
export const RECURRING_VERSION = 1;
export const MAX_PER_RULE = 366; // 한 번에 규칙당 생성하는 최대 건수
export const CYCLES = ['monthly', 'weekly', 'yearly'];
export const CYCLE_LABEL = { monthly: '매월', weekly: '매주', yearly: '매년' };
export const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토'];

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v, min, max) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isPositiveInt = (v) => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;

// 반복 규칙 파일 본문이 손상되었음을 나타내는 전용 오류 (예산의 BudgetFileCorruptError 와 같은 역할)
export class RecurringFileCorruptError extends Error {
  constructor(message = '반복 거래 파일을 읽을 수 없습니다') {
    super(message);
    this.name = 'RecurringFileCorruptError';
  }
}

// ── 날짜 도우미 ──
const isLeap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
export const daysInMonth = (y, m) => [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
const pad = (n, w = 2) => String(n).padStart(w, '0');
const fmt = (y, m, d) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;

// 실제로 존재하는 날짜만 { y, m, d } 로 분해 (1900~2999년), 아니면 null
export const parseDate = (s) => {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
  if (!r) return null;
  const y = Number(r[1]);
  const m = Number(r[2]);
  const d = Number(r[3]);
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
};

// 로컬 달력 기준으로 n일 이동한 날짜
export const addDays = (s, n) => {
  const { y, m, d } = parseDate(s);
  const dt = new Date(y, m - 1, d + n);
  return fmt(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
};

const weekdayOf = (s) => {
  const { y, m, d } = parseDate(s);
  return new Date(y, m - 1, d).getDay();
};

const maxStr = (a, b) => (a >= b ? a : b);
const minStr = (a, b) => (a <= b ? a : b);

// ── 규칙 검증 ──
// 올바른 규칙이면 정규화된 새 객체, 아니면 null. 주기와 무관한 필드는 버린다.
export const normalizeRule = (raw) => {
  if (!isPlainObject(raw)) return null;
  if (typeof raw.id !== 'string' || raw.id === '') return null;
  if (raw.type !== 'income' && raw.type !== 'expense') return null;
  if (!CATEGORIES[raw.type].includes(raw.category)) return null;
  if (typeof raw.description !== 'string' || raw.description.trim() === '') return null;
  if (!isPositiveInt(raw.amount)) return null;
  if (!CYCLES.includes(raw.cycle)) return null;
  if (!parseDate(raw.startDate)) return null;
  if (raw.endDate != null && (!parseDate(raw.endDate) || raw.endDate < raw.startDate)) return null;
  if (raw.lastGenerated != null && !parseDate(raw.lastGenerated)) return null;
  const rule = {
    id: raw.id,
    type: raw.type,
    category: raw.category,
    description: raw.description.trim(),
    amount: raw.amount,
    cycle: raw.cycle,
  };
  if (raw.cycle === 'monthly') {
    if (!isInt(raw.day, 1, 31)) return null;
    rule.day = raw.day;
  } else if (raw.cycle === 'weekly') {
    if (!isInt(raw.weekday, 0, 6)) return null;
    rule.weekday = raw.weekday;
  } else {
    if (!isInt(raw.month, 1, 12)) return null;
    if (!isInt(raw.day, 1, daysInMonth(2000, raw.month))) return null; // 윤년 기준: 2/29 허용
    rule.month = raw.month;
    rule.day = raw.day;
  }
  rule.startDate = raw.startDate;
  rule.endDate = raw.endDate ?? null;
  rule.lastGenerated = raw.lastGenerated ?? null;
  return rule;
};

const fail = (reason) => {
  throw new Error(`반복 거래 파일을 읽을 수 없습니다: ${reason}`);
};

export const emptyRules = () => [];

// 엄격한 검증. 하나라도 이상하면 에러를 던져 불러오기 실패로 이어지게 한다(덮어쓰기 차단). 규칙 배열 반환
export const parseRecurring = (raw) => {
  if (!isPlainObject(raw)) fail('형식이 올바르지 않습니다');
  if (raw.version !== RECURRING_VERSION) fail('지원하지 않는 버전입니다');
  if (!Array.isArray(raw.rules)) fail('규칙 목록 형식이 올바르지 않습니다');
  const seen = new Set();
  return raw.rules.map((r, i) => {
    const rule = normalizeRule(r);
    if (!rule) fail(`${i + 1}번째 규칙이 올바르지 않습니다`);
    if (seen.has(rule.id)) fail(`중복된 규칙 id: ${rule.id}`);
    seen.add(rule.id);
    return rule;
  });
};

// 게스트 localStorage 용: 파일 객체({rules}) 또는 배열을 받아 유효한 규칙만 남김(id 중복은 첫 항목). 항상 배열 반환
export const sanitizeRecurring = (raw) => {
  const list = Array.isArray(raw) ? raw : isPlainObject(raw) && Array.isArray(raw.rules) ? raw.rules : [];
  const seen = new Set();
  const out = [];
  list.forEach((r) => {
    const rule = normalizeRule(r);
    if (rule && !seen.has(rule.id)) {
      seen.add(rule.id);
      out.push(rule);
    }
  });
  return out;
};

export const toRecurringFile = (rules) => ({ version: RECURRING_VERSION, rules: sanitizeRecurring(rules) });

// id 별 병합: Drive 규칙 우선, Drive 에 없는 게스트 규칙만 추가. guestOnly: 게스트에만 있던 규칙이 반영되었는지
export const mergeRecurring = (driveRules, guestRules) => {
  const merged = sanitizeRecurring(driveRules);
  const ids = new Set(merged.map((r) => r.id));
  let guestOnly = false;
  sanitizeRecurring(guestRules).forEach((r) => {
    if (!ids.has(r.id)) {
      merged.push(r);
      ids.add(r.id);
      guestOnly = true;
    }
  });
  return { merged, guestOnly };
};

// 새 규칙 id (충돌 가능성이 사실상 없는 문자열)
export const newRuleId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

// ── 발생일 계산 ──
// from~to(양끝 포함) 사이의 발생일을 오름차순으로 만든다. 규칙의 시작·종료·lastGenerated 는 호출자가 범위로 반영한다.
function* iterateOccurrences(rule, from, to) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b || from > to) return;
  if (rule.cycle === 'monthly') {
    for (let y = a.y, m = a.m; y * 12 + m <= b.y * 12 + b.m; m === 12 ? ((y += 1), (m = 1)) : (m += 1)) {
      const s = fmt(y, m, Math.min(rule.day, daysInMonth(y, m))); // 짧은 달은 말일
      if (s >= from && s <= to) yield s;
    }
  } else if (rule.cycle === 'yearly') {
    for (let y = a.y; y <= b.y; y += 1) {
      const s = fmt(y, rule.month, Math.min(rule.day, daysInMonth(y, rule.month))); // 평년 2/29 는 2/28
      if (s >= from && s <= to) yield s;
    }
  } else {
    let cur = addDays(from, (rule.weekday - weekdayOf(from) + 7) % 7);
    while (cur <= to) {
      yield cur;
      cur = addDays(cur, 7);
    }
  }
}

// 규칙에서 아직 만들지 않은 발생일(lastGenerated 다음 날~min(종료일, 오늘)). 미래 날짜는 포함하지 않는다.
// 상한(max)을 넘으면 가장 최근 max 건만 남기고 오래된 건수를 skipped 로 알린다.
export const dueOccurrences = (rule, todayStr, max = MAX_PER_RULE) => {
  if (!parseDate(todayStr)) return { dates: [], skipped: 0 };
  let from = rule.startDate;
  if (rule.lastGenerated) from = maxStr(from, addDays(rule.lastGenerated, 1));
  const to = rule.endDate ? minStr(rule.endDate, todayStr) : todayStr;
  if (from > to) return { dates: [], skipped: 0 };
  const all = [...iterateOccurrences(rule, from, to)];
  const dates = all.length > max ? all.slice(all.length - max) : all;
  return { dates, skipped: all.length - dates.length };
};

// 다음 발생 예정일(오늘 이후이면서 아직 만들지 않은 날). 종료되었으면 null
export const nextOccurrence = (rule, todayStr) => {
  if (!parseDate(todayStr)) return null;
  let from = maxStr(rule.startDate, addDays(todayStr, 1));
  if (rule.lastGenerated) from = maxStr(from, addDays(rule.lastGenerated, 1));
  const f = parseDate(from);
  if (!f) return null; // 지원 범위(2999년)를 벗어남
  const limit = fmt(Math.min(f.y + 8, 2999), 12, 31);
  const to = rule.endDate ? minStr(rule.endDate, limit) : limit;
  for (const s of iterateOccurrences(rule, from, to)) return s;
  return null;
};

// '매월 5일' / '매주 월요일' / '매년 3월 5일'
export const describeCycle = (rule) => {
  if (rule.cycle === 'monthly') return `매월 ${rule.day}일`;
  if (rule.cycle === 'weekly') return `매주 ${WEEKDAY_LABEL[rule.weekday]}요일`;
  return `매년 ${rule.month}월 ${rule.day}일`;
};

// 모든 규칙의 생성 대상 계산 (순수). 반환:
//   drafts: id 없는 거래 초안 목록, updates: { [규칙 id]: 새 lastGenerated }, skipped: 상한으로 건너뛴 건수
export const planGeneration = (rules, todayStr, max = MAX_PER_RULE) => {
  const drafts = [];
  const updates = {};
  let skipped = 0;
  (Array.isArray(rules) ? rules : []).forEach((rule) => {
    const r = dueOccurrences(rule, todayStr, max);
    skipped += r.skipped;
    if (r.dates.length === 0) return;
    updates[rule.id] = r.dates[r.dates.length - 1];
    r.dates.forEach((date) => {
      drafts.push({ date, type: rule.type, category: rule.category, description: rule.description, amount: rule.amount });
    });
  });
  return { drafts, updates, skipped };
};

export const txKey = (t) => [t.date, t.type, t.category, t.description, t.amount].join('\u0000');

// 초안들의 내용 키 목록(중복 제거). applyDrafts 가 같은 내용의 초안을 하나로 합치므로 집합이면 충분하다.
export const draftKeys = (drafts) => [...new Set((Array.isArray(drafts) ? drafts : []).map(txKey))];

// 성공한 저장 배열(saved)이 생성하려던 내용 키(keys)를 모두 충족하는지 판정 (순수).
// 각 키는 saved 에 같은 내용의 거래가 있거나, 현재 목록(current)에 더 이상 없으면(삭제·수정됨) 충족으로 본다.
// 반드시 '저장 성공 신호가 온 뒤'에만 호출해야 한다.
export const isGenerationSaved = (keys, saved, current) => {
  const savedKeys = new Set((Array.isArray(saved) ? saved : []).map(txKey));
  const currentKeys = new Set((Array.isArray(current) ? current : []).map(txKey));
  return keys.every((k) => savedKeys.has(k) || !currentKeys.has(k));
};

// 초안을 거래 목록에 추가 (순수: StrictMode 이중 호출 안전).
// 같은 날짜·유형·카테고리·내용·금액 거래가 이미 있으면 건너뛰고,
// id 는 max(기존 최대 id, minId) 다음 값부터 순서대로 부여한다(minId 에 Date.now() 를 넘기면 직접 추가 거래 id 와 겹치지 않음).
// 부여할 id 가 Number.MAX_SAFE_INTEGER 를 넘게 되는 초안은 건너뛴다(정수 안전성·고유성 보장).
// Date.now() 는 호출자가 업데이터 밖에서 한 번 읽어 넘긴다(순수성 유지). 추가할 것이 없으면 prev 를 그대로 돌려준다.
export const applyDrafts = (prev, drafts, minId = 0) => {
  const list = Array.isArray(prev) ? prev : [];
  const seen = new Set(list.map(txKey));
  let nextId = list.reduce((max, t) => (typeof t.id === 'number' && Number.isFinite(t.id) && t.id > max ? t.id : max), Number.isFinite(minId) ? minId : 0);
  const added = [];
  drafts.forEach((d) => {
    const k = txKey(d);
    if (seen.has(k)) return;
    if (nextId >= Number.MAX_SAFE_INTEGER) return; // 안전 정수를 넘는 id 는 고유성을 보장할 수 없으므로 이 초안은 만들지 않는다
    seen.add(k);
    nextId += 1;
    added.push({ id: nextId, ...d });
  });
  return added.length === 0 ? list : [...list, ...added];
};

// 규칙 목록에 lastGenerated 갱신을 반영 (순수). 규칙이 그 사이 삭제되었거나 이미 더 앞서 있으면 건드리지 않는다.
export const applyGenerationUpdates = (rules, updates) => {
  let changed = false;
  const next = rules.map((r) => {
    const to = updates[r.id];
    if (to && (!r.lastGenerated || to > r.lastGenerated)) {
      changed = true;
      return { ...r, lastGenerated: to };
    }
    return r;
  });
  return changed ? next : rules;
};
