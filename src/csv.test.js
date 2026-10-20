import { toCSV, parseCSV } from './csv';

const sample = (over = {}) => ({
  id: 1,
  date: '2024-05-01',
  type: 'expense',
  category: '식비',
  description: '점심',
  amount: 8000,
  ...over,
});

describe('toCSV', () => {
  test('헤더와 일반 행 출력', () => {
    expect(toCSV([sample()])).toBe(
      'id,date,type,category,description,amount\n1,2024-05-01,expense,식비,점심,8000'
    );
  });

  test('쉼표/따옴표/개행이 있으면 따옴표로 감싼다', () => {
    const csv = toCSV([sample({ category: 'a,b', description: 'say "hi"\nbye' })]);
    expect(csv).toContain('"a,b"');
    expect(csv).toContain('"say ""hi""\nbye"');
  });

  test('빈 배열은 헤더만 출력', () => {
    expect(toCSV([])).toBe('id,date,type,category,description,amount');
  });
});

describe('parseCSV', () => {
  test('왕복 동일성', () => {
    const list = [
      sample(),
      sample({ id: 2, type: 'income', category: '월급, 보너스', description: '"따옴표" 와 쉼표, 포함', amount: 3000000 }),
      sample({ id: 3, description: '줄1\n줄2\r\n줄3' }),
      sample({ id: 4, category: '"인용"', description: '' }),
    ];
    expect(parseCSV(toCSV(list))).toEqual(list);
  });

  test('\\r\\n 줄 끝 허용', () => {
    const text = 'id,date,type,category,description,amount\r\n1,2024-05-01,expense,식비,점심,8000\r\n2,2024-05-02,income,월급,급여,100\r\n';
    expect(parseCSV(text)).toEqual([
      sample(),
      sample({ id: 2, date: '2024-05-02', type: 'income', category: '월급', description: '급여', amount: 100 }),
    ]);
  });

  test('BOM 제거', () => {
    const text = '﻿id,date,type,category,description,amount\n1,2024-05-01,expense,식비,점심,8000';
    expect(parseCSV(text)).toEqual([sample()]);
  });

  test('기존 포맷(description 만 따옴표) 호환', () => {
    const text =
      'id,date,type,category,description,amount\n' +
      '1,2024-05-01,expense,식비,"점심, ""맛집""",8000\n' +
      '2,2024-05-02,income,월급,"",100';
    expect(parseCSV(text)).toEqual([
      sample({ description: '점심, "맛집"' }),
      sample({ id: 2, date: '2024-05-02', type: 'income', category: '월급', description: '', amount: 100 }),
    ]);
  });

  test('끝의 빈 줄 무시', () => {
    const text = 'id,date,type,category,description,amount\n1,2024-05-01,expense,식비,점심,8000\n\n\n';
    expect(parseCSV(text)).toEqual([sample()]);
  });

  test('빈 입력/헤더만 있는 파일은 []', () => {
    expect(parseCSV('')).toEqual([]);
    expect(parseCSV('\n')).toEqual([]);
    expect(parseCSV('﻿')).toEqual([]);
    expect(parseCSV('id,date,type,category,description,amount')).toEqual([]);
    expect(parseCSV('id,date,type,category,description,amount\n')).toEqual([]);
  });

  describe('손상 행은 에러', () => {
    const header = 'id,date,type,category,description,amount\n';
    const ok = '1,2024-05-01,expense,식비,점심,8000\n';

    test('필드 수 부족/초과', () => {
      expect(() => parseCSV(header + '1,2024-05-01,expense,식비,8000')).toThrow('CSV 2번째 행을 읽을 수 없습니다');
      expect(() => parseCSV(header + '1,2024-05-01,expense,식비,점심,x,8000')).toThrow('CSV 2번째 행');
    });

    test('id/amount 가 숫자가 아님', () => {
      expect(() => parseCSV(header + 'abc,2024-05-01,expense,식비,점심,8000')).toThrow('CSV 2번째 행');
      expect(() => parseCSV(header + ok + '2,2024-05-01,expense,식비,점심,많이')).toThrow('CSV 3번째 행');
    });

    test('type 이 income/expense 가 아님', () => {
      expect(() => parseCSV(header + '1,2024-05-01,transfer,식비,점심,8000')).toThrow('CSV 2번째 행');
    });

    test('중간의 빈 줄', () => {
      expect(() => parseCSV(header + ok + '\n' + ok)).toThrow('CSV 3번째 행');
    });

    test('닫히지 않은 따옴표', () => {
      expect(() => parseCSV(header + '1,2024-05-01,expense,식비,"점심,8000')).toThrow();
    });
  });
});
