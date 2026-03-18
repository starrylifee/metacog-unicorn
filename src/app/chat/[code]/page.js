'use client';

import { useEffect, useRef, useState } from 'react';
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

  useEffect(() => {
    async function init() {
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
          setLoading(false);
          return;
        }

        if (conversationData.success) {
          setConversationId(conversationData.conversationId);
          setMessages([
            {
              role: 'unicorn',
              content: `안녕! 나는 유니콘이야 🦄✨\n\n오늘 **"${data.assignment.title}"**에서 배운 걸 핵심만 짧고 정확하게 설명해줘!\n내가 필요한 것만 2번 정도 더 물어보고 금방 끝낼게.\n\n잘 설명하면 포인트를 줄 수도 있어! 💎`,
            },
          ]);
        }
      } catch (error) {
        console.error('Init error:', error);
      }

      setLoading(false);
    }

    void init();
  }, [code, studentCode]);

  const sendMessage = async () => {
    if (!input.trim() || sending || finished) {
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
          setFeedback(data.feedback);
        }
      } else {
        setMessages([
          ...nextMessages,
          {
            role: 'unicorn',
            content: data.error || '앗, 잠깐 문제가 생겼어! 🫣 처음부터 다시 시작해줄래?',
          },
        ]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages([
        ...nextMessages,
        {
          role: 'unicorn',
          content: '앗, 잠깐 문제가 생겼어! 🫣 다시 말해줄래?',
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

  const getScoreStars = (value) => {
    const filled = '⭐';
    const empty = '☆';
    return filled.repeat(value) + empty.repeat(3 - value);
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
          <a href="/" className="btn btn-primary">
            돌아가기
          </a>
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
            {studentCode}번 학생은 이 과제에 이미 참여했어요.
            <br />
            본인 번호가 맞다면 선생님에게 문의하세요.
          </p>
          <a href="/" className="btn btn-primary">
            돌아가기
          </a>
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
          {finished && <span className="badge badge-score">{score}점</span>}
        </div>

        <div className="chat-messages">
          {messages.map((message, index) => (
            <div key={index} className={`chat-bubble chat-bubble-${message.role}`}>
              {message.role === 'unicorn' && <div className="chat-sender">🦄 유니콘</div>}
              <div style={{ whiteSpace: 'pre-wrap' }}>{message.content}</div>
            </div>
          ))}

          {sending && (
            <div className="chat-bubble chat-bubble-unicorn">
              <div className="chat-sender">🦄 유니콘</div>
              <div className="typing-dots">
                <span />
                <span />
                <span />
              </div>
            </div>
          )}

          {finished && score && (
            <div className="chat-bubble chat-bubble-system">
              <div className="score-display">
                <div className="score-stars">{getScoreStars(score)}</div>
                <div className="score-label">{score}점 / 3점</div>
                {feedback && <div className="score-feedback">{feedback}</div>}
                <div style={{ marginTop: '1rem' }}>
                  <a href="/" className="btn btn-primary btn-sm">
                    🏠 처음으로
                  </a>
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
              placeholder="유니콘에게 설명해보세요..."
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
              {sending ? '⏳' : '전송'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}