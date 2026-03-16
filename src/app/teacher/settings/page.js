'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { getTeacherSettings, saveTeacherSettings } from '@/lib/firestore';

export default function TeacherSettings() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [settings, setSettings] = useState({
    growndClassId: '',
    growndApiKey: '',
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push('/teacher');
        return;
      }
      setUser(u);

      const existing = await getTeacherSettings(u.uid);
      if (existing) {
        setSettings({
          growndClassId: existing.growndClassId || '',
          growndApiKey: existing.growndApiKey || '',
        });
      }
    });
    return () => unsubscribe();
  }, [router]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);

    try {
      await saveTeacherSettings(user.uid, {
        growndClassId: settings.growndClassId,
        growndApiKey: settings.growndApiKey,
        email: user.email,
        displayName: user.displayName,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      console.error('Save error:', err);
      alert('저장에 실패했습니다.');
    }
    setSaving(false);
  };

  if (!user) return null;

  return (
    <div className="page-container">
      <nav className="navbar">
        <Link href="/teacher" className="navbar-brand">
          <span className="emoji">🦄</span> 메타인지 유니콘
        </Link>
        <Link href="/teacher" className="btn btn-ghost btn-sm">← 대시보드</Link>
      </nav>

      <div className="content-wrapper content-narrow">
        <h1 className="heading-section">⚙️ 설정</h1>
        <p className="subtitle">Grownd 연동 정보를 입력하세요</p>

        <form onSubmit={handleSave}>
          <div className="card-glass">
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              🌱 Grownd API 설정
            </h3>

            <div className="form-group">
              <label className="form-label">클래스 ID (Class ID)</label>
              <input
                id="input-class-id"
                type="text"
                className="form-input"
                placeholder="예: NP0hetJ3wyQKFtRnFeftmPiy8Dl4_2"
                value={settings.growndClassId}
                onChange={(e) => setSettings(prev => ({ ...prev, growndClassId: e.target.value }))}
              />
              <p className="form-hint">그라운드 학급의 클래스 ID를 입력하세요</p>
            </div>

            <div className="form-group">
              <label className="form-label">API 키 (API Key)</label>
              <input
                id="input-api-key"
                type="password"
                className="form-input"
                placeholder="Grownd에서 발급받은 API 키"
                value={settings.growndApiKey}
                onChange={(e) => setSettings(prev => ({ ...prev, growndApiKey: e.target.value }))}
              />
              <p className="form-hint">그라운드에서 발급받은 API 키를 입력하세요</p>
            </div>

            <button
              id="btn-save-settings"
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={saving}
            >
              {saving ? '저장 중...' : saved ? '✅ 저장 완료!' : '💾 저장'}
            </button>
          </div>
        </form>

        {/* Info */}
        <div className="card" style={{ marginTop: '1.5rem' }}>
          <h4 style={{ fontSize: '0.9rem', marginBottom: '0.75rem', color: 'var(--text-secondary)' }}>
            📖 설정 방법
          </h4>
          <ol style={{ fontSize: '0.85rem', color: 'var(--text-muted)', paddingLeft: '1.25rem', lineHeight: 2 }}>
            <li><a href="https://growndcard.com" target="_blank" style={{ color: 'var(--cyan-primary)' }}>growndcard.com</a>에 로그인</li>
            <li>설정에서 API 키를 발급</li>
            <li>클래스 ID와 API 키를 위에 입력</li>
            <li>저장하면 채점 시 자동으로 포인트가 부여됩니다!</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
