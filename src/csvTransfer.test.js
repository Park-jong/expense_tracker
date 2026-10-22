import { buildExportFile, parseImportText, planImport } from './csvTransfer';
import { toCSV } from './csv';

const tx = (over = {}) => ({
  id: 1,
  date: '2026-03-05',
  type: 'expense',
  category: '식비',
  description: '점심',
  amount: 8000,
  ...over,
});

describe('buildExportFile', () => {
  test('파일명에 날짜가 들어가고 내용 앞에 BOM이 붙으며 toCSV 출력은 그대로다', () => {
    const list = [tx()];
    const { filename, content } = buildExportFile(list, new Date(2026, 2, 5));
    expect(filename).toBe('가계부-2026-03-05.csv');
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content.slice(1)).toBe(toCSV(list));
    expect(toCSV(list).charCodeAt(0)).not.toBe(0xfeff);
  });
});

describe('parseImportText', () => {
  test('BOM을 제거하고 헤더를 제외한 행을 반환하며 필드 수가 틀린 행은 null', () => {
    const rows = parseImportText('﻿' + toCSV([tx()]) + '\n1,2,3');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: '1', category: '식비', amount: '8000' });
    expect(rows[1]).toBeNull();
  });

  test('헤더가 없는 파일은 첫 줄도 데이터로 처리한다', () => {
    const rows = parseImportText('1,2026-03-05,expense,식비,점심,8000\n2,2026-03-06,income,급여,월급,100');
    expect(rows).toHaveLength(2);
    expect(planImport([], rows).toAdd).toHaveLength(2);
  });

  test('헤더는 공백/대소문자와 무관하게 인식하고, 다른 헤더는 잘못된 행으로 센다', () => {
    expect(parseImportText(' ID, Date,type,category,description,AMOUNT \n1,2026-03-05,expense,식비,a,1')).toHaveLength(1);
    const r = planImport([], parseImportText('a,b,c,d,e,f\n1,2026-03-05,expense,식비,a,1'));
    expect(r.invalid).toBe(1);
    expect(r.toAdd).toHaveLength(1);
  });

  test('빈 파일은 빈 배열', () => {
    expect(parseImportText('')).toEqual([]);
  });
});

describe('planImport', () => {
  test('새 거래는 추가된다', () => {
    const { toAdd, duplicates, invalid } = planImport([tx()], parseImportText(toCSV([tx({ id: 2, amount: 9000 })])));
    expect(toAdd).toEqual([tx({ id: 2, amount: 9000 })]);
    expect(duplicates).toBe(0);
    expect(invalid).toBe(0);
  });

  test('id가 같아도 달라도 내용이 같으면 중복으로 건너뛴다', () => {
    const r = planImport([tx()], parseImportText(toCSV([tx(), tx({ id: 99 })])));
    expect(r.toAdd).toEqual([]);
    expect(r.duplicates).toBe(2);
  });

  test('같은 파일 안에서 내용이 같은 행은 하나만 추가하고 나머지는 중복으로 센다', () => {
    const rows = parseImportText(toCSV([tx({ id: 5 }), tx({ id: 6 }), tx({ id: 7, amount: 1 })]));
    const r = planImport([], rows);
    expect(r.toAdd.map((t) => t.id)).toEqual([5, 7]);
    expect(r.duplicates).toBe(1);
  });

  test('기존 거래끼리 내용이 같아도 건드리지 않는다', () => {
    const existing = [tx({ id: 1 }), tx({ id: 2 })];
    const r = planImport(existing, parseImportText(toCSV([tx({ id: 3, amount: 5 })])));
    expect(existing).toHaveLength(2);
    expect(r.toAdd).toHaveLength(1);
  });

  test('설명의 CRLF 는 LF 로 정규화해 비교하고 저장한다', () => {
    const existing = [tx({ description: 'a\nb' })];
    const raw = { id: '9', date: '2026-03-05', type: 'expense', category: '식비', description: 'a\r\nb', amount: '8000' };
    expect(planImport(existing, [raw]).duplicates).toBe(1);
    const r = planImport([], [raw]);
    expect(r.toAdd[0].description).toBe('a\nb');
  });

  test('새 id는 결정적이다 (같은 입력이면 같은 결과)', () => {
    const rows = parseImportText(toCSV([tx({ id: 10, amount: 1 })]));
    const a = planImport([tx({ id: 10 })], rows);
    const b = planImport([tx({ id: 10 })], rows);
    expect(a.toAdd).toEqual(b.toAdd);
    expect(a.toAdd[0].id).toBe(11);
  });

  test('id만 겹치고 내용이 다르면 새 고유 id를 부여하고 기존 거래는 건드리지 않는다', () => {
    const existing = [tx()];
    const r = planImport(existing, parseImportText(toCSV([tx({ amount: 9000 })])));
    expect(r.toAdd).toHaveLength(1);
    expect(r.toAdd[0].id).not.toBe(1);
    expect(r.toAdd[0].amount).toBe(9000);
    expect(existing).toEqual([tx()]);
  });

  test('id가 겹치는 여러 행에 서로 다른 새 id가 부여된다', () => {
    const rows = parseImportText(toCSV([tx({ amount: 1 }), tx({ amount: 2 }), tx({ id: 5, amount: 3 })]));
    const r = planImport([tx()], rows);
    const ids = r.toAdd.map((t) => t.id);
    expect(new Set([1, ...ids]).size).toBe(4);
  });

  test('잘못된 행은 건너뛰고 개수를 센다', () => {
    const text = [
      'id,date,type,category,description,amount',
      '1,2026-03-05,expense,식비,정상,100',
      '2,2026-03-05,expense,식비,글자금액,abc',
      '3,2026-03-05,expense,식비,음수,-5',
      '4,2026-13-45,expense,식비,날짜오류,100',
      '5,2026-03-05,other,식비,유형오류,100',
      '6,2026-03-05,expense,식비,영원,0',
      '7,2026-03-05,expense',
    ].join('\n');
    const r = planImport([], parseImportText(text));
    expect(r.toAdd).toHaveLength(1);
    expect(r.toAdd[0].description).toBe('정상');
    expect(r.invalid).toBe(6);
  });
});
