import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent } from '@testing-library/react';
import { normalizeTheme, loadTheme, saveTheme, applyTheme, THEME_COLORS } from './theme';
import ThemeSelect from './ThemeSelect';
import useTheme from './useTheme';

function Harness() {
  const [theme, setTheme] = useTheme();
  return <ThemeSelect theme={theme} onChange={setTheme} />;
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('theme.js', () => {
  test('normalizeTheme 은 허용 값만 통과시키고 나머지는 system', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
    expect(normalizeTheme('system')).toBe('system');
    expect(normalizeTheme('blue')).toBe('system');
    expect(normalizeTheme(null)).toBe('system');
  });

  test('loadTheme 은 저장값이 없거나 잘못되면 system', () => {
    expect(loadTheme()).toBe('system');
    localStorage.setItem('theme', 'neon');
    expect(loadTheme()).toBe('system');
    localStorage.setItem('theme', 'dark');
    expect(loadTheme()).toBe('dark');
  });

  test('saveTheme 은 저장하고, 저장소 접근 실패는 무시한다', () => {
    saveTheme('light');
    expect(localStorage.getItem('theme')).toBe('light');
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => saveTheme('dark')).not.toThrow();
    spy.mockRestore();
  });

  test('loadTheme 은 저장소 접근 실패 시 system', () => {
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(loadTheme()).toBe('system');
    spy.mockRestore();
  });

  test('applyTheme 은 light/dark 에 속성을 설정하고 system 은 제거한다', () => {
    const root = document.documentElement;
    applyTheme('dark');
    expect(root.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(root.getAttribute('data-theme')).toBe('light');
    applyTheme('system');
    expect(root.hasAttribute('data-theme')).toBe(false);
    applyTheme('garbage');
    expect(root.hasAttribute('data-theme')).toBe(false);
  });
});

describe('테마 전환 컨트롤', () => {
  test('기본은 시스템 따라가기이고 속성이 없다', () => {
    render(<Harness />);
    expect(screen.getByLabelText('테마')).toHaveValue('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  test('다크를 고르면 속성과 localStorage 에 반영된다', () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText('테마'), { target: { value: 'dark' } });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('theme')).toBe('dark');

    fireEvent.change(screen.getByLabelText('테마'), { target: { value: 'system' } });
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('system');
  });

  test('저장된 값을 복원하고, 잘못된 저장값은 무시한다', () => {
    localStorage.setItem('theme', 'light');
    const { unmount } = render(<Harness />);
    expect(screen.getByLabelText('테마')).toHaveValue('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    unmount();

    localStorage.setItem('theme', 'bogus');
    document.documentElement.removeAttribute('data-theme');
    render(<Harness />);
    expect(screen.getByLabelText('테마')).toHaveValue('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('theme-color 메타', () => {
  let light;
  let dark;
  beforeEach(() => {
    document.head.innerHTML =
      '<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f0f2f5">' +
      '<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#12141c">';
    [light, dark] = document.head.querySelectorAll('meta[name="theme-color"]');
  });
  afterEach(() => {
    document.head.innerHTML = '';
  });

  test('다크를 고르면 두 메타 모두 다크 배경, 라이트를 고르면 라이트 배경', () => {
    applyTheme('dark');
    expect(light.content).toBe(THEME_COLORS.dark);
    expect(dark.content).toBe(THEME_COLORS.dark);
    applyTheme('light');
    expect(light.content).toBe(THEME_COLORS.light);
    expect(dark.content).toBe(THEME_COLORS.light);
  });

  test('시스템으로 돌아가면 media 별 원래 값으로 복원된다', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(light.content).toBe('#f0f2f5');
    expect(dark.content).toBe('#12141c');
  });

  test('THEME_COLORS 는 App.css 의 --bg 와 같다', () => {
    const css = fs.readFileSync(path.join(__dirname, 'App.css'), 'utf8');
    expect(css.match(/:root\s*\{[^}]*--bg:\s*([^;]+);/)[1].trim()).toBe(THEME_COLORS.light);
    expect(css.match(/:root\[data-theme='dark'\]\s*\{[^}]*--bg:\s*([^;]+);/)[1].trim()).toBe(
      THEME_COLORS.dark
    );
  });

  test('public/index.html 의 메타 초기값이 THEME_COLORS 와 같다', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    expect(html).toContain(`media="(prefers-color-scheme: light)" content="${THEME_COLORS.light}"`);
    expect(html).toContain(`media="(prefers-color-scheme: dark)" content="${THEME_COLORS.dark}"`);
  });
});

describe('다크 테마 변수 동일성', () => {
  function parseVars(block) {
    const vars = {};
    for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
    return vars;
  }

  test(":root[data-theme='dark'] 와 prefers-color-scheme 블록의 변수 선언이 완전히 같다", () => {
    const css = fs.readFileSync(path.join(__dirname, 'App.css'), 'utf8');
    // color-scheme 만 있는 짧은 규칙이 먼저 나오므로 변수 블록(--bg 포함)을 고른다
    const explicit = [...css.matchAll(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/g)]
      .map((m) => m[1])
      .find((b) => b.includes('--bg'));
    const media = css.match(
      /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme\]\)\s*\{([^}]*)\}/
    )[1];
    const a = parseVars(explicit);
    const b = parseVars(media);
    expect(Object.keys(a).length).toBeGreaterThan(30);
    expect(b).toEqual(a);
  });
});
