import OpenAI from 'openai';

import { FieldValue, adminDb, serializeDoc } from '../src/lib/serverDb.js';

const MODEL_NAME = 'gpt-4o-mini';

function formatScoreOptions(scoreOptions) {
  return scoreOptions.join(', ');
}

function getClosestAllowedScore(scoreOptions, proposedScore) {
  if (!Number.isFinite(proposedScore) || !Array.isArray(scoreOptions) || scoreOptions.length === 0) {
    return null;
  }

  return scoreOptions.reduce((closest, candidate) => {
    if (closest === null) {
      return candidate;
    }

    const currentDistance = Math.abs(candidate - proposedScore);
    const closestDistance = Math.abs(closest - proposedScore);

    if (currentDistance < closestDistance) {
      return candidate;
    }

    if (currentDistance === closestDistance && candidate < closest) {
      return candidate;
    }

    return closest;
  }, null);
}

function parseJsonResponse(content) {
  if (typeof content !== 'string') {
    return null;
  }

  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [trimmed];
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    candidates.unshift(fencedMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // Try the next candidate.
    }
  }

  return null;
}

function buildConversationTranscript(messages) {
  return messages
    .map((message, index) => {
      const speaker = message.role === 'student' ? '학생' : '유니콘';
      return `${index + 1}. ${speaker}: ${String(message.content ?? '').trim()}`;
    })
    .join('\n');
}

function buildArtEvaluationPrompt(assignment) {
  const scoreOptions = Array.isArray(assignment.scoreOptions) && assignment.scoreOptions.length > 0
    ? assignment.scoreOptions
    : [0, 1, 2, 3, 4, 5];
  const maxScore = scoreOptions[scoreOptions.length - 1];

  const paintingInfo = [
    `- 작품명: ${assignment.paintingTitle || assignment.title}`,
    assignment.artist ? `- 작가: ${assignment.artist}` : null,
    assignment.year ? `- 제작 연도: ${assignment.year}` : null,
    assignment.paintingContext ? `- 배경 정보: ${assignment.paintingContext}` : null,
    assignment.appreciationPrompt ? `- 감상 목표: ${assignment.appreciationPrompt}` : null,
    assignment.difficultyPrompt ? `- 질문 난이도: ${assignment.difficultyPrompt}` : null,
  ].filter(Boolean).join('\n');

  return `너는 미술 감상 대화의 최종 채점기다.
반드시 JSON 객체만 출력하고, 마크다운이나 코드블록은 쓰지 마.

채점 기준:
- 허용 점수는 ${formatScoreOptions(scoreOptions)}점뿐이다.
- 정확한 미술 지식보다 감상의 깊이를 본다.
- 학생이 작품을 구체적으로 관찰했는지, 표현 방법을 분석했는지, 작가의 감정이나 이야기를 해석했는지, 자신의 판단과 근거를 말했는지를 함께 본다.
- reachedStage는 가장 높게 도달한 감상 단계다.
  1: 보이는 것 관찰
  2: 표현 방법이나 색, 구도 분석
  3: 작가 감정, 분위기, 이야기 해석
  4: 자기 판단과 근거까지 표현
- reply는 학생에게 보내는 2~4문장 마무리 말이다. 질문형으로 끝내지 마.
- feedback는 왜 그 점수를 주었는지 1~2문장으로 구체적으로 설명한다.
- nextStepTip는 다음 그림 감상에서 바로 시도할 수 있는 한 가지를 제안한다.
- 최고 점수는 ${maxScore}점이다.
- 학생 답이 짧거나 서툴러도 실제로 관찰, 분석, 해석, 판단이 드러나면 그 깊이를 인정한다.
- 마지막 유니콘 말이 질문으로 끝났더라도, 그것만으로 자동 0점을 주지 마. 학생이 마지막으로 남긴 감상 내용 자체를 중심으로 평가해.

작품 정보:
${paintingInfo}

반드시 아래 형태의 JSON만 출력해.
{"reply":"string","score":0,"reachedStage":1,"feedback":"string","nextStepTip":"string"}`;
}

function normalizeArtEvaluation(payload, assignment) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const scoreOptions = Array.isArray(assignment.scoreOptions) && assignment.scoreOptions.length > 0
    ? assignment.scoreOptions
    : [0, 1, 2, 3, 4, 5];

  const score = getClosestAllowedScore(scoreOptions, Number(payload.score));
  const reply = typeof payload.reply === 'string' ? payload.reply.trim() : '';
  const feedback = typeof payload.feedback === 'string' ? payload.feedback.trim() : '';
  const nextStepTip = typeof payload.nextStepTip === 'string' ? payload.nextStepTip.trim() : '';
  const reachedStage = Number.parseInt(payload.reachedStage, 10);

  if (!Number.isFinite(score) || !reply || !feedback) {
    return null;
  }

  return {
    score,
    reply,
    feedback,
    nextStepTip,
    reachedStage: reachedStage >= 1 && reachedStage <= 4 ? reachedStage : null,
  };
}

async function resolveAssignment(codeOrId) {
  const directSnap = await adminDb.collection('assignments').doc(codeOrId).get();
  if (directSnap.exists) {
    return { id: directSnap.id, ...directSnap.data() };
  }

  const querySnap = await adminDb
    .collection('assignments')
    .where('entryCode', '==', String(codeOrId).toUpperCase())
    .limit(1)
    .get();

  if (querySnap.empty) {
    return null;
  }

  return serializeDoc(querySnap.docs[0]);
}

function buildUpdatedMessages(existingMessages, finalReply) {
  const messages = Array.isArray(existingMessages) ? [...existingMessages] : [];
  const lastIndex = messages.length - 1;

  if (lastIndex >= 0 && messages[lastIndex]?.role === 'unicorn') {
    messages[lastIndex] = {
      ...messages[lastIndex],
      content: finalReply,
    };
    return messages;
  }

  messages.push({
    role: 'unicorn',
    content: finalReply,
    timestamp: new Date().toISOString(),
  });
  return messages;
}

async function evaluateConversation(openai, assignment, conversation) {
  const transcript = buildConversationTranscript(conversation.messages || []);
  const raw = await openai.chat.completions.create({
    model: MODEL_NAME,
    response_format: { type: 'json_object' },
    temperature: 0,
    max_tokens: 420,
    messages: [
      { role: 'system', content: buildArtEvaluationPrompt(assignment) },
      {
        role: 'user',
        content: `아래 대화는 이미 마지막 학생 답변까지 끝난 상태야. 추가 질문 없이 이 대화 자체만 보고 최종 평가해.\n\n${transcript}`,
      },
    ],
  });

  const content = raw.choices[0]?.message?.content?.trim() || '';
  return normalizeArtEvaluation(parseJsonResponse(content), assignment);
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const includeApproved = args.includes('--include-approved');
  const codeOrId = args.find((arg) => !arg.startsWith('--'));

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing.');
  }

  if (!codeOrId) {
    console.error('Usage: node scripts/regrade_art_assignment.mjs <entryCodeOrAssignmentId> [--apply] [--include-approved]');
    process.exit(1);
  }

  const assignment = await resolveAssignment(codeOrId);
  if (!assignment) {
    throw new Error(`Assignment not found: ${codeOrId}`);
  }

  if (assignment.type !== 'art') {
    throw new Error(`Assignment ${assignment.id} is not an art assignment.`);
  }

  const conversationsSnap = await adminDb
    .collection('conversations')
    .where('assignmentId', '==', assignment.id)
    .get();

  const allConversations = conversationsSnap.docs.map(serializeDoc);
  const completed = allConversations.filter((conversation) => conversation.status === 'completed');
  const zeroScoreCompleted = completed.filter((conversation) => conversation.score === 0);
  const approvedZero = zeroScoreCompleted.filter((conversation) => conversation.approved === true);
  const targets = zeroScoreCompleted.filter(
    (conversation) => includeApproved || conversation.approved !== true
  );

  console.log(JSON.stringify({
    assignment: {
      id: assignment.id,
      entryCode: assignment.entryCode,
      title: assignment.title,
      scoreOptions: assignment.scoreOptions,
    },
    counts: {
      all: allConversations.length,
      completed: completed.length,
      zeroScoreCompleted: zeroScoreCompleted.length,
      approvedZero: approvedZero.length,
      targets: targets.length,
    },
    mode: apply ? 'apply' : 'dry-run',
  }, null, 2));

  if (targets.length === 0) {
    return;
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const results = [];

  for (const conversation of targets) {
    const evaluation = await evaluateConversation(openai, assignment, conversation);
    if (!evaluation) {
      results.push({
        id: conversation.id,
        studentCode: conversation.studentCode,
        status: 'parse_failed',
      });
      continue;
    }

    results.push({
      id: conversation.id,
      studentCode: conversation.studentCode,
      approved: conversation.approved === true,
      oldScore: conversation.score,
      newScore: evaluation.score,
      reachedStage: evaluation.reachedStage,
      feedback: evaluation.feedback,
      nextStepTip: evaluation.nextStepTip,
      reply: evaluation.reply,
    });

    if (!apply) {
      continue;
    }

    const updatedMessages = buildUpdatedMessages(conversation.messages, evaluation.reply);

    await adminDb.collection('conversations').doc(conversation.id).update({
      score: evaluation.score,
      feedback: evaluation.feedback,
      nextStepTip: evaluation.nextStepTip,
      higherScoreTip: '',
      reachedStage: evaluation.reachedStage,
      messages: updatedMessages,
      regradedAt: FieldValue.serverTimestamp(),
      regradeSource: 'structured_art_final_evaluator_v1',
      regradePreviousScore: conversation.score ?? null,
      regradePreviousFeedback: conversation.feedback ?? null,
      regradePreviousNextStepTip: conversation.nextStepTip ?? null,
      regradePreviousFinalReply: Array.isArray(conversation.messages) && conversation.messages.length > 0
        ? conversation.messages[conversation.messages.length - 1]?.content ?? null
        : null,
    });
  }

  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
