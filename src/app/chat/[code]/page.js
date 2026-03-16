'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'next/navigation';

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
  const [blocked, setBlocked] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 과제 정보 불러오기 + 대화 시작
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch(`/api/assignments/lookup?code=${code}`);
        const data = await res.json();

        if (!data.success) {
          setLoading(false);
          return;
        }

        setAssignment(data.assignment);

        // 대화 시작 API 호출
        const convRes = await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assignmentId: data.assignment.id,
            studentCode,
          }),
        });
        const convData = await convRes.json();

        if (convData.alreadyExists) {
          setBlocked(true);
          setLoading(false);
          return;
        }

        if (convData.success) {
          setConversationId(convData.conversationId);
          setMessages([
            {
              role: 'unicorn',
              content: `안녕! 나는 유니콘이야 🦄✨\n\n오늘 **"${data.assignment.title}"**에 대해 배웠다면서?\n나한테 설명해볼래? 최대한 자세하게 말해줘!\n\n잘 설명하면 포인트를 줄 수도 있어! 💎`,
            },
          ]);
        }
      } catch (err) {
        console.error('Init error:', err);
      }
      setLoading(false);
    }
    init();
  }, [code, studentCode]);

  const sendMessage = async () => {
    if (!input.trim() || sending || finished) return;

    const userMessage = input.trim();
    setInput('');
    setSending(true);

    const newMessages = [...messages, { role: 'student', content: userMessage }];
    setMessages(newMessages);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversationId,
            assignmentId: assignment.id,
            content: userMessage,
            studentCode,
          }),
        });

        const data = await res.json();

        if (data.success) {
          const updatedMessages = [...newMessages, { role: 'unicorn', content: data.reply }];
          setMessages(updatedMessages);

          if (data.finished) {
            setFinished(true);
            setScore(data.score);
            setFeedback(data.feedback);
          }
        } else {
          setMessages([
            ...newMessages,
            {
              role: 'unicorn',
              content: data.error || '앗, 잠깐 문제가 생겼어! 🫣 처음부터 다시 시작해줄래?',
            },
          ]);
        }
      } catch (err) {
        console.error('Chat error:', err);
        setMessages([...newMessages, {
        role: 'unicorn',
        content: '앗, 잠깐 문제가 생겼어! 🫣 다시 말해줄래?',
      }]);
    }
    setSending(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const getScoreStars = (s) => {
    const filled = '⭐';
    const empty = '☆';
    return filled.repeat(s) + empty.repeat(3 - s);
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
          <div className="unicorn-avatar unicorn-avatar-large">😢</div>
          <h2 style={{ marginTop: '1rem' }}>과제를 찾을 수 없어요</h2>
          <p className="subtitle">입장 코드를 다시 확인해주세요!</p>
          <a href="/" className="btn btn-primary">돌아가기</a>
        </div>
      </div>
    );
  }

  if (blocked) {
    return (
      <div className="page-container">
        <div className="entry-container">
          <div className="unicorn-avatar unicorn-avatar-large">🔒</div>
          <h2 style={{ marginTop: '1rem' }}>이미 참여한 번호예요!</h2>
          <p className="subtitle">
            {studentCode}번 학생은 이 과제에 이미 참여했어요.<br />
            본인 번호가 맞다면 선생님에게 문의하세요.
          </p>
          <a href="/" className="btn btn-primary">돌아가기</a>
        </div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="chat-container">
        {/* Header */}
        <div className="chat-header">
          <div className="unicorn-avatar">🦄</div>
          <div className="chat-header-info">
            <h2>유니콘과 대화 중</h2>
            <p>{assignment.title} · {studentCode}번 학생</p>
          </div>
          {finished && <span className="badge badge-score">{score}점</span>}
        </div>

        {/* Messages */}
        <div className="chat-messages">
          {messages.map((msg, i) => (
            <div key={i} className={`chat-bubble chat-bubble-${msg.role}`}>
              {msg.role === 'unicorn' && (
                <div className="chat-sender">🦄 유니콘</div>
              )}
              <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
            </div>
          ))}

          {sending && (
            <div className="chat-bubble chat-bubble-unicorn">
              <div className="chat-sender">🦄 유니콘</div>
              <div className="typing-dots">
                <span /><span /><span />
              </div>
            </div>
          )}

          {finished && score && (
            <div className="chat-bubble chat-bubble-system">
              <div className="score-display">
                <div className="score-stars">{getScoreStars(score)}</div>
                <div className="score-label">{score}점 / 3점</div>
                {feedback && (
                  <div className="score-feedback">{feedback}</div>
                )}
                <div style={{ marginTop: '1rem' }}>
                  <a href="/" className="btn btn-primary btn-sm">🏠 처음으로</a>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        {!finished && (
          <div className="chat-input-area">
            <input
              id="chat-input"
              type="text"
              className="form-input"
              placeholder="유니콘에게 설명해보세요..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              autoComplete="off"
            />
            <button
              id="btn-send"
              className="btn btn-primary"
              onClick={sendMessage}
              disabled={sending || !input.trim()}
            >
              {sending ? '⏳' : '전송'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
