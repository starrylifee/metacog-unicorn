'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import {
  getArtReferenceLabel,
  getStudentFacingArtAttribution,
  getStudentFacingArtTitle,
} from '@/lib/artAssignment';
import { formatStudentMessageByteRange, getUtf8ByteLength } from '@/lib/chatConstraints';
import { getStudentMessageCount } from '@/lib/conversationState';
import { getAssignmentMaxScore } from '@/lib/scoreConfig';

function buildWelcomeMessage(assignment) {
  if (assignment?.type === 'art') {
    const paintingTitle = assignment.paintingTitle?.trim();
    const attribution = getStudentFacingArtAttribution(assignment);
    const artworkIntro = paintingTitle
      ? `오늘은 **"${paintingTitle}"${attribution ? ` (${attribution})` : ''}**을 함께 감상할 거야.`
      : '오늘은 그림 한 점을 함께 감상할 거야.';
    return {
      role: 'unicorn',
      content: `안녕! 나는 미술 유니콘이야. 🎨\n\n${artworkIntro}\n그림을 천천히 살펴보고, 눈에 띄는 것부터 자유롭게 말해 줘!`,
    };
  }
  return {
    role: 'unicorn',
    content: `안녕! 나는 메타인지 유니콘이야.\n\n오늘 **"${assignment?.title}"**에서 배운 내용을 네 말로 설명해 줘.\n필요한 부분만 짧게 더 물어보고 마무리할게.`,
  };
}

function buildInitialMessages(assignment, savedMessages = []) {
  const welcomeMessage = buildWelcomeMessage(assignment);
  return savedMessages.length > 0 ? [welcomeMessage, ...savedMessages] : [welcomeMessage];
}

export default function ChatPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const code = params.code;
  const studentCode = searchParams.get('student') || '1';

  const [assignment, setAssignment] = useState(null);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [finished, setFinished] = useState(false);
  const [score, setScore] = useState(null);
  const [feedback, setFeedback] = useState('');
  const [nextStepTip, setNextStepTip] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState('');
  const [showImagePanel, setShowImagePanel] = useState(false);
  const [readyToChat, setReadyToChat] = useState(false);
  const [turnInfo, setTurnInfo] = useState({ current: 0, max: 0, remaining: 0 });
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const isArt = assignment?.type === 'art';
  const hasArtReference = isArt && Boolean(assignment?.imageUrl);
  const studentFacingArtTitle = useMemo(
    () => (isArt ? getStudentFacingArtTitle(assignment) : ''),
    [assignment, isArt]
  );
  const artReferenceLabel = useMemo(
    () => (isArt ? getArtReferenceLabel(assignment) : ''),
    [assignment, isArt]
  );
  const studentFacingArtAttribution = useMemo(
    () => (isArt ? getStudentFacingArtAttribution(assignment) : ''),
    [assignment, isArt]
  );
  const maxScore = useMemo(() => (assignment ? getAssignmentMaxScore(assignment) : null), [assignment]);
  const inputByteLength = useMemo(() => getUtf8ByteLength(input), [input]);
  const byteRangeLabel = useMemo(
    () => formatStudentMessageByteRange(assignment?.minStudentMessageBytes, assignment?.maxStudentMessageBytes),
    [assignment]
  );
  const inputLengthError = useMemo(() => {
    if (!assignment || !input.trim()) {
      return '';
    }

    if (inputByteLength < assignment.minStudentMessageBytes) {
      return `최소 ${assignment.minStudentMessageBytes}B 이상으로 적어 주세요. 지금은 ${inputByteLength}B예요.`;
    }

    if (inputByteLength > assignment.maxStudentMessageBytes) {
      return `최대 ${assignment.maxStudentMessageBytes}B 안으로 적어 주세요. 지금은 ${inputByteLength}B예요.`;
    }

    return '';
  }, [assignment, input, inputByteLength]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    if (!hasArtReference) {
      setShowImagePanel(false);
      return;
    }

    if (typeof window !== 'undefined' && window.innerWidth >= 960) {
      setShowImagePanel(true);
    }
  }, [hasArtReference]);

  useEffect(() => {
    if (loading || blocked || sending || finished || !conversationId) {
      return;
    }

    if (isArt && !readyToChat) {
      return;
    }

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 0);

    return () => window.clearTimeout(focusTimer);
  }, [blocked, conversationId, finished, isArt, loading, readyToChat, sending]);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setBlocked(false);
      setBlockedMessage('');
      setFinished(false);
      setScore(null);
      setFeedback('');
      setNextStepTip('');
      setMessages([]);
      setConversationId(null);
      setReadyToChat(false);

      try {
        const response = await fetch(`/api/assignments/lookup?code=${code}`);
        const data = await response.json();

        if (!data.success) {
          setLoading(false);
          return;
        }

        setAssignment(data.assignment);

        const conversationResponse = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assignmentId: data.assignment.id,
            studentCode,
          }),
        });
        const conversationData = await conversationResponse.json();

        if (conversationData.alreadyExists) {
          setBlocked(true);
          setBlockedMessage(
            conversationData.error || '이미 참여한 번호입니다. 교사에게 문의해 주세요.'
          );
          setLoading(false);
          return;
        }

        if (!conversationData.success) {
          setBlocked(true);
          setBlockedMessage(
            conversationData.error || '지금은 이 번호로 입장할 수 없어요. 학생 번호를 다시 확인해 주세요.'
          );
          setLoading(false);
          return;
        }

        if (conversationData.success) {
          const restoredConversation = conversationData.conversation;
          const restoredMessages = Array.isArray(restoredConversation?.messages)
            ? restoredConversation.messages
            : [];

          setConversationId(conversationData.conversationId);
          setMessages(buildInitialMessages(data.assignment, restoredMessages));

          if (restoredConversation?.status === 'completed') {
            setFinished(true);
            setScore(restoredConversation.score ?? null);
            setFeedback(restoredConversation.feedback || '');
            setNextStepTip(restoredConversation.nextStepTip || restoredConversation.higherScoreTip || '');
          }

          // 복원된 대화에서 턴 정보 계산
          const restoredStudentTurns = getStudentMessageCount(restoredConversation);
          const maxTurns = data.assignment.maxTurns ?? 0;
          setTurnInfo({
            current: restoredStudentTurns,
            max: maxTurns,
            remaining: Math.max(0, maxTurns - restoredStudentTurns),
          });

          // 복원된 대화가 있으면 준비 화면 건너뛰기
          if (restoredMessages.length > 0 || restoredConversation?.status === 'completed') {
            setReadyToChat(true);
          } else if (data.assignment.type !== 'art') {
            // 수학 과제는 준비 화면 없이 바로 시작
            setReadyToChat(true);
          }
        }
      } catch (error) {
        console.error('Init error:', error);
      }

      setLoading(false);
    }

    void init();
  }, [code, studentCode]);

  const sendMessage = async () => {
    if (!input.trim() || sending || finished || !conversationId || !assignment || inputLengthError) {
      return;
    }

    const userMessage = input.trim();
    setInput('');
    setSending(true);

    const nextMessages = [...messages, { role: 'student', content: userMessage }];
    setMessages(nextMessages);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId,
          assignmentId: assignment.id,
          content: userMessage,
          studentCode,
        }),
      });
      const data = await response.json();

      if (data.success) {
        const updatedMessages = [...nextMessages, { role: 'unicorn', content: data.reply }];
        setMessages(updatedMessages);

        if (data.finished) {
          setFinished(true);
          setScore(data.score);
          setFeedback(data.feedback || '');
          setNextStepTip(data.nextStepTip || data.higherScoreTip || '');
        }

        // 턴 정보 업데이트
        if (data.maxTurns !== undefined) {
          setTurnInfo({
            current: data.currentTurn ?? 0,
            max: data.maxTurns ?? 0,
            remaining: data.remainingTurns ?? 0,
          });
        }
      } else {
        setMessages([
          ...nextMessages,
          {
            role: 'unicorn',
            content: data.error || '문제가 생겼어요. 처음부터 다시 시작해 주세요.',
          },
        ]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages([
        ...nextMessages,
        {
          role: 'unicorn',
          content: '연결에 문제가 있어요. 한 번만 다시 설명해 줄래?',
        },
      ]);
    }

    setSending(false);
  };

  const handleKeyDown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <div className="loading-container">
          <div className="unicorn-avatar unicorn-avatar-large">🦄</div>
          <p style={{ color: 'var(--text-secondary)' }}>유니콘을 깨우고 있어요...</p>
          <div className="loading-spinner" />
        </div>
      </div>
    );
  }

  if (!assignment) {
    return (
      <div className="page-container">
        <div className="entry-container">
          <div className="unicorn-avatar unicorn-avatar-large">⚠️</div>
          <h2 style={{ marginTop: '1rem' }}>과제를 찾을 수 없어요.</h2>
          <p className="subtitle">입장 코드를 다시 확인해 주세요.</p>
          <Link href="/" className="btn btn-primary">
            돌아가기
          </Link>
        </div>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="page-container">
        <div className="entry-container">
          <div className="unicorn-avatar unicorn-avatar-large">🔒</div>
          <h2 style={{ marginTop: '1rem' }}>지금은 이 번호로 들어갈 수 없어요.</h2>
          <p className="subtitle">{blockedMessage}</p>
          <Link href="/" className="btn btn-primary">
            돌아가기
          </Link>
        </div>
      </div>
    );
  }

  // 미술 과제: 감상 준비 화면
  if (isArt && !readyToChat) {
    return (
      <div className="page-container">
        <div className="entry-container">
          <div className="unicorn-avatar unicorn-avatar-large">🎨</div>
          <h1 className="heading-hero" style={{ fontSize: '1.8rem' }}>
            <span className="heading-gradient">그림을 천천히 살펴보세요</span>
          </h1>
          <p className="subtitle" style={{ marginBottom: '1.5rem' }}>
            잠시 그림을 자유롭게 감상한 뒤, 준비되면 대화를 시작하세요.
          </p>

          {assignment.imageUrl && (
            <div style={{
              marginBottom: '1.5rem',
              borderRadius: 'var(--radius-lg)',
              overflow: 'hidden',
              background: 'rgba(0,0,0,0.3)',
              border: '1px solid var(--border-color)',
              maxWidth: '560px',
              width: '100%',
            }}>
              <img
                src={assignment.imageUrl}
                alt={artReferenceLabel}
                style={{
                  width: '100%',
                  maxHeight: '420px',
                  objectFit: 'contain',
                  display: 'block',
                }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              <p style={{
                fontSize: '0.9rem',
                color: 'var(--text-secondary)',
                padding: '0.75rem 1rem',
                fontWeight: 500,
              }}>
                {artReferenceLabel}
                {studentFacingArtAttribution ? ` · ${studentFacingArtAttribution}` : ''}
              </p>
            </div>
          )}

          <button
            className="btn btn-primary btn-large"
            onClick={() => setReadyToChat(true)}
            style={{ width: '100%', maxWidth: '320px' }}
          >
            🦄 감상 시작하기
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className={hasArtReference ? 'art-chat-layout' : undefined}>
        <div className={`chat-container${hasArtReference ? ' chat-container-art' : ''}`}>
        <div className="chat-header">
          <div className="unicorn-avatar">🦄</div>
          <div className="chat-header-info">
            <h2>유니콘과 대화 중</h2>
            <p>
              {isArt ? studentFacingArtTitle : assignment.title} · {studentCode}번 학생
            </p>
          </div>
          {!finished && turnInfo.max > 0 && (
            <span
              className="badge"
              style={{
                background: turnInfo.remaining <= 2
                  ? 'rgba(255, 100, 100, 0.2)'
                  : 'rgba(139, 92, 246, 0.2)',
                color: turnInfo.remaining <= 2
                  ? '#ff8a8a'
                  : 'var(--primary)',
                border: `1px solid ${turnInfo.remaining <= 2 ? 'rgba(255,100,100,0.3)' : 'rgba(139,92,246,0.3)'}`,
                padding: '0.25rem 0.6rem',
                borderRadius: '999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              {turnInfo.current}/{turnInfo.max}턴
            </span>
          )}
          {!isArt && Number.isFinite(score) && finished && <span className="badge badge-score">{score}점</span>}
        </div>

        <div className="chat-messages">
          {/* 미술: 스티키 썸네일 — 스크롤해도 항상 상단에 고정 */}
          {false && isArt && assignment.imageUrl && (
            <div
              onClick={() => setShowImagePanel(!showImagePanel)}
              style={{
                position: 'sticky',
                top: 0,
                zIndex: 10,
                cursor: 'pointer',
                borderRadius: showImagePanel ? 'var(--radius-md)' : 'var(--radius-sm)',
                overflow: 'hidden',
                background: 'rgba(15, 10, 26, 0.92)',
                backdropFilter: 'blur(8px)',
                border: '1px solid var(--border-color)',
                textAlign: 'center',
                marginBottom: '0.75rem',
                transition: 'all 0.3s ease',
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              }}
            >
              <img
                src={assignment.imageUrl}
                alt={artReferenceLabel}
                style={{
                  width: '100%',
                  maxHeight: showImagePanel ? '280px' : '72px',
                  objectFit: showImagePanel ? 'contain' : 'cover',
                  display: 'block',
                  transition: 'max-height 0.3s ease',
                }}
                onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
              />
              <p style={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                padding: '0.2rem 0.5rem',
                margin: 0,
              }}>
                {showImagePanel
                  ? `${artReferenceLabel}${studentFacingArtAttribution ? ` · ${studentFacingArtAttribution}` : ''} — 탭하면 축소`
                  : '🖼️ 탭하면 그림 확대'}
              </p>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={index} className={`chat-bubble chat-bubble-${message.role}`}>
              {message.role === 'unicorn' && <div className="chat-sender">{isArt ? '미술 유니콘' : '메타인지 유니콘'}</div>}
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
            </div>
          ))}

          {sending && (
            <div className="chat-bubble chat-bubble-unicorn">
              <div className="chat-sender">{isArt ? '미술 유니콘' : '메타인지 유니콘'}</div>
              <div className="typing-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          {/* 완료 카드: 미술은 점수 숨김, 수학은 기존대로 */}
          {finished && (
            <div className="chat-bubble chat-bubble-system">
              <div className="score-display">
                {isArt ? (
                  <>
                    <div className="score-label">🎨 오늘의 감상 완료!</div>
                    {feedback && <div className="score-feedback">{feedback}</div>}
                    {nextStepTip && (
                      <div className="score-feedback" style={{ marginTop: '0.75rem' }}>
                        <strong>💡 다음에 해보면 좋을 것</strong> {nextStepTip}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {Number.isFinite(score) && (
                      <div className="score-label">{score}점{Number.isFinite(maxScore) ? ` / ${maxScore}점` : ''}</div>
                    )}
                    {feedback && <div className="score-feedback">{feedback}</div>}
                    {nextStepTip && (
                      <div className="score-feedback" style={{ marginTop: '0.75rem' }}>
                        <strong>💡 다음에 해보면 좋을 것</strong> {nextStepTip}
                      </div>
                    )}
                  </>
                )}
                <div style={{ marginTop: '1rem' }}>
                  <Link href="/" className="btn btn-primary btn-sm">
                    처음으로
                  </Link>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {!finished && (
          <div className="chat-input-area">
            {turnInfo.max > 0 && turnInfo.remaining <= 2 && turnInfo.remaining > 0 && (
              <div style={{
                fontSize: '0.72rem',
                color: turnInfo.remaining === 1 ? '#ff8a8a' : 'var(--text-muted)',
                textAlign: 'center',
                paddingBottom: '0.35rem',
                fontWeight: 500,
              }}>
                {turnInfo.remaining === 1
                  ? '⚠️ 마지막 대화 기회예요!'
                  : `💬 남은 대화 기회: ${turnInfo.remaining}번`}
              </div>
            )}
            {assignment?.minStudentMessageBytes && assignment?.maxStudentMessageBytes && (
              <div style={{
                fontSize: '0.72rem',
                color: inputLengthError ? '#ff8a8a' : 'var(--text-muted)',
                textAlign: 'center',
                paddingBottom: '0.35rem',
                fontWeight: 500,
              }}>
                {inputLengthError || `답변 길이 ${inputByteLength}B · 권장 범위 ${byteRangeLabel}`}
              </div>
            )}
            <input
              ref={inputRef}
              id="chat-input"
              type="text"
              className="form-input"
              placeholder={isArt ? '그림을 보고 느낀 점을 자유롭게 말해 보세요...' : '유니콘에게 설명해 보세요...'}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              autoComplete="off"
            />
            <button
              id="btn-send"
              className="btn btn-primary"
              onClick={() => void sendMessage()}
              disabled={sending || !input.trim() || Boolean(inputLengthError)}
            >
              {sending ? '...' : '전송'}
            </button>
          </div>
        )}
        </div>
        {hasArtReference && (
          <aside className={`art-reference-panel${showImagePanel ? ' is-open' : ''}`}>
            <button
              type="button"
              className="art-reference-toggle"
              onClick={() => setShowImagePanel((prev) => !prev)}
              aria-expanded={showImagePanel}
              aria-controls="art-reference-card"
            >
              {showImagePanel ? '그림 접기' : '그림 보기'}
            </button>

            <div id="art-reference-card" className="art-reference-card">
              <div className="art-reference-card-header">
                <div>
                  <div className="art-reference-eyebrow">Artwork Reference</div>
                  <h3>{artReferenceLabel}</h3>
                </div>
                <button
                  type="button"
                  className="art-reference-close"
                  onClick={() => setShowImagePanel(false)}
                  aria-label="작품 패널 닫기"
                >
                  ×
                </button>
              </div>

              <div className="art-reference-image-wrap">
                <img
                  src={assignment.imageUrl}
                  alt={artReferenceLabel}
                  className="art-reference-image"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>

              <p className="art-reference-caption">
                {artReferenceLabel}
                {studentFacingArtAttribution ? ` · ${studentFacingArtAttribution}` : ''}
              </p>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
