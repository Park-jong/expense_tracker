import { toCSV, parseCSV } from './csv';
import { parseBudgets, BudgetFileCorruptError } from './budget';

const CLIENT_ID =process.env.REACT_APP_GOOGLE_CLIENT_ID;

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = '가계부.csv';
const BUDGET_FILE_NAME = '가계부-예산.json';
const STORAGE_KEY = 'gd_token';

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;

// Google Identity Services 스크립트 동적 로드
function loadGIS() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// 인증 초기화 + sessionStorage에서 토큰 복원
export async function initAuth() {
  await loadGIS();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => { },
  });

  const stored = sessionStorage.getItem(STORAGE_KEY);
  if (stored) {
    const { token, expiresAt } = JSON.parse(stored);
    if (Date.now() < expiresAt) {
      accessToken = token;
      tokenExpiresAt = expiresAt;
      return true;
    }
    sessionStorage.removeItem(STORAGE_KEY);
  }
  return false;
}

// 로그인 - 액세스 토큰 요청 (첫 로그인은 동의 화면, 이후엔 자동)
export function signIn() {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) return reject(response);
      accessToken = response.access_token;
      tokenExpiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ token: accessToken, expiresAt: tokenExpiresAt }));
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  });
}

// 로그아웃
export function signOut() {
  if (accessToken) {
    window.google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = null;
  tokenExpiresAt = 0;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function isSignedIn() {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

// 토큰 만료 시 재발급
async function ensureToken() {
  if (!isSignedIn()) {
    await signIn();
  }
}

// ── Drive API 호출 ──────────────────────────────────────────

async function driveRequest(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...options.headers,
    },
  });
  if (!res.ok) throw new Error(`Drive API 오류: ${res.status}`);
  return res;
}

// 기존 파일 ID 검색
async function findFileId(name = FILE_NAME) {
  const q = encodeURIComponent(`name='${name}' and trashed=false`);
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`
  );
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

// Drive에서 거래 데이터 불러오기
export async function loadTransactions() {
  await ensureToken();
  const fileId = await findFileId();
  if (!fileId) return null; // 파일 없음 = 첫 실행

  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  const text = await res.text();
  return parseCSV(text);
}

// Drive에 거래 데이터 저장 (없으면 생성, 있으면 덮어쓰기)
export async function saveTransactions(transactions) {
  await ensureToken();
  const csvContent = toCSV(transactions);
  const fileId = await findFileId();

  const metadata = { name: FILE_NAME, mimeType: 'text/csv' };
  const blob = new Blob([csvContent], { type: 'text/csv' });

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  if (fileId) {
    // 기존 파일 업데이트
    await driveRequest(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`,
      { method: 'PATCH', body: form }
    );
  } else {
    // 새 파일 생성
    await driveRequest(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', body: form }
    );
  }
}

// Drive에서 예산 불러오기. 파일이 없으면 null, 손상된 파일이면 에러를 그대로 던진다
export async function loadBudgets() {
  await ensureToken();
  const fileId = await findFileId(BUDGET_FILE_NAME);
  if (!fileId) return null;

  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  );
  const text = await res.text(); // 다운로드 단계 오류는 변환하지 않고 그대로 전파
  // 본문 파싱·검증 실패만 BudgetFileCorruptError 로 변환
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new BudgetFileCorruptError('예산 파일을 읽을 수 없습니다: JSON 형식이 아닙니다');
  }
  try {
    return parseBudgets(raw);
  } catch (e) {
    throw new BudgetFileCorruptError(e?.message || undefined);
  }
}

// Drive에 예산 저장 (없으면 생성, 있으면 덮어쓰기)
export async function saveBudgets(budgets) {
  await ensureToken();
  const fileId = await findFileId(BUDGET_FILE_NAME);

  const metadata = { name: BUDGET_FILE_NAME, mimeType: 'application/json' };
  const blob = new Blob([JSON.stringify(budgets)], { type: 'application/json' });

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);

  if (fileId) {
    await driveRequest(
      `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`,
      { method: 'PATCH', body: form }
    );
  } else {
    await driveRequest(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      { method: 'POST', body: form }
    );
  }
}
