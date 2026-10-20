import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';
import * as drive from './googleDrive';

jest.mock('./googleDrive');

beforeEach(() => {
  localStorage.clear();
  jest.resetAllMocks();
  drive.isSignedIn.mockImplementation(() => false);
  drive.initAuth.mockResolvedValue(false);
});

test('비로그인 상태의 기본 화면이 렌더링된다', async () => {
  render(<App />);

  expect(screen.getByText('가계부')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '목록' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '달력' })).toBeInTheDocument();
  expect(await screen.findByText('이 기기에만 저장됨')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Google Drive 연결/ })).toBeInTheDocument();
});

test('달력 탭을 누르면 요일 헤더가 보인다', async () => {
  render(<App />);
  await screen.findByText('이 기기에만 저장됨');

  fireEvent.click(screen.getByRole('button', { name: '달력' }));

  ['일', '월', '화', '수', '목', '금', '토'].forEach((day) => {
    expect(screen.getByText(day)).toBeInTheDocument();
  });
});
