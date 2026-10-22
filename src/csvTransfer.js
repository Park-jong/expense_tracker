// ── CSV 내보내기/가져오기 순수 함수 ─────────────────────────
import { toCSV, readCSVRows } from './csv';
import { today } from './utils';

const BOM = '﻿';

// 내보내기 파일 내용과 이름. BOM은 다운로드 파일에만 붙이고 toCSV 출력은 그대로 둔다.
export function buildExportFile(transactions, date = new Date()) {
  return {
    filename: `가계부-${today(date)}.csv`,
    content: BOM + toCSV(transactions),
  };
}

// 실제 달력에 존재하는 YYYY-MM-DD 인지 확인
function isValidDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

const HEADER = 'id,date,type,category,description,amount';
const normalizeNewlines = (s) => s.replace(/\r\n/g, '\n');

// 원시 행({id,date,type,category,description,amount}) 하나를 검증해 거래로 변환. 잘못되면 null
function normalizeRow(row) {
  if (!row) return null;
  const { id, date, type, category, description, amount } = row;
  const idStr = String(id ?? '').trim();
  const amountStr = String(amount ?? '').trim();
  if (!/^\d+$/.test(idStr) || !/^\d+$/.test(amountStr)) return null;
  const amountNum = Number(amountStr);
  const idNum = Number(idStr);
  if (!Number.isSafeInteger(amountNum) || amountNum < 1) return null;
  if (!Number.isSafeInteger(idNum)) return null;
  if (!isValidDate(String(date ?? ''))) return null;
  if (type !== 'income' && type !== 'expense') return null;
  const cat = String(category ?? '').trim();
  const desc = normalizeNewlines(String(description ?? ''));
  if (!cat) return null;
  return { id: idNum, date, type, category: cat, description: desc, amount: amountNum };
}

// 형식이 올바른 원시 행인지 확인
export const isValidImportRow = (row) => normalizeRow(row) !== null;

// CSV 텍스트 -> 원시 행 객체 배열. 필드 수가 맞지 않는 행은 null. 따옴표 오류 등은 예외
// 첫 줄이 표준 헤더와 일치하면 제외하고, 아니면 데이터로 취급한다(헤더 없는 파일 지원)
export function parseImportText(text) {
  const all = readCSVRows(text);
  const isHeader = all.length > 0 && all[0].map((f) => f.trim().toLowerCase()).join(',') === HEADER;
  const rows = isHeader ? all.slice(1) : all;
  return rows.map((f) =>
    f.length === 6
      ? { id: f[0], date: f[1], type: f[2], category: f[3], description: f[4], amount: f[5] }
      : null
  );
}

// id와 무관한 내용 비교용 키 (description 줄바꿈은 \r\n -> \n 정규화)
const contentKey = (t) =>
  JSON.stringify([t.date, t.type, t.category, normalizeNewlines(String(t.description ?? '')), t.amount]);

// 가져올 행을 기존 거래와 비교해 { toAdd, duplicates, invalid } 로 분류
// - toAdd: 추가할 거래 (중복이 아닌데 id가 겹치면 기존 최대 id 기반의 새 고유 id 부여)
// - duplicates: 기존 거래 또는 파일 안의 앞선 행과 내용이 같아 건너뛴 거래 수
// - invalid: 형식이 잘못돼 건너뛴 행 수
// 순수 함수: 같은 입력이면 항상 같은 결과 (Date.now 등을 쓰지 않는다)
export function planImport(existing, parsedRows) {
  const seen = new Set(existing.map(contentKey));
  const usedIds = new Set(existing.map((t) => t.id));
  let nextId = [...usedIds].reduce((m, v) => Math.max(m, v), 0) + 1;
  const toAdd = [];
  let duplicates = 0;
  let invalid = 0;

  for (const raw of parsedRows) {
    const tx = normalizeRow(raw);
    if (!tx) {
      invalid++;
      continue;
    }
    const key = contentKey(tx);
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    if (usedIds.has(tx.id)) {
      while (usedIds.has(nextId)) nextId++;
      tx.id = nextId++;
    }
    seen.add(key);
    usedIds.add(tx.id);
    toAdd.push(tx);
  }

  return { toAdd, duplicates, invalid };
}
