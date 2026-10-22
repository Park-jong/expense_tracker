// 모듈 내부 토큰 상태는 initAuth 의 sessionStorage 복원 경로로 채운다 (googleDriveBudgets.test.js 와 같은 방식)
const loadFresh = async () => {
  let mod;
  jest.isolateModules(() => {
    // 격리된 레지스트리의 recurring 모듈과 같은 클래스를 써야 instanceof 가 맞는다
    mod = { ...require('./googleDrive'), RecurringFileCorruptError: require('./recurring').RecurringFileCorruptError };
  });
  await mod.initAuth();
  return mod;
};

const res = ({ ok = true, status = 200, json, text } = {}) => ({
  ok,
  status,
  json: json ?? (async () => ({})),
  text: text ?? (async () => ''),
});
const search = (files) => res({ json: async () => ({ files }) });
const body = (text) => res({ text: async () => text });

const RULE = {
  id: 'r1',
  type: 'expense',
  category: '주거',
  description: '월세',
  amount: 500000,
  cycle: 'monthly',
  day: 5,
  startDate: '2024-01-01',
  endDate: null,
  lastGenerated: null,
};
const VALID = { version: 1, rules: [RULE] };

beforeEach(() => {
  window.google = { accounts: { oauth2: { initTokenClient: jest.fn(() => ({})) } } };
  sessionStorage.setItem('gd_token', JSON.stringify({ token: 't', expiresAt: Date.now() + 3600 * 1000 }));
  global.fetch = jest.fn();
});

afterEach(() => {
  delete window.google;
  delete global.fetch;
  sessionStorage.clear();
});

describe('loadRecurring (googleDrive 비모킹)', () => {
  it('파일이 없으면 null', async () => {
    fetch.mockResolvedValueOnce(search([]));
    const { loadRecurring } = await loadFresh();
    await expect(loadRecurring()).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('정상 본문은 규칙 배열로 돌려준다', async () => {
    fetch.mockResolvedValueOnce(search([{ id: 'f1' }])).mockResolvedValueOnce(body(JSON.stringify(VALID)));
    const { loadRecurring } = await loadFresh();
    await expect(loadRecurring()).resolves.toEqual([RULE]);
  });

  it.each([
    ['빈 본문', ''],
    ['HTML 본문', '<html><body>로그인이 필요합니다</body></html>'],
    ['버전 불일치', JSON.stringify({ version: 2, rules: [] })],
    ['규칙 목록이 배열이 아님', JSON.stringify({ version: 1, rules: {} })],
    ['잘못된 규칙', JSON.stringify({ version: 1, rules: [{ ...RULE, amount: -1 }] })],
    ['중복 id', JSON.stringify({ version: 1, rules: [RULE, RULE] })],
  ])('본문이 %s 이면 RecurringFileCorruptError', async (_name, text) => {
    fetch.mockResolvedValueOnce(search([{ id: 'f1' }])).mockResolvedValueOnce(body(text));
    const { loadRecurring, RecurringFileCorruptError } = await loadFresh();
    const err = await loadRecurring().catch((e) => e);
    expect(err).toBeInstanceOf(RecurringFileCorruptError);
    expect(err.name).toBe('RecurringFileCorruptError');
    expect(err.message).toMatch(/^반복 거래 파일을 읽을 수 없습니다/);
  });

  it('검색 응답이 JSON 이 아니면 SyntaxError 그대로 (손상으로 변환되지 않음)', async () => {
    fetch.mockResolvedValueOnce(res({ json: async () => JSON.parse('<html>captive portal</html>') }));
    const { loadRecurring, RecurringFileCorruptError } = await loadFresh();
    const err = await loadRecurring().catch((e) => e);
    expect(err).toBeInstanceOf(SyntaxError);
    expect(err).not.toBeInstanceOf(RecurringFileCorruptError);
  });

  it('HTTP 500 과 네트워크 오류는 손상 오류가 아닌 일반 Error (검색/다운로드 모두)', async () => {
    fetch.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    let mod = await loadFresh();
    let err = await mod.loadRecurring().catch((e) => e);
    expect(err).not.toBeInstanceOf(mod.RecurringFileCorruptError);
    expect(err.message).toContain('500');

    fetch.mockResolvedValueOnce(search([{ id: 'f1' }])).mockResolvedValueOnce(res({ ok: false, status: 500 }));
    mod = await loadFresh();
    err = await mod.loadRecurring().catch((e) => e);
    expect(err).not.toBeInstanceOf(mod.RecurringFileCorruptError);
    expect(err.message).toContain('500');

    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    mod = await loadFresh();
    err = await mod.loadRecurring().catch((e) => e);
    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(mod.RecurringFileCorruptError);
  });
});

describe('saveRecurring (googleDrive 비모킹)', () => {
  it('파일이 없으면 POST 로 새로 만들고 { version, rules } 형식으로 저장한다', async () => {
    fetch.mockResolvedValueOnce(search([])).mockResolvedValueOnce(res());
    const { saveRecurring } = await loadFresh();
    await saveRecurring([RULE, { id: 'bad' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    const [url, opts] = fetch.mock.calls[1];
    expect(url).toContain('/upload/drive/v3/files?uploadType=multipart');
    expect(opts.method).toBe('POST');
    const file = opts.body.get('file');
    const text = await new Promise((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.readAsText(file); });
    expect(JSON.parse(text)).toEqual(VALID); // 잘못된 규칙은 저장되지 않음
  });

  it('파일이 있으면 PATCH 로 갱신한다', async () => {
    fetch.mockResolvedValueOnce(search([{ id: 'f9' }])).mockResolvedValueOnce(res());
    const { saveRecurring } = await loadFresh();
    await saveRecurring([RULE]);
    const [url, opts] = fetch.mock.calls[1];
    expect(url).toContain('/upload/drive/v3/files/f9?uploadType=multipart');
    expect(opts.method).toBe('PATCH');
  });

  it('저장 요청이 실패하면 오류를 던진다', async () => {
    fetch.mockResolvedValueOnce(search([])).mockResolvedValueOnce(res({ ok: false, status: 500 }));
    const { saveRecurring } = await loadFresh();
    await expect(saveRecurring([RULE])).rejects.toThrow('500');
  });
});
