'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '@/lib/firebase';
import { createAssignment } from '@/lib/firestore';
import {
  DEFAULT_SCORE_OPTIONS,
  DEFAULT_SCORING_STYLE,
  formatScoreOptions,
  parseScoreOptionsInput,
  SCORE_PRESETS,
} from '@/lib/scoreConfig';

const APPRECIATION_LEVELS = [
  {
    value: 1,
    label: '1단계 · 기술',
    emoji: '👀',
    desc: '작품에서 보이는 것을 구체적으로 말하게 한다',
    prompt: '기술(記述) 단계까지만 안내해. 학생이 작품에서 보이는 것(색, 형태, 인물, 배경 등)을 말로 표현하는 것을 돕는다.',
  },
  {
    value: 2,
    label: '2단계 · 분석',
    emoji: '🔍',
    desc: '기술 + 색·구도·선·명암 등 표현 방법 분석',
    prompt: '기술(記述)과 분석(分析) 단계까지 안내해. 먼저 보이는 것을 말하게 한 뒤, 색감·구도·선·명암·질감 등 표현 기법을 생각하게 한다.',
  },
  {
    value: 3,
    label: '3단계 · 해석',
    emoji: '💭',
    desc: '기술 + 분석 + 작가 의도·감정·메시지 해석',
    prompt: '기술(記述), 분석(分析), 해석(解釋) 단계까지 안내해. 보이는 것과 표현 기법을 거쳐, 작가의 의도나 감정, 작품이 전달하려는 메시지를 학생 스스로 추측하게 한다.',
  },
  {
    value: 4,
    label: '4단계 · 판단',
    emoji: '⚖️',
    desc: '모든 단계 + 근거를 들어 자신의 의견 표현',
    prompt: '기술(記述), 분석(分析), 해석(解釋), 판단(判斷) 네 단계를 모두 안내해. 마지막으로 학생이 이 작품에 대한 자신의 생각을 근거와 함께 표현하게 한다.',
  },
];

const DIFFICULTY_LEVELS = [
  {
    value: 'beginner',
    label: '초급',
    emoji: '🌱',
    desc: '쉬운 말로 힌트를 충분히 주고, 짧은 답변도 긍정적으로 유도',
    prompt: '질문은 매우 쉽고 친근하게 해. 학생이 조금만 답해도 "맞아, 잘 봤어!"처럼 칭찬하고 힌트 질문으로 더 이끌어 줘. 미술 용어는 최소한으로 쓰고 쓸 때는 쉽게 풀어서 설명해.',
  },
  {
    value: 'intermediate',
    label: '중급',
    emoji: '🌿',
    desc: '기본 미술 용어를 활용하며 스스로 생각하도록 유도',
    prompt: '기본적인 미술 용어(구도, 명암, 색채 등)를 사용할 수 있어. 학생이 스스로 생각하도록 열린 질문을 하고, 막히면 부드럽게 힌트를 줘.',
  },
  {
    value: 'advanced',
    label: '고급',
    emoji: '🌳',
    desc: '심화 미술 용어와 맥락을 활용해 비판적 사고 유도',
    prompt: '다양한 미술 용어와 시대적·문화적 맥락을 활용할 수 있어. 학생이 근거를 들어 자신의 해석을 주장하도록 도전적인 질문을 해. 피상적인 답변에는 "왜 그렇게 생각해?"처럼 더 깊이 파고들어.',
  },
];

export default function NewArtAssignment() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [imagePreviewError, setImagePreviewError] = useState(false);

  const [form, setForm] = useState({
    paintingTitle: '',
    artist: '',
    year: '',
    imageUrl: '',
    paintingContext: '',
    appreciationLevel: 2,
    difficultyLevel: 'intermediate',
    title: '',
    scoreOptionsInput: formatScoreOptions(DEFAULT_SCORE_OPTIONS),
    minTurns: 2,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (!nextUser) {
        router.push('/teacher');
        return;
      }
      setUser(nextUser);
    });
    return () => unsubscribe();
  }, [router]);

  const parsedScoreOptions = useMemo(
    () => parseScoreOptionsInput(form.scoreOptionsInput),
    [form.scoreOptionsInput]
  );

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleScorePreset = (values) => {
    setForm((prev) => ({ ...prev, scoreOptionsInput: formatScoreOptions(values) }));
  };

  const autoTitle = useMemo(() => {
    if (form.paintingTitle && form.artist) {
      return `${form.paintingTitle} - ${form.artist}`;
    }
    return form.paintingTitle || '';
  }, [form.paintingTitle, form.artist]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.paintingTitle.trim() || !form.artist.trim()) return;
    if (!parsedScoreOptions.ok) {
      alert(parsedScoreOptions.error);
      return;
    }

    setSaving(true);

    const appreciationInfo = APPRECIATION_LEVELS.find((l) => l.value === form.appreciationLevel);
    const difficultyInfo = DIFFICULTY_LEVELS.find((d) => d.value === form.difficultyLevel);

    try {
      const result = await createAssignment(user.uid, {
        type: 'art',
        title: form.title.trim() || autoTitle,
        subject: '미술',
        grade: '',
        paintingTitle: form.paintingTitle.trim(),
        artist: form.artist.trim(),
        year: form.year.trim(),
        imageUrl: form.imageUrl.trim(),
        paintingContext: form.paintingContext.trim(),
        appreciationLevel: form.appreciationLevel,
        appreciationLevelLabel: appreciationInfo?.label || '',
        appreciationPrompt: appreciationInfo?.prompt || '',
        difficultyLevel: form.difficultyLevel,
        difficultyLabel: difficultyInfo?.label || '',
        difficultyPrompt: difficultyInfo?.prompt || '',
        learningObjective: `${appreciationInfo?.label} 감상 · ${difficultyInfo?.label}`,
        content: `명화 감상 과제: ${form.paintingTitle} (${form.artist}${form.year ? ', ' + form.year : ''})`,
        keywords: [],
        standards: [],
        scoreOptions: parsedScoreOptions.scoreOptions,
        scoringStyle: DEFAULT_SCORING_STYLE,
        minTurns: form.minTurns,
      });

      setCreated({ ...result, scoreOptions: parsedScoreOptions.scoreOptions });
    } catch (error) {
      console.error('Create art assignment error:', error);
      alert('과제 생성에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (!user) return null;

  if (created) {
    return (
      <div className="page-container">
        <nav className="navbar">
          <Link href="/teacher" className="navbar-brand">
            <span className="emoji">🎨</span> 미술 유니콘
          </Link>
        </nav>
        <div className="content-wrapper content-narrow" style={{ textAlign: 'center', paddingTop: '3rem' }}>
          <div className="unicorn-avatar unicorn-avatar-large">✨</div>
          <h1 className="heading-hero">
            <span className="heading-gradient">과제 생성 완료</span>
          </h1>
          <p className="subtitle">학생들에게 아래 입장 코드를 알려 주세요.</p>
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>입장 코드</p>
            <p style={{
              fontSize: '3rem', fontWeight: 800, letterSpacing: '0.2em',
              background: 'var(--gradient-unicorn)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            }}>
              {created.entryCode}
            </p>
            <p className="form-hint" style={{ marginTop: '1rem' }}>
              점수 단계: {formatScoreOptions(created.scoreOptions, ' / ')}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <Link href="/teacher" className="btn btn-secondary">대시보드로</Link>
            <Link href={`/teacher/assignments/${created.id}`} className="btn btn-primary">결과 보기</Link>
          </div>
        </div>
      </div>
    );
  }

  const selectedLevel = APPRECIATION_LEVELS.find((l) => l.value === form.appreciationLevel);
  const selectedDifficulty = DIFFICULTY_LEVELS.find((d) => d.value === form.difficultyLevel);

  return (
    <div className="page-container">
      <nav className="navbar">
        <Link href="/teacher" className="navbar-brand">
          <span className="emoji">🎨</span> 미술 유니콘
        </Link>
        <Link href="/teacher" className="btn btn-ghost btn-sm">대시보드로</Link>
      </nav>

      <div className="content-wrapper content-medium">
        <h1 className="heading-section">명화 감상 과제 만들기</h1>
        <p className="subtitle">감상할 명화와 단계, 난이도를 설정하면 유니콘이 맞춤형 질문으로 학생을 안내합니다.</p>

        <form onSubmit={handleSubmit}>

          {/* 명화 정보 */}
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              🖼️ 명화 정보
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">작품명 *</label>
                <input
                  id="input-painting-title"
                  type="text"
                  className="form-input"
                  placeholder="예: 별이 빛나는 밤"
                  value={form.paintingTitle}
                  onChange={handleChange('paintingTitle')}
                  required
                />
              </div>
              <div className="form-group">
                <label className="form-label">작가 *</label>
                <input
                  id="input-artist"
                  type="text"
                  className="form-input"
                  placeholder="예: 빈센트 반 고흐"
                  value={form.artist}
                  onChange={handleChange('artist')}
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">제작 연도 (선택)</label>
              <input
                id="input-year"
                type="text"
                className="form-input"
                placeholder="예: 1889"
                value={form.year}
                onChange={handleChange('year')}
                style={{ maxWidth: '200px' }}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">이미지 URL (선택)</label>
              <input
                id="input-image-url"
                type="url"
                className="form-input"
                placeholder="https://..."
                value={form.imageUrl}
                onChange={(e) => {
                  setImagePreviewError(false);
                  handleChange('imageUrl')(e);
                }}
              />
              <p className="form-hint">학생 채팅 화면에 명화 이미지가 표시됩니다. 위키미디어 등 공개 이미지 URL을 사용하세요.</p>
              {form.imageUrl && !imagePreviewError && (
                <div style={{ marginTop: '0.75rem', borderRadius: 'var(--radius-md)', overflow: 'hidden', maxHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.2)' }}>
                  <img
                    src={form.imageUrl}
                    alt="명화 미리보기"
                    style={{ maxHeight: '200px', maxWidth: '100%', objectFit: 'contain' }}
                    onError={() => setImagePreviewError(true)}
                  />
                </div>
              )}
              {imagePreviewError && (
                <p style={{ color: '#fca5a5', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  ⚠️ 이미지를 불러올 수 없습니다. URL을 확인해 주세요.
                </p>
              )}
            </div>
          </div>

          {/* 작품 배경 정보 */}
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              📚 작품 배경 정보 (선택)
            </h3>
            <p className="form-hint" style={{ marginBottom: '1rem' }}>
              유니콘이 학생에게 더 정확하게 안내할 수 있도록, 이 작품의 시대적 맥락·화풍·주요 감상 포인트를 적어 주세요.
            </p>
            <textarea
              id="input-context"
              className="form-textarea"
              placeholder="예: 고흐가 생레미 요양원에 입원해 있던 시기의 작품. 소용돌이치는 하늘과 강렬한 붓 터치가 특징. 별·달·사이프러스 나무가 주요 구성 요소."
              value={form.paintingContext}
              onChange={handleChange('paintingContext')}
              rows={4}
            />
          </div>

          {/* 과제 제목 */}
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              📝 과제 제목 (선택)
            </h3>
            <input
              id="input-title"
              type="text"
              className="form-input"
              placeholder={autoTitle || '예: 별이 빛나는 밤 - 반 고흐'}
              value={form.title}
              onChange={handleChange('title')}
            />
            <p className="form-hint">비워두면 "작품명 - 작가"로 자동 설정됩니다.</p>
          </div>

          {/* 감상 단계 */}
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              🎯 감상 단계 설정
            </h3>
            <p className="form-hint" style={{ marginBottom: '1.25rem' }}>
              유니콘이 학생을 어디까지 안내할지 결정합니다. 단계가 높을수록 더 깊은 감상을 유도합니다.
            </p>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {APPRECIATION_LEVELS.map((level) => {
                const isSelected = form.appreciationLevel === level.value;
                return (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, appreciationLevel: level.value }))}
                    style={{
                      textAlign: 'left', padding: '0.9rem 1rem', borderRadius: 'var(--radius-md)',
                      border: `1px solid ${isSelected ? 'var(--cyan-primary)' : 'var(--border-color)'}`,
                      background: isSelected ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      color: 'var(--text-primary)', cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                      {level.emoji} {level.label}
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>{level.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 질문 난이도 */}
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              📊 질문 난이도
            </h3>
            <p className="form-hint" style={{ marginBottom: '1.25rem' }}>
              학생 수준에 맞게 유니콘의 질문 방식과 어휘를 조정합니다.
            </p>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {DIFFICULTY_LEVELS.map((level) => {
                const isSelected = form.difficultyLevel === level.value;
                return (
                  <button
                    key={level.value}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, difficultyLevel: level.value }))}
                    style={{
                      textAlign: 'left', padding: '0.9rem 1rem', borderRadius: 'var(--radius-md)',
                      border: `1px solid ${isSelected ? 'var(--purple-light)' : 'var(--border-color)'}`,
                      background: isSelected ? 'rgba(168, 85, 247, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      color: 'var(--text-primary)', cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                      {level.emoji} {level.label}
                    </div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>{level.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 대화 횟수 */}
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              💬 대화 횟수 설정
            </h3>
            <p className="form-hint" style={{ marginBottom: '1.25rem' }}>
              채점하기 전에 학생과 최소 몇 번 대화할지 설정합니다.
            </p>
            <div style={{ display: 'grid', gap: '0.75rem' }}>
              {[
                { value: 1, label: '1회', desc: '학생이 한 번 답하면 바로 채점 가능' },
                { value: 2, label: '2회 (권장)', desc: '답변 확인 후 한 번 더 보충할 기회 제공' },
                { value: 3, label: '3회', desc: '충분한 대화 후 채점 (3회가 최대)' },
              ].map((option) => {
                const isSelected = form.minTurns === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, minTurns: option.value }))}
                    style={{
                      textAlign: 'left', padding: '0.9rem 1rem', borderRadius: 'var(--radius-md)',
                      border: `1px solid ${isSelected ? 'var(--cyan-primary)' : 'var(--border-color)'}`,
                      background: isSelected ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      color: 'var(--text-primary)', cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{option.label}</div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>{option.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 점수 단계 */}
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              🏅 점수 단계 설정
            </h3>
            <div className="form-group">
              <label className="form-label">빠른 프리셋</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {SCORE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => handleScorePreset(preset.values)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">점수 단계</label>
              <input
                id="input-score-options"
                type="text"
                className="form-input"
                placeholder="예: 0, 1, 2, 3"
                value={form.scoreOptionsInput}
                onChange={handleChange('scoreOptionsInput')}
              />
              <p className="form-hint">쉼표 또는 공백으로 구분해 입력하세요. 0점부터 시작해야 합니다.</p>
              {parsedScoreOptions.ok ? (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                  {parsedScoreOptions.scoreOptions.map((score) => (
                    <span key={score} className="badge badge-score">{score}점</span>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#fca5a5', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                  {parsedScoreOptions.error}
                </p>
              )}
            </div>
          </div>

          {/* 설정 요약 */}
          {form.paintingTitle && form.artist && (
            <div
              style={{
                marginBottom: '1.5rem', padding: '1rem 1.25rem',
                borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)',
                background: 'rgba(168, 85, 247, 0.06)',
              }}
            >
              <p style={{ fontSize: '0.8rem', color: 'var(--purple-light)', fontWeight: 600, marginBottom: '0.75rem' }}>
                설정 요약
              </p>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                🖼️ {form.paintingTitle}{form.artist ? ` · ${form.artist}` : ''}{form.year ? ` (${form.year})` : ''}
              </p>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.3rem' }}>
                🎯 {selectedLevel?.emoji} {selectedLevel?.label}
              </p>
              <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                📊 {selectedDifficulty?.emoji} {selectedDifficulty?.label} · 최소 {form.minTurns}회 대화
              </p>
            </div>
          )}

          <button
            id="btn-create"
            type="submit"
            className="btn btn-primary btn-large"
            style={{ width: '100%' }}
            disabled={saving || !form.paintingTitle.trim() || !form.artist.trim() || !parsedScoreOptions.ok}
          >
            {saving ? '생성 중...' : '🎨 명화 감상 과제 생성하기'}
          </button>
        </form>
      </div>
    </div>
  );
}
