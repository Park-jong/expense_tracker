import { useState, useEffect, useRef } from 'react';
import './App.css';
import ListPage from './ListPage';
import CalendarPage from './CalendarPage';
import { initAuth, signIn, signOut, isSignedIn, loadTransactions, saveTransactions } from './googleDrive';

const today = () => new Date().toISOString().slice(0, 10);

export default function App() {
  const [transactions, setTransactions] = useState([]);
  const [tab, setTab] = useState('list');
  const [filterMonth, setFilterMonth] = useState(today().slice(0, 7));

  const [authState, setAuthState] = useState('idle'); // 'idle' | 'loading' | 'signed-in' | 'error'
  const [syncState, setSyncState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const isLoaded = useRef(false); // Drive에서 데이터를 불러온 뒤에만 자동 저장

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
        setSyncState('saving');
        try {
          const data = await loadTransactions();
          if (data) setTransactions(data);
          isLoaded.current = true;
          setSyncState('saved');
        } catch {
          isLoaded.current = true;
          setSyncState('error');
        }
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
    setSyncState('saving');
    try {
      const data = await loadTransactions();
      if (data) setTransactions(data);
      isLoaded.current = true;
      setSyncState('saved');
    } catch {
      isLoaded.current = true;
      setSyncState('error');
    }
  };

  // 로그아웃
  const handleSignOut = () => {
    signOut();
    setAuthState('idle');
    setSyncState('idle');
    isLoaded.current = false;
    setTransactions([]);
  };

  // 거래 변경 시 자동 저장
  useEffect(() => {
    if (!isLoaded.current || !isSignedIn()) return;

    setSyncState('saving');
    const timer = setTimeout(async () => {
      try {
        await saveTransactions(transactions);
        setSyncState('saved');
      } catch {
        setSyncState('error');
      }
    }, 800); // 연속 입력 시 디바운스

    return () => clearTimeout(timer);
  }, [transactions]);

  const handleAdd = (data) => {
    setTransactions((prev) => [...prev, { id: Date.now(), ...data }]);
  };

  const handleDelete = (id) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
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
              onChange={(e) => setFilterMonth(e.target.value)}
              className="month-picker"
            />
          )}
          <AuthButton
            authState={authState}
            syncState={syncState}
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
      </div>

      {tab === 'list' && (
        <ListPage
          transactions={transactions}
          onAdd={handleAdd}
          onDelete={handleDelete}
          filterMonth={filterMonth}
          onFilterMonthChange={setFilterMonth}
        />
      )}

      {tab === 'calendar' && (
        <CalendarPage transactions={transactions} />
      )}
    </div>
  );
}

function AuthButton({ authState, syncState, onSignIn, onSignOut }) {
  if (authState === 'signed-in') {
    return (
      <div className="auth-area">
        <span className={`sync-status ${syncState}`}>
          {syncState === 'saving' && '저장 중...'}
          {syncState === 'saved' && '✓ 저장됨'}
          {syncState === 'error' && '⚠ 저장 실패'}
        </span>
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
    <button className="btn-auth signin" onClick={onSignIn}>
      Google Drive 연결
    </button>
  );
}
