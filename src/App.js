import { useState, useEffect, useRef } from 'react';
import './App.css';
import ListPage from './ListPage';
import CalendarPage from './CalendarPage';
import StatsPage from './StatsPage';
import { initAuth, signIn, signOut, isSignedIn, loadTransactions, saveTransactions } from './googleDrive';
import { today, parseMonth } from './utils';
import { planImport } from './csvTransfer';
import { useBudgets } from './useBudgets';
import { useRecurring } from './useRecurring';
import { planGeneration, applyDrafts, draftKeys, isGenerationSaved, txKey } from './recurring';
import useTheme from './useTheme';
import ThemeSelect from './ThemeSelect';
import { loadGuestTransactions, saveGuestTransactions, clearGuestTransactions, mergeTransactions } from './guestStorage';

export default function App() {
  const [transactions, setTransactions] = useState(() => loadGuestTransactions());
  const [theme, setTheme] = useTheme();
  const [tab, setTab] = useState('list');
  const [filterMonth, setFilterMonth] = useState(today().slice(0, 7));

  const [authState, setAuthState] = useState('idle'); // 'idle' | 'loading' | 'signed-in' | 'error'
  const [syncState, setSyncState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [loadFailed, setLoadFailed] = useState(false); // Drive 불러오기 실패 여부
  const isLoaded = useRef(false); // Drive에서 데이터를 불러온 뒤에만 자동 저장
  const loadGen = useRef(0); // 불러오기 요청 세대 (오래된 응답 무효화용)
  const transactionsRef = useRef(transactions); // 최신 거래 목록 (비동기 콜백에서 참조)
  transactionsRef.current = transactions;
  const savedQueue = useRef([]); // Drive 저장에 성공한 거래 배열들(반복 거래 생성 effect 가 소비)
  const [savedSeq, setSavedSeq] = useState(0); // 저장 성공 시마다 증가해 생성 effect 를 깨움
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
        savedQueue.current.push(transactions); // 저장 성공 신호: 이 저장에 쓰인 거래 배열 기록
        setSavedSeq((n) => n + 1);
      } catch {
        if (gen !== loadGen.current) return;
        setSyncState('error');
      }
    }, 800); // 연속 입력 시 디바운스

    return () => clearTimeout(timer);
  }, [transactions]);

  const budgetApi = useBudgets(authState);
  const recurringApi = useRecurring(authState);
  const [recurringNotice, setRecurringNotice] = useState(null);
  const pendingGen = useRef(null); // 로그인 모드: 생성 거래가 Drive 에 저장되기 전까지 규칙의 lastGenerated 반영을 보류 { updates, keys }

  // 알림은 8초 뒤 자동으로 사라진다(언마운트 시 타이머 정리)
  useEffect(() => {
    if (!recurringNotice) return;
    const t = setTimeout(() => setRecurringNotice(null), 8000);
    return () => clearTimeout(t);
  }, [recurringNotice]);

  // 인증 초기화가 시작되기 전(첫 렌더의 'idle')에는 비로그인으로 오인해 거래를 만들지 않기 위한 표시
  const [authBooted, setAuthBooted] = useState(false);
  useEffect(() => {
    if (authState !== 'idle') setAuthBooted(true);
  }, [authState]);

  // 반복 거래 자동 생성. 거래와 반복 규칙 불러오기가 모두 성공한 뒤에만 실행한다(실패 시 생성·저장 없음).
  // lastGenerated 가 앞서 있어 삭제한 거래는 되살아나지 않고, 같은 내용의 거래가 있으면 건너뛰어 중복을 막는다.
  const { rules, ready: rulesReady, markGenerated } = recurringApi;
  useEffect(() => {
    const guestMode = authState === 'idle' || authState === 'error';
    const txReady = authBooted && (guestMode || (authState === 'signed-in' && isLoaded.current && !loadFailed));
    // 성공 신호 큐는 실행마다 비워 누적을 막는다(규칙 로드 실패 등으로 아래에서 일찍 반환해도 쌓이지 않음). 최근 5개만 판정에 쓴다.
    const successes = savedQueue.current.slice(-5);
    savedQueue.current = [];
    if (!txReady || !rulesReady) {
      pendingGen.current = null; // 세션·불러오기 상태가 바뀌면 보류분 폐기(다음 로드 때 재생성, 내용 중복 검사로 중복 없음)
      return;
    }
    // 로그인 모드: 저장 성공 신호(savedQueue)가 온 뒤에만 판단한다. 성공한 저장 배열에 생성하려던 내용 키가 모두 있으면
    // (그 사이 사용자가 삭제·수정해 현재 목록에 없는 키는 충족으로 간주) 규칙을 저장한다. id 는 쓰지 않는다.
    // 저장 실패는 신호가 없으므로 보류를 유지하고 다음 성공 저장에서 다시 판정한다.
    const pending = pendingGen.current;
    if (pending) {
      const current = transactionsRef.current;
      const done = successes.some((arr) => isGenerationSaved(pending.keys, arr, current));
      if (done) {
        pendingGen.current = null;
        markGenerated(pending.updates);
      }
      return;
    }
    const { drafts, updates, skipped } = planGeneration(rules, today());
    if (Object.keys(updates).length === 0) return;
    const nowMs = Date.now(); // 업데이터 밖에서 한 번만 읽음
    const base = transactionsRef.current;
    const added = applyDrafts(base, drafts, nowMs).length - base.length; // 알림 표시용 건수
    setTransactions((prev) => applyDrafts(prev, drafts, nowMs)); // 순수 업데이터
    const baseKeys = new Set(base.map(txKey)); // 이미 있는 내용은 저장을 기다릴 필요 없음
    const keys = draftKeys(drafts).filter((k) => !baseKeys.has(k));
    if (authState === 'signed-in' && keys.length > 0) {
      pendingGen.current = { updates, keys }; // 같은 내용의 거래가 담긴 저장 성공을 기다림
    } else markGenerated(updates); // 게스트(동기 저장)이거나 새로 추가된 거래가 없으면 바로 반영
    const parts = [];
    if (added > 0) parts.push(`반복 거래 ${added}건을 자동으로 등록했습니다.`);
    if (skipped > 0) parts.push(`오래된 ${skipped}건은 한 번에 만들 수 있는 상한(규칙당 366건)을 넘어 등록하지 않았습니다.`);
    if (parts.length > 0) setRecurringNotice(parts.join(' '));
  }, [authState, authBooted, syncState, savedSeq, loadFailed, rulesReady, rules, markGenerated]);

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

  // CSV 가져오기: 검증된 원시 행을 받아 최신 상태(prev) 기준으로 중복 제외·id 부여 후 뒤에 추가
  // planImport 는 순수 함수라 StrictMode 이중 호출에도 같은 결과를 낸다
  const handleImport = (rows) => {
    setTransactions((prev) => {
      const { toAdd } = planImport(prev, rows);
      return toAdd.length === 0 ? prev : [...prev, ...toAdd];
    });
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
          <ThemeSelect theme={theme} onChange={setTheme} />
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
          onImport={handleImport}
          importDisabled={loadFailed}
          filterMonth={filterMonth}
          onFilterMonthChange={setFilterMonth}
          budgetApi={budgetApi}
          recurringApi={recurringApi}
          recurringNotice={recurringNotice}
          onDismissRecurringNotice={() => setRecurringNotice(null)}
          authState={authState}
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
