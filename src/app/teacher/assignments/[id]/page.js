'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { auth } from '@/lib/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import {
  deleteAssignment,
  getAssignmentById,
  getConversationsByAssignment,
  toggleAssignment,
} from '@/lib/firestore';

export default function AssignmentDetail() {
  const router = useRouter();
  const params = useParams();
  const id = params.id;

  const [user, setUser] = useState(null);
  const [assignment, setAssignment] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedConv, setSelectedConv] = useState(null);
  const [actionLoading, setActionLoading] = useState(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      if (!u) router.push('/teacher');
      else setUser(u);
    });
    return () => unsubscribe();
  }, [router]);

  const loadData = async () => {
    if (!user || !id) return;
    try {
      const a = await getAssignmentById(id);
      if (!a || a.teacherId !== user.uid) {
        router.push('/teacher');
        return;
      }
      setAssignment(a);
      const convs = await getConversationsByAssignment(id);
      setConversations(convs);
    } catch (err) {
      console.error('Load error:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
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
    const newState = !assignment.isActive;
    await toggleAssignment(id, newState);
    setAssignment(prev => ({ ...prev, isActive: newState }));
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
    } catch (err) {
      console.error('Delete assignment error:', err);
      alert('과제 삭제에 실패했습니다.');
      setActionLoading(null);
    }
  };

  // 승인: Grownd 포인트 부여
  const handleApprove = async (conv) => {
    if (!confirm(`${conv.studentCode}번 학생 (${conv.score}점) 승인하고 포인트를 부여할까요?`)) return;

    setActionLoading(conv.id);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/approve', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          conversationId: conv.id,
        }),
      });
      const data = await res.json();

      if (data.success) {
        alert('✅ 승인 완료! 포인트가 부여되었습니다.');
        await loadData();
      } else {
        alert(`❌ ${data.error}`);
      }
    } catch (err) {
      alert('오류가 발생했습니다.');
    }
    setActionLoading(null);
  };

  // 전체 승인
  const handleApproveAll = async () => {
    const pendingConvs = conversations.filter(c => c.status === 'completed' && !c.approved);
    if (pendingConvs.length === 0) {
      alert('승인 대기 중인 학생이 없습니다.');
      return;
    }
    if (!confirm(`${pendingConvs.length}명의 학생을 모두 승인할까요?`)) return;

    setActionLoading('all');
    const headers = await getAuthHeaders();
    for (const conv of pendingConvs) {
      try {
        const res = await fetch('/api/approve', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            conversationId: conv.id,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `${conv.studentCode}번 승인 실패`);
        }
      } catch (err) {
        console.error(`Approve error for ${conv.studentCode}:`, err);
        alert(`❌ ${conv.studentCode}번 학생 승인에 실패했습니다.`);
        setActionLoading(null);
        return;
      }
    }
    alert('✅ 전체 승인 완료!');
    await loadData();
    setActionLoading(null);
  };

  // 리셋: 대화 삭제 → 재참여 가능
  const handleReset = async (conv) => {
    if (!confirm(`${conv.studentCode}번 학생의 기록을 삭제하고 다시 참여할 수 있게 할까요?`)) return;

    setActionLoading(conv.id);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/approve?id=${conv.id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const data = await res.json();

      if (data.success) {
        alert('🔄 리셋 완료! 학생이 다시 참여할 수 있습니다.');
        setSelectedConv(null);
        await loadData();
      } else {
        alert(`❌ ${data.error}`);
      }
    } catch (err) {
      alert('오류가 발생했습니다.');
    }
    setActionLoading(null);
  };

  const formatDate = (ts) => {
    if (!ts) return '-';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('ko-KR', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  const getScoreEmoji = (score) => {
    if (score === 3) return '🌟🌟🌟';
    if (score === 2) return '⭐⭐☆';
    if (score === 1) return '⭐☆☆';
    return '-';
  };

  const getStatusLabel = (conv) => {
    if (conv.approved) return { text: '승인됨', className: 'badge-active' };
    if (conv.status === 'completed') return { text: '승인 대기', className: 'badge-inactive' };
    return { text: '진행 중', className: 'badge-inactive' };
  };

  const avgScore = () => {
    const scored = conversations.filter(c => c.score);
    if (scored.length === 0) return '-';
    const avg = scored.reduce((sum, c) => sum + c.score, 0) / scored.length;
    return avg.toFixed(1);
  };

  const pendingCount = conversations.filter(c => c.status === 'completed' && !c.approved).length;

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-container"><div className="loading-spinner" /></div>
      </div>
    );
  }

  if (!assignment) return null;

  return (
    <div className="page-container">
      <nav className="navbar">
        <Link href="/teacher" className="navbar-brand">
          <span className="emoji">🦄</span> 메타인지 유니콘
        </Link>
        <Link href="/teacher" className="btn btn-ghost btn-sm">← 대시보드</Link>
      </nav>

      <div className="content-wrapper">
        {/* Assignment Info */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <h1 className="heading-section" style={{ marginBottom: 0 }}>{assignment.title}</h1>
              <span className={`badge ${assignment.isActive ? 'badge-active' : 'badge-inactive'}`}>
                {assignment.isActive ? '활성' : '비활성'}
              </span>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {assignment.subject && `${assignment.subject} · `}
              {assignment.grade && `${assignment.grade} · `}
              입장코드: <strong style={{ color: 'var(--cyan-primary)', letterSpacing: '0.1em' }}>{assignment.entryCode}</strong>
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
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

        {/* Stats */}
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-value">{conversations.length}</div>
            <div className="stat-label">전체 참여</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{conversations.filter(c => c.status === 'completed').length}</div>
            <div className="stat-label">완료</div>
          </div>
          <div className="stat-card">
            <div className="stat-value" style={{ color: pendingCount > 0 ? 'var(--yellow-primary)' : undefined }}>{pendingCount}</div>
            <div className="stat-label">승인 대기</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{conversations.filter(c => c.approved).length}</div>
            <div className="stat-label">승인 완료</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{avgScore()}</div>
            <div className="stat-label">평균 점수</div>
          </div>
        </div>

        {/* Results Table */}
        <h2 className="heading-section">📊 학생 결과</h2>

        {conversations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-emoji">🦄</div>
            <p className="empty-state-text">아직 참여한 학생이 없어요</p>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              학생들에게 입장코드 <strong style={{ color: 'var(--cyan-primary)' }}>{assignment.entryCode}</strong>를 알려주세요!
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
                  {conversations.map(conv => {
                    const status = getStatusLabel(conv);
                    return (
                      <tr key={conv.id}>
                        <td><strong>{conv.studentCode}번</strong></td>
                        <td>
                          <span className={`badge ${status.className}`}>{status.text}</span>
                        </td>
                        <td>{conv.score ? getScoreEmoji(conv.score) : '-'}</td>
                        <td className="card-meta">{formatDate(conv.startedAt)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                            {/* 승인 버튼 - 완료 + 미승인일 때만 */}
                            {conv.status === 'completed' && !conv.approved && (
                              <button
                                className="btn btn-primary btn-sm"
                                onClick={() => handleApprove(conv)}
                                disabled={actionLoading === conv.id}
                              >
                                {actionLoading === conv.id ? '...' : '✅ 승인'}
                              </button>
                            )}
                            {/* 대화 보기 */}
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => setSelectedConv(selectedConv?.id === conv.id ? null : conv)}
                            >
                              💬
                            </button>
                            {/* 리셋 */}
                            <button
                              className="btn btn-danger btn-sm"
                              onClick={() => handleReset(conv)}
                              disabled={actionLoading === conv.id}
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

            {/* Selected Conversation Detail */}
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
                    <span className="badge badge-active" style={{ marginLeft: '0.5rem' }}>승인됨</span>
                  )}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {(selectedConv.messages || []).map((msg, i) => (
                    <div key={i} className={`chat-bubble chat-bubble-${msg.role}`} style={{ maxWidth: '85%' }}>
                      {msg.role === 'unicorn' && <div className="chat-sender">🦄 유니콘</div>}
                      <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
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
