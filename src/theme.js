// 테마: 'system'(OS 설정 따라가기, 기본) | 'light' | 'dark'
export const THEME_STORAGE_KEY = 'theme';
export const THEMES = ['system', 'light', 'dark'];
export const THEME_LABELS = {
  system: '시스템 따라가기',
  light: '라이트',
  dark: '다크',
};

// 허용된 값이 아니면 기본값('system')으로 돌린다
export function normalizeTheme(value) {
  return THEMES.includes(value) ? value : 'system';
}

// 저장된 테마를 읽는다. 접근 실패나 잘못된 값은 'system'
export function loadTheme() {
  try {
    return normalizeTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

// 테마를 저장한다. 접근 실패는 무시
export function saveTheme(theme) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, normalizeTheme(theme));
  } catch {
    // 저장소를 쓸 수 없어도 이번 세션 동안은 적용된다
  }
}

// 테마별 배경색(App.css 의 --bg 와 동일). theme-color 메타에 사용
export const THEME_COLORS = { light: '#f0f2f5', dark: '#12141c' };

// theme-color 메타 갱신: light/dark 직접 선택 시 모든 theme-color 메타를 그 배경색으로,
// system 이면 media 에 맞는 원래 값으로 되돌린다
function applyThemeColor(t, doc) {
  doc.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    if (t === 'system') {
      const media = meta.getAttribute('media') || '';
      meta.setAttribute('content', media.includes('dark') ? THEME_COLORS.dark : THEME_COLORS.light);
    } else {
      meta.setAttribute('content', THEME_COLORS[t]);
    }
  });
}

// light/dark 는 data-theme 속성으로, system 은 속성을 제거해 미디어 쿼리에 맡긴다
export function applyTheme(theme, root = document.documentElement) {
  const t = normalizeTheme(theme);
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
  applyThemeColor(t, root.ownerDocument || document);
}
