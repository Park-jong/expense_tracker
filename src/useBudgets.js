import { useState, useEffect, useRef, useCallback } from 'react';
import { loadBudgets, saveBudgets } from './googleDrive';
import { mergeBudgets, sanitizeBudgets, BudgetFileCorruptError } from './budget';
import { loadGuestBudgets, saveGuestBudgets, clearGuestBudgets } from './guestBudgetStorage';

const SAVE_DEBOUNCE_MS = 800;

// 불러오기 오류 종류 판별: 예산 파일 본문이 잘못된 경우(전용 오류 타입)만 'corrupt', 그 외는 모두 'network'
const classifyLoadError = (e) => (e instanceof BudgetFileCorruptError ? 'corrupt' : 'network');

const sameBudgets = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 예산 상태 + 동기화 훅. 거래와는 별개의 실패 영역이다.
// authState: App 의 'idle' | 'loading' | 'signed-in' | 'error'
export function useBudgets(authState) {
  const [budgets, setBudgetsRaw] = useState(() => loadGuestBudgets());
  const [syncState, setSyncState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadError, setLoadErrorState] = useState(null); // null | 'corrupt' | 'network'
  const [loaded, setLoaded] = useState(false); // Drive 불러오기에 성공했는지
  const [retryTick, setRetryTick] = useState(0);

  const loadGen = useRef(0); // 불러오기/세션 세대 (오래된 응답 무효화용)
  const budgetsRef = useRef(budgets); // 비동기 콜백에서 참조할 최신 예산
  budgetsRef.current = budgets;
  const loadErrorRef = useRef(null);
  const dirty = useRef(false); // 사용자가 변경한 뒤 아직 Drive 에 저장하지 않았는지
  const guestPending = useRef(false); // 게스트 예산이 Drive 에 아직 저장되지 않았는지
  const skipGuestSave = useRef(false); // 로그아웃 직후 Drive 예산이 게스트 저장소로 복사되는 것을 막음
  const saving = useRef(false); // Drive 저장이 진행 중인지 (한 번에 하나만)
  const queued = useRef(false); // 진행 중 저장 뒤에 이어서 저장할 변경이 있는지
  const timerPending = useRef(false); // 디바운스 타이머가 대기 중인지
  const prevAuth = useRef(authState);

  const setLoadError = (value) => {
    loadErrorRef.current = value;
    setLoadErrorState(value);
  };

  // 사용자 변경: 일반 setState 처럼 동작하되 항상 sanitize 하고 실제로 바뀐 경우에만 dirty 표시
  const setBudgets = useCallback((next) => {
    setBudgetsRaw((prev) => {
      const value = sanitizeBudgets(typeof next === 'function' ? next(prev) : next);
      if (sameBudgets(value, prev)) return prev;
      dirty.current = true;
      return value;
    });
  }, []);

  // Drive 저장 실행기: 한 번에 하나만 진행하고, 진행 중 변경은 끝난 뒤 최신 값으로 이어서 저장한다.
  // recover: 손상된 파일 덮어쓰기 복구용 (성공 시 불러오기 실패 상태를 해제). 일반 저장과 같은 직렬화·세대 검사·handoff 를 탄다.
  // 반환: 이 호출이 저장을 실행해 성공했으면 true, 대기열에 맡겼거나 실패/오래된 세대면 false
  // 한계: 이전 세대의 저장이 끝나지 않으면 새 세대 저장은 타임아웃 없이 대기한다(중복 파일 생성 방지를 우선).
  const runSave = useCallback(async (gen, recover = false) => {
    if (saving.current) {
      queued.current = true;
      return false;
    }
    saving.current = true;
    let handoff = false; // 오래된 세대로 끝나 새 세션의 대기 저장을 넘겨받아야 하는지
    try {
      for (;;) {
        queued.current = false;
        dirty.current = false;
        const snapshot = sanitizeBudgets(budgetsRef.current);
        let ok = true;
        try {
          await saveBudgets(snapshot);
        } catch {
          ok = false;
        }
        if (gen !== loadGen.current) {
          handoff = true;
          return false;
        }
        if (ok && recover) {
          recover = false;
          setLoaded(true);
          setLoadFailed(false);
          setLoadError(null);
        }
        if (queued.current) continue; // 그 사이 변경이 있었으면 결과와 무관하게 최신 값으로 이어서 저장
        if (ok) {
          // 이 저장이 현재 최신 값을 반영한 경우에만 게스트 저장소를 비움
          if (guestPending.current && !dirty.current) {
            clearGuestBudgets();
            guestPending.current = false;
          }
          if (!timerPending.current) setSyncState('saved');
          return true;
        }
        if (recover) {
          // 복구 실패: 불러오기 실패 상태를 유지하고 변경 표시는 건드리지 않음
          guestPending.current = false;
          setSyncState('error');
          return false;
        }
        dirty.current = true;
        if (!timerPending.current) setSyncState('error');
        return false;
      }
    } finally {
      saving.current = false;
      if (handoff && queued.current) {
        queued.current = false;
        runSave(loadGen.current);
      }
    }
  }, []);

  // Drive 에서 불러오기. 성공(파일 없음 포함)한 경우에만 저장을 활성화한다.
  useEffect(() => {
    if (authState !== 'signed-in') return;
    const gen = ++loadGen.current;
    queued.current = false;
    setLoaded(false);
    setLoadFailed(false);
    setLoadError(null);
    setSyncState('saving');
    (async () => {
      try {
        const data = await loadBudgets();
        if (gen !== loadGen.current) return; // 로그아웃/재요청으로 무효화된 응답은 무시
        const { merged, guestOnly } = mergeBudgets(data, budgetsRef.current);
        if (data || guestOnly) setBudgetsRaw(merged);
        guestPending.current = guestOnly;
        setLoaded(true);
        setSyncState('saved');
      } catch (e) {
        if (gen !== loadGen.current) return;
        guestPending.current = false;
        setLoaded(false);
        setLoadFailed(true);
        setLoadError(classifyLoadError(e));
        setSyncState('error');
      }
    })();
  }, [authState, retryTick]);

  // 로그아웃 등으로 로그인 상태가 풀리면 진행 중 요청을 무효화하고 게스트 예산으로 되돌린다
  useEffect(() => {
    const wasSignedIn = prevAuth.current === 'signed-in';
    prevAuth.current = authState;
    if (authState === 'signed-in') return;
    loadGen.current++;
    queued.current = false;
    guestPending.current = false;
    dirty.current = false;
    setLoaded(false);
    setLoadFailed(false);
    setLoadError(null);
    setSyncState('idle');
    if (wasSignedIn) {
      skipGuestSave.current = true; // 같은 커밋에서 Drive 예산이 게스트 저장소에 쓰이지 않게
      setBudgetsRaw(loadGuestBudgets());
    }
  }, [authState]);

  // 게스트 저장: 비로그인이거나 불러오기 실패 상태일 때만 (불러오는 중/로드 성공 후에는 건드리지 않음)
  useEffect(() => {
    if (skipGuestSave.current) {
      skipGuestSave.current = false;
      return;
    }
    const guestMode = authState === 'idle' || authState === 'error';
    if (guestMode || (authState === 'signed-in' && loadFailed)) {
      saveGuestBudgets(budgets);
    }
  }, [budgets, authState, loadFailed]);

  // Drive 저장: 불러오기에 성공했고 변경이 있을 때만 (디바운스)
  useEffect(() => {
    if (authState !== 'signed-in' || !loaded) return;
    if (!dirty.current && !guestPending.current) return;

    setSyncState('saving');
    timerPending.current = true;
    const gen = loadGen.current; // 이 저장이 속한 세션 세대
    const timer = setTimeout(() => {
      timerPending.current = false;
      runSave(gen);
    }, SAVE_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      timerPending.current = false;
    };
  }, [budgets, loaded, authState, runSave]);

  // 불러오기 실패 시 다시 시도
  const retry = useCallback(() => {
    if (loadFailed) setRetryTick((t) => t + 1);
  }, [loadFailed]);

  // 저장 실패 시 현재 예산을 다시 저장 (자동 재시도는 하지 않음)
  const retrySave = useCallback(() => {
    if (authState !== 'signed-in' || !loaded || syncState !== 'error') return;
    dirty.current = true;
    setSyncState('saving');
    runSave(loadGen.current);
  }, [authState, loaded, syncState, runSave]);

  // 손상된 예산 파일을 현재 예산으로 덮어써 복구. 사용자가 확인한 뒤에만 호출해야 하며 'corrupt' 일 때만 동작.
  // 반환: 덮어쓰기가 실행되어 성공하면 true, 무시(손상 상태 아님/저장 진행 중)·실패·세션 변경이면 false.
  // 저장 진행 중에는 무시되므로 UI 는 syncState === 'saving' 일 때 버튼을 막고, false 반환 시 사용자에게 알려야 한다.
  const overwriteDrive = useCallback(async () => {
    if (loadErrorRef.current !== 'corrupt' || saving.current) return false;
    guestPending.current = true; // 성공하고 그 사이 새 변경이 없을 때만 게스트 저장소를 비움
    setSyncState('saving');
    return runSave(loadGen.current, true);
  }, [runSave]);

  const loading = authState === 'loading' || (authState === 'signed-in' && !loaded && !loadFailed);

  return { budgets, setBudgets, syncState, loadFailed, loadError, loading, retry, retrySave, overwriteDrive };
}
