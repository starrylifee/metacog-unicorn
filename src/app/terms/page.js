import Link from 'next/link';

export const metadata = {
  title: '이용약관 | 메타인지 유니콘',
};

export default function TermsPage() {
  return (
    <div className="page-container">
      <div className="content-wrapper content-medium">
        <div className="legal-card">
          <div className="legal-header">
            <Link href="/" className="btn btn-ghost btn-sm">
              처음으로
            </Link>
            <h1 className="heading-section" style={{ marginBottom: '0.5rem' }}>
              이용약관
            </h1>
            <p className="subtitle" style={{ marginBottom: 0 }}>
              메타인지 유니콘은 앱뜰(App-Tteul) 플랫폼의 하위 프로그램으로 제공됩니다.
            </p>
          </div>

          <div className="legal-body">
            <p>
              본 이용약관(이하 &apos;약관&apos;)은 메타인지 유니콘(이하 &apos;본
              서비스&apos;)이 제공하는 교육용 웹 애플리케이션 서비스의 이용에 관한 사항을
              규정합니다.
            </p>

            <section className="legal-section">
              <h2>제1조 (목적)</h2>
              <p>
                이 약관은 본 서비스가 제공하는 무료 교육용 웹 애플리케이션 서비스(이하
                &apos;서비스&apos;)를 이용함에 있어 서비스 제공자와 이용자의 권리·의무 및
                책임사항을 규정함을 목적으로 합니다.
              </p>
            </section>

            <section className="legal-section">
              <h2>제2조 (정의)</h2>
              <ul>
                <li>&apos;서비스&apos;란 본 플랫폼에서 제공하는 교육용 웹 애플리케이션을 말합니다.</li>
                <li>
                  &apos;이용자&apos;란 본 서비스에 접속하여 이 약관에 따라 서비스를 이용하는 회원 및
                  비회원을 말합니다.
                </li>
                <li>
                  &apos;회원&apos;이란 본 서비스에 회원등록을 한 자로서, 서비스를 이용할 수 있는 자를
                  말합니다.
                </li>
              </ul>
            </section>

            <section className="legal-section">
              <h2>제3조 (약관의 명시와 개정)</h2>
              <p>
                ① 본 서비스는 이 약관의 내용을 이용자가 쉽게 알 수 있도록 서비스 초기 화면에
                게시합니다.
              </p>
              <p>② 본 서비스는 관련 법령을 위배하지 않는 범위에서 이 약관을 개정할 수 있습니다.</p>
              <p>
                ③ 약관을 개정할 경우에는 적용일자 및 개정사유를 명시하여 현행약관과 함께 서비스
                내에 그 적용일자 7일 이전부터 공지합니다.
              </p>
            </section>

            <section className="legal-section">
              <h2>제4조 (서비스의 제공)</h2>
              <ul>
                <li>본 서비스는 교육 목적의 무료 웹 애플리케이션을 제공합니다.</li>
                <li>서비스의 이용은 무료이며, 별도의 유료 결제가 필요하지 않습니다.</li>
                <li>본 서비스는 교육 활동 지원을 목적으로 하며, 상업적 목적으로 운영되지 않습니다.</li>
              </ul>
            </section>

            <section className="legal-section">
              <h2>제5조 (서비스의 중단)</h2>
              <p>
                ① 본 서비스는 시스템 점검, 교체 및 고장, 통신 두절 등의 사유가 발생한 경우에는
                서비스의 제공을 일시적으로 중단할 수 있습니다.
              </p>
              <p>
                ② 본 서비스는 무료로 제공되는 교육용 서비스이므로, 서비스 중단으로 인한 별도의
                보상은 제공되지 않습니다.
              </p>
            </section>

            <section className="legal-section">
              <h2>제6조 (회원가입)</h2>
              <p>
                ① 이용자는 서비스가 정한 가입 양식에 따라 회원정보를 기입한 후 이 약관에
                동의함으로써 회원가입을 신청합니다.
              </p>
              <p>
                ② 만 14세 미만의 아동은 학교 가정통신문 등을 통해 보호자(법정대리인)의 동의를
                받은 후 서비스를 이용할 수 있습니다.
              </p>
            </section>

            <section className="legal-section">
              <h2>제7조 (회원 탈퇴)</h2>
              <p>
                회원은 본 서비스에 언제든지 탈퇴를 요청할 수 있으며, 서비스는 즉시 회원탈퇴를
                처리합니다.
              </p>
            </section>

            <section className="legal-section">
              <h2>제8조 (이용자의 의무)</h2>
              <p>이용자는 다음 행위를 하여서는 안 됩니다.</p>
              <ul>
                <li>허위 내용의 등록</li>
                <li>타인의 정보 도용</li>
                <li>서비스에 게시된 정보의 무단 변경</li>
                <li>서비스의 운영을 방해하는 행위</li>
                <li>타인의 명예를 손상시키거나 불이익을 주는 행위</li>
                <li>공서양속에 반하는 정보를 게시하는 행위</li>
              </ul>
            </section>

            <section className="legal-section">
              <h2>제9조 (저작권)</h2>
              <p>① 본 서비스가 작성한 저작물에 대한 저작권은 서비스 제공자에게 귀속합니다.</p>
              <p>
                ② 이용자는 서비스를 이용하여 얻은 정보를 서비스 제공자의 사전 승낙 없이 복제,
                송신, 출판, 배포하여서는 안 됩니다.
              </p>
            </section>

            <section className="legal-section">
              <h2>제10조 (면책조항)</h2>
              <p>
                ① 본 서비스는 무료로 제공되는 교육용 서비스로서, 서비스 이용 중 발생하는 기술적
                문제나 오류에 대해 제한적 책임을 집니다.
              </p>
              <p>
                ② 본 서비스가 연결하는 외부 웹 애플리케이션의 내용에 대해서는 해당 애플리케이션
                제공자가 책임을 집니다.
              </p>
            </section>

            <section className="legal-section">
              <h2>제11조 (분쟁해결)</h2>
              <p>
                본 서비스와 이용자 간에 발생한 분쟁에 관하여는 대한민국 법을 적용하며, 소송이
                제기되는 경우 서비스 제공자의 소재지를 관할하는 법원을 관할법원으로 합니다.
              </p>
            </section>

            <section className="legal-section">
              <h2>부칙</h2>
              <p>이 약관은 2026년 1월 28일부터 시행됩니다.</p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
