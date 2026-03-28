'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import { getAssignmentMaxScore } from '@/lib/scoreConfig';

function buildWelcomeMessage(assignment) {
  if (assignment?.type === 'art') {
    const paintingTitle = assignment.paintingTitle || assignment.title;
    const artist = assignment.artist ? ` (${assignment.artist}${assignment.year ? ', ' + assignment.year : ''})` : '';
    return {
      role: 'unicorn',
      content: `안녕! 나는 미술 유니콘이야. 🎨\n\n오늘은 **"${paintingTitle}"${artist}**을 함께 감상할 거야.\n그림을 천천히 살펴보고, 눈에 띄는 것부터 자유롭게 말해 줘!`,
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
  const messagesEndRef = useRef(null);

  const isArt = assignment?.type === 'art';
  const maxScore = useMemo(() => (assignment ? getAssignmentMaxScore(assignment) : null), [assignment]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

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
    if (!input.trim() || sending || finished || !conversationId || !assignment) {
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
                alt={assignment.paintingTitle || assignment.title}
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
                {assignment.paintingTitle || assignment.title}
                {assignment.artist ? ` · ${assignment.artist}` : ''}
                {assignment.year ? ` (${assignment.year})` : ''}
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
      <div className="chat-container">
        <div className="chat-header">
          <div className="unicorn-avatar">🦄</div>
          <div className="chat-header-info">
            <h2>유니콘과 대화 중</h2>
            <p>
              {assignment.title} · {studentCode}번 학생
            </p>
          </div>
          {/* 미술: 점수 헤더에 안 보임, 수학: 기존대로 표시 */}
          {!isArt && Number.isFinite(score) && finished && <span className="badge badge-score">{score}점</span>}
          {/* 미술: 그림 보기 버튼 */}
          {isArt && assignment.imageUrl && (
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowImagePanel(!showImagePanel)}
              style={{ marginLeft: 'auto' }}
            >
              {showImagePanel ? '그림 닫기' : '🖼️ 그림 보기'}
            </button>
          )}
        </div>

        {/* 미술: 접이식 이미지 패널 (헤더 바로 아래 고정) */}
        {isArt && assignment.imageUrl && showImagePanel && (
          <div style={{
            borderBottom: '1px solid var(--border-color)',
            background: 'rgba(0,0,0,0.25)',
            textAlign: 'center',
            padding: '0.75rem',
            flexShrink: 0,
          }}>
            <img
              src={assignment.imageUrl}
              alt={assignment.paintingTitle || assignment.title}
              style={{
                maxWidth: '100%',
                maxHeight: '220px',
                objectFit: 'contain',
                display: 'block',
                margin: '0 auto',
                borderRadius: 'var(--radius-sm)',
              }}
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
            <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
              {assignment.paintingTitle || assignment.title}
              {assignment.artist ? ` · ${assignment.artist}` : ''}
              {assignment.year ? ` (${assignment.year})` : ''}
            </p>
          </div>
        )}

        <div className="chat-messages">
          {/* 미술: 초기 인라인 이미지 (대화 시작 시 한 번 보여줌) */}
          {isArt && assignment.imageUrl && !showImagePanel && messages.length <= 1 && (
            <div style={{ marginBottom: '0.5rem', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'rgba(0,0,0,0.25)', textAlign: 'center' }}>
              <img
                src={assignment.imageUrl}
                alt={assignment.paintingTitle || assignment.title}
                style={{ maxWidth: '100%', maxHeight: '200px', objectFit: 'contain', display: 'block', margin: '0 auto' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', padding: '0.3rem 0.5rem' }}>
                상단 "🖼️ 그림 보기" 버튼으로 언제든 다시 볼 수 있어요
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
            <input
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
              disabled={sending || !input.trim()}
            >
              {sending ? '...' : '전송'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
