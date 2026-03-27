'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';

import lessonPlanData from '@/data/mathLessonPlans.json';
import { auth } from '@/lib/firebase';
import { createAssignment } from '@/lib/firestore';
import {
  DEFAULT_SCORE_OPTIONS,
  DEFAULT_SCORING_STYLE,
  formatScoreOptions,
  getScoringStyleDescription,
  getScoringStyleLabel,
  parseScoreOptionsInput,
  SCORING_STYLE_OPTIONS,
  SCORE_PRESETS,
} from '@/lib/scoreConfig';

const SUBJECT = '수학';

function isLessonTitle(lesson) {
  return typeof lesson === 'string' && lesson.trim() && !/^\d+(?:~\d+)?$/.test(lesson.trim());
}

function formatGradeLabel(grade, semester) {
  if (!grade || !semester) return '';
  return `${grade}학년 ${semester}학기`;
}

function buildAssignmentContent({ gradeLabel, unitTitle, lessonTitle, teacherContent }) {
  const sections = [
    `[오늘 수업 범위]\n과목: ${SUBJECT}\n학년/학기: ${gradeLabel}\n단원: ${unitTitle}\n차시명: ${lessonTitle}`,
  ];

  if (teacherContent.trim()) {
    sections.push(`[교사가 추가한 오늘 배운 내용]\n${teacherContent.trim()}`);
  }

  return sections.join('\n\n');
}

export default function NewAssignment() {
  const router = useRouter();
  const [user, setUser] = useState(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);

  const [selectedGrade, setSelectedGrade] = useState('');
  const [selectedSemester, setSelectedSemester] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('');
  const [selectedLesson, setSelectedLesson] = useState('');
  const [autoFilledTitle, setAutoFilledTitle] = useState('');

  const [form, setForm] = useState({
    title: '',
    content: '',
    keywords: '',
    scoreOptionsInput: formatScoreOptions(DEFAULT_SCORE_OPTIONS),
    scoringStyle: DEFAULT_SCORING_STYLE,
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

  const gradeOptions = useMemo(() => Object.keys(lessonPlanData.grades || {}), []);

  const semesterOptions = useMemo(() => {
    if (!selectedGrade) return [];
    return Object.keys(lessonPlanData.grades?.[selectedGrade] || {});
  }, [selectedGrade]);

  const units = useMemo(() => {
    if (!selectedGrade || !selectedSemester) return [];

    const rawUnits = lessonPlanData.grades?.[selectedGrade]?.[selectedSemester] || [];
    return rawUnits
      .map((unit) => ({
        ...unit,
        lessons: Array.from(
          new Set(Array.isArray(unit.lessons) ? unit.lessons.filter(isLessonTitle) : [])
        ),
      }))
      .filter((unit) => unit.unit && unit.lessons.length > 0);
  }, [selectedGrade, selectedSemester]);

  const selectedUnitData = useMemo(
    () => units.find((unit) => unit.unit === selectedUnit) || null,
    [units, selectedUnit]
  );

  const lessons = useMemo(() => selectedUnitData?.lessons || [], [selectedUnitData]);
  const gradeLabel = useMemo(
    () => formatGradeLabel(selectedGrade, selectedSemester),
    [selectedGrade, selectedSemester]
  );
  const parsedScoreOptions = useMemo(
    () => parseScoreOptionsInput(form.scoreOptionsInput),
    [form.scoreOptionsInput]
  );

  const handleGradeChange = (grade) => {
    setSelectedGrade(grade);
    setSelectedSemester('');
    setSelectedUnit('');
    setSelectedLesson('');
    setAutoFilledTitle('');
    setForm((prev) => ({
      ...prev,
      title: prev.title === autoFilledTitle ? '' : prev.title,
    }));
  };

  const handleSemesterChange = (semester) => {
    setSelectedSemester(semester);
    setSelectedUnit('');
    setSelectedLesson('');
    setAutoFilledTitle('');
    setForm((prev) => ({
      ...prev,
      title: prev.title === autoFilledTitle ? '' : prev.title,
    }));
  };

  const handleUnitChange = (unitTitle) => {
    setSelectedUnit(unitTitle);
    setSelectedLesson('');
    setAutoFilledTitle('');
    setForm((prev) => ({
      ...prev,
      title: prev.title === autoFilledTitle ? '' : prev.title,
    }));
  };

  const handleLessonChange = (lessonTitle) => {
    setSelectedLesson(lessonTitle);
    setForm((prev) => ({
      ...prev,
      title: !prev.title.trim() || prev.title === autoFilledTitle ? lessonTitle : prev.title,
    }));
    setAutoFilledTitle(lessonTitle);
  };

  const handleTitleChange = (event) => {
    setForm((prev) => ({ ...prev, title: event.target.value }));
  };

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleScorePreset = (values) => {
    setForm((prev) => ({
      ...prev,
      scoreOptionsInput: formatScoreOptions(values),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.title.trim() || !selectedLesson) {
      return;
    }

    if (!parsedScoreOptions.ok) {
      alert(parsedScoreOptions.error);
      return;
    }

    setSaving(true);

    try {
      const result = await createAssignment(user.uid, {
        title: form.title.trim(),
        subject: SUBJECT,
        grade: gradeLabel,
        learningObjective: `${selectedUnit} > ${selectedLesson}`,
        content: buildAssignmentContent({
          gradeLabel,
          unitTitle: selectedUnit,
          lessonTitle: selectedLesson,
          teacherContent: form.content,
        }),
        keywords: form.keywords
          .split(',')
          .map((keyword) => keyword.trim())
          .filter(Boolean),
        standards: [selectedUnit, selectedLesson],
        scoreOptions: parsedScoreOptions.scoreOptions,
        scoringStyle: form.scoringStyle,
        minTurns: form.minTurns,
      });

      setCreated({
        ...result,
        scoreOptions: parsedScoreOptions.scoreOptions,
        scoringStyle: form.scoringStyle,
      });
    } catch (error) {
      console.error('Create assignment error:', error);
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
            <span className="emoji">🦄</span> 메타인지 유니콘
          </Link>
        </nav>

        <div
          className="content-wrapper content-narrow"
          style={{ textAlign: 'center', paddingTop: '3rem' }}
        >
          <div className="unicorn-avatar unicorn-avatar-large">✨</div>
          <h1 className="heading-hero">
            <span className="heading-gradient">과제 생성 완료</span>
          </h1>
          <p className="subtitle">학생들에게 아래 입장 코드를 알려 주세요.</p>

          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>
              입장 코드
            </p>
            <p
              style={{
                fontSize: '3rem',
                fontWeight: 800,
                letterSpacing: '0.2em',
                background: 'var(--gradient-unicorn)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
              }}
            >
              {created.entryCode}
            </p>
            <p className="form-hint" style={{ marginTop: '1rem' }}>
              점수 단계: {formatScoreOptions(created.scoreOptions, ' / ')}
            </p>
            <p className="form-hint" style={{ marginTop: '0.35rem' }}>
              채점 성향: {getScoringStyleLabel(created.scoringStyle)} ({getScoringStyleDescription(created.scoringStyle)})
            </p>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center' }}>
            <Link href="/teacher" className="btn btn-secondary">
              대시보드로
            </Link>
            <Link href={`/teacher/assignments/${created.id}`} className="btn btn-primary">
              결과 보기
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <nav className="navbar">
        <Link href="/teacher" className="navbar-brand">
          <span className="emoji">🦄</span> 메타인지 유니콘
        </Link>
        <Link href="/teacher" className="btn btn-ghost btn-sm">
          대시보드로
        </Link>
      </nav>

      <div className="content-wrapper content-medium">
        <h1 className="heading-section">새 수학 과제 만들기</h1>
        <p className="subtitle">오늘 수업 범위와 점수 단계, 채점 성향을 함께 설정해 주세요.</p>

        <form onSubmit={handleSubmit}>
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">과제 제목 *</label>
              <input
                id="input-title"
                type="text"
                className="form-input"
                placeholder="예: 받아올림이 있는 덧셈을 설명해 볼까?"
                value={form.title}
                onChange={handleTitleChange}
                required
              />
              <p className="form-hint">차시명을 고르면 제목이 자동으로 채워집니다.</p>
            </div>
          </div>

          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              수학 차시 선택
            </h3>

            <div className="form-group">
              <label className="form-label">과목</label>
              <div
                style={{
                  display: 'inline-flex',
                  padding: '0.65rem 1rem',
                  borderRadius: '999px',
                  background: 'rgba(168, 85, 247, 0.12)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                }}
              >
                {SUBJECT}
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">학년</label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {gradeOptions.map((grade) => (
                  <button
                    key={grade}
                    type="button"
                    className={`btn ${selectedGrade === grade ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                    onClick={() => handleGradeChange(grade)}
                  >
                    {grade}학년
                  </button>
                ))}
              </div>
            </div>

            {selectedGrade && (
              <div className="form-group">
                <label className="form-label">학기</label>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {semesterOptions.map((semester) => (
                    <button
                      key={semester}
                      type="button"
                      className={`btn ${selectedSemester === semester ? 'btn-primary' : 'btn-secondary'} btn-sm`}
                      onClick={() => handleSemesterChange(semester)}
                    >
                      {semester}학기
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selectedSemester && (
              <div className="form-group">
                <label className="form-label">단원</label>
                <select
                  className="form-select"
                  value={selectedUnit}
                  onChange={(event) => handleUnitChange(event.target.value)}
                >
                  <option value="">단원을 선택해 주세요.</option>
                  {units.map((unit) => (
                    <option key={unit.unit} value={unit.unit}>
                      {unit.unit}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {selectedUnit && (
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">차시명</label>
                <select
                  className="form-select"
                  value={selectedLesson}
                  onChange={(event) => handleLessonChange(event.target.value)}
                >
                  <option value="">차시명을 선택해 주세요.</option>
                  {lessons.map((lesson) => (
                    <option key={lesson} value={lesson}>
                      {lesson}
                    </option>
                  ))}
                </select>
                <p className="form-hint">현재 3학년부터 6학년까지의 수학 진도 자료를 기반으로 구성되어 있습니다.</p>
              </div>
            )}

            {selectedLesson && (
              <div
                style={{
                  marginTop: '1rem',
                  padding: '1rem',
                  background: 'rgba(168, 85, 247, 0.05)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--border-color)',
                }}
              >
                <p
                  style={{
                    fontSize: '0.8rem',
                    color: 'var(--purple-light)',
                    fontWeight: 600,
                    marginBottom: '0.5rem',
                  }}
                >
                  선택한 오늘 수업 범위
                </p>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  {gradeLabel}
                </p>
                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  단원: {selectedUnit}
                </p>
                <p style={{ fontSize: '0.95rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                  차시명: {selectedLesson}
                </p>
              </div>
            )}
          </div>

          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              점수 단계 설정
            </h3>

            <div className="form-group">
              <label className="form-label">채점 성향</label>
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {SCORING_STYLE_OPTIONS.map((option) => {
                  const isSelected = form.scoringStyle === option.value;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setForm((prev) => ({ ...prev, scoringStyle: option.value }))}
                      style={{
                        textAlign: 'left',
                        padding: '0.9rem 1rem',
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${isSelected ? 'var(--cyan-primary)' : 'var(--border-color)'}`,
                        background: isSelected ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{option.label}</div>
                      <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                        {option.description}
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="form-hint">
                이 설정은 관련 있는 답변에만 적용됩니다. 장난, 회피, 엉뚱한 답은 항상 낮은 점수를 받습니다.
              </p>
            </div>

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
                placeholder="예: 0, 1, 2, 3 또는 0, 10, 20, 30"
                value={form.scoreOptionsInput}
                onChange={handleChange('scoreOptionsInput')}
              />
              <p className="form-hint">쉼표 또는 공백으로 구분해 입력하세요. 0점부터 시작해야 합니다.</p>
              {parsedScoreOptions.ok ? (
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                  {parsedScoreOptions.scoreOptions.map((score) => (
                    <span key={score} className="badge badge-score">
                      {score}점
                    </span>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#fca5a5', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                  {parsedScoreOptions.error}
                </p>
              )}
            </div>
          </div>

          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              대화 횟수 설정
            </h3>
            <p className="form-hint" style={{ marginBottom: '1.25rem' }}>
              유니콘이 채점하기 전에 학생과 최소 몇 번 대화할지 설정합니다.
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
                      textAlign: 'left',
                      padding: '0.9rem 1rem',
                      borderRadius: 'var(--radius-md)',
                      border: `1px solid ${isSelected ? 'var(--cyan-primary)' : 'var(--border-color)'}`,
                      background: isSelected ? 'rgba(34, 211, 238, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>{option.label}</div>
                    <div style={{ fontSize: '0.88rem', color: 'var(--text-muted)' }}>{option.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '1.5rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              오늘 실제로 배운 내용 (선택)
            </h3>

            <div className="form-group">
              <label className="form-label">교실에서 다룬 예시 / 풀이 / 표현</label>
              <textarea
                id="input-content"
                className="form-textarea"
                placeholder="예: 받아올림이 있으면 일의 자리에서 10이 넘어가니까 십의 자리에 1을 더해 준다고 설명했어요."
                value={form.content}
                onChange={handleChange('content')}
                rows={6}
              />
              <p className="form-hint">학생 답을 평가할 때 참고할 수 있도록 오늘 수업에서 실제로 다룬 표현을 적어 주세요.</p>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">핵심 키워드 (선택)</label>
              <input
                id="input-keywords"
                type="text"
                className="form-input"
                placeholder="예: 받아올림, 일의 자리, 십의 자리"
                value={form.keywords}
                onChange={handleChange('keywords')}
              />
              <p className="form-hint">쉼표로 구분해서 적어 주세요.</p>
            </div>
          </div>

          <button
            id="btn-create"
            type="submit"
            className="btn btn-primary btn-large"
            style={{ width: '100%' }}
            disabled={saving || !form.title.trim() || !selectedLesson || !parsedScoreOptions.ok}
          >
            {saving ? '생성 중...' : '차시 과제 생성하기'}
          </button>
        </form>
      </div>
    </div>
  );
}
