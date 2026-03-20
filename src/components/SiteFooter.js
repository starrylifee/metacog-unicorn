import Link from 'next/link';

export default function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p className="site-footer-copy">
          메타인지 유니콘은 앱뜰(App-Tteul) 플랫폼의 하위 프로그램입니다.
        </p>
        <div className="site-footer-links">
          <Link href="/privacy">개인정보 처리방침</Link>
          <span className="site-footer-divider">|</span>
          <Link href="/terms">이용약관</Link>
        </div>
      </div>
    </footer>
  );
}
