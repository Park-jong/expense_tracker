import { budgetStatus, formatBudgetPercent } from './budget';
import { formatKRW } from './utils';

// 목록 탭의 예산 알림: 주의/초과 항목만 한 줄씩. 낭독을 유발하지 않도록 role="alert"/aria-live 는 쓰지 않는다
export default function BudgetAlerts({ transactions, month, budgetApi }) {
  if (!budgetApi || budgetApi.loading) return null;
  const status = budgetStatus(transactions, month, budgetApi.budgets);
  const items = [];
  if (status.total) items.push({ name: '전체', entry: status.total });
  status.categories.forEach((c) => items.push({ name: c.category, entry: c }));

  const alerts = items.filter((i) => i.entry.status === 'over' || i.entry.status === 'warn');
  if (alerts.length === 0) return null;

  return (
    <section className="budget-alerts" aria-label="예산 알림">
      {alerts.map(({ name, entry }) =>
        entry.status === 'over' ? (
          <p key={name} className="budget-alert over">
            ⛔ {name} 예산 초과 · {formatKRW(-entry.remaining)} 더 사용
          </p>
        ) : (
          <p key={name} className="budget-alert warn">
            ⚠ {name} 예산 주의 · {formatBudgetPercent(entry.ratio)} 사용
          </p>
        )
      )}
    </section>
  );
}
