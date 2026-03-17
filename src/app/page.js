'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function HomePage() {
  const router = useRouter();
  const [entryCode, setEntryCode] = useState('');
  const [studentNumber, setStudentNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleStudentEntry = async (e) => {
    e.preventDefault();
    if (!entryCode.trim() || !studentNumber.trim()) {
      setError('입장 코드와 출석번호를 모두 입력해주세요.');
      return;
    }

    const normalizedStudentNumber = Number(studentNumber);
    if (!Number.isInteger(normalizedStudentNumber) || normalizedStudentNumber < 1 || normalizedStudentNumber > 99) {
      setError('출석번호는 1부터 99 사이로 입력해주세요.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`/api/assignments/lookup?code=${entryCode.toUpperCase()}`);
      const data = await res.json();

      if (!data.success) {
        setError(data.error || '입장 코드를 찾을 수 없어요. 선생님께 확인해주세요!');
        setLoading(false);
        return;
      }

      router.push(`/chat/${entryCode.toUpperCase()}?student=${normalizedStudentNumber}`);
    } catch (err) {
      setError('서버 연결에 실패했어요. 다시 시도해주세요.');
      setLoading(false);
    }
  };

  return (
    <div className="page-container">
      <div className="entry-container">
        <div className="entry-card">
          <div className="unicorn-avatar unicorn-avatar-large">
            🦄
          </div>

          <h1 className="heading-hero">
            <span className="heading-gradient">메타인지 유니콘</span>
          </h1>
          <p className="subtitle">
            오늘 배운 것을 유니콘에게 설명해보세요!
          </p>

          <div className="card-glass">
            <form onSubmit={handleStudentEntry}>
              <div className="form-group">
                <label className="form-label">📝 입장 코드</label>
                <input
                  id="entry-code"
                  type="text"
                  className="form-input form-input-large"
                  placeholder="SUNNY42"
                  value={entryCode}
                  onChange={(e) => setEntryCode(e.target.value.toUpperCase())}
                  maxLength={6}
                  autoComplete="off"
                />
                <p className="form-hint">선생님이 알려주신 6자리 코드를 입력하세요</p>
              </div>

              <div className="form-group">
                <label className="form-label">🎒 출석번호</label>
                <input
                  id="student-number"
                  type="number"
                  className="form-input form-input-large"
                  placeholder="7"
                  value={studentNumber}
                  onChange={(e) => setStudentNumber(e.target.value)}
                  min={1}
                  max={99}
                  autoComplete="off"
                />
              </div>

              {error && (
                <p style={{ color: '#f87171', fontSize: '0.85rem', marginBottom: '1rem', textAlign: 'center' }}>
                  ⚠️ {error}
                </p>
              )}

              <button
                id="btn-enter"
                type="submit"
                className="btn btn-primary btn-large"
                disabled={loading}
                style={{ width: '100%' }}
              >
                {loading ? '입장 중...' : '🦄 유니콘 만나러 가기'}
              </button>
            </form>
          </div>

          <div className="entry-divider">선생님이신가요?</div>

          <Link href="/teacher" className="btn btn-secondary" style={{ width: '100%' }}>
            👩‍🏫 교사 로그인
          </Link>
        </div>
      </div>
    </div>
  );
}
