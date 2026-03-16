import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { CHAT_SESSION_COOKIE, hashChatSessionToken } from '@/lib/chatSession';
import { FieldValue, adminDb } from '@/lib/serverDb';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function buildSystemPrompt(assignment) {
  const keywords = (assignment.keywords || []).join(', ');

  return `너는 "유니콘"이라는 이름의 귀엽지만 까다로운 캐릭터야. 🦄
학생이 오늘 배운 내용을 너에게 설명해야 해. 너는 학생의 설명을 듣고 부족한 부분에 딴지를 걸어야 해.

=== 학습 주제 ===
${assignment.title}

=== 오늘 차시 ===
${assignment.learningObjective || '(미지정)'}

=== 오늘 수업 범위 ===
${assignment.content}

${keywords ? `=== 핵심 키워드 ===\n${keywords}` : ''}

=== 범위 제한 규칙 ===
1. 반드시 오늘 차시와 오늘 수업 범위 안에서만 질문해
2. 같은 단원이라도 오늘 배우지 않은 앞차시, 다음 차시, 단원 전체 내용으로 확장하지 마
3. "기수법" 같은 교사용 또는 교육과정 용어를 학생에게 직접 말하게 시키지 마
4. 학생이 쉬운 말로 정확하게 설명하면 교과서 용어가 없어도 맞게 인정해
5. 차시명이 넓어 보여도, 실제 질문 기준은 교사가 적은 오늘 수업 범위를 우선해

=== 너의 행동 규칙 ===
1. 학생이 설명을 시작하면, 오늘 배운 핵심 한두 가지를 중심으로 빠진 부분이나 부정확한 부분을 질문해
2. "정말? 🤔", "그건 좀 다른 것 같은데?", "왜 그런 거야?", "더 자세히 말해줄 수 있어?" 같은 딴지를 걸어
3. 학생이 핵심 내용을 충분히 설명했다고 판단되면, 대화를 마무리해
4. 너무 엄격하지 않게, 친근하고 장난스러운 톤을 유지해
5. 이모지를 적절히 사용해
6. 한 번에 너무 많은 질문을 하지 말고, 한두 가지씩 물어봐
7. 학생의 설명이 맞으면 칭찬해주되, 아직 부족한 부분이 있으면 더 물어봐

=== 대화 마무리 판단 ===
학생이 학습 내용의 핵심을 어느 정도 설명했다고 느끼면 (완벽하지 않아도 됨), 다음 형식으로 대화를 마무리해:

마무리 메시지를 작성한 후, 반드시 마지막 줄에 다음 형식을 추가해:
[SCORE:X] (X는 1, 2, 3 중 하나)
[FEEDBACK:피드백 내용]

채점 기준:
- 3점: 핵심 내용을 정확하고 풍부하게 설명했음
- 2점: 기본 개념은 이해하지만 일부 설명이 부족하거나 부정확함
- 1점: 핵심 내용을 거의 설명하지 못했거나 크게 잘못된 설명이 있음

=== 중요 ===
- 대화가 대략 5~10턴 안에 마무리될 수 있도록 적절히 조절해
- 학생이 "모르겠어", "그만할래" 등을 말하면, 격려 후 현재까지의 성과로 채점해
- 오늘 수업 범위에 없는 내용을 지어내거나 끌어오지 마
- 반드시 한국어로 대화해`;
}

export async function POST(request) {
  try {
    const { conversationId, assignmentId, content, studentCode } = await request.json();
    const normalizedStudentCode = Number(studentCode);
    const userMessage = typeof content === 'string' ? content.trim() : '';
    const sessionToken = request.cookies.get(CHAT_SESSION_COOKIE)?.value;

    if (
      !conversationId ||
      !assignmentId ||
      !userMessage ||
      !Number.isInteger(normalizedStudentCode) ||
      !sessionToken
    ) {
      return NextResponse.json(
        { success: false, error: '대화 세션이 유효하지 않습니다. 처음부터 다시 시작해주세요.' },
        { status: 400 }
      );
    }

    const assignmentRef = adminDb.collection('assignments').doc(assignmentId);
    const conversationRef = adminDb.collection('conversations').doc(conversationId);
    const [assignmentSnap, conversationSnap] = await Promise.all([
      assignmentRef.get(),
      conversationRef.get(),
    ]);

    if (!assignmentSnap.exists) {
      return NextResponse.json({ success: false, error: '과제를 찾을 수 없습니다.' }, { status: 404 });
    }

    if (!conversationSnap.exists) {
      return NextResponse.json({ success: false, error: '대화 기록을 찾을 수 없습니다.' }, { status: 404 });
    }

    const assignment = assignmentSnap.data();
    const conversation = conversationSnap.data();

    if (
      conversation.assignmentId !== assignmentId ||
      conversation.studentCode !== normalizedStudentCode ||
      conversation.status === 'completed'
    ) {
      return NextResponse.json(
        { success: false, error: '이 대화는 더 이상 진행할 수 없습니다.' },
        { status: 409 }
      );
    }

    if (
      !conversation.sessionTokenHash ||
      conversation.sessionTokenHash !== hashChatSessionToken(sessionToken)
    ) {
      return NextResponse.json(
        { success: false, error: '대화 세션이 만료되었습니다. 처음부터 다시 시작해주세요.' },
        { status: 401 }
      );
    }

    const existingMessages = Array.isArray(conversation.messages) ? conversation.messages : [];

    // OpenAI 메시지 구성
    const systemPrompt = buildSystemPrompt(assignment);
    const openaiMessages = [
      { role: 'system', content: systemPrompt },
      ...existingMessages.map(m => ({
        role: m.role === 'unicorn' ? 'assistant' : 'user',
        content: m.content,
      })),
      { role: 'user', content: userMessage },
    ];

    // OpenAI API 호출
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: openaiMessages,
      temperature: 0.8,
      max_tokens: 500,
    });

    let reply = completion.choices[0].message.content;

    // 점수 파싱
    let finished = false;
    let score = null;
    let feedback = null;

    const scoreMatch = reply.match(/\[SCORE:(\d)\]/);
    const feedbackMatch = reply.match(/\[FEEDBACK:(.*?)\]/s);

    if (scoreMatch) {
      finished = true;
      score = parseInt(scoreMatch[1]);
      if (score < 1) score = 1;
      if (score > 3) score = 3;

      feedback = feedbackMatch ? feedbackMatch[1].trim() : '';

      // 태그 제거해서 학생에게 깔끔하게 보여주기
      reply = reply
        .replace(/\[SCORE:\d\]/, '')
        .replace(/\[FEEDBACK:.*?\]/s, '')
        .trim();
    }

    // 대화 기록 저장
    const updatedMessages = [
      ...existingMessages,
      { role: 'student', content: userMessage, timestamp: new Date().toISOString() },
      { role: 'unicorn', content: reply, timestamp: new Date().toISOString() },
    ];

    const updateData = { messages: updatedMessages };

    if (finished) {
      updateData.score = score;
      updateData.feedback = feedback;
      updateData.status = 'completed';
      updateData.approved = false;
      updateData.completedAt = FieldValue.serverTimestamp();
      updateData.sessionTokenHash = null;
    }

    await conversationRef.update(updateData);

    const response = NextResponse.json({
      success: true,
      reply,
      finished,
      score,
      feedback,
    });

    if (finished) {
      response.cookies.set(CHAT_SESSION_COOKIE, '', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: 0,
      });
    }

    return response;
  } catch (err) {
    console.error('Chat API error:', err);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
