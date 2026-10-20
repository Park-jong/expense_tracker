// ── CSV 변환 유틸 (RFC 4180) ────────────────────────────────

const HEADER = 'id,date,type,category,description,amount';

// 쉼표/따옴표/개행이 있으면 "..." 로 감싸고 내부 " 는 "" 로 이스케이프
function escapeField(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(transactions) {
  const rows = transactions.map((t) =>
    [
      t.id,
      escapeField(t.date),
      escapeField(t.type),
      escapeField(t.category),
      escapeField(t.description),
      t.amount,
    ].join(',')
  );
  return [HEADER, ...rows].join('\n');
}

// 상태 기계로 텍스트를 행/필드 배열로 분해
function splitRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldQuoted = false; // 현재 필드가 따옴표로 시작했는지

  const endField = () => {
    row.push(field);
    field = '';
    fieldQuoted = false;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // 이스케이프된 따옴표
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch; // 따옴표 안의 쉼표/개행은 그대로 보존
      }
    } else if (ch === '"' && field === '' && !fieldQuoted) {
      inQuotes = true;
      fieldQuoted = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\n') {
      endRow();
    } else if (ch === '\r' && text[i + 1] === '\n') {
      // \r\n 은 \n 에서 처리
    } else {
      field += ch;
    }
  }

  if (inQuotes) throw new Error('CSV 따옴표가 닫히지 않았습니다');

  // 마지막 줄이 개행 없이 끝난 경우
  if (field !== '' || fieldQuoted || row.length > 0) endRow();

  return rows;
}

// 행 번호(n)는 헤더를 1번으로 센 파일 기준
export function parseCSV(text) {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // BOM 제거
  const rows = splitRows(src);

  // 끝의 빈 줄 무시
  while (rows.length > 0) {
    const last = rows[rows.length - 1];
    if (last.length === 1 && last[0] === '') rows.pop();
    else break;
  }
  if (rows.length < 2) return []; // 빈 파일 또는 헤더만 있는 파일

  return rows.slice(1).map((fields, idx) => {
    const n = idx + 2;
    const fail = () => new Error(`CSV ${n}번째 행을 읽을 수 없습니다`);
    if (fields.length !== 6) throw fail();
    const [id, date, type, category, description, amount] = fields;
    if (!/^\d+$/.test(id) || !/^\d+$/.test(amount)) throw fail();
    if (type !== 'income' && type !== 'expense') throw fail();
    return {
      id: Number(id),
      date,
      type,
      category,
      description,
      amount: Number(amount),
    };
  });
}
