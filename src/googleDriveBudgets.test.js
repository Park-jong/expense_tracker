// 모듈 내부 토큰 상태는 initAuth 의 sessionStorage 복원 경로로 채운다
const loadFresh = async () => {
  let mod;
  jest.isolateModules(() => {
    // 격리된 레지스트리의 budget 모듈과 같은 클래스를 써야 instanceof 가 맞는다
    mod = { ...require('./googleDrive'), BudgetFileCorruptError: require('./budget').BudgetFileCorruptError };
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

const VALID = { version: 1, total: 1000, categories: { 식비: 300 } };

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

describe('loadBudgets (googleDrive 비모킹)', () => {
  it('파일이 없으면 null', async () => {
    fetch.mockResolvedValueOnce(search([]));
    const { loadBudgets } = await loadFresh();
    await expect(loadBudgets()).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('정상 본문은 파싱된 값을 돌려준다', async () => {
    fetch.mockResolvedValueOnce(search([{ id: 'f1' }])).mockResolvedValueOnce(body(JSON.stringify(VALID)));
    const { loadBudgets } = await loadFresh();
    await expect(loadBudgets()).resolves.toEqual(VALID);
  });

  it.each([
    ['빈 본문', ''],
    ['HTML 본문', '<html><body>로그인이 필요합니다</body></html>'],
    ['스키마 불일치', JSON.stringify({ version: 2, total: null, categories: {} })],
    ['잘못된 금액', JSON.stringify({ version: 1, total: -1, categories: {} })],
  ])('본문이 %s 이면 BudgetFileCorruptError', async (_name, text) => {
    fetch.mockResolvedValueOnce(search([{ id: 'f1' }])).mockResolvedValueOnce(body(text));
    const { loadBudgets, BudgetFileCorruptError } = await loadFresh();
    const err = await loadBudgets().catch((e) => e);
    expect(err).toBeInstanceOf(BudgetFileCorruptError);
    expect(err.name).toBe('BudgetFileCorruptError');
    expect(err.message).toMatch(/^예산 파일을 읽을 수 없습니다/);
  });

  it('검색 응답이 JSON 이 아니면 변환되지 않고 SyntaxError 그대로 (network 로 분류됨)', async () => {
    fetch.mockResolvedValueOnce(
      res({ json: async () => JSON.parse('<html>captive portal</html>') })
    );
    const { loadBudgets, BudgetFileCorruptError } = await loadFresh();
    const err = await loadBudgets().catch((e) => e);
    expect(err).toBeInstanceOf(SyntaxError);
    expect(err).not.toBeInstanceOf(BudgetFileCorruptError);
  });

  it('HTTP 500 은 일반 Error 그대로 (검색/다운로드 모두)', async () => {
    fetch.mockResolvedValueOnce(res({ ok: false, status: 500 }));
    let mod = await loadFresh();
    let err = await mod.loadBudgets().catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(mod.BudgetFileCorruptError);
    expect(err.message).toContain('500');

    fetch.mockResolvedValueOnce(search([{ id: 'f1' }])).mockResolvedValueOnce(res({ ok: false, status: 500 }));
    mod = await loadFresh();
    err = await mod.loadBudgets().catch((e) => e);
    expect(err).not.toBeInstanceOf(mod.BudgetFileCorruptError);
    expect(err.message).toContain('500');
  });
});
