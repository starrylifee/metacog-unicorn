import './globals.css';

export const metadata = {
  title: '메타인지 유니콘 🦄 | 배운 걸 설명하며 성장하기',
  description: '유니콘에게 오늘 배운 것을 설명해보세요! AI가 여러분의 이해도를 확인해줍니다.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>
        <div className="bg-stars" />
        {children}
      </body>
    </html>
  );
}
