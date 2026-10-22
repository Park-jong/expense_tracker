import { THEMES, THEME_LABELS } from './theme';

export default function ThemeSelect({ theme, onChange }) {
  return (
    <select
      className="theme-select"
      aria-label="테마"
      value={theme}
      onChange={(e) => onChange(e.target.value)}
    >
      {THEMES.map((t) => (
        <option key={t} value={t}>{THEME_LABELS[t]}</option>
      ))}
    </select>
  );
}
