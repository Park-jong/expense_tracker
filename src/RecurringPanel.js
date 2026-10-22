import { useState } from 'react';
import { CATEGORIES } from './categories';
import { formatKRW, today } from './utils';
import {
  CYCLES,
  CYCLE_LABEL,
  WEEKDAY_LABEL,
  daysInMonth,
  describeCycle,
  newRuleId,
  nextOccurrence,
  normalizeRule,
  parseDate,
} from './recurring';

const emptyForm = () => ({
  type: 'expense',
  category: CATEGORIES.expense[0],
  description: '',
  amount: '',
  cycle: 'monthly',
  day: '1',
  weekday: '1',
  month: '1',
  startDate: today(),
  endDate: '',
});

const toForm = (r) => ({
  type: r.type,
  category: r.category,
  description: r.description,
  amount: String(r.amount),
  cycle: r.cycle,
  day: String(r.day ?? 1),
  weekday: String(r.weekday ?? 1),
  month: String(r.month ?? 1),
  startDate: r.startDate,
  endDate: r.endDate ?? '',
});

const toInt = (s) => (/^\d+$/.test(String(s).trim()) ? Number(s) : NaN);

// 폼 -> { rule 입력값 } 또는 { errors: [메시지...] }
const validate = (f) => {
  const errors = [];
  if (f.description.trim() === '') errors.push('내용을 입력해 주세요.');
  const amount = toInt(f.amount);
  if (!Number.isSafeInteger(amount) || amount < 1) errors.push('금액은 1 이상의 정수로 입력해 주세요.');
  const data = {
    type: f.type,
    category: f.category,
    description: f.description.trim(),
    amount,
    cycle: f.cycle,
  };
  if (f.cycle === 'monthly' || f.cycle === 'yearly') {
    const day = toInt(f.day);
    if (!Number.isInteger(day) || day < 1 || day > 31) errors.push('기준일은 1~31 사이의 숫자로 입력해 주세요.');
    else if (f.cycle === 'yearly' && day > daysInMonth(2000, Number(f.month))) errors.push('선택한 월에 없는 날짜입니다.');
    data.day = day;
  }
  if (f.cycle === 'weekly') data.weekday = Number(f.weekday);
  if (f.cycle === 'yearly') data.month = Number(f.month);
  const startOk = !!parseDate(f.startDate);
  if (!startOk) errors.push('시작일을 올바르게 입력해 주세요.');
  data.startDate = f.startDate;
  if (f.endDate !== '') {
    if (!parseDate(f.endDate)) errors.push('종료일을 올바르게 입력해 주세요.');
    else if (startOk && f.endDate < f.startDate) errors.push('종료일은 시작일보다 빠를 수 없습니다.');
  }
  data.endDate = f.endDate === '' ? null : f.endDate;
  return { errors, data };
};

// 목록 탭 하단의 접이식 반복 거래 패널. 규칙 저장/동기화는 useRecurring 이 맡고, 거래 자동 생성은 App 이 맡는다.
export default function RecurringPanel({ recurringApi, notice, onDismissNotice, authState }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [errors, setErrors] = useState([]);
  const [overwriteNotice, setOverwriteNotice] = useState(false);

  if (!recurringApi) return null;
  const { rules, setRules, loading, loadFailed, loadError, syncState, retry, retrySave, overwriteDrive } = recurringApi;
  const todayStr = today();

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm());
    setErrors([]);
  };

  const startAdd = () => {
    setForm(emptyForm());
    setEditingId(null);
    setErrors([]);
    setShowForm(true);
  };

  const startEdit = (r) => {
    setForm(toForm(r));
    setEditingId(r.id);
    setErrors([]);
    setShowForm(true);
  };

  const set = (key, value) => setForm((p) => ({ ...p, [key]: value }));

  const changeType = (type) => setForm((p) => ({ ...p, type, category: CATEGORIES[type][0] }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const { errors: errs, data } = validate(form);
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    const existing = editingId ? rules.find((r) => r.id === editingId) : null;
    const rule = normalizeRule({
      ...data,
      id: existing ? existing.id : newRuleId(),
      lastGenerated: existing ? existing.lastGenerated : null,
    });
    if (!rule) {
      setErrors(['입력값을 확인해 주세요.']);
      return;
    }
    setRules((prev) => (existing ? prev.map((r) => (r.id === rule.id ? rule : r)) : [...prev, rule]));
    closeForm();
  };

  const handleDelete = (r) => {
    if (!window.confirm(`"${r.description}" 반복 규칙을 삭제할까요? 이미 생성된 거래는 삭제되지 않습니다.`)) return;
    setRules((prev) => prev.filter((x) => x.id !== r.id));
    if (editingId === r.id) closeForm();
  };

  const handleOverwrite = async () => {
    setOverwriteNotice(false);
    if (!window.confirm('Drive의 반복 거래 파일을 현재 화면의 규칙으로 덮어쓸까요? 기존 Drive 반복 거래 파일 내용은 사라집니다.')) return;
    const ok = await overwriteDrive();
    if (!ok) setOverwriteNotice(true);
  };

  let statusLine = null;
  if (loading) {
    statusLine = <span>반복 거래를 불러오는 중…</span>;
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
    <section className="stats-card recurring-panel" aria-labelledby="recurring-title">
      <div className="stats-card-head">
        <h2 id="recurring-title" className="stats-title">반복 거래</h2>
        <button
          type="button"
          className="stats-toggle"
          aria-expanded={open}
          aria-controls="recurring-body"
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '접기' : '펼치기'}
        </button>
      </div>

      {notice && (
        <div className="recurring-notice-row">
          <p className="recurring-notice" role="status">{notice}</p>
          {onDismissNotice && (
            <button type="button" className="recurring-notice-close" aria-label="알림 닫기" onClick={onDismissNotice}>×</button>
          )}
        </div>
      )}

      {loadFailed && loadError === 'network' && (
        <div className="budget-notice">
          <p>⚠ Drive의 반복 거래 규칙을 불러오지 못했습니다. 불러오기에 성공할 때까지 자동 등록은 멈춥니다.</p>
          <button type="button" className="budget-link-btn" onClick={retry}>다시 불러오기</button>
        </div>
      )}

      {loadFailed && loadError === 'corrupt' && (
        <div className="budget-notice">
          <p>⚠ Drive의 반복 거래 파일이 손상되어 읽을 수 없습니다. 자동 등록은 멈춰 있습니다.</p>
          <p className="budget-help">덮어쓰면 현재 화면의 규칙으로 Drive 반복 거래 파일이 교체됩니다.</p>
          <button
            type="button"
            className="budget-link-btn"
            onClick={handleOverwrite}
            disabled={syncState === 'saving'}
          >
            반복 거래 파일 덮어쓰기
          </button>
          {overwriteNotice && (
            <p className="budget-help">지금은 덮어쓸 수 없습니다. 저장이 끝난 뒤 다시 시도해 주세요.</p>
          )}
        </div>
      )}

      {open && (
        <div id="recurring-body">
          {statusLine && <p className="budget-sync">{statusLine}</p>}

          <p className="budget-help recurring-help">
            월세·구독료처럼 정해진 날 반복되는 거래를 자동으로 등록합니다. 시작일이 과거이면 지난 발생분도 등록되며,
            규칙을 삭제해도 이미 생성된 거래는 삭제되지 않습니다.
          </p>

          {rules.length === 0 ? (
            <p className="budget-empty">등록된 반복 규칙이 없습니다.</p>
          ) : (
            <ul className="recurring-list">
              {rules.map((r) => {
                const next = nextOccurrence(r, todayStr);
                return (
                  <li key={r.id} className="recurring-item">
                    <div className="recurring-main">
                      <span className="recurring-desc" title={r.description}>{r.description}</span>
                      <span className={`recurring-amount ${r.type}`}>
                        {r.type === 'income' ? '+' : '-'}{formatKRW(r.amount)}
                      </span>
                    </div>
                    <p className="recurring-meta">
                      {describeCycle(r)} · {r.category} · {next ? `다음 ${next}` : r.endDate ? '종료됨' : '다음 -'}
                    </p>
                    <div className="recurring-actions">
                      <button type="button" className="btn-edit" aria-label={`반복 규칙 수정: ${r.description}`} onClick={() => startEdit(r)}>
                        수정
                      </button>
                      <button type="button" className="btn-delete" aria-label={`반복 규칙 삭제: ${r.description}`} onClick={() => handleDelete(r)}>
                        삭제
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {!showForm && (
            <button type="button" className="stats-toggle recurring-add" onClick={startAdd} disabled={loading}>
              + 반복 규칙 추가
            </button>
          )}

          {showForm && (
            <form className="recurring-form" onSubmit={handleSubmit} noValidate aria-label={editingId ? '반복 규칙 수정' : '반복 규칙 추가'}>
              <div className="recurring-field">
                <label htmlFor="rec-type">유형</label>
                <select id="rec-type" value={form.type} onChange={(e) => changeType(e.target.value)}>
                  <option value="expense">지출</option>
                  <option value="income">수입</option>
                </select>
              </div>
              <div className="recurring-field">
                <label htmlFor="rec-category">카테고리</label>
                <select id="rec-category" value={form.category} onChange={(e) => set('category', e.target.value)}>
                  {CATEGORIES[form.type].map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="recurring-field recurring-wide">
                <label htmlFor="rec-desc">내용</label>
                <input id="rec-desc" type="text" value={form.description} placeholder="예: 월세" onChange={(e) => set('description', e.target.value)} />
              </div>
              <div className="recurring-field">
                <label htmlFor="rec-amount">금액 (원)</label>
                <input id="rec-amount" type="number" min="1" step="1" inputMode="numeric" value={form.amount} onChange={(e) => set('amount', e.target.value)} />
              </div>
              <div className="recurring-field">
                <label htmlFor="rec-cycle">주기</label>
                <select id="rec-cycle" value={form.cycle} onChange={(e) => set('cycle', e.target.value)}>
                  {CYCLES.map((c) => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}
                </select>
              </div>
              {form.cycle === 'yearly' && (
                <div className="recurring-field">
                  <label htmlFor="rec-month">월</label>
                  <select id="rec-month" value={form.month} onChange={(e) => set('month', e.target.value)}>
                    {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}월</option>)}
                  </select>
                </div>
              )}
              {form.cycle !== 'weekly' && (
                <div className="recurring-field">
                  <label htmlFor="rec-day">기준일 (일)</label>
                  <input id="rec-day" type="number" min="1" max="31" step="1" inputMode="numeric" value={form.day} onChange={(e) => set('day', e.target.value)} />
                </div>
              )}
              {form.cycle === 'weekly' && (
                <div className="recurring-field">
                  <label htmlFor="rec-weekday">요일</label>
                  <select id="rec-weekday" value={form.weekday} onChange={(e) => set('weekday', e.target.value)}>
                    {WEEKDAY_LABEL.map((w, i) => <option key={w} value={String(i)}>{w}요일</option>)}
                  </select>
                </div>
              )}
              <div className="recurring-field">
                <label htmlFor="rec-start">시작일</label>
                <input id="rec-start" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
              </div>
              <div className="recurring-field">
                <label htmlFor="rec-end">종료일 (선택)</label>
                <input id="rec-end" type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
              </div>
              {errors.length > 0 && (
                <ul className="recurring-errors" role="alert">
                  {errors.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
              <div className="budget-form-actions">
                <button type="submit" className="btn-submit">{editingId ? '수정 저장' : '규칙 저장'}</button>
                <button type="button" className="btn-filter-reset" onClick={closeForm}>취소</button>
              </div>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
