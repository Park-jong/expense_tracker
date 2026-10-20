// 비로그인(게스트) 상태의 거래를 localStorage에 저장/복원
export const GUEST_KEY = 'guest_transactions';

// 거래 항목 형태 검증
const isValidTransaction = (t) =>
  t !== null &&
  typeof t === 'object' &&
  typeof t.id === 'number' &&
  Number.isFinite(t.id) &&
  typeof t.date === 'string' &&
  (t.type === 'income' || t.type === 'expense') &&
  typeof t.category === 'string' &&
  typeof t.description === 'string' &&
  typeof t.amount === 'number' &&
  Number.isFinite(t.amount);

// 게스트 거래 읽기. 실패/손상 시 빈 배열, 유효하지 않은 항목은 제외
export const loadGuestTransactions = () => {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidTransaction);
  } catch {
    return [];
  }
};

// 게스트 거래 저장. 성공 여부 반환 (사생활 보호 모드/용량 초과 등은 false)
export const saveGuestTransactions = (transactions) => {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(transactions));
    return true;
  } catch {
    return false;
  }
};

// 게스트 거래 삭제
export const clearGuestTransactions = () => {
  try {
    localStorage.removeItem(GUEST_KEY);
    return true;
  } catch {
    return false;
  }
};

// Drive 데이터와 게스트 데이터를 id 기준 합집합으로 병합 (같은 id는 Drive 우선)
export const mergeTransactions = (driveList, guestList) => {
  const drive = Array.isArray(driveList) ? driveList : [];
  const guest = Array.isArray(guestList) ? guestList : [];
  const ids = new Set(drive.map((t) => t.id));
  const guestOnly = [];
  for (const t of guest) {
    if (!ids.has(t.id)) {
      ids.add(t.id); // 게스트 내부 중복 id도 한 번만
      guestOnly.push(t);
    }
  }
  return [...drive, ...guestOnly];
};
