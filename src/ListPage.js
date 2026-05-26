import { useState } from 'react';

const CATEGORIES = {
  income: ['급여', '부업', '투자', '기타수입'],
  expense: ['식비', '교통', '주거', '의료', '쇼핑', '문화', '기타지출'],
};

const formatKRW = (amount) => amount.toLocaleString('ko-KR') + '원';

const today = () => new Date().toISOString().slice(0, 10);

export default function ListPage({ transactions, onAdd, onDelete, filterMonth, onFilterMonthChange }) {
  const [form, setForm] = useState({
    date: today(),
    type: 'expense',
    category: '식비',
    description: '',
    amount: '',
  });
  const [showForm, setShowForm] = useState(false);

  const filtered = transactions.filter((t) => t.date.startsWith(filterMonth));

  const totalIncome = filtered
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const totalExpense = filtered
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + t.amount, 0);

  const balance = totalIncome - totalExpense;

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
    onAdd({
      date: form.date,
      type: form.type,
      category: form.category,
      description: form.description.trim(),
      amount: parseInt(form.amount, 10),
    });
    setForm({ date: today(), type: 'expense', category: '식비', description: '', amount: '' });
    setShowForm(false);
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

      <div className="add-area">
        <button className="btn-add" onClick={() => setShowForm((v) => !v)}>
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
          <button type="submit" className="btn-submit">저장</button>
        </form>
      )}

      <section className="transaction-list">
        {filtered.length === 0 ? (
          <p className="empty">이 달의 거래 내역이 없습니다.</p>
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
                  <button className="btn-delete" onClick={() => onDelete(t.id)}>삭제</button>
                </div>
              </div>
            ))
        )}
      </section>
    </>
  );
}
