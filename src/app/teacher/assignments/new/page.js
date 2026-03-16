'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { onAuthStateChanged } from 'firebase/auth';

import lessonPlanData from '@/data/mathLessonPlans.json';
import { auth } from '@/lib/firebase';
import { createAssignment } from '@/lib/firestore';

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
    `[오늘 수업 범위]
과목: ${SUBJECT}
학년/학기: ${gradeLabel}
단원: ${unitTitle}
차시명: ${lessonTitle}

중요: 유니콘은 위 차시 범위 안에서만 질문하고, 단원 전체 내용이나 교사용 전문 용어를 직접 요구하지 않는다.`,
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
  const [titleEdited, setTitleEdited] = useState(false);

  const [form, setForm] = useState({
    title: '',
    content: '',
    keywords: '',
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
        lessons: Array.from(new Set(Array.isArray(unit.lessons) ? unit.lessons.filter(isLessonTitle) : [])),
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

  const handleGradeChange = (grade) => {
    setSelectedGrade(grade);
    setSelectedSemester('');
    setSelectedUnit('');
    setSelectedLesson('');

    if (!titleEdited) {
      setForm((prev) => ({ ...prev, title: '' }));
    }
  };

  const handleSemesterChange = (semester) => {
    setSelectedSemester(semester);
    setSelectedUnit('');
    setSelectedLesson('');

    if (!titleEdited) {
      setForm((prev) => ({ ...prev, title: '' }));
    }
  };

  const handleUnitChange = (unitTitle) => {
    setSelectedUnit(unitTitle);
    setSelectedLesson('');

    if (!titleEdited) {
      setForm((prev) => ({ ...prev, title: '' }));
    }
  };

  const handleLessonChange = (lessonTitle) => {
    setSelectedLesson(lessonTitle);

    if (!titleEdited) {
      setForm((prev) => ({ ...prev, title: lessonTitle }));
    }
  };

  const handleTitleChange = (event) => {
    setTitleEdited(true);
    setForm((prev) => ({ ...prev, title: event.target.value }));
  };

  const handleChange = (field) => (event) => {
    setForm((prev) => ({ ...prev, [field]: event.target.value }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.title.trim() || !selectedLesson) {
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
      });

      setCreated(result);
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
          <div className="unicorn-avatar unicorn-avatar-large">🎉</div>
          <h1 className="heading-hero">
            <span className="heading-gradient">과제 생성 완료!</span>
          </h1>
          <p className="subtitle">학생들에게 아래 입장 코드를 알려주세요.</p>

          <div className="card-glass" style={{ marginBottom: '2rem' }}>
            <p
              style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}
            >
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
        <p className="subtitle">
          연간 지도 계획의 차시명을 기준으로 오늘 수업 범위를 골라 주세요.
        </p>

        <form onSubmit={handleSubmit}>
          <div className="card-glass" style={{ marginBottom: '1.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">과제 제목 *</label>
              <input
                id="input-title"
                type="text"
                className="form-input"
                placeholder="예: 세 자리 수의 덧셈을 해 볼까요"
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
                  <option value="">단원을 선택하세요</option>
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
                  <option value="">차시명을 선택하세요</option>
                  {lessons.map((lesson) => (
                    <option key={lesson} value={lesson}>
                      {lesson}
                    </option>
                  ))}
                </select>
                <p className="form-hint">
                  현재 3학년부터 6학년까지 수학 지도 계획 자료 기준으로 구성되어 있습니다.
                </p>
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
                  선택된 오늘 수업 범위
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
              오늘 실제로 배운 내용 (선택사항)
            </h3>

            <div className="form-group">
              <label className="form-label">판서 내용 / 풀이 방법 / 예시</label>
              <textarea
                id="input-content"
                className="form-textarea"
                placeholder="예: 받아올림이 있는 덧셈에서 일의 자리부터 계산하고, 10이 되면 십의 자리로 올려 보냈다고 설명했어요."
                value={form.content}
                onChange={handleChange('content')}
                rows={6}
              />
              <p className="form-hint">
                성취기준 원문보다 오늘 수업에서 실제로 쓴 표현을 적는 편이 더 정확합니다.
              </p>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">핵심 키워드 (선택)</label>
              <input
                id="input-keywords"
                type="text"
                className="form-input"
                placeholder="예: 받아올림, 일의 자리, 십의 자리, 세 자리 수"
                value={form.keywords}
                onChange={handleChange('keywords')}
              />
              <p className="form-hint">학생이 꼭 언급하면 좋은 표현을 쉼표로 구분해 적으세요.</p>
            </div>
          </div>

          <button
            id="btn-create"
            type="submit"
            className="btn btn-primary btn-large"
            style={{ width: '100%' }}
            disabled={saving || !form.title.trim() || !selectedLesson}
          >
            {saving ? '생성 중...' : '🦄 차시 과제 생성하기'}
          </button>
        </form>
      </div>
    </div>
  );
}
