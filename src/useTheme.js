import { useState, useCallback } from 'react';
import { loadTheme, saveTheme, applyTheme, normalizeTheme } from './theme';

// 현재 테마와 변경 함수를 돌려준다. 변경 시 즉시 DOM 에 적용하고 저장한다.
export default function useTheme() {
  const [theme, setThemeState] = useState(() => {
    const initial = loadTheme();
    applyTheme(initial);
    return initial;
  });

  const setTheme = useCallback((next) => {
    const t = normalizeTheme(next);
    setThemeState(t);
    applyTheme(t);
    saveTheme(t);
  }, []);

  return [theme, setTheme];
}
