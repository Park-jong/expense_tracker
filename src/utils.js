// 금액을 '1,000원' 형식으로 변환
export const formatKRW = (amount) => amount.toLocaleString('ko-KR') + '원';

// 로컬 시간 기준 날짜(YYYY-MM-DD). toISOString()은 UTC 기준이라 사용하지 않음
export const today = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
