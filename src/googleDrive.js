const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

const SCOPES = 'https://www.googleapis.com/auth/drive.file';
const FILE_NAME = '가계부.csv';

let tokenClient = null;
let accessToken = null;

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

// 인증 초기화
export async function initAuth() {
  await loadGIS();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: () => { },
  });
}

// 로그인 - 액세스 토큰 요청
export function signIn() {
  return new Promise((resolve, reject) => {
    tokenClient.callback = (response) => {
      if (response.error) return reject(response);
      accessToken = response.access_token;
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

// 로그아웃
export function signOut() {
  if (accessToken) {
    window.google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = null;
}

export function isSignedIn() {
  return !!accessToken;
}

// ── CSV 변환 유틸 ──────────────────────────────────────────

function toCSV(transactions) {
  const header = 'id,date,type,category,description,amount';
  const rows = transactions.map((t) =>
    [t.id, t.date, t.type, t.category, `"${t.description.replace(/"/g, '""')}"`, t.amount].join(',')
  );
  return [header, ...rows].join('\n');
}

function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  return lines.slice(1).map((line) => {
    // description의 따옴표 처리
    const match = line.match(/^([^,]+),([^,]+),([^,]+),([^,]+),"((?:[^"]|"")*)",(\d+)$/);
    if (!match) return null;
    const [, id, date, type, category, description, amount] = match;
    return {
      id: Number(id),
      date,
      type,
      category,
      description: description.replace(/""/g, '"'),
      amount: Number(amount),
    };
  }).filter(Boolean);
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
async function findFileId() {
  const q = encodeURIComponent(`name='${FILE_NAME}' and trashed=false`);
  const res = await driveRequest(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`
  );
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

// Drive에서 거래 데이터 불러오기
export async function loadTransactions() {
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
