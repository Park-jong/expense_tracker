// 금액을 '1,000원' 형식으로 변환
export const formatKRW = (amount) => amount.toLocaleString('ko-KR') + '원';

// 로컬 시간 기준 날짜(YYYY-MM-DD). toISOString()은 UTC 기준이라 사용하지 않음
export const today = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// 'YYYY-MM' 문자열을 { year, month }로 분해. 형식이 올바르지 않으면 null
export const parseMonth = (month) => {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? '');
  if (!m) return null;
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) return null;
  return { year, month: mon };
};

// 'YYYY-MM'에서 delta개월 이동한 'YYYY-MM' 반환 (연말/연초 경계 처리). 형식이 이상하면 그대로 반환
export const shiftMonth = (month, delta) => {
  const parsed = parseMonth(month);
  if (!parsed) return month;
  const index = parsed.year * 12 + (parsed.month - 1) + delta;
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
};

// 'YYYY-MM-DD' 날짜에서 월('YYYY-MM') 추출. 날짜가 비었거나 형식이 이상하면 null
export const monthOfDate = (date) => {
  const month = typeof date === 'string' ? date.slice(0, 7) : '';
  return parseMonth(month) ? month : null;
};

// 금액을 짧게 줄여 표시 (축 눈금·값 라벨용)
// 1만 미만은 쉼표 숫자('9,999'), 1만~1억은 '만'(100만 미만은 소수 첫째 자리), 1억~1조는 '억', 그 이상은 '조'
// 단위 승급은 반올림한 값 기준이라 '10000억' 같은 표기는 나오지 않는다
export const compactKRW = (amount) => {
  const n = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  const rounded = Math.round(abs);
  if (rounded === 0) return '0';
  const sign = n < 0 ? '-' : '';
  const comma = (v) => v.toLocaleString('en-US');
  const round1 = (v) => Math.round(v * 10) / 10;
  if (rounded < 10000) return sign + comma(rounded);
  if (abs < 1e8) {
    const man = abs / 1e4;
    if (man < 100) return `${sign}${comma(round1(man))}만`;
    const m = Math.round(man);
    if (m < 10000) return `${sign}${comma(m)}만`;
  }
  if (abs < 1e12) {
    const eok = round1(abs / 1e8);
    if (eok < 10000) return `${sign}${comma(eok)}억`;
  }
  return `${sign}${comma(round1(abs / 1e12))}조`;
};

// 유형/카테고리/키워드로 거래 목록을 거른다 (원본 불변)
// type, category 는 'all' 또는 값, keyword 는 내용·카테고리명 부분 일치 (대소문자 무시, 앞뒤 공백 제거)
export const filterTransactions = (list, { type = 'all', category = 'all', keyword = '' } = {}) => {
  const kw = String(keyword ?? '').trim().toLowerCase();
  return list.filter((t) => {
    if (type !== 'all' && t.type !== type) return false;
    if (category !== 'all' && t.category !== category) return false;
    if (kw) {
      const inDesc = String(t.description ?? '').toLowerCase().includes(kw);
      const inCat = String(t.category ?? '').toLowerCase().includes(kw);
      if (!inDesc && !inCat) return false;
    }
    return true;
  });
};
