import { NextResponse } from 'next/server';
import OpenAI from 'openai';

import { CHAT_SESSION_COOKIE, hashChatSessionToken } from '@/lib/chatSession';
import {
  formatScoreOptions,
  getAssignmentMaxScore,
  getAssignmentScoreOptions,
  getClosestAllowedScore,
  getNextHigherScore,
  getScoringStyleLabel,
  normalizeScoringStyle,
} from '@/lib/scoreConfig';
import { FieldValue, adminDb } from '@/lib/serverDb';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const MODEL_NAME = 'gpt-4o-mini';
const MAX_STUDENT_TURNS = 3;

function getLowestAllowedScore(scoreOptions) {
  return Array.isArray(scoreOptions) && scoreOptions.length > 0 ? scoreOptions[0] : 0;
}

function buildScoringStyleGuidance(scoreOptions, scoringStyle) {
  const lowestScore = getLowestAllowedScore(scoreOptions);
  const nextScore = scoreOptions[1] ?? lowestScore;
  const middleScore = scoreOptions[Math.max(1, Math.floor((scoreOptions.length - 1) / 2))] ?? nextScore;
  const maxScore = scoreOptions[scoreOptions.length - 1] ?? lowestScore;

  if (scoringStyle === 'strict') {
    return `- 기본적으로 보수적으로 채점해.
- 핵심 개념이 조금 보여도 이유나 과정이 빠지면 ${nextScore}점 이하로 제한해.
- ${middleScore}점 이상은 오늘 배운 핵심과 왜 그런지가 분명히 드러날 때만 줘.
- 최고점 ${maxScore}점은 정확성, 구체성, 이유 설명, 예시나 근거가 모두 충분할 때만 줘.`;
  }

  if (scoringStyle === 'generous') {
    return `- 관련 있는 답변에는 약간 넓게 점수를 열어 둘 수 있어.
- 그래도 핵심이 거의 없거나 부정확하면 ${lowestScore}점 또는 ${nextScore}점이야.
- ${middleScore}점 이상은 오늘 배운 핵심을 대체로 맞게 설명했을 때만 줘.
- 최고점 ${maxScore}점은 후하게 채점하더라도 정확하고 구체적인 설명일 때만 줘.`;
  }

  return `- 기본적으로 균형 있게 채점해.
- 핵심이 조금 보여도 설명이 얕거나 이유가 없으면 ${nextScore}점 이하를 우선 고려해.
- ${middleScore}점 이상은 핵심 개념과 이유, 과정, 예시 중 적어도 일부가 분명해야 줘.
- 최고점 ${maxScore}점은 정확하고 구체적이며 자기 말 설명이 충분할 때만 줘.`;
}

function buildSystemPrompt(assignment, options = {}) {
  const { shouldForceFinish = false } = options;
  const keywords = (assignment.keywords || []).join(', ');
  const scoreOptions = getAssignmentScoreOptions(assignment);
  const maxScore = getAssignmentMaxScore(assignment);
  const scoringStyle = normalizeScoringStyle(assignment.scoringStyle);
  const lowestScore = getLowestAllowedScore(scoreOptions);

  return `너는 "메타인지 유니콘"이라는 이름의 친근한 학습 도우미야.
학생이 오늘 배운 내용을 자기 말로 설명하면, 짧게 되묻고 마지막에는 점수와 피드백을 알려 줘.

=== 학습 주제 ===
${assignment.title}

=== 오늘 수업 범위 ===
${assignment.learningObjective || '(미설정)'}

=== 수업 자료 ===
${assignment.content}

${keywords ? `=== 꼭 챙길 표현 ===\n${keywords}\n` : ''}=== 질문 규칙 ===
1. 반드시 오늘 수업 범위 안에서만 질문해.
2. 다음 차시나 단원 전체 내용으로 확장하지 마.
3. 학생에게 교과서 표현을 그대로 외우게 하지 말고, 학생 말로 설명하게 도와.
4. 한 번에 질문을 너무 많이 하지 말고 꼭 필요한 것만 1~2개 물어봐.
5. 학생 설명이 충분하면 더 캐묻지 말고 바로 마무리해.

=== 채점 성향 ===
- 현재 채점 성향은 "${getScoringStyleLabel(scoringStyle)}"이야.
${buildScoringStyleGuidance(scoreOptions, scoringStyle)}

=== 점수 체계 ===
- 사용할 수 있는 점수는 ${formatScoreOptions(scoreOptions)}점뿐이야. 반드시 이 중 하나만 사용해.
- 최고점 ${maxScore}점은 오늘 배운 핵심을 정확하고 구체적으로, 자기 말로 설명한 경우야.
- 낮은 점수일수록 핵심이 빠졌거나, 이유·과정·예시가 부족하거나, 설명이 부정확한 경우야.
- 점수 단계가 여러 개면 정확성, 구체성, 이유 설명, 예시 제시 정도에 따라 자연스럽게 나눠서 사용해.
- 채점 성향은 관련 있는 학습 답변에만 적용해.
- 장난, 말장난, 엉뚱한 농담, 무의미한 반복, 질문 회피, 오늘 수업과 무관한 답, "몰라요"만 반복하는 답은 반드시 ${lowestScore}점이야.
- 아주 짧더라도 오늘 수업의 핵심 개념이 실제로 들어 있을 때만 최저점보다 높은 점수를 고려해.

=== 마무리 형식 ===
대화를 마무리할 때는 학생에게 자연스럽게 한두 문장으로 말한 뒤, 마지막 줄들에 아래 형식을 정확히 넣어.
[SCORE:X]
[FEEDBACK:현재 점수를 준 이유를 1~2문장으로 설명]
[HIGHER_SCORE_TIP:더 높은 다음 점수를 받으려면 어떤 말이나 이유나 예시를 더 말했어야 했는지 1~2문장으로 구체적으로 설명. 이미 최고점이면 '이미 최고 점수야.'라고 써.]

=== 중요 ===
- 학생 발화 기회는 최대 ${MAX_STUDENT_TURNS}번이야.
- ${MAX_STUDENT_TURNS}번째 학생 답변 뒤에는 반드시 마무리해야 해.
- HIGHER_SCORE_TIP에는 막연한 조언 말고, 학생이 실제로 어떤 내용을 더 말했어야 하는지 써.
- HIGHER_SCORE_TIP도 오늘 수업 범위를 벗어나면 안 돼.
- 학생이 "모르겠어"처럼 짧게 답해도 남은 내용으로 평가하고 마무리해.
- ${shouldForceFinish ? '이번 응답은 마지막 응답이야. 질문하지 말고 바로 마무리해.' : '학생이 충분히 설명했거나 턴이 거의 다 찼다면 더 캐묻지 말고 종료해.'}`;
}

function extractTaggedValue(text, tagName) {
  const pattern = new RegExp(`\\[${tagName}:(.*?)\\]`, 's');
  const match = text.match(pattern);
  return match ? match[1].trim() : '';
}

function stripCompletionTags(text) {
  return text
    .replace(/\[SCORE:.*?\]/s, '')
    .replace(/\[FEEDBACK:.*?\]/s, '')
    .replace(/\[HIGHER_SCORE_TIP:.*?\]/s, '')
    .trim();
}

function extractCompletionData(content, assignment) {
  const replyText = typeof content === 'string' ? content.trim() : '';
  const scoreOptions = getAssignmentScoreOptions(assignment);
  const scoreMatch = replyText.match(/\[SCORE:(-?\d+)\]/);

  if (!scoreMatch) {
    return {
      finished: false,
      score: null,
      feedback: null,
      higherScoreTip: null,
      reply: replyText,
    };
  }

  const parsedScore = Number.parseInt(scoreMatch[1], 10);
  const score = getClosestAllowedScore(scoreOptions, parsedScore) ?? getLowestAllowedScore(scoreOptions);

  return {
    finished: true,
    score,
    feedback: extractTaggedValue(replyText, 'FEEDBACK'),
    higherScoreTip: extractTaggedValue(replyText, 'HIGHER_SCORE_TIP'),
    reply: stripCompletionTags(replyText),
  };
}

async function createChatReply(messages, options = {}) {
  const completion = await openai.chat.completions.create({
    model: MODEL_NAME,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 650,
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}

async function createForcedFinalReply(assignment, conversationMessages) {
  const attempts = [
    {
      temperature: 0.3,
      maxTokens: 420,
      systemPrompt: buildSystemPrompt(assignment, { shouldForceFinish: true }),
    },
    {
      temperature: 0,
      maxTokens: 420,
      systemPrompt: `${buildSystemPrompt(assignment, { shouldForceFinish: true })}

=== 출력 형식 재강조 ===
- 이번 응답은 마지막 응답이야.
- 추가 질문은 하지 마.
- 2~4문장으로 짧게 마무리한 뒤 아래 3줄을 반드시 포함해.
[SCORE:X]
[FEEDBACK:현재 점수를 준 이유]
[HIGHER_SCORE_TIP:더 높은 다음 점수를 받으려면 어떤 말을 더 했어야 하는지]`,
    },
  ];

  for (const attempt of attempts) {
    const reply = await createChatReply(
      [{ role: 'system', content: attempt.systemPrompt }, ...conversationMessages],
      { temperature: attempt.temperature, maxTokens: attempt.maxTokens }
    );
    const parsed = extractCompletionData(reply, assignment);

    if (parsed.finished) {
      return parsed;
    }
  }

  return null;
}

function buildFallbackCompletion(assignment, partialReply = '') {
  const scoreOptions = getAssignmentScoreOptions(assignment);
  const fallbackScore = getLowestAllowedScore(scoreOptions);
  const nextHigherScore = getNextHigherScore(scoreOptions, fallbackScore);

  return {
    finished: true,
    score: fallbackScore,
    feedback: '오늘 수업과 연결된 핵심 설명이 충분히 드러나지 않아 낮은 점수로 마무리했어.',
    higherScoreTip: nextHigherScore === null
      ? '이미 최고 점수야.'
      : `${nextHigherScore}점을 받으려면 장난이나 짧은 답으로 끝내지 말고, 오늘 배운 핵심이 무엇인지와 왜 그런지 또는 어떤 예시가 있는지 함께 설명해 줘.`,
    reply: partialReply || '여기까지 설명한 내용을 바탕으로 이번 대화는 마무리할게.',
  };
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
        { success: false, error: '세션이 유효하지 않습니다. 처음부터 다시 시작해 주세요.' },
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
        { success: false, error: '세션이 만료되었습니다. 처음부터 다시 시작해 주세요.' },
        { status: 401 }
      );
    }

    const existingMessages = Array.isArray(conversation.messages) ? conversation.messages : [];
    const studentTurnCount =
      existingMessages.filter((message) => message.role === 'student').length + 1;
    const shouldForceFinish = studentTurnCount >= MAX_STUDENT_TURNS;

    const conversationMessages = [
      ...existingMessages.map((message) => ({
        role: message.role === 'unicorn' ? 'assistant' : 'user',
        content: message.content,
      })),
      { role: 'user', content: userMessage },
    ];

    let parsedReply = extractCompletionData(
      await createChatReply(
        [
          { role: 'system', content: buildSystemPrompt(assignment, { shouldForceFinish }) },
          ...conversationMessages,
        ],
        { temperature: shouldForceFinish ? 0.35 : 0.7, maxTokens: 650 }
      ),
      assignment
    );

    if (shouldForceFinish && !parsedReply.finished) {
      const forcedFinalReply = await createForcedFinalReply(assignment, conversationMessages);
      if (forcedFinalReply) {
        parsedReply = forcedFinalReply;
      }
    }

    if (shouldForceFinish && !parsedReply.finished) {
      parsedReply = buildFallbackCompletion(assignment, parsedReply.reply);
    }

    const { reply, finished, score, feedback, higherScoreTip } = parsedReply;

    const updatedMessages = [
      ...existingMessages,
      { role: 'student', content: userMessage, timestamp: new Date().toISOString() },
      { role: 'unicorn', content: reply, timestamp: new Date().toISOString() },
    ];

    const updateData = { messages: updatedMessages };

    if (finished) {
      updateData.score = score;
      updateData.feedback = feedback;
      updateData.higherScoreTip = higherScoreTip;
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
      higherScoreTip,
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
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json({ success: false, error: '서버 오류' }, { status: 500 });
  }
}
