import { sanitizeRecurring, toRecurringFile } from './recurring';

// 비로그인(게스트) 상태의 반복 거래 규칙을 localStorage에 저장/복원
export const GUEST_RECURRING_KEY = 'guest_recurring';

// 게스트 규칙 읽기. 실패/손상 시 빈 배열, 유효하지 않은 항목은 제외
export const loadGuestRecurring = () => {
  try {
    const raw = localStorage.getItem(GUEST_RECURRING_KEY);
    if (!raw) return [];
    return sanitizeRecurring(JSON.parse(raw));
  } catch {
    return [];
  }
};

// 게스트 규칙 저장. 성공 여부 반환
export const saveGuestRecurring = (rules) => {
  try {
    localStorage.setItem(GUEST_RECURRING_KEY, JSON.stringify(toRecurringFile(rules)));
    return true;
  } catch {
    return false;
  }
};

// 게스트 규칙 삭제
export const clearGuestRecurring = () => {
  try {
    localStorage.removeItem(GUEST_RECURRING_KEY);
    return true;
  } catch {
    return false;
  }
};
