'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '@/lib/firebase';
import {
  deleteAssignment,
  getAssignmentById,
  getConversationsByAssignment,
  toggleAssignment,
} from '@/lib/firestore';

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
        setLoadError('이 과제를 확인할 수 없습니다.');
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
        const nextSelectedConv = nextConversations.find((conversation) => conversation.id === selectedConv.id);
        setSelectedConv(nextSelectedConv || null);
      }
    } catch (error) {
      console.error('Conversation load error:', error);
      setConversations([]);
      setSelectedConv(null);
      setLoadError(
        error instanceof Error
          ? `과제는 불러왔지만 대화 목록을 가져오지 못했습니다. ${error.message}`
          : '과제는 불러왔지만 대화 목록을 가져오지 못했습니다.'
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
    if (!confirm(`"${assignment.title}" 과제를 삭제할까요?\n삭제한 과제는 되돌릴 수 없습니다.`)) {
      return;
    }

    setActionLoading('delete-assignment');
    try {
      await deleteAssignment(id);
      router.push('/teacher');
    } catch (error) {
      console.error('Delete assignment error:', error);
      alert('과제 삭제에 실패했습니다.');
      setActionLoading(null);
    }
  };

  const handleApprove = async (conversation) => {
    if (!confirm(`${conversation.studentCode}번 학생 (${conversation.score}점) 승인하고 포인트를 부여할까요?`)) {
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

      if (data.success) {
        alert('✅ 승인 완료! 포인트가 부여되었습니다.');
        await loadData();
      } else {
        alert(`❌ ${data.error}`);
      }
    } catch (error) {
      console.error('Approve error:', error);
      alert('오류가 발생했습니다.');
    }

    setActionLoading(null);
  };

  const handleApproveAll = async () => {
    const pendingConversations = conversations.filter(
      (conversation) => conversation.status === 'completed' && !conversation.approved
    );

    if (pendingConversations.length === 0) {
      alert('승인 대기 중인 학생이 없습니다.');
      return;
    }

    if (!confirm(`${pendingConversations.length}명의 학생을 모두 승인할까요?`)) {
      return;
    }

    setActionLoading('all');
    const headers = await getAuthHeaders();

    for (const conversation of pendingConversations) {
      try {
        const response = await fetch('/api/approve', {
          method: 'POST',
          headers,
          body: JSON.stringify({ conversationId: conversation.id }),
        });
        const data = await response.json();

        if (!response.ok || !data.success) {
          throw new Error(data.error || `${conversation.studentCode}번 승인 실패`);
        }
      } catch (error) {
        console.error(`Approve error for ${conversation.studentCode}:`, error);
        alert(`❌ ${conversation.studentCode}번 학생 승인에 실패했습니다.`);
        setActionLoading(null);
        return;
      }
    }

    alert('✅ 전체 승인 완료!');
    await loadData();
    setActionLoading(null);
  };

  const handleReset = async (conversation) => {
    if (!confirm(`${conversation.studentCode}번 학생의 기록을 삭제하고 다시 참여할 수 있게 할까요?`)) {
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

      if (data.success) {
        alert('🔄 리셋 완료! 학생이 다시 참여할 수 있습니다.');
        setSelectedConv(null);
        await loadData();
      } else {
        alert(`❌ ${data.error}`);
      }
    } catch (error) {
      console.error('Reset error:', error);
      alert('오류가 발생했습니다.');
    }

    setActionLoading(null);
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return '-';

    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return date.toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getScoreEmoji = (score) => {
    if (score === 3) return '🌟🌟🌟';
    if (score === 2) return '⭐⭐☆';
    if (score === 1) return '⭐☆☆';
    return '-';
  };

  const getStatusLabel = (conversation) => {
    if (conversation.approved) {
      return { text: '승인됨', className: 'badge-active' };
    }

    if (conversation.status === 'completed') {
      return { text: '승인 대기', className: 'badge-inactive' };
    }

    return { text: '진행 중', className: 'badge-inactive' };
  };

  const avgScore = () => {
    const scoredConversations = conversations.filter((conversation) => conversation.score);

    if (scoredConversations.length === 0) {
      return '-';
    }

    const average =
      scoredConversations.reduce((sum, conversation) => sum + conversation.score, 0) /
      scoredConversations.length;

    return average.toFixed(1);
  };

  const pendingCount = conversations.filter(
    (conversation) => conversation.status === 'completed' && !conversation.approved
  ).length;

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
            ← 대시보드
          </Link>
        </nav>

        <div className="content-wrapper content-narrow">
          <div className="empty-state">
            <div className="empty-state-emoji">⚠️</div>
            <p className="empty-state-text">{loadError || '과제 정보를 불러오지 못했어요.'}</p>
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
          ← 대시보드
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
              {assignment.subject && `${assignment.subject} · `}
              {assignment.grade && `${assignment.grade} · `}
              입장코드:{' '}
              <strong style={{ color: 'var(--cyan-primary)', letterSpacing: '0.1em' }}>
                {assignment.entryCode}
              </strong>
            </p>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {pendingCount > 0 && (
              <button
                className="btn btn-primary btn-sm"
                onClick={handleApproveAll}
                disabled={actionLoading === 'all'}
              >
                {actionLoading === 'all' ? '처리 중...' : `✅ 전체 승인 (${pendingCount}명)`}
              </button>
            )}
            <button
              className={`btn ${assignment.isActive ? 'btn-danger' : 'btn-secondary'} btn-sm`}
              onClick={handleToggle}
            >
              {assignment.isActive ? '🔒 비활성화' : '🔓 활성화'}
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
            <div className="stat-label">평균 점수</div>
          </div>
        </div>

        <h2 className="heading-section">📊 학생 결과</h2>

        {conversations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-emoji">🦄</div>
            <p className="empty-state-text">아직 참여한 학생이 없어요</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              학생들에게 입장코드{' '}
              <strong style={{ color: 'var(--cyan-primary)' }}>{assignment.entryCode}</strong>를 알려주세요!
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
                    <th>시간</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {conversations.map((conversation) => {
                    const status = getStatusLabel(conversation);

                    return (
                      <tr key={conversation.id}>
                        <td>
                          <strong>{conversation.studentCode}번</strong>
                        </td>
                        <td>
                          <span className={`badge ${status.className}`}>{status.text}</span>
                        </td>
                        <td>{conversation.score ? getScoreEmoji(conversation.score) : '-'}</td>
                        <td className="card-meta">{formatDate(conversation.startedAt)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {conversation.status === 'completed' && !conversation.approved && (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleApprove(conversation)}
                                disabled={actionLoading === conversation.id}
                              >
                                {actionLoading === conversation.id ? '...' : '✅ 승인'}
                              </button>
                            )}
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() =>
                                setSelectedConv(
                                  selectedConv?.id === conversation.id ? null : conversation
                                )
                              }
                            >
                              💬
                            </button>
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleReset(conversation)}
                              disabled={actionLoading === conversation.id}
                            >
                              🔄
                            </button>
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
                  💬 {selectedConv.studentCode}번 학생 대화 기록
                  {selectedConv.score && (
                    <span className="badge badge-score" style={{ marginLeft: '0.75rem' }}>
                      {selectedConv.score}점
                    </span>
                  )}
                  {selectedConv.approved && (
                    <span className="badge badge-active" style={{ marginLeft: '0.5rem' }}>
                      승인됨
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
                      {message.role === 'unicorn' && <div className="chat-sender">🦄 유니콘</div>}
                      <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
                    </div>
                  ))}
                </div>
                {selectedConv.feedback && (
                  <div className="score-feedback" style={{ marginTop: '1rem' }}>
                    <strong>AI 피드백:</strong> {selectedConv.feedback}
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