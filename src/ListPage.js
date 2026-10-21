import { useState, useRef, useEffect } from 'react';
import { CATEGORIES } from './categories';
import { formatKRW, today, monthOfDate, filterTransactions } from './utils';
import BudgetAlerts from './BudgetAlerts';

const UNDO_MS = 6000; // 삭제 실행 취소 알림 표시 시간

const emptyFilter = () => ({ type: 'all', category: 'all', keyword: '' });

// 필터용 카테고리 목록: 유형이 전체면 수입·지출 카테고리를 합쳐 중복 제거
const filterCategories = (type) =>
  type === 'all' ? [...new Set([...CATEGORIES.income, ...CATEGORIES.expense])] : CATEGORIES[type];

const emptyForm = () => ({
  date: today(),
  type: 'expense',
  category: '식비',
  description: '',
  amount: '',
});

export default function ListPage({ transactions, onAdd, onEdit, onDelete, onRestore, filterMonth, onFilterMonthChange, budgetApi }) {
  const [form, setForm] = useState(emptyForm);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null); // 수정 중인 거래 id (null이면 추가 모드)
  const [deleted, setDeleted] = useState(null); // 마지막으로 삭제한 거래 (실행 취소용)
  const [filter, setFilter] = useState(emptyFilter); // 유형/카테고리/키워드 필터
  const undoTimer = useRef(null);

  // 언마운트 시 타이머 정리
  useEffect(() => () => clearTimeout(undoTimer.current), []);

  const closeForm = () => {
    setForm(emptyForm());
    setEditingId(null);
    setShowForm(false);
  };

  const handleToggleForm = () => {
    if (showForm) closeForm();
    else setShowForm(true);
  };

  const handleEditStart = (t) => {
    setForm({
      date: t.date,
      type: t.type,
      category: t.category,
      description: t.description,
      amount: String(t.amount),
    });
    setEditingId(t.id);
    setShowForm(true);
  };

  const handleDeleteClick = (t) => {
    onDelete(t.id);
    if (editingId === t.id) closeForm();
    clearTimeout(undoTimer.current);
    setDeleted(t);
    undoTimer.current = setTimeout(() => setDeleted(null), UNDO_MS);
  };

  const handleUndo = () => {
    clearTimeout(undoTimer.current);
    if (deleted) onRestore(deleted);
    setDeleted(null);
  };

  // 해당 월 전체 거래 (요약 카드는 필터와 무관)
  const monthly = transactions.filter((t) => t.date.startsWith(filterMonth));

  const totalIncome = monthly
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpense = monthly
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const balance = totalIncome - totalExpense;

  // 필터가 적용된 거래 (목록 표시용)
  const filterActive = filter.type !== 'all' || filter.category !== 'all' || filter.keyword.trim() !== '';
  const filtered = filterTransactions(monthly, filter);
  const filteredIncome = filtered
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);
  const filteredExpense = filtered
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const handleFilterType = (e) => {
    const type = e.target.value;
    setFilter((prev) => ({
      ...prev,
      type,
      category: prev.category === 'all' || filterCategories(type).includes(prev.category) ? prev.category : 'all',
    }));
  };

  const handleFilterCategory = (e) => setFilter((prev) => ({ ...prev, category: e.target.value }));
  const handleFilterKeyword = (e) => setFilter((prev) => ({ ...prev, keyword: e.target.value }));
  const resetFilter = () => setFilter(emptyFilter());

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setForm((prev) => {
      const updated = { ...prev, [name]: value };
      if (name === 'type') updated.category = CATEGORIES[value][0];
      return updated;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!form.description.trim() || !form.amount) return;
    const data = {
      date: form.date,
      type: form.type,
      category: form.category,
      description: form.description.trim(),
      amount: parseInt(form.amount, 10),
    };
    if (!(data.amount >= 1)) return;
    if (editingId !== null) onEdit(editingId, data);
    else onAdd(data);
    // 저장한 거래가 현재 월 밖이면 그 거래의 월로 이동
    const savedMonth = monthOfDate(data.date);
    if (savedMonth && savedMonth !== filterMonth) onFilterMonthChange(savedMonth);
    // 방금 저장한 거래가 필터에 가려지지 않도록 필터 초기화
    if (filterActive) resetFilter();
    closeForm();
  };

  return (
    <>
      <section className="summary">
        <div className="card income-card">
          <span className="card-label">수입</span>
          <span className="card-amount">{formatKRW(totalIncome)}</span>
        </div>
        <div className="card expense-card">
          <span className="card-label">지출</span>
          <span className="card-amount">{formatKRW(totalExpense)}</span>
        </div>
        <div className={`card balance-card ${balance >= 0 ? 'positive' : 'negative'}`}>
          <span className="card-label">잔액</span>
          <span className="card-amount">{formatKRW(balance)}</span>
        </div>
      </section>

      <BudgetAlerts transactions={transactions} month={filterMonth} budgetApi={budgetApi} />

      <div className="add-area">
        <button className="btn-add" onClick={handleToggleForm}>
          {showForm ? '취소' : '+ 거래 추가'}
        </button>
      </div>

      {showForm && (
        <form className="form" onSubmit={handleSubmit}>
          <div className="form-row">
            <label>날짜</label>
            <input type="date" name="date" value={form.date} onChange={handleFormChange} required />
          </div>
          <div className="form-row">
            <label>유형</label>
            <select name="type" value={form.type} onChange={handleFormChange}>
              <option value="income">수입</option>
              <option value="expense">지출</option>
            </select>
          </div>
          <div className="form-row">
            <label>카테고리</label>
            <select name="category" value={form.category} onChange={handleFormChange}>
              {CATEGORIES[form.type].map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <label>내용</label>
            <input
              type="text"
              name="description"
              value={form.description}
              onChange={handleFormChange}
              placeholder="거래 내용을 입력하세요"
              required
            />
          </div>
          <div className="form-row">
            <label>금액</label>
            <input
              type="number"
              name="amount"
              value={form.amount}
              onChange={handleFormChange}
              placeholder="금액 (원)"
              min="1"
              required
            />
          </div>
          <button type="submit" className="btn-submit">{editingId !== null ? '수정 저장' : '저장'}</button>
        </form>
      )}

      <section className="filter-bar">
        <select
          aria-label="유형 필터"
          value={filter.type}
          onChange={handleFilterType}
        >
          <option value="all">전체 유형</option>
          <option value="income">수입</option>
          <option value="expense">지출</option>
        </select>
        <select
          aria-label="카테고리 필터"
          value={filter.category}
          onChange={handleFilterCategory}
        >
          <option value="all">전체 카테고리</option>
          {filterCategories(filter.type).map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          type="search"
          aria-label="내용 검색"
          placeholder="내용 검색"
          value={filter.keyword}
          onChange={handleFilterKeyword}
        />
        {filterActive && (
          <button type="button" className="btn-filter-reset" onClick={resetFilter}>
            필터 초기화
          </button>
        )}
      </section>

      {filterActive && (
        <p className="filter-result">
          조건에 맞는 거래 {filtered.length}건 · 수입 {formatKRW(filteredIncome)} · 지출 {formatKRW(filteredExpense)}
        </p>
      )}

      <section className="transaction-list">
        {filtered.length === 0 ? (
          <p className="empty">
            {filterActive ? '조건에 맞는 거래가 없습니다.' : '이 달의 거래 내역이 없습니다.'}
          </p>
        ) : (
          [...filtered]
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((t) => (
              <div key={t.id} className={`transaction-item ${t.type}`}>
                <div className="tx-left">
                  <span className="tx-date">{t.date}</span>
                  <span className="tx-category">{t.category}</span>
                  <span className="tx-desc">{t.description}</span>
                </div>
                <div className="tx-right">
                  <span className="tx-amount">
                    {t.type === 'income' ? '+' : '-'}{formatKRW(t.amount)}
                  </span>
                  <div className="tx-actions">
                    <button
                      className="btn-edit"
                      aria-label={`수정: ${t.description}`}
                      onClick={() => handleEditStart(t)}
                    >
                      수정
                    </button>
                    <button
                      className="btn-delete"
                      aria-label={`삭제: ${t.description}`}
                      onClick={() => handleDeleteClick(t)}
                    >
                      삭제
                    </button>
                  </div>
                </div>
              </div>
            ))
        )}
      </section>

      {deleted && (
        <div className="undo-bar" role="status">
          <span>거래를 삭제했습니다 ·</span>
          <button className="btn-undo" onClick={handleUndo}>실행 취소</button>
        </div>
      )}
    </>
  );
}
