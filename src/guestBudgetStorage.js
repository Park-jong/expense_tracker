import { emptyBudgets, sanitizeBudgets } from './budget';

// 비로그인(게스트) 상태의 예산을 localStorage에 저장/복원
export const GUEST_BUDGET_KEY = 'guest_budgets';

// 게스트 예산 읽기. 실패/손상 시 빈 예산, 유효하지 않은 항목은 제외
export const loadGuestBudgets = () => {
  try {
    const raw = localStorage.getItem(GUEST_BUDGET_KEY);
    if (!raw) return emptyBudgets();
    return sanitizeBudgets(JSON.parse(raw));
  } catch {
    return emptyBudgets();
  }
};

// 게스트 예산 저장. 성공 여부 반환
export const saveGuestBudgets = (budgets) => {
  try {
    localStorage.setItem(GUEST_BUDGET_KEY, JSON.stringify(budgets));
    return true;
  } catch {
    return false;
  }
};

// 게스트 예산 삭제
export const clearGuestBudgets = () => {
  try {
    localStorage.removeItem(GUEST_BUDGET_KEY);
    return true;
  } catch {
    return false;
  }
};
