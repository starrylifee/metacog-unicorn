'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';

import { formatStudentMessageByteRange, normalizeAssignmentConstraints } from '@/lib/chatConstraints';
import { auth } from '@/lib/firebase';
import {
  deleteAssignment,
  duplicateAssignment,
  getAssignmentById,
  getConversationsByAssignment,
  toggleAssignment,
} from '@/lib/firestore';
import {
  formatScoreOptions,
  getAssignmentMaxScore,
  getAssignmentScoreOptions,
  getNextHigherScore,
  getScoringStyleLabel,
} from '@/lib/scoreConfig';

function canApproveConversation(conversation) {
  return (
    conversation.status === 'completed' &&
    !conversation.approved &&
    conversation.approvalStatus !== 'processing'
  );
}

function canResetConversation(conversation) {
  return !conversation.approved && conversation.approvalStatus !== 'processing';
}

function formatConversationScore(score) {
  return Number.isFinite(score) ? `${score}점` : '-';
}

const STAGE_BADGES = [
  { stage: 1, emoji: '👀', label: '탐험가' },
  { stage: 2, emoji: '🔍', label: '분석가' },
  { stage: 3, emoji: '💭', label: '상상가' },
  { stage: 4, emoji: '⚖️', label: '평론가' },
];

function formatReachedStage(reachedStage) {
  if (!reachedStage || reachedStage < 1 || reachedStage > 4) return null;
  return STAGE_BADGES.filter((b) => b.stage <= reachedStage);
}

export default function AssignmentDetail() {
  const router = useRouter();
  const params = useParams();
  const id = params?.id;

  const [user, setUser] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedConv, setSelectedConv] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const scoreOptions = useMemo(
    () => (assignment ? getAssignmentScoreOptions(assignment) : []),
    [assignment]
  );
  const scoreScaleLabel = useMemo(
    () => (scoreOptions.length > 0 ? formatScoreOptions(scoreOptions, ' / ') : ''),
    [scoreOptions]
  );
  const maxScore = useMemo(() => (assignment ? getAssignmentMaxScore(assignment) : null), [assignment]);
  const chatConstraints = useMemo(
    () => (assignment ? normalizeAssignmentConstraints(assignment) : null),
    [assignment]
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

  const loadData = async () => {
    if (!user || !id) return;

    setLoading(true);
    setLoadError('');

    try {
      const nextAssignment = await getAssignmentById(id);

      if (!nextAssignment || nextAssignment.teacherId !== user.uid) {
        setAssignment(null);
        setConversations([]);
        setSelectedConv(null);
        setLoadError('과제를 확인할 수 없습니다.');
        setLoading(false);
        router.push('/teacher');
        return;
      }

      setAssignment(nextAssignment);
    } catch (error) {
      console.error('Assignment load error:', error);
      setAssignment(null);
      setConversations([]);
      setSelectedConv(null);
      setLoadError(error instanceof Error ? error.message : '과제 정보를 불러오지 못했습니다.');
      setLoading(false);
      return;
    }

    try {
      const nextConversations = await getConversationsByAssignment(id);
      setConversations(nextConversations);

      if (selectedConv) {
        const refreshedSelection = nextConversations.find(
          (conversation) => conversation.id === selectedConv.id
        );
        setSelectedConv(refreshedSelection || null);
      }
    } catch (error) {
      console.error('Conversation load error:', error);
      setConversations([]);
      setSelectedConv(null);
      setLoadError(
        error instanceof Error
          ? `과제는 불러왔지만 대화 목록은 가져오지 못했습니다. ${error.message}`
          : '과제는 불러왔지만 대화 목록은 가져오지 못했습니다.'
      );
    }

    setLoading(false);
  };

  useEffect(() => {
    void loadData();
  }, [user, id]);

  const getAuthHeaders = async () => {
    const token = await user.getIdToken();
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  };

  const handleToggle = async () => {
    if (!assignment) return;

    const nextIsActive = !assignment.isActive;

    try {
      await toggleAssignment(id, nextIsActive);
      setAssignment((prev) => ({ ...prev, isActive: nextIsActive }));
    } catch (error) {
      console.error('Toggle assignment error:', error);
      alert('과제 상태를 변경하지 못했습니다.');
    }
  };

  const handleDeleteAssignment = async () => {
    if (!assignment) return;

    if (!confirm(`"${assignment.title}" 과제를 삭제할까요?\n삭제 후에는 되돌릴 수 없습니다.`)) {
      return;
    }

    setActionLoading('delete-assignment');

    try {
      await deleteAssignment(id);
      router.push('/teacher');
    } catch (error) {
      console.error('Delete assignment error:', error);
      alert('과제를 삭제하지 못했습니다.');
      setActionLoading(null);
    }
  };

  const handleDuplicateAssignment = async () => {
    if (!assignment) return;

    setActionLoading('duplicate-assignment');

    try {
      const duplicated = await duplicateAssignment(id);
      router.push(`/teacher/assignments/${duplicated.id}`);
    } catch (error) {
      console.error('Duplicate assignment error:', error);
      alert('과제를 복사하지 못했습니다.');
      setActionLoading(null);
    }
  };

  const handleApprove = async (conversation) => {
    if (!canApproveConversation(conversation)) {
      return;
    }

    if (!confirm(`${conversation.studentCode}번 학생 제출을 승인할까요?`)) {
      return;
    }

    setActionLoading(conversation.id);

    try {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/approve', {
        method: 'POST',
        headers,
        body: JSON.stringify({ conversationId: conversation.id }),
      });
      const data = await response.json();

      if (!data.success) {
        const detail = data.growndResult
          ? `\n\n[Grownd 응답]\n${JSON.stringify(data.growndResult, null, 2)}`
          : '';
        alert((data.error || '승인 처리에 실패했습니다.') + detail);
      }

      await loadData();
    } catch (error) {
      console.error('Approve error:', error);
      alert('승인 처리 중 오류가 발생했습니다.');
      await loadData();
    }

    setActionLoading(null);
  };

  const handleApproveAllLegacy = async () => {
    const pendingConversations = conversations.filter(canApproveConversation);

    if (pendingConversations.length === 0) {
      alert('승인 대기 중인 학생이 없습니다.');
      return;
    }

    if (!confirm(`${pendingConversations.length}명의 제출을 모두 승인할까요?`)) {
      return;
    }

    setActionLoading('all');

    try {
      const headers = await getAuthHeaders();

      for (const conversation of pendingConversations) {
        const response = await fetch('/api/approve', {
          method: 'POST',
          headers,
          body: JSON.stringify({ conversationId: conversation.id }),
        });
        const data = await response.json().catch(() => ({ success: false, error: `서버 오류 (HTTP ${response.status})` }));

        if (!response.ok || !data.success) {
          const errMsg = typeof data.error === 'string'
            ? data.error
            : (data.error ? JSON.stringify(data.error) : `${conversation.studentCode}번 승인에 실패했습니다.`);
          throw new Error(errMsg);
        }
      }

      await loadData();
    } catch (error) {
      console.error('Approve all error:', error);
      alert(error instanceof Error ? error.message : '일괄 승인 중 오류가 발생했습니다.');
      await loadData();
    }

    setActionLoading(null);
  };

  const handleApproveAll = async () => {
    const pendingConversations = conversations.filter(canApproveConversation);

    if (pendingConversations.length === 0) {
      alert('승인 대기 중인 학생이 없습니다.');
      return;
    }

    if (!confirm(`${pendingConversations.length}명의 제출을 모두 승인할까요?`)) {
      return;
    }

    setActionLoading('all');

    try {
      const headers = await getAuthHeaders();
      const successStudentCodes = [];
      const failedApprovals = [];

      for (const conversation of pendingConversations) {
        const response = await fetch('/api/approve', {
          method: 'POST',
          headers,
          body: JSON.stringify({ conversationId: conversation.id }),
        });
        const data = await response.json().catch(() => ({
          success: false,
          error: `서버 오류 (HTTP ${response.status})`,
        }));

        if (response.ok && data.success) {
          successStudentCodes.push(conversation.studentCode);
          continue;
        }

        const errMsg = typeof data.error === 'string'
          ? data.error
          : (data.error ? JSON.stringify(data.error) : `${conversation.studentCode}번 승인에 실패했습니다.`);
        failedApprovals.push({
          studentCode: conversation.studentCode,
          message: errMsg,
        });
      }

      await loadData();

      if (failedApprovals.length === 0) {
        alert(`${successStudentCodes.length}명의 제출을 모두 승인했습니다.`);
      } else {
        const failedSummary = failedApprovals
          .map(({ studentCode, message }) => `- ${studentCode}번: ${message}`)
          .join('\n');
        const successSummary = successStudentCodes.length > 0
          ? `승인 완료: ${successStudentCodes.join(', ')}번\n\n`
          : '';
        alert(
          `${successSummary}문제가 있는 번호만 제외하고 나머지는 승인했습니다.\n\n확인 필요:\n${failedSummary}`
        );
      }
    } catch (error) {
      console.error('Approve all error:', error);
      alert(error instanceof Error ? error.message : '일괄 승인 중 오류가 발생했습니다.');
      await loadData();
    }

    setActionLoading(null);
  };

  const handleReset = async (conversation) => {
    if (!canResetConversation(conversation)) {
      alert('승인 중이거나 이미 승인된 제출은 리셋할 수 없습니다.');
      return;
    }

    if (!confirm(`${conversation.studentCode}번 학생 기록을 삭제하고 다시 참여하게 할까요?`)) {
      return;
    }

    setActionLoading(conversation.id);

    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/approve?id=${conversation.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await response.json();

      if (!data.success) {
        alert(data.error || '리셋에 실패했습니다.');
      }

      setSelectedConv(null);
      await loadData();
    } catch (error) {
      console.error('Reset error:', error);
      alert('리셋 중 오류가 발생했습니다.');
      await loadData();
    }

    setActionLoading(null);
  };

  const formatDate = (value) => {
    if (!value) return '-';

    const date = value.toDate ? value.toDate() : new Date(value);
    return date.toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getStatusLabel = (conversation) => {
    if (conversation.approved) {
      return { text: '승인 완료', className: 'badge-active' };
    }

    if (conversation.approvalStatus === 'processing') {
      return { text: '승인 처리 중', className: 'badge-inactive' };
    }

    if (conversation.approvalStatus === 'failed') {
      return { text: '승인 실패', className: 'badge-inactive' };
    }

    if (conversation.status === 'completed') {
      return { text: '승인 대기', className: 'badge-inactive' };
    }

    return { text: '진행 중', className: 'badge-inactive' };
  };

  const avgScore = () => {
    const scoredConversations = conversations.filter((conversation) => Number.isFinite(conversation.score));

    if (scoredConversations.length === 0) {
      return '-';
    }

    const average =
      scoredConversations.reduce((sum, conversation) => sum + conversation.score, 0) /
      scoredConversations.length;

    return average.toFixed(1);
  };

  const pendingCount = conversations.filter(canApproveConversation).length;
  const selectedNextHigherScore = useMemo(() => {
    if (!selectedConv || !Number.isFinite(selectedConv.score)) {
      return null;
    }

    return getNextHigherScore(scoreOptions, selectedConv.score);
  }, [scoreOptions, selectedConv]);

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
        <nav className="navbar">
          <Link href="/teacher" className="navbar-brand">
            <span className="emoji">🦄</span> 메타인지 유니콘
          </Link>
          <Link href="/teacher" className="btn btn-ghost btn-sm">
            대시보드
          </Link>
        </nav>

        <div className="content-wrapper content-narrow">
          <div className="empty-state">
            <div className="empty-state-emoji">⚠️</div>
            <p className="empty-state-text">{loadError || '과제 정보를 불러오지 못했습니다.'}</p>
            <div
              style={{
                display: 'flex',
                gap: '0.75rem',
                justifyContent: 'center',
                flexWrap: 'wrap',
              }}
            >
              <button className="btn btn-secondary" onClick={loadData}>
                다시 불러오기
              </button>
              <Link href="/teacher" className="btn btn-primary">
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
          <span className="emoji">🦄</span> 메타인지 유니콘
        </Link>
        <Link href="/teacher" className="btn btn-ghost btn-sm">
          대시보드
        </Link>
      </nav>

      <div className="content-wrapper">
        {loadError && (
          <div
            className="card"
            style={{
              marginBottom: '1.5rem',
              borderColor: 'rgba(251, 113, 133, 0.35)',
              background: 'rgba(251, 113, 133, 0.08)',
            }}
          >
            <p style={{ marginBottom: '0.75rem' }}>{loadError}</p>
            <button className="btn btn-secondary btn-sm" onClick={loadData}>
              다시 불러오기
            </button>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '2rem',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '0.5rem',
              }}
            >
              <h1 className="heading-section" style={{ marginBottom: 0 }}>
                {assignment.title}
              </h1>
              <span className={`badge ${assignment.isActive ? 'badge-active' : 'badge-inactive'}`}>
                {assignment.isActive ? '활성' : '비활성'}
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {assignment.subject ? `${assignment.subject} · ` : ''}
              {assignment.grade ? `${assignment.grade} · ` : ''}
              입장코드: <strong style={{ color: 'var(--cyan-primary)', letterSpacing: '0.1em' }}>{assignment.entryCode}</strong>
            </p>
            {scoreScaleLabel && (
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.35rem' }}>
                점수 단계: {scoreScaleLabel}
              </p>
            )}
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
              채점 성향: {getScoringStyleLabel(assignment.scoringStyle)}
            </p>
            {chatConstraints && (
              <>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                  대화 턴: 최소 {chatConstraints.minTurns}턴 후 채점 가능 · 최대 {chatConstraints.maxTurns}턴
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.2rem' }}>
                  학생 답변 길이: {formatStudentMessageByteRange(
                    chatConstraints.minStudentMessageBytes,
                    chatConstraints.maxStudentMessageBytes
                  )}
                </p>
              </>
            )}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {pendingCount > 0 && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleApproveAll}
                disabled={actionLoading === 'all'}
              >
                {actionLoading === 'all' ? '처리 중...' : `전체 승인 (${pendingCount})`}
              </button>
            )}
            <button
              className="btn btn-secondary btn-sm"
              onClick={handleDuplicateAssignment}
              disabled={actionLoading === 'duplicate-assignment'}
            >
              {actionLoading === 'duplicate-assignment' ? '복사 중...' : '과제 복사'}
            </button>
            <button
              className={`btn ${assignment.isActive ? 'btn-danger' : 'btn-secondary'} btn-sm`}
              onClick={handleToggle}
            >
              {assignment.isActive ? '비활성화' : '활성화'}
            </button>
            <button
              className="btn btn-danger btn-sm"
              onClick={handleDeleteAssignment}
              disabled={actionLoading === 'delete-assignment'}
            >
              {actionLoading === 'delete-assignment' ? '삭제 중...' : '과제 삭제'}
            </button>
          </div>
        </div>

        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{conversations.length}</div>
            <div className="stat-label">전체 참여</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {conversations.filter((conversation) => conversation.status === 'completed').length}
            </div>
            <div className="stat-label">완료</div>
          </div>
          <div className="stat-card">
            <div
              className="stat-value"
              style={{ color: pendingCount > 0 ? 'var(--yellow-primary)' : undefined }}
            >
              {pendingCount}
            </div>
            <div className="stat-label">승인 대기</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">
              {conversations.filter((conversation) => conversation.approved).length}
            </div>
            <div className="stat-label">승인 완료</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{avgScore()}</div>
            <div className="stat-label">평균 점수{Number.isFinite(maxScore) ? ` / ${maxScore}` : ''}</div>
          </div>
        </div>

        {/* 기간별 데이터 다운로드 */}
        {conversations.length > 0 && (
          <div className="card-glass" style={{ marginBottom: '2rem' }}>
            <h3 style={{ marginBottom: '1rem', fontSize: '1rem', color: 'var(--purple-light)' }}>
              📂 데이터 다운로드
            </h3>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.85rem' }}>시작일</label>
                <input
                  type="date"
                  className="form-input"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  style={{ maxWidth: '180px' }}
                />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" style={{ fontSize: '0.85rem' }}>종료일</label>
                <input
                  type="date"
                  className="form-input"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  style={{ maxWidth: '180px' }}
                />
              </div>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const fromDate = dateFrom ? new Date(dateFrom) : null;
                  const toDate = dateTo ? new Date(dateTo + 'T23:59:59') : null;

                  const filtered = conversations.filter((conv) => {
                    const startedAt = conv.startedAt
                      ? (conv.startedAt.toDate ? conv.startedAt.toDate() : new Date(conv.startedAt))
                      : null;
                    if (!startedAt) return !fromDate && !toDate;
                    if (fromDate && startedAt < fromDate) return false;
                    if (toDate && startedAt > toDate) return false;
                    return true;
                  });

                  if (filtered.length === 0) {
                    alert('해당 기간에 데이터가 없습니다.');
                    return;
                  }

                  const escapeCSV = (value) => {
                    const str = String(value ?? '');
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                      return `"${str.replace(/"/g, '""')}"`;
                    }
                    return str;
                  };

                  const isArt = assignment.type === 'art';
                  const headers = [
                    '학생번호', '상태', '점수',
                    ...(isArt ? ['도달단계'] : []),
                    '피드백', '다음단계팁',
                    '시작시간', '완료시간', '대화내용',
                  ];

                  const rows = filtered.map((conv) => {
                    const startedAt = conv.startedAt
                      ? (conv.startedAt.toDate ? conv.startedAt.toDate() : new Date(conv.startedAt))
                      : null;
                    const completedAt = conv.completedAt
                      ? (conv.completedAt.toDate ? conv.completedAt.toDate() : new Date(conv.completedAt))
                      : null;

                    const chatLog = (conv.messages || [])
                      .map((m) => `[${m.role === 'unicorn' ? '유니콘' : '학생'}] ${m.content}`)
                      .join('\n');

                    return [
                      conv.studentCode,
                      conv.status === 'completed' ? '완료' : '진행중',
                      conv.score ?? '',
                      ...(isArt ? [conv.reachedStage ?? ''] : []),
                      conv.feedback ?? '',
                      conv.nextStepTip || conv.higherScoreTip || '',
                      startedAt ? startedAt.toLocaleString('ko-KR') : '',
                      completedAt ? completedAt.toLocaleString('ko-KR') : '',
                      chatLog,
                    ].map(escapeCSV).join(',');
                  });

                  const bom = '\uFEFF';
                  const csvContent = bom + headers.join(',') + '\n' + rows.join('\n');
                  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  const dateLabel = [dateFrom, dateTo].filter(Boolean).join('~') || 'all';
                  link.href = url;
                  link.download = `${assignment.title}_${dateLabel}.csv`;
                  link.click();
                  URL.revokeObjectURL(url);
                }}
              >
                📅 CSV 다운로드 {dateFrom || dateTo ? `(${conversations.filter((conv) => {
                  const startedAt = conv.startedAt
                    ? (conv.startedAt.toDate ? conv.startedAt.toDate() : new Date(conv.startedAt))
                    : null;
                  if (!startedAt) return !dateFrom && !dateTo;
                  if (dateFrom && startedAt < new Date(dateFrom)) return false;
                  if (dateTo && startedAt > new Date(dateTo + 'T23:59:59')) return false;
                  return true;
                }).length}건)` : `(전체 ${conversations.length}건)`}
              </button>
            </div>
            <p className="form-hint">
              비워두면 전체 기간을 다운로드합니다. 학생별 대화 내용, 점수, 피드백이 모두 포함됩니다.
            </p>
          </div>
        )}

        <h2 className="heading-section">학생 결과</h2>

        {conversations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-emoji">🦄</div>
            <p className="empty-state-text">아직 참여한 학생이 없습니다.</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              학생에게 입장코드 <strong style={{ color: 'var(--cyan-primary)' }}>{assignment.entryCode}</strong>를 알려 주세요.
            </p>
          </div>
        ) : (
          <>
            <div className="table-wrapper" style={{ marginBottom: '2rem' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>번호</th>
                    <th>상태</th>
                    <th>점수</th>
                    {assignment.type === 'art' && <th>감상 배지</th>}
                    <th>시작 시간</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conversation) => {
                    const status = getStatusLabel(conversation);
                    const isSelected = selectedConv?.id === conversation.id;

                    return (
                      <tr key={conversation.id}>
                        <td>
                          <strong>{conversation.studentCode}번</strong>
                        </td>
                        <td>
                          <span className={`badge ${status.className}`}>{status.text}</span>
                        </td>
                        <td>{formatConversationScore(conversation.score)}</td>
                        {assignment.type === 'art' && (
                          <td>
                            {conversation.reachedStage ? (
                              <span style={{ fontSize: '0.85rem' }}>
                                {formatReachedStage(conversation.reachedStage)?.map((b) => (
                                  <span key={b.stage} title={b.label} style={{ marginRight: '0.2rem' }}>{b.emoji}</span>
                                ))}
                              </span>
                            ) : '-'}
                          </td>
                        )}
                        <td className="card-meta">{formatDate(conversation.startedAt)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {canApproveConversation(conversation) && (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleApprove(conversation)}
                                disabled={actionLoading === conversation.id}
                              >
                                {actionLoading === conversation.id ? '...' : '승인'}
                              </button>
                            )}
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setSelectedConv(isSelected ? null : conversation)}
                            >
                              보기
                            </button>
                            {canResetConversation(conversation) && (
                              <button
                                className="btn btn-danger btn-sm"
                                onClick={() => handleReset(conversation)}
                                disabled={actionLoading === conversation.id}
                              >
                                리셋
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {selectedConv && (
              <div className="card-glass" style={{ marginBottom: '2rem' }}>
                <h3 style={{ marginBottom: '1rem', fontSize: '1rem' }}>
                  {selectedConv.studentCode}번 학생 대화 기록
                  {Number.isFinite(selectedConv.score) && (
                    <span className="badge badge-score" style={{ marginLeft: '0.75rem' }}>
                      {selectedConv.score}점
                    </span>
                  )}
                  {selectedConv.approved && (
                    <span className="badge badge-active" style={{ marginLeft: '0.5rem' }}>
                      승인 완료
                    </span>
                  )}
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {(selectedConv.messages || []).map((message, index) => (
                    <div
                      key={index}
                      className={`chat-bubble chat-bubble-${message.role}`}
                      style={{ maxWidth: '85%' }}
                    >
                      {message.role === 'unicorn' && <div className="chat-sender">{assignment.type === 'art' ? '미술 유니콘' : '메타인지 유니콘'}</div>}
                      <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
                    </div>
                  ))}
                </div>

                {selectedConv.feedback && (
                  <div className="score-feedback" style={{ marginTop: '1rem' }}>
                    <strong>AI 피드백 ({selectedConv.score}점{Number.isFinite(maxScore) ? `/${maxScore}점` : ''})</strong> {selectedConv.feedback}
                  </div>
                )}

                {(selectedConv.nextStepTip || selectedConv.higherScoreTip) && (
                  <div className="score-feedback" style={{ marginTop: '0.75rem' }}>
                    <strong>💡 다음 감상 팁</strong> {selectedConv.nextStepTip || selectedConv.higherScoreTip}
                  </div>
                )}

                {selectedConv.lastGrowndError?.message && !selectedConv.approved && (
                  <div className="score-feedback" style={{ marginTop: '1rem' }}>
                    <strong>승인 오류</strong> {selectedConv.lastGrowndError.message}
                    {selectedConv.approvalStatus === 'processing' && (
                      <div style={{ marginTop: '0.5rem' }}>
                        중복 지급을 막기 위해 자동 재시도는 잠시 막혀 있습니다. 상태를 확인한 뒤 필요하면 관리자 확인 후 처리해 주세요.
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
