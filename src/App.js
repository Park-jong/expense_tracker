import { useState, useEffect, useRef } from 'react';
import './App.css';
import ListPage from './ListPage';
import CalendarPage from './CalendarPage';
import StatsPage from './StatsPage';
import { initAuth, signIn, signOut, isSignedIn, loadTransactions, saveTransactions } from './googleDrive';
import { today, parseMonth } from './utils';
import { useBudgets } from './useBudgets';
import { loadGuestTransactions, saveGuestTransactions, clearGuestTransactions, mergeTransactions } from './guestStorage';

export default function App() {
  const [transactions, setTransactions] = useState(() => loadGuestTransactions());
  const [tab, setTab] = useState('list');
  const [filterMonth, setFilterMonth] = useState(today().slice(0, 7));

  const [authState, setAuthState] = useState('idle'); // 'idle' | 'loading' | 'signed-in' | 'error'
  const [syncState, setSyncState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [loadFailed, setLoadFailed] = useState(false); // Drive 불러오기 실패 여부
  const isLoaded = useRef(false); // Drive에서 데이터를 불러온 뒤에만 자동 저장
  const loadGen = useRef(0); // 불러오기 요청 세대 (오래된 응답 무효화용)
  const transactionsRef = useRef(transactions); // 최신 거래 목록 (비동기 콜백에서 참조)
  transactionsRef.current = transactions;
  const guestPending = useRef(false); // 게스트 데이터가 Drive에 아직 저장되지 않았는지 여부

  // Drive에서 불러오기. 성공(파일 없음 포함)한 경우에만 자동 저장을 활성화해
  // 실패 시 빈 목록으로 기존 파일을 덮어쓰지 않도록 한다.
  const loadFromDrive = async () => {
    const gen = ++loadGen.current;
    isLoaded.current = false;
    setSyncState('saving');
    setLoadFailed(false);
    try {
      const data = await loadTransactions();
      if (gen !== loadGen.current) return; // 로그아웃/재요청으로 무효화된 응답은 무시
      // 순서: 병합 -> Drive 저장(자동 저장 effect) -> 저장 성공 후에만 게스트 저장소 비움
      const merged = mergeTransactions(data ?? [], transactionsRef.current);
      const hasGuestOnly = merged.length > (data ?? []).length;
      if (data || hasGuestOnly) setTransactions(merged);
      guestPending.current = hasGuestOnly;
      isLoaded.current = true;
      setSyncState('saved');
    } catch {
      if (gen !== loadGen.current) return;
      isLoaded.current = false;
      setLoadFailed(true);
      setSyncState('error');
    }
  };

  // Google Auth 초기화 + 세션 복원
  useEffect(() => {
    setAuthState('loading');
    initAuth()
      .then(async (autoSignedIn) => {
        if (!autoSignedIn) {
          setAuthState('idle');
          return;
        }
        setAuthState('signed-in');
        await loadFromDrive();
      })
      .catch(() => setAuthState('error'));
  }, []);

  // 로그인
  const handleSignIn = async () => {
    setAuthState('loading');
    try {
      await signIn();
    } catch {
      setAuthState('error');
      return;
    }
    setAuthState('signed-in');
    await loadFromDrive();
  };

  // 로그아웃
  const handleSignOut = () => {
    loadGen.current++; // 진행 중인 불러오기 무효화
    signOut();
    setAuthState('idle');
    setSyncState('idle');
    setLoadFailed(false);
    isLoaded.current = false;
    guestPending.current = false;
    setTransactions(loadGuestTransactions()); // 이전 계정 데이터 제거, 게스트 데이터로 복원
  };

  // 게스트 저장: 비로그인이거나 Drive 불러오기 실패 상태일 때만 localStorage에 저장
  // (불러오는 중이거나 로드 성공 후에는 게스트 저장소를 건드리지 않음)
  useEffect(() => {
    const guestMode = authState === 'idle' || authState === 'error';
    if (guestMode || (authState === 'signed-in' && loadFailed)) {
      saveGuestTransactions(transactions);
    }
  }, [transactions, authState, loadFailed]);

  // 거래 변경 시 자동 저장
  useEffect(() => {
    if (!isLoaded.current || !isSignedIn()) return;

    setSyncState('saving');
    const timer = setTimeout(async () => {
      const gen = loadGen.current; // 이 저장이 속한 세션 세대
      try {
        await saveTransactions(transactions);
        if (gen !== loadGen.current) return; // 이전 세션의 저장 결과는 무시
        // Drive 저장 성공 후에만 게스트 저장소를 비움 (실패 시 유지)
        if (isLoaded.current && isSignedIn() && guestPending.current) {
          clearGuestTransactions();
          guestPending.current = false;
        }
        setSyncState('saved');
      } catch {
        if (gen !== loadGen.current) return;
        setSyncState('error');
      }
    }, 800); // 연속 입력 시 디바운스

    return () => clearTimeout(timer);
  }, [transactions]);

  const budgetApi = useBudgets(authState);

  const handleAdd = (data) => {
    setTransactions((prev) => [...prev, { id: Date.now(), ...data }]);
  };

  // 같은 id를 유지한 채 필드만 교체 (Drive/게스트 병합이 id 기준이므로)
  const handleEdit = (id, data) => {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...data, id } : t)));
  };

  // 삭제 실행 취소: 이미 같은 id가 있으면 추가하지 않음
  const handleRestore = (tx) => {
    setTransactions((prev) => (prev.some((t) => t.id === tx.id) ? prev : [...prev, tx]));
  };

  const handleDelete = (id) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  // 월 선택기를 비우거나 형식이 올바르지 않으면 직전 월을 유지
  const handleMonthPick = (e) => {
    if (parseMonth(e.target.value)) setFilterMonth(e.target.value);
  };

  return (
    <div className="app">
      <header className="header">
        <h1>가계부</h1>
        <div className="header-right">
          {tab === 'list' && (
            <input
              type="month"
              value={filterMonth}
              onChange={handleMonthPick}
              className="month-picker"
            />
          )}
          <AuthButton
            authState={authState}
            syncState={syncState}
            loadFailed={loadFailed}
            onRetry={loadFromDrive}
            onSignIn={handleSignIn}
            onSignOut={handleSignOut}
          />
        </div>
      </header>

      <div className="tabs">
        <button className={`tab-btn ${tab === 'list' ? 'active' : ''}`} onClick={() => setTab('list')}>
          목록
        </button>
        <button className={`tab-btn ${tab === 'calendar' ? 'active' : ''}`} onClick={() => setTab('calendar')}>
          달력
        </button>
        <button className={`tab-btn ${tab === 'stats' ? 'active' : ''}`} onClick={() => setTab('stats')}>
          통계
        </button>
      </div>

      {tab === 'list' && (
        <ListPage
          transactions={transactions}
          onAdd={handleAdd}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onRestore={handleRestore}
          filterMonth={filterMonth}
          onFilterMonthChange={setFilterMonth}
          budgetApi={budgetApi}
        />
      )}

      {tab === 'calendar' && (
        <CalendarPage
          transactions={transactions}
          month={filterMonth}
          onMonthChange={setFilterMonth}
        />
      )}

      {tab === 'stats' && (
        <StatsPage
          transactions={transactions}
          month={filterMonth}
          onMonthChange={setFilterMonth}
          authState={authState}
          budgetApi={budgetApi}
        />
      )}
    </div>
  );
}

function AuthButton({ authState, syncState, loadFailed, onRetry, onSignIn, onSignOut }) {
  if (authState === 'signed-in') {
    return (
      <div className="auth-area">
        <span className={`sync-status ${syncState}`}>
          {syncState === 'saving' && '저장 중...'}
          {syncState === 'saved' && '✓ 저장됨'}
          {syncState === 'error' && (loadFailed ? '⚠ 불러오기 실패' : '⚠ 저장 실패')}
        </span>
        {loadFailed && (
          <button className="btn-auth signin" onClick={onRetry}>
            다시 시도
          </button>
        )}
        <button className="btn-auth signout" onClick={onSignOut}>
          로그아웃
        </button>
      </div>
    );
  }

  if (authState === 'loading') {
    return <button className="btn-auth signin" disabled>연결 중...</button>;
  }

  return (
    <div className="auth-area">
      <span className="sync-status">이 기기에만 저장됨</span>
      <button className="btn-auth signin" onClick={onSignIn}>
        Google Drive 연결
      </button>
    </div>
  );
}
