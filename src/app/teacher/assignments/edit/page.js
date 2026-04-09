'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';

import { buildArtAssignmentContent, buildArtAssignmentTitle } from '@/lib/artAssignment';
import { normalizeAssignmentConstraints } from '@/lib/chatConstraints';
import { hasStudentStartedConversation } from '@/lib/conversationState';
import { auth } from '@/lib/firebase';
import {
  getAssignmentById,
  getConversationsByAssignment,
  updateAssignment,
} from '@/lib/firestore';
import {
  DEFAULT_SCORING_STYLE,
  formatScoreOptions,
  getAssignmentScoreOptions,
  getScoringStyleDescription,
  getScoringStyleLabel,
  parseScoreOptionsInput,
  SCORING_STYLE_OPTIONS,
} from '@/lib/scoreConfig';

const APPRECIATION_LEVELS = [
  {
    value: 1,
    label: '1단계 관찰',
    prompt: '작품에서 보이는 것들을 편안하게 관찰하고 말해 보도록 이끈다.',
  },
  {
    value: 2,
    label: '2단계 분석',
    prompt: '관찰한 요소를 바탕으로 색, 구도, 표현 방식을 생각해 보도록 이끈다.',
  },
  {
    value: 3,
    label: '3단계 해석',
    prompt: '작가의 의도나 분위기, 작품이 주는 느낌을 스스로 해석해 보도록 이끈다.',
  },
  {
    value: 4,
    label: '4단계 판단',
    prompt: '자신의 감상과 이유를 연결해 작품에 대한 생각을 분명하게 말해 보도록 이끈다.',
  },
];

const DIFFICULTY_LEVELS = [
  {
    value: 'beginner',
    label: '초급',
    prompt: '쉽고 친근한 질문으로 학생이 부담 없이 작품을 말해 보게 한다.',
  },
  {
    value: 'intermediate',
    label: '중급',
    prompt: '기본 미술 어휘와 함께 스스로 생각을 넓혀 가도록 질문한다.',
  },
  {
    value: 'advanced',
    label: '고급',
    prompt: '비교와 해석, 근거 설명까지 이끌어 내는 깊이 있는 질문을 사용한다.',
  },
];

function joinCsv(values) {
  return Array.isArray(values) ? values.join(', ') : '';
}

function splitCsv(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function EditAssignmentPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const assignmentId = searchParams.get('id');

  const [user, setUser] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [started, setStarted] = useState(false);
  const [imagePreviewError, setImagePreviewError] = useState(false);
  const [form, setForm] = useState({
    title: '',
    subject: '',
    grade: '',
    learningObjective: '',
    content: '',
    keywords: '',
    standards: '',
    scoreOptionsInput: '',
    scoringStyle: DEFAULT_SCORING_STYLE,
    minTurns: 2,
    maxTurns: 3,
    minStudentMessageBytes: 9,
    maxStudentMessageBytes: 220,
    paintingTitle: '',
    artist: '',
    year: '',
    imageUrl: '',
    paintingContext: '',
    appreciationLevel: 2,
    difficultyLevel: 'intermediate',
  });

  const isArt = assignment?.type === 'art';
  const parsedScoreOptions = useMemo(
    () => parseScoreOptionsInput(form.scoreOptionsInput),
    [form.scoreOptionsInput]
  );
  const selectedAppreciation = useMemo(
    () => APPRECIATION_LEVELS.find((item) => item.value === Number(form.appreciationLevel)) || APPRECIATION_LEVELS[1],
    [form.appreciationLevel]
  );
  const selectedDifficulty = useMemo(
    () => DIFFICULTY_LEVELS.find((item) => item.value === form.difficultyLevel) || DIFFICULTY_LEVELS[1],
    [form.difficultyLevel]
  );

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

  useEffect(() => {
    async function load() {
      if (!user || !assignmentId) {
        if (!assignmentId) {
          setLoadError('수정할 과제를 찾을 수 없습니다.');
          setLoading(false);
        }
        return;
      }

      setLoading(true);
      setLoadError('');

      try {
        const [nextAssignment, conversations] = await Promise.all([
          getAssignmentById(assignmentId),
          getConversationsByAssignment(assignmentId),
        ]);

        if (!nextAssignment || nextAssignment.teacherId !== user.uid) {
          setLoadError('과제를 확인할 수 없습니다.');
          setLoading(false);
          return;
        }

        const constraints = normalizeAssignmentConstraints(nextAssignment);
        setAssignment(nextAssignment);
        setStarted(conversations.some(hasStudentStartedConversation));
        setImagePreviewError(false);
        setForm({
          title: nextAssignment.title || '',
          subject: nextAssignment.subject || '',
          grade: nextAssignment.grade || '',
          learningObjective: nextAssignment.learningObjective || '',
          content: nextAssignment.content || '',
          keywords: joinCsv(nextAssignment.keywords),
          standards: joinCsv(nextAssignment.standards),
          scoreOptionsInput: formatScoreOptions(getAssignmentScoreOptions(nextAssignment)),
          scoringStyle: nextAssignment.scoringStyle || DEFAULT_SCORING_STYLE,
          minTurns: constraints.minTurns,
          maxTurns: constraints.maxTurns,
          minStudentMessageBytes: constraints.minStudentMessageBytes,
          maxStudentMessageBytes: constraints.maxStudentMessageBytes,
          paintingTitle: nextAssignment.paintingTitle || '',
          artist: nextAssignment.artist || '',
          year: nextAssignment.year || '',
          imageUrl: nextAssignment.imageUrl || '',
          paintingContext: nextAssignment.paintingContext || '',
          appreciationLevel: nextAssignment.appreciationLevel ?? 2,
          difficultyLevel: nextAssignment.difficultyLevel || 'intermediate',
        });
      } catch (error) {
        console.error('Edit assignment load error:', error);
        setLoadError(error instanceof Error ? error.message : '과제 정보를 불러오지 못했습니다.');
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [assignmentId, user]);

  const handleChange = (field) => (event) => {
    const value = event.target.value;
    if (field === 'imageUrl') {
      setImagePreviewError(false);
    }
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!assignment || !assignmentId || started) {
      return;
    }

    if (!parsedScoreOptions.ok) {
      alert(parsedScoreOptions.error);
      return;
    }

    setSaving(true);

    try {
      const payload = {
        title: isArt ? buildArtAssignmentTitle(form) : form.title.trim(),
        subject: form.subject.trim(),
        grade: form.grade.trim(),
        learningObjective: form.learningObjective.trim(),
        content: isArt ? buildArtAssignmentContent(form) : form.content.trim(),
        keywords: splitCsv(form.keywords),
        standards: splitCsv(form.standards),
        scoreOptions: parsedScoreOptions.scoreOptions,
        scoringStyle: form.scoringStyle,
        minTurns: Number(form.minTurns),
        maxTurns: Number(form.maxTurns),
        minStudentMessageBytes: Number(form.minStudentMessageBytes),
        maxStudentMessageBytes: Number(form.maxStudentMessageBytes),
      };

      if (isArt) {
        Object.assign(payload, {
          paintingTitle: form.paintingTitle.trim(),
          artist: form.artist.trim(),
          year: form.year.trim(),
          imageUrl: form.imageUrl.trim(),
          paintingContext: form.paintingContext.trim(),
          appreciationLevel: Number(form.appreciationLevel),
          appreciationLevelLabel: selectedAppreciation.label,
          appreciationPrompt: selectedAppreciation.prompt,
          difficultyLevel: form.difficultyLevel,
          difficultyLabel: selectedDifficulty.label,
          difficultyPrompt: selectedDifficulty.prompt,
        });
      }

      await updateAssignment(assignmentId, payload);
      router.push(`/teacher/assignments/${assignmentId}`);
    } catch (error) {
      console.error('Update assignment error:', error);
      alert(error instanceof Error ? error.message : '과제를 수정하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-container">
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="page-container">
        <div className="content-wrapper content-narrow">
          <div className="empty-state">
            <p className="empty-state-text">{loadError || '과제를 찾을 수 없습니다.'}</p>
            <Link href="/teacher" className="btn btn-primary">대시보드로</Link>
          </div>
        </div>
      </div>
    );
  }

  if (started) {
    return (
      <div className="page-container">
        <nav className="navbar">
          <Link href="/teacher" className="navbar-brand">
            <span className="emoji">🦄</span> 메타인지 유니콘
          </Link>
          <Link href={`/teacher/assignments/${assignmentId}`} className="btn btn-ghost btn-sm">
            결과 보기
          </Link>
        </nav>

        <div className="content-wrapper content-narrow">
          <div className="card-glass">
            <h1 className="heading-section">수정 불가</h1>
            <p className="subtitle" style={{ marginBottom: '1rem' }}>
              학생이 이미 시작한 과제는 내용이 바뀌면 혼선이 생길 수 있어 수정할 수 없도록 막아 두었습니다.
            </p>
            <p className="form-hint" style={{ marginBottom: '1rem' }}>
              복사본을 만든 뒤 수정해서 새 과제로 사용하는 흐름을 권장합니다.
            </p>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Link href={`/teacher/assignments/${assignmentId}`} className="btn btn-primary">
                과제 상세로
              </Link>
              <Link href="/teacher" className="btn btn-secondary">
                대시보드로
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <nav className="navbar">
        <Link href="/teacher" className="navbar-brand">
          <span className="emoji">{isArt ? '🎨' : '🦄'}</span> {isArt ? '미술 유니콘' : '메타인지 유니콘'}
        </Link>
        <Link href={`/teacher/assignments/${assignmentId}`} className="btn btn-ghost btn-sm">
          결과 보기
        </Link>
      </nav>

      <div className="content-wrapper content-medium">
        <h1 className="heading-section">{isArt ? '미술 과제 수정' : '수학 과제 수정'}</h1>
        <p className="subtitle">학생이 시작하기 전에는 과제 내용을 자유롭게 손볼 수 있습니다.</p>

        {loadError && (
          <div
            className="card"
            style={{
              marginBottom: '1.5rem',
              borderColor: 'rgba(251, 113, 133, 0.35)',
              background: 'rgba(251, 113, 133, 0.08)',
            }}
          >
            <p>{loadError}</p>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              기본 정보
            </h3>

            <div className="form-group">
              <label className="form-label">과제 제목</label>
              <input
                type="text"
                className="form-input"
                value={form.title}
                onChange={handleChange('title')}
                required={!isArt}
              />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">과목</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.subject}
                  onChange={handleChange('subject')}
                />
              </div>
              <div className="form-group">
                <label className="form-label">학년</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.grade}
                  onChange={handleChange('grade')}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">학습 목표</label>
              <input
                type="text"
                className="form-input"
                value={form.learningObjective}
                onChange={handleChange('learningObjective')}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">과제 설명</label>
              <textarea
                className="form-textarea"
                rows={5}
                value={form.content}
                onChange={handleChange('content')}
              />
            </div>
          </div>

          {isArt && (
            <>
              <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
                  작품 정보
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">작품명 (선택)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.paintingTitle}
                      onChange={handleChange('paintingTitle')}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">작가 (선택)</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.artist}
                      onChange={handleChange('artist')}
                    />
                  </div>
                </div>

                <p className="form-hint" style={{ marginBottom: '1rem' }}>
                  작품명과 작가를 비워 두면 학생 화면에서는 작품 정보를 먼저 드러내지 않고 감상만 시작할 수 있습니다.
                </p>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label className="form-label">제작 연도</label>
                    <input
                      type="text"
                      className="form-input"
                      value={form.year}
                      onChange={handleChange('year')}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">이미지 URL</label>
                    <input
                      type="url"
                      className="form-input"
                      value={form.imageUrl}
                      onChange={handleChange('imageUrl')}
                    />
                  </div>
                </div>

                {form.imageUrl && !imagePreviewError && (
                  <div style={{ marginBottom: '1rem', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'rgba(0,0,0,0.2)' }}>
                    <img
                      src={form.imageUrl}
                      alt="작품 미리보기"
                      style={{ width: '100%', maxHeight: '280px', objectFit: 'contain' }}
                      onError={() => setImagePreviewError(true)}
                    />
                  </div>
                )}

                {imagePreviewError && (
                  <p style={{ color: '#fca5a5', fontSize: '0.85rem', marginBottom: '1rem' }}>
                    이미지 미리보기를 불러오지 못했습니다. URL을 확인해 주세요.
                  </p>
                )}

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">작품 배경 정보</label>
                  <textarea
                    className="form-textarea"
                    rows={4}
                    value={form.paintingContext}
                    onChange={handleChange('paintingContext')}
                  />
                </div>
              </div>

              <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
                  감상 설정
                </h3>

                <div className="form-group">
                  <label className="form-label">감상 단계</label>
                  <select
                    className="form-select"
                    value={form.appreciationLevel}
                    onChange={handleChange('appreciationLevel')}
                  >
                    {APPRECIATION_LEVELS.map((level) => (
                      <option key={level.value} value={level.value}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">질문 난이도</label>
                  <select
                    className="form-select"
                    value={form.difficultyLevel}
                    onChange={handleChange('difficultyLevel')}
                  >
                    {DIFFICULTY_LEVELS.map((level) => (
                      <option key={level.value} value={level.value}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </>
          )}

          {!isArt && (
            <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
                수업 메타데이터
              </h3>

              <div className="form-group">
                <label className="form-label">키워드</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.keywords}
                  onChange={handleChange('keywords')}
                  placeholder="쉼표로 구분"
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">기준/차시 정보</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.standards}
                  onChange={handleChange('standards')}
                  placeholder="쉼표로 구분"
                />
              </div>
            </div>
          )}

          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              채점 및 대화 설정
            </h3>

            {!isArt && (
              <div className="form-group">
                <label className="form-label">채점 성향</label>
                <select
                  className="form-select"
                  value={form.scoringStyle}
                  onChange={handleChange('scoringStyle')}
                >
                  {SCORING_STYLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {getScoringStyleLabel(option.value)} - {getScoringStyleDescription(option.value)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="form-group">
              <label className="form-label">점수 단계</label>
              <input
                type="text"
                className="form-input"
                value={form.scoreOptionsInput}
                onChange={handleChange('scoreOptionsInput')}
                placeholder="예: 0, 1, 2, 3, 4, 5"
              />
              {parsedScoreOptions.ok ? (
                <p className="form-hint" style={{ marginTop: '0.5rem' }}>
                  현재 점수 단계: {formatScoreOptions(parsedScoreOptions.scoreOptions, ' / ')}
                </p>
              ) : (
                <p style={{ color: '#fca5a5', fontSize: '0.85rem', marginTop: '0.5rem' }}>
                  {parsedScoreOptions.error}
                </p>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">최소 턴</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  max={form.maxTurns || 12}
                  value={form.minTurns}
                  onChange={handleChange('minTurns')}
                />
              </div>
              <div className="form-group">
                <label className="form-label">최대 턴</label>
                <input
                  type="number"
                  className="form-input"
                  min={form.minTurns || 1}
                  max="12"
                  value={form.maxTurns}
                  onChange={handleChange('maxTurns')}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">최소 글자 바이트</label>
                <input
                  type="number"
                  className="form-input"
                  min="1"
                  max={form.maxStudentMessageBytes || 4000}
                  value={form.minStudentMessageBytes}
                  onChange={handleChange('minStudentMessageBytes')}
                />
              </div>
              <div className="form-group">
                <label className="form-label">최대 글자 바이트</label>
                <input
                  type="number"
                  className="form-input"
                  min={form.minStudentMessageBytes || 1}
                  max="4000"
                  value={form.maxStudentMessageBytes}
                  onChange={handleChange('maxStudentMessageBytes')}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !parsedScoreOptions.ok}
            >
              {saving ? '저장 중...' : '변경 사항 저장'}
            </button>
            <Link href={`/teacher/assignments/${assignmentId}`} className="btn btn-secondary">
              취소
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function EditAssignmentPage() {
  return (
    <Suspense
      fallback={
        <div className="page-container">
          <div className="loading-container">
            <div className="loading-spinner" />
          </div>
        </div>
      }
    >
      <EditAssignmentPageContent />
    </Suspense>
  );
}
