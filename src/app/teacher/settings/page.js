'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { getChatLengthExamples, getTeacherConstraintDefaults } from '@/lib/chatConstraints';
import { getTeacherSettings, saveTeacherSettings } from '@/lib/firestore';

export default function TeacherSettings() {
  const router = useRouter();
  const mathDefaults = getTeacherConstraintDefaults({}, 'math');
  const artDefaults = getTeacherConstraintDefaults({}, 'art');
  const lengthExamples = getChatLengthExamples();
  const [user, setUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [settings, setSettings] = useState({
    growndClassId: '',
    growndApiKey: '',
    defaultMathMinTurns: mathDefaults.minTurns,
    defaultMathMaxTurns: mathDefaults.maxTurns,
    defaultArtMinTurns: artDefaults.minTurns,
    defaultArtMaxTurns: artDefaults.maxTurns,
    defaultMinStudentMessageBytes: mathDefaults.minStudentMessageBytes,
    defaultMaxStudentMessageBytes: mathDefaults.maxStudentMessageBytes,
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
          defaultMathMinTurns: existing.defaultMathMinTurns ?? mathDefaults.minTurns,
          defaultMathMaxTurns: existing.defaultMathMaxTurns ?? mathDefaults.maxTurns,
          defaultArtMinTurns: existing.defaultArtMinTurns ?? artDefaults.minTurns,
          defaultArtMaxTurns: existing.defaultArtMaxTurns ?? artDefaults.maxTurns,
          defaultMinStudentMessageBytes: existing.defaultMinStudentMessageBytes ?? mathDefaults.minStudentMessageBytes,
          defaultMaxStudentMessageBytes: existing.defaultMaxStudentMessageBytes ?? mathDefaults.maxStudentMessageBytes,
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
        defaultMathMinTurns: settings.defaultMathMinTurns,
        defaultMathMaxTurns: settings.defaultMathMaxTurns,
        defaultArtMinTurns: settings.defaultArtMinTurns,
        defaultArtMaxTurns: settings.defaultArtMaxTurns,
        defaultMinStudentMessageBytes: settings.defaultMinStudentMessageBytes,
        defaultMaxStudentMessageBytes: settings.defaultMaxStudentMessageBytes,
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

            <div
              style={{
                marginBottom: '1.5rem',
                padding: '1rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)',
                background: 'rgba(255, 255, 255, 0.03)',
              }}
            >
              <h4 style={{ marginBottom: '1rem', fontSize: '0.95rem', color: 'var(--purple-light)' }}>
                새 과제 기본값
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">수학 최소/최대 턴</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <input
                      type="number"
                      min="1"
                      max={settings.defaultMathMaxTurns}
                      className="form-input"
                      value={settings.defaultMathMinTurns}
                      onChange={(e) => {
                        const nextValue = Number(e.target.value || 1);
                        setSettings((prev) => ({
                          ...prev,
                          defaultMathMinTurns: nextValue,
                          defaultMathMaxTurns: Math.max(prev.defaultMathMaxTurns, nextValue),
                        }));
                      }}
                    />
                    <input
                      type="number"
                      min={settings.defaultMathMinTurns}
                      max="12"
                      className="form-input"
                      value={settings.defaultMathMaxTurns}
                      onChange={(e) => {
                        const nextValue = Number(e.target.value || settings.defaultMathMinTurns);
                        setSettings((prev) => ({
                          ...prev,
                          defaultMathMaxTurns: Math.max(nextValue, prev.defaultMathMinTurns),
                        }));
                      }}
                    />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">미술 최소/최대 턴</label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <input
                      type="number"
                      min="1"
                      max={settings.defaultArtMaxTurns}
                      className="form-input"
                      value={settings.defaultArtMinTurns}
                      onChange={(e) => {
                        const nextValue = Number(e.target.value || 1);
                        setSettings((prev) => ({
                          ...prev,
                          defaultArtMinTurns: nextValue,
                          defaultArtMaxTurns: Math.max(prev.defaultArtMaxTurns, nextValue),
                        }));
                      }}
                    />
                    <input
                      type="number"
                      min={settings.defaultArtMinTurns}
                      max="12"
                      className="form-input"
                      value={settings.defaultArtMaxTurns}
                      onChange={(e) => {
                        const nextValue = Number(e.target.value || settings.defaultArtMinTurns);
                        setSettings((prev) => ({
                          ...prev,
                          defaultArtMaxTurns: Math.max(nextValue, prev.defaultArtMinTurns),
                        }));
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">학생 답변 길이 기본값</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <input
                    type="number"
                    min="1"
                    max={settings.defaultMaxStudentMessageBytes}
                    className="form-input"
                    value={settings.defaultMinStudentMessageBytes}
                    onChange={(e) => {
                      const nextValue = Number(e.target.value || 1);
                      setSettings((prev) => ({
                        ...prev,
                        defaultMinStudentMessageBytes: nextValue,
                        defaultMaxStudentMessageBytes: Math.max(prev.defaultMaxStudentMessageBytes, nextValue),
                      }));
                    }}
                  />
                  <input
                    type="number"
                    min={settings.defaultMinStudentMessageBytes}
                    max="4000"
                    className="form-input"
                    value={settings.defaultMaxStudentMessageBytes}
                    onChange={(e) => {
                      const nextValue = Number(e.target.value || settings.defaultMinStudentMessageBytes);
                      setSettings((prev) => ({
                        ...prev,
                        defaultMaxStudentMessageBytes: Math.max(nextValue, prev.defaultMinStudentMessageBytes),
                      }));
                    }}
                  />
                </div>
                <p className="form-hint" style={{ marginTop: '0.75rem' }}>
                  바이트 예시: {lengthExamples.map((example) => `${example.label} ${example.bytes}B`).join(' · ')}
                </p>
                <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.75rem' }}>
                  {lengthExamples.map((example) => (
                    <div
                      key={example.label}
                      style={{
                        padding: '0.75rem 0.9rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid var(--border-color)',
                        color: 'var(--text-secondary)',
                        fontSize: '0.88rem',
                      }}
                    >
                      <strong style={{ color: 'var(--text-primary)' }}>{example.label}</strong> · {example.bytes}B
                      <div style={{ marginTop: '0.35rem' }}>{example.text}</div>
                    </div>
                  ))}
                </div>
              </div>
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
