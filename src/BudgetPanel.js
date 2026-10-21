import { useState } from 'react';
import { CATEGORIES } from './categories';
import { budgetStatus, emptyBudgets, BUDGET_VERSION, formatBudgetPercent } from './budget';
import { formatKRW } from './utils';

const FIELD_ERROR = '1 이상의 정수를 입력해 주세요.';

// 입력 문자열 -> { value: 숫자|null, error: bool }. 비어 있으면 미설정(null)
const parseField = (raw) => {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: null, error: false };
  if (!/^\d+$/.test(s)) return { value: null, error: true };
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1) return { value: null, error: true };
  return { value: n, error: false };
};

const toInputs = (budgets) => {
  const b = budgets ?? emptyBudgets();
  const categories = {};
  CATEGORIES.expense.forEach((c) => {
    categories[c] = b.categories && c in b.categories ? String(b.categories[c]) : '';
  });
  return { total: b.total != null ? String(b.total) : '', categories };
};

const STATUS_TEXT = {
  ok: (e) => `${formatBudgetPercent(e.ratio)} 사용 · 남은 ${formatKRW(e.remaining)}`,
  warn: (e) => `주의 · ${formatBudgetPercent(e.ratio)} 사용 · 남은 ${formatKRW(e.remaining)}`,
  over: (e) => `초과 · ${formatKRW(-e.remaining)} 더 사용`,
};
const STATUS_ICON = { ok: '', warn: '⚠', over: '⛔' };

function BudgetMeter({ name, entry }) {
  const fillRatio = entry.spent > 0 ? Math.min(entry.ratio, 1) : 0;
  const label = `${name} 예산, 사용 ${formatKRW(entry.spent)} / 예산 ${formatKRW(entry.budget)}, ${formatBudgetPercent(entry.ratio)}`;
  return (
    <li className={`budget-row ${entry.status}`}>
      <div className="budget-head">
        <span className="budget-name" title={name}>{name}</span>
        <span className="budget-amount">{formatKRW(entry.spent)} / {formatKRW(entry.budget)}</span>
      </div>
      <div
        className="budget-meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={entry.budget}
        aria-valuenow={entry.spent}
        aria-label={label}
      >
        <div className="budget-fill" style={{ width: `${fillRatio * 100}%` }} />
      </div>
      <p className="budget-status">
        {STATUS_ICON[entry.status] && <span aria-hidden="true">{STATUS_ICON[entry.status]} </span>}
        {STATUS_TEXT[entry.status](entry)}
      </p>
    </li>
  );
}

export default function BudgetPanel({ transactions, month, authState, budgetApi }) {
  const [open, setOpen] = useState(false);
  const [inputs, setInputs] = useState(() => toInputs(null));
  const [errors, setErrors] = useState({});
  const [overwriteNotice, setOverwriteNotice] = useState(false);

  if (!budgetApi) return null;
  const {
    budgets, setBudgets, loading, loadFailed, loadError, syncState, retry, retrySave, overwriteDrive,
  } = budgetApi;

  const status = budgetStatus(transactions, month, budgets);
  const isEmpty = status.total === null && status.categories.length === 0;

  // 폼은 열 때만 현재 값으로 초기화 (열려 있는 동안 budgets 가 바뀌어도 입력값 유지)
  const openForm = () => {
    setInputs(toInputs(budgets));
    setErrors({});
    setOpen(true);
  };
  const closeForm = () => {
    setOpen(false);
    setErrors({});
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const nextErrors = {};
    const total = parseField(inputs.total);
    if (total.error) nextErrors.total = true;
    const categories = {};
    CATEGORIES.expense.forEach((c) => {
      const r = parseField(inputs.categories[c]);
      if (r.error) nextErrors[c] = true;
      else if (r.value !== null) categories[c] = r.value;
    });
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setBudgets({ version: BUDGET_VERSION, total: total.value, categories });
    closeForm();
  };

  const handleOverwrite = async () => {
    setOverwriteNotice(false);
    if (!window.confirm('Drive의 예산 파일을 현재 화면의 예산으로 덮어쓸까요? 기존 Drive 예산 파일 내용은 사라집니다.')) return;
    const ok = await overwriteDrive();
    if (!ok) setOverwriteNotice(true);
  };

  const field = (key, label, value, onChange) => {
    const id = `budget-input-${key}`;
    const errId = `${id}-error`;
    return (
      <div className="budget-field" key={key}>
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type="number"
          min="1"
          step="1"
          inputMode="numeric"
          placeholder="미설정"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={errors[key] ? 'true' : undefined}
          aria-describedby={errors[key] ? errId : undefined}
        />
        {errors[key] && <p id={errId} className="budget-error">{FIELD_ERROR}</p>}
      </div>
    );
  };

  let statusLine = null;
  if (loading) {
    statusLine = <span>예산을 불러오는 중…</span>;
  } else if (!loadFailed) {
    if (authState !== 'signed-in') {
      statusLine = <span>이 기기에만 저장됨</span>;
    } else if (syncState === 'saving') {
      statusLine = <span>저장 중…</span>;
    } else if (syncState === 'saved') {
      statusLine = <span>✓ 저장됨</span>;
    } else if (syncState === 'error') {
      statusLine = (
        <>
          <span>⚠ 저장 실패</span>
          <button type="button" className="budget-link-btn" onClick={retrySave}>다시 시도</button>
        </>
      );
    }
  }

  return (
    <section className="stats-card budget-panel" aria-labelledby="budget-title">
      <div className="stats-card-head">
        <h2 id="budget-title" className="stats-title">월 예산</h2>
        <button
          type="button"
          className="stats-toggle"
          onClick={open ? closeForm : openForm}
          disabled={loading}
          aria-expanded={open}
        >
          예산 설정
        </button>
      </div>

      {statusLine && <p className="budget-sync">{statusLine}</p>}

      {loadFailed && loadError === 'network' && (
        <div className="budget-notice">
          <p>⚠ Drive 예산을 불러오지 못했습니다. 변경은 이 기기에만 임시 저장됩니다.</p>
          <button type="button" className="budget-link-btn" onClick={retry}>다시 불러오기</button>
        </div>
      )}

      {loadFailed && loadError === 'corrupt' && (
        <div className="budget-notice">
          <p>⚠ Drive의 예산 파일이 손상되어 읽을 수 없습니다.</p>
          <p className="budget-help">덮어쓰면 현재 화면의 예산으로 Drive 예산 파일이 교체됩니다.</p>
          <button
            type="button"
            className="budget-link-btn"
            onClick={handleOverwrite}
            disabled={syncState === 'saving'}
          >
            예산 파일 덮어쓰기
          </button>
          {overwriteNotice && (
            <p className="budget-help">지금은 덮어쓸 수 없습니다. 저장이 끝난 뒤 다시 시도해 주세요.</p>
          )}
        </div>
      )}

      {open && (
        <form className="budget-form" onSubmit={handleSubmit} noValidate>
          {field('total', '전체 월 예산', inputs.total, (v) => setInputs((p) => ({ ...p, total: v })))}
          {CATEGORIES.expense.map((c) =>
            field(c, c, inputs.categories[c], (v) =>
              setInputs((p) => ({ ...p, categories: { ...p.categories, [c]: v } }))
            )
          )}
          <div className="budget-form-actions">
            <button type="submit" className="btn-submit">저장</button>
            <button type="button" className="btn-filter-reset" onClick={closeForm}>취소</button>
          </div>
        </form>
      )}

      {isEmpty ? (
        <p className="budget-empty">설정된 예산이 없습니다. 예산 설정에서 카테고리별 월 예산을 정해 보세요.</p>
      ) : (
        <ul className="budget-list">
          {status.total && <BudgetMeter name="전체" entry={status.total} />}
          {status.categories.map((c) => (
            <BudgetMeter key={c.category} name={c.category} entry={c} />
          ))}
        </ul>
      )}
    </section>
  );
}
