'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth, googleProvider } from '@/lib/firebase';
import { signInWithPopup, onAuthStateChanged, signOut } from 'firebase/auth';
import { getAssignmentsByTeacher } from '@/lib/firestore';
import { getTeacherSettings } from '@/lib/firestore';

export default function TeacherDashboard() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [assignments, setAssignments] = useState([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [hasSettings, setHasSettings] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUser(u);
        setDataLoading(true);

        // 교사 설정 확인
        const settings = await getTeacherSettings(u.uid);
        setHasSettings(!!(settings?.growndApiKey && settings?.growndClassId));

        // 과제 불러오기
        try {
          const data = await getAssignmentsByTeacher(u.uid);
          setAssignments(data);
        } catch (err) {
          console.error('Failed to load assignments:', err);
        }
        setDataLoading(false);
      } else {
        setUser(null);
      }
      setAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Login error:', err);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setAssignments([]);
  };

  const formatDate = (ts) => {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  // 로그인 전 화면
  if (authLoading) {
    return (
      <div className="page-container">
        <div className="loading-container">
          <div className="loading-spinner" />
          <p style={{ color: 'var(--text-secondary)' }}>로딩 중...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="page-container">
        <div className="entry-container">
          <div className="entry-card">
            <div className="unicorn-avatar unicorn-avatar-large">👩‍🏫</div>
            <h1 className="heading-hero">
              <span className="heading-gradient">교사 로그인</span>
            </h1>
            <p className="subtitle">
              구글 계정으로 간편하게 로그인하세요
            </p>

            <button
              id="btn-google-login"
              className="btn btn-primary btn-large"
              onClick={handleLogin}
              style={{ width: '100%', marginBottom: '1rem' }}
            >
              🔐 Google로 로그인
            </button>

            <Link href="/" className="btn btn-ghost" style={{ width: '100%' }}>
              ← 학생 화면으로
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 로그인 후 대시보드
  const activeCount = assignments.filter(a => a.isActive).length;

  return (
    <div className="page-container">
      {/* Navbar */}
      <nav className="navbar">
        <Link href="/teacher" className="navbar-brand">
          <span className="emoji">🦄</span> 메타인지 유니콘
        </Link>
        <div className="navbar-actions">
          <Link href="/teacher/settings" className="btn btn-ghost btn-sm">
            ⚙️ 설정
          </Link>
          <div className="navbar-user">
            {user.photoURL && <img src={user.photoURL} alt="" />}
            <span>{user.displayName}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={handleLogout}>로그아웃</button>
        </div>
      </nav>

      <div className="content-wrapper">
        {/* Grownd 설정 경고 */}
        {!hasSettings && (
          <div className="card" style={{
            marginBottom: '1.5rem',
            borderColor: 'rgba(251, 191, 36, 0.3)',
            background: 'rgba(251, 191, 36, 0.05)'
          }}>
            <p style={{ color: 'var(--yellow-primary)' }}>
              ⚠️ Grownd API 설정이 필요합니다.{' '}
              <Link href="/teacher/settings" style={{ color: 'var(--purple-light)', textDecoration: 'underline' }}>
                설정하러 가기 →
              </Link>
            </p>
          </div>
        )}

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
          <div>
            <h1 className="heading-section">📋 나의 과제</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              과제를 만들고 학생들의 학습 결과를 확인하세요
            </p>
          </div>
          <Link href="/teacher/assignments/new" className="btn btn-primary">
            ✨ 새 과제 만들기
          </Link>
        </div>

        {/* Stats */}
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{assignments.length}</div>
            <div className="stat-label">전체 과제</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{activeCount}</div>
            <div className="stat-label">활성 과제</div>
          </div>
        </div>

        {/* Assignment List */}
        {dataLoading ? (
          <div className="loading-container" style={{ minHeight: '30vh' }}>
            <div className="loading-spinner" />
          </div>
        ) : assignments.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-emoji">📝</div>
            <p className="empty-state-text">아직 만든 과제가 없어요</p>
            <Link href="/teacher/assignments/new" className="btn btn-primary">
              ✨ 첫 과제 만들기
            </Link>
          </div>
        ) : (
          <div className="grid-2">
            {assignments.map(a => (
              <Link
                key={a.id}
                href={`/teacher/assignments/${a.id}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                    <div className="card-title">{a.title}</div>
                    <span className={`badge ${a.isActive ? 'badge-active' : 'badge-inactive'}`}>
                      {a.isActive ? '활성' : '비활성'}
                    </span>
                  </div>
                  {a.subject && (
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                      {a.subject} {a.grade && `· ${a.grade}`}
                    </p>
                  )}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="card-meta">
                      입장코드: <strong style={{ color: 'var(--cyan-primary)', letterSpacing: '0.1em' }}>{a.entryCode}</strong>
                    </span>
                    <span className="card-meta">{formatDate(a.createdAt)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
