'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

import { formatScoreOptions, getAssignmentMaxScore, getNextHigherScore } from '@/lib/scoreConfig';

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
  const [higherScoreTip, setHigherScoreTip] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState('');
  const messagesEndRef = useRef(null);

  const scoreScaleLabel = useMemo(
    () => (assignment?.scoreOptions ? formatScoreOptions(assignment.scoreOptions, ' / ') : ''),
    [assignment]
  );
  const maxScore = useMemo(() => (assignment ? getAssignmentMaxScore(assignment) : null), [assignment]);
  const nextHigherScore = useMemo(() => {
    if (!assignment || !Number.isFinite(score)) {
      return null;
    }

    return getNextHigherScore(assignment.scoreOptions || [], score);
  }, [assignment, score]);

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
      setHigherScoreTip('');
      setMessages([]);
      setConversationId(null);

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
            setHigherScoreTip(restoredConversation.higherScoreTip || '');
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
          setHigherScoreTip(data.higherScoreTip || '');
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
          {Number.isFinite(score) && finished && <span className="badge badge-score">{score}점</span>}
        </div>

        <div className="chat-messages">
          {assignment.type === 'art' && assignment.imageUrl && (
            <div style={{ marginBottom: '1rem', borderRadius: 'var(--radius-md)', overflow: 'hidden', background: 'rgba(0,0,0,0.25)', textAlign: 'center' }}>
              <img
                src={assignment.imageUrl}
                alt={assignment.paintingTitle || assignment.title}
                style={{ maxWidth: '100%', maxHeight: '260px', objectFit: 'contain', display: 'block', margin: '0 auto' }}
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
              <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', padding: '0.4rem 0.75rem' }}>
                {assignment.paintingTitle || assignment.title}{assignment.artist ? ` · ${assignment.artist}` : ''}{assignment.year ? ` (${assignment.year})` : ''}
              </p>
            </div>
          )}
          {messages.map((message, index) => (
            <div key={index} className={`chat-bubble chat-bubble-${message.role}`}>
              {message.role === 'unicorn' && <div className="chat-sender">메타인지 유니콘</div>}
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
            </div>
          ))}

          {sending && (
            <div className="chat-bubble chat-bubble-unicorn">
              <div className="chat-sender">메타인지 유니콘</div>
              <div className="typing-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          {finished && Number.isFinite(score) && (
            <div className="chat-bubble chat-bubble-system">
              <div className="score-display">
                <div className="score-label">{score}점{Number.isFinite(maxScore) ? ` / ${maxScore}점` : ''}</div>
                {scoreScaleLabel && (
                  <p style={{ marginTop: '0.75rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    점수 단계: {scoreScaleLabel}
                  </p>
                )}
                {feedback && <div className="score-feedback">{feedback}</div>}
                {nextHigherScore !== null && higherScoreTip && (
                  <div className="score-feedback" style={{ marginTop: '0.75rem' }}>
                    <strong>{nextHigherScore}점을 받으려면</strong> {higherScoreTip}
                  </div>
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
              placeholder="유니콘에게 설명해 보세요..."
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
