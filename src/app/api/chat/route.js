import { NextResponse } from 'next/server';
import OpenAI from 'openai';

import { getArtPromptPaintingInfoLines } from '@/lib/artAssignment';
import { CHAT_SESSION_COOKIE, hashChatSessionToken } from '@/lib/chatSession';
import { getUtf8ByteLength, normalizeAssignmentConstraints } from '@/lib/chatConstraints';
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

const IMAGE_FETCH_TIMEOUT_MS = 8000;
const IMAGE_FAILURE_TTL_MS = 60000;

// OpenAI가 외부 CDN에서 이미지를 직접 받다가 "Timeout while downloading"으로
// 실패하는 것을 막기 위해, 서버에서 직접 받아 base64 data URL로 변환해 넘긴다.
// 성공은 영구 캐시, 실패는 짧은 TTL로 음수 캐시해 매 턴 재시도를 피한다.
const imageDataUrlCache = new Map();

async function fetchImageAsDataUrl(rawImageUrl) {
  const imageUrl = typeof rawImageUrl === 'string' ? rawImageUrl.trim() : '';
  if (!imageUrl || !imageUrl.startsWith('http')) {
    return null;
  }

  const cached = imageDataUrlCache.get(imageUrl);
  if (cached) {
    if (cached.dataUrl) {
      return cached.dataUrl;
    }
    if (Date.now() - cached.failedAt < IMAGE_FAILURE_TTL_MS) {
      return null;
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`이미지 응답 상태 ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    const base64 = Buffer.from(await response.arrayBuffer()).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;
    imageDataUrlCache.set(imageUrl, { dataUrl });
    return dataUrl;
  } catch (error) {
    console.warn('Art image fetch failed; falling back to text-only.', {
      imageUrl,
      message: error?.message || 'unknown error',
    });
    imageDataUrlCache.set(imageUrl, { dataUrl: null, failedAt: Date.now() });
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

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
  const { shouldForceFinish = false, allowFinish = true, maxTurns = 3 } = options;
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
[HIGHER_SCORE_TIP:더 높은 다음 점수를 받으려면 어떤 말이나 이유나 예시를 더 말했어야 했는지 1~2문장으로 구체적으로 설명. 학생이 그대로 참고할 수 있는 예시 문장을 큰따옴표 안에 1개 포함해. 이미 최고점이면 '이미 최고 점수야.'라고 써.]

=== 중요 ===
- 학생 발화 기회는 최대 ${maxTurns}번이야.
- ${maxTurns}번째 학생 답변 뒤에는 반드시 마무리해야 해.
- HIGHER_SCORE_TIP에는 막연한 조언 말고, 학생이 실제로 어떤 내용을 더 말했어야 하는지 써.
- 최고점이 아니라면 HIGHER_SCORE_TIP에 "예시 답변 문장"을 반드시 큰따옴표로 넣어. 예: "분수는 전체를 똑같이 나눈 것 중 몇 부분인지 나타내는 수야."
- HIGHER_SCORE_TIP도 오늘 수업 범위를 벗어나면 안 돼.
- 학생이 "모르겠어"처럼 짧게 답해도 남은 내용으로 평가하고 마무리해.
- ${shouldForceFinish ? '이번 응답은 마지막 응답이야. 질문하지 말고 바로 마무리해.' : allowFinish ? '학생이 충분히 설명했거나 턴이 거의 다 찼다면 더 캐묻지 말고 종료해.' : `아직 학생 답변이 충분히 쌓이지 않았어. [SCORE], [FEEDBACK], [HIGHER_SCORE_TIP] 태그를 절대 사용하지 말고, 핵심이 부족한 부분을 한두 가지만 짧게 더 물어봐.`}`;
}

function buildArtSystemPrompt(assignment, options = {}) {
  const { shouldForceFinish = false, allowFinish = true, maxTurns = 5 } = options;
  const scoreOptions = getAssignmentScoreOptions(assignment);
  const maxScore = getAssignmentMaxScore(assignment);
  const lowestScore = getLowestAllowedScore(scoreOptions);

  const paintingInfo = getArtPromptPaintingInfoLines(assignment).join('\n') || '?묓뭹 ?뺣낫媛 誘몃━ 怨듦컻?섏? ?딆븯?듬땲??';

  const paintingKnowledge = assignment.paintingContext
    ? `\n=== 이 작품에 대한 배경 지식 (학생에게 직접 알려주지 말고, 대화를 이끌 때 참고만 해) ===\n${assignment.paintingContext}`
    : '';

  return `너는 "미술 유니콘"이라는 이름의 다정하고 호기심 많은 미술 감상 친구야.
이건 시험이 아니야. 학생이 그림을 보고 자유롭게 이야기하면서 즐기는 시간이야.
맞장구를 치며 자연스럽게 더 깊이 생각하도록 이끌어 줘.
"정답"은 없어. 학생 자신만의 느낌과 생각이 가장 소중해.
너는 이 명화에 대해 잘 알고 있지만, 학생에게 지식을 가르치는 게 아니라 함께 즐기며 스스로 발견하게 도와주는 역할이야.

=== 감상할 작품 ===
${paintingInfo}${paintingKnowledge}

=== 이번 감상 목표 ===
${assignment.appreciationPrompt || '네 단계를 자연스럽게 안내해.'}

=== 감상 흐름 (자연스럽게 안내하되, 단계 이름을 학생에게 굳이 알려주지 않아도 돼) ===
1단계: 무엇이 보이는지 찾아보기
  → "이 그림에서 뭐가 제일 먼저 눈에 들어와?", "어떤 색이 많이 보여?" 같은 질문.
  → 색깔, 사람, 동물, 물건, 배경 등 보이는 걸 자유롭게 말하게 해.
  → 학생이 뭘 하나라도 말하면 "오, 잘 봤다!" 하고 맞장구.

2단계: 어떻게 그렸는지 살펴보기
  → "이 부분은 왜 이렇게 밝은(어두운) 것 같아?", "선이 어떤 느낌이야?" 같은 질문.
  → 색 사용, 밝기, 붓 터치, 구도(화면 배치) 등을 탐색하게 해.
  → 어려운 용어 대신 "밝다/어둡다, 부드럽다/거칠다, 가운데/가장자리" 같은 쉬운 말 사용.

3단계: 작가의 마음 상상해보기
  → "이 그림을 그릴 때 작가 기분이 어땠을 것 같아?", "이 그림이 무슨 이야기를 하고 있는 것 같아?" 같은 질문.
  → 학생의 상상이 엉뚱해도 OK! "재밌는 생각이다!" 하고 이유를 물어봐.

4단계: 작품에 대한 나만의 판단과 근거 말하기
  → 팰드만 감상 단계의 마지막인 판단/평가 단계야. 단순히 "마음에 들어/안 들어"만 묻지 말고, 작품이 무엇을 잘 표현했는지 학생이 자기 생각으로 판단하게 해.
  → 사용할 수 있는 질문 예시:
     "이 작품은 즐거운 순간을 잘 표현한 작품이라고 생각해? 왜 그렇게 생각해?"
     "이 그림이 보는 사람에게 어떤 좋은 점이나 가치를 전해 준다고 생각해?"
     "네가 마음에 든 부분이 작품 전체의 분위기나 이야기를 어떻게 잘 보여준다고 생각해?"
     "이 작품에서 잘 표현된 점이나 조금 아쉬운 점이 있다면 뭐라고 생각해?"
  → 질문 예시는 한 번에 하나만 사용해.
  → 학생이 작품에 대한 판단을 말하고, 그 이유를 그림 속 색, 표정, 인물의 행동, 배경, 구도, 분위기, 이야기 중 하나와 연결하면 4단계로 인정해.
  → 예: "좋은 작품이라고 생각해. 네 사람이 모두 라켓을 들고 함께 운동해서 가족의 즐거움이 잘 느껴지기 때문이야."
  → 예: "즐거운 추억을 잘 표현한 작품 같아. 밝은 하늘과 웃는 표정 때문에 행복한 분위기가 잘 느껴져."
  → 예: "가장 마음에 드는 모습은 4명이 모두 라켓을 들고 운동을 한다는 거야. 누군가 빠지지 않고 함께 참여하는 모습이 참 좋아."처럼 작품 속 근거와 가치 판단이 연결되면 4단계로 인정해.
  → 학생이 "좋다/싫다/마음에 든다"만 말하면 "그렇게 느낀 이유를 그림 속에서 하나 찾아볼까?" 하고 부드럽게 물어봐.

=== 대화 원칙 ===
- 한 번에 질문은 딱 1개만. 여러 개 동시에 던지지 마.
- 서두르지 마. 학생이 한 단계에서 충분히 이야기하고 싶어 하면 거기서 더 머물러도 돼.
- 학생이 막히면: "힌트를 줄까?" 하고, 더 쉬운 질문으로 내려가.
- 학생이 잘 답하면: 그 말을 인정("오! 그렇구나~")한 뒤 자연스럽게 다음 흐름으로.
- "틀렸어"는 절대 금지. "그렇게 볼 수도 있겠다! 그러면 이건 어때?" 식으로.
- "네가 말한 것처럼~"으로 학생 답변을 반영하면 학생이 자신감을 가져.
- 학생이 한 말에 대해 이 작품과 관련된 배경 지식으로 맞장구를 칠 수 있어. 단, 지식을 일방적으로 전달하지 마.
- 대화가 즐거운 수다처럼 흘러가게 해. 학생이 "더 하고 싶다"고 느끼면 성공이야.

=== 질문 난이도: ${assignment.difficultyLabel || '중급'} ===
${assignment.difficultyPrompt || '쉬운 말로 질문하되 스스로 생각하도록 유도해.'}

=== 채점 기준: 감상의 깊이 ===
- 사용할 수 있는 점수는 ${formatScoreOptions(scoreOptions)}점뿐이야.
- **정확한 미술 지식이 아니라 "감상이 얼마나 깊었느냐"로 점수를 줘.**
- 감상의 깊이란:
  · 작품을 구체적으로 관찰했는가 (예: 색깔, 형태, 인물, 배경 등을 구체적으로 언급)
  · 표현 방법을 인식했는가 (예: 색의 밝고 어두움, 선의 느낌, 화면 배치, 표정과 자세가 주는 느낌 등)
  · 자기 나름의 의미를 찾으려 했는가 (예: 작가의 마음, 그림의 이야기, 분위기, 추억, 메시지)
  · 작품에 대한 자기 판단을 근거와 함께 표현했는가 (예: "이 작품은 ~을 잘 표현한 것 같아. 왜냐하면 그림 속 ~ 때문이야.")

- reachedStage와 score는 분리해서 판단해.
- reachedStage는 학생이 감상 대화에서 어디까지 도달했는지를 나타낸다.
- score는 같은 단계 안에서도 구체성, 근거, 자기 말 표현의 깊이에 따라 달라질 수 있다.

- reachedStage 판정:
  · 1단계: 보이는 대상, 색, 사람, 사물, 배경 등 작품 속 요소를 말함.
  · 2단계: 색, 밝기, 선, 배치, 크기, 표정, 자세 등 표현 방법이 주는 느낌을 말함.
  · 3단계: 작가의 마음, 그림 속 이야기, 분위기, 추억, 의미를 상상함.
  · 4단계: 작품에 대한 자기 판단을 말하고, 그 이유를 그림 속 요소나 표현 방식과 연결함.

- 4단계 인정 기준:
  · 학생이 "좋은 작품이다", "잘 표현했다", "인상적이다", "따뜻하다", "아쉽다", "가치가 있다", "마음에 든다"처럼 작품에 대한 판단을 말하고,
  · 그 이유를 색, 표정, 행동, 구도, 배경, 분위기, 이야기 등 작품 속 근거와 연결하면 4단계로 인정해.
  · 예: "네 사람이 모두 함께 운동하고 있어서 가족의 즐거움을 잘 표현한 좋은 작품이라고 생각해."
  · 예: "밝은 색과 웃는 표정 때문에 행복한 추억을 잘 보여 주는 작품이라고 생각해."
  · 예: "가장 마음에 드는 모습은 4명이 모두 라켓을 들고 운동을 한다는 거야. 누군가 빠지지 않고 함께 참여하는 모습이 참 좋아."
  · 단순히 "좋다", "예쁘다", "마음에 든다"만 있고 이유가 없으면 4단계로 보지 말고 3단계 이하로 판단해.
  · 하지만 "마음에 드는 이유"를 작품 속 요소와 연결하면 4단계로 인정해.

- 점수 판정:
  · 1단계까지만 도달: 낮은 점수 범위
  · 2단계까지 도달: 중하 점수 범위
  · 3단계까지 도달: 중상 점수 범위
  · 4단계까지 도달: 높은 점수 범위
  · 최고점 ${maxScore}점은 4단계에 도달했고, 관찰·분석·해석·판단이 구체적으로 연결될 때 줘.
  · 4단계에 도달했더라도 근거가 짧거나 단순하면 최고점보다 낮은 높은 점수를 줄 수 있어.
- 같은 단계라도 더 구체적이고 자기만의 표현이 있으면 높은 점수를 줘.
- 틀린 해석이라도 진지하게 자기 생각을 말했으면 그 깊이를 인정해.
- 최저 ${lowestScore}점: 그림과 완전히 무관한 장난이나 반복된 무의미한 말에만 써. 조금이라도 그림을 보고 자기 생각을 이야기했다면 ${lowestScore}점 대신 그 위 점수를 줘.

=== 마무리 형식 ===
대화를 마무리할 때는 학생이 오늘 감상에서 발견한 것들을 따뜻하게 요약해 줘.
마지막 줄들에 아래 태그를 정확히 넣어.

[SCORE:X]
[REACHED_STAGE:도달한 가장 높은 단계 번호(1~4)]
[FEEDBACK:X점을 준 이유를 구체적으로. 예: "4단계까지 도달했어. 색과 분위기를 관찰하고, 작가의 즐거운 추억을 상상했으며, 모두가 함께 운동하는 모습이 좋다는 판단을 그림 속 근거와 연결했기 때문에 높은 점수를 주었어." 아직 4단계가 아니면 어떤 판단과 근거가 부족했는지 설명해.]
[NEXT_STEP_TIP:다음에 그림을 볼 때 스스로 해볼 수 있는 질문이나 시도를 구체적으로 제안. 최고점이 아니라면 점수가 더 오를 수 있었던 학생 답변 예시를 큰따옴표 안에 1개 포함해. 최고점이면 '정말 깊이 있는 감상이었어!']

=== 중요 ===
- 학생 발화 기회는 최대 ${maxTurns}번이야.
- ${maxTurns}번째 답변 뒤에는 반드시 마무리해야 해.
- 학생이 "몰라요"처럼 짧게 답해도 지금까지 한 말을 바탕으로 평가하고 마무리해.
- ${shouldForceFinish ? '이번은 마지막 응답이야. 질문하지 말고 바로 마무리해.' : allowFinish ? '학생이 충분히 감상했거나 턴이 거의 다 찼다면 자연스럽게 마무리해.' : '[SCORE], [REACHED_STAGE], [FEEDBACK], [NEXT_STEP_TIP] 태그를 절대 사용하지 말고, 대화를 자연스럽게 이어가.'}`;
}

function extractTaggedValue(text, tagName) {
  const pattern = new RegExp(`\\[${tagName}:(.*?)\\]`, 's');
  const match = text.match(pattern);
  return match ? match[1].trim() : '';
}

function stripCompletionTags(text) {
  return text
    .replace(/\[SCORE:.*?\]/s, '')
    .replace(/\[REACHED_STAGE:.*?\]/s, '')
    .replace(/\[FEEDBACK:.*?\]/s, '')
    .replace(/\[HIGHER_SCORE_TIP:.*?\]/s, '')
    .replace(/\[NEXT_STEP_TIP:.*?\]/s, '')
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

  const reachedStageRaw = extractTaggedValue(replyText, 'REACHED_STAGE');
  const reachedStage = reachedStageRaw ? Number.parseInt(reachedStageRaw, 10) || null : null;

  return {
    finished: true,
    score,
    reachedStage,
    feedback: extractTaggedValue(replyText, 'FEEDBACK'),
    higherScoreTip: extractTaggedValue(replyText, 'HIGHER_SCORE_TIP'),
    nextStepTip: extractTaggedValue(replyText, 'NEXT_STEP_TIP'),
    reply: stripCompletionTags(replyText),
  };
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
      // Keep trying the next candidate.
    }
  }

  return null;
}

function buildConversationTranscript(conversationMessages) {
  return conversationMessages
    .map((message, index) => {
      const speaker = message.role === 'user' ? '학생' : '유니콘';
      return `${index + 1}. ${speaker}: ${String(message.content ?? '').trim()}`;
    })
    .join('\n');
}

function normalizeStructuredFinalReply(payload, assignment) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const scoreOptions = getAssignmentScoreOptions(assignment);
  const score = getClosestAllowedScore(scoreOptions, Number(payload.score));
  const reply = typeof payload.reply === 'string' ? payload.reply.trim() : '';
  const feedback = typeof payload.feedback === 'string' ? payload.feedback.trim() : '';

  if (!Number.isFinite(score) || !reply || !feedback) {
    return null;
  }

  const result = {
    finished: true,
    score,
    feedback,
    reply,
    higherScoreTip: '',
    nextStepTip: '',
    reachedStage: null,
  };

  if (assignment.type === 'art') {
    const reachedStage = Number.parseInt(payload.reachedStage, 10);
    result.reachedStage = reachedStage >= 1 && reachedStage <= 4 ? reachedStage : null;
    result.nextStepTip =
      typeof payload.nextStepTip === 'string' ? payload.nextStepTip.trim() : '';
  } else {
    result.higherScoreTip =
      typeof payload.higherScoreTip === 'string' ? payload.higherScoreTip.trim() : '';
  }

  return result;
}

async function createChatReply(messages, options = {}) {
  const completion = await openai.chat.completions.create({
    model: MODEL_NAME,
    messages,
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 650,
    ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
  });

  return completion.choices[0]?.message?.content?.trim() || '';
}

function buildForcedFinalEvaluationPrompt(assignment) {
  const scoreOptions = getAssignmentScoreOptions(assignment);
  const maxScore = getAssignmentMaxScore(assignment);

  if (assignment.type === 'art') {
    const paintingInfo =
      getArtPromptPaintingInfoLines(assignment)
        .map((line) => `- ${line}`)
        .join('\n') || '- 작품 정보 비공개';

    return `너는 미술 감상 대화의 최종 채점기다.
반드시 JSON 객체만 출력하고, 마크다운이나 코드블록은 쓰지 마.

채점 기준:
- 허용 점수는 ${formatScoreOptions(scoreOptions)}점뿐이다.
- 정확한 미술 지식보다 감상의 깊이를 본다.
- 학생이 작품을 구체적으로 관찰했는지, 표현 방법을 분석했는지, 작가의 감정이나 이야기를 해석했는지, 자신의 판단과 근거를 말했는지를 함께 본다.
- reachedStage는 가장 높게 도달한 감상 단계다.
  1: 보이는 것 관찰
  2: 표현 방법이나 색, 구도, 표정, 자세, 배치 등이 주는 느낌 분석
  3: 작가 감정, 분위기, 이야기, 추억, 의미 해석
  4: 작품에 대한 자기 판단과 그 근거까지 표현

- 4단계 판정 기준:
  학생이 작품을 "좋다", "인상적이다", "잘 표현했다", "따뜻하다", "가치 있다", "아쉽다", "마음에 든다"처럼 평가하고,
  그 이유를 그림 속 색, 표정, 인물의 행동, 배경, 구도, 분위기, 이야기 중 하나와 연결하면 reachedStage는 4다.
  "마음에 든다"는 말도 이유가 작품 속 요소와 연결되어 있으면 4단계로 인정한다.
  예: "가장 마음에 드는 모습은 4명이 모두 라켓을 들고 운동을 한다는 거야. 누군가 빠지지 않고 가족 체육 활동에 열심히 참여하고 있는 모습이 참 좋아."
  단순히 "좋다", "예쁘다", "마음에 든다"만 있고 이유가 없으면 4단계로 보지 않는다.
  제목을 새로 짓는 답변은 창의적 해석으로 볼 수 있지만, 작품에 대한 가치 판단과 근거가 함께 있지 않으면 그것만으로는 4단계로 보지 않는다.

- score는 reachedStage와 완전히 동일하지 않다.
  4단계에 도달했더라도 근거가 짧거나 단순하면 최고점보다 낮을 수 있다.
  최고점 ${maxScore}점은 관찰, 분석, 해석, 판단이 모두 구체적으로 이어질 때 준다.
- reply는 학생에게 보내는 2~4문장 마무리 말이다. 질문형으로 끝내지 마.
- feedback는 왜 그 점수를 주었는지 1~2문장으로 구체적으로 설명한다.
- nextStepTip는 다음 그림 감상에서 바로 시도할 수 있는 한 가지를 제안한다.
- 최고점이 아니라면 nextStepTip에 학생이 그대로 참고할 수 있는 예시 답변 문장을 큰따옴표 안에 1개 포함한다.
- 예: "밝은 색과 웃는 표정 때문에 가족이 함께하는 즐거움이 잘 느껴져서 좋은 작품이라고 생각해."
- 최고 점수는 ${maxScore}점이다.
- 학생이 조금이라도 그림을 보고 자기 생각을 말했다면 0점을 주지 마라.

작품 정보:
${paintingInfo}

반드시 아래 형태의 JSON만 출력해.
{"reply":"string","score":0,"reachedStage":1,"feedback":"string","nextStepTip":"string"}`;
  }

  return `너는 학습 대화의 최종 채점기다.
반드시 JSON 객체만 출력하고, 마크다운이나 코드블록은 쓰지 마.

채점 기준:
- 허용 점수는 ${formatScoreOptions(scoreOptions)}점뿐이다.
- 학생이 오늘 배운 개념을 자신의 말로 얼마나 정확하고 구체적으로 설명했는지 평가한다.
- reply는 학생에게 보내는 2~4문장 마무리 말이다. 질문형으로 끝내지 마.
- feedback는 왜 그 점수를 주었는지 1~2문장으로 설명한다.
- higherScoreTip는 다음 점수를 받으려면 무엇을 더 말했어야 하는지 구체적으로 적는다.
- 최고점이 아니라면 higherScoreTip에 학생이 그대로 참고할 수 있는 예시 답변 문장을 큰따옴표 안에 1개 포함한다.
- 최고 점수는 ${maxScore}점이다.

반드시 아래 형태의 JSON만 출력해.
{"reply":"string","score":0,"feedback":"string","higherScoreTip":"string"}`;
}

async function createForcedFinalReply(assignment, conversationMessages, artPrimingMessages = []) {
  const isArt = assignment.type === 'art';
  const buildPrompt = isArt ? buildArtSystemPrompt : buildSystemPrompt;
  const { maxTurns } = normalizeAssignmentConstraints(assignment);
  const reachedStageTag = isArt ? '\n[REACHED_STAGE:도달한 가장 높은 단계 번호(1~4)]' : '';
  const tipTag = isArt ? 'NEXT_STEP_TIP' : 'HIGHER_SCORE_TIP';
  const tipDesc = isArt
    ? '다음에 그림을 볼 때 스스로 해볼 수 있는 질문이나 시도. 최고점이 아니라면 점수가 더 오를 수 있었던 학생 답변 예시를 큰따옴표 안에 1개 포함'
    : '더 높은 다음 점수를 받으려면 어떤 말을 더 했어야 하는지. 최고점이 아니라면 학생 답변 예시를 큰따옴표 안에 1개 포함';

  const attempts = [
    {
      temperature: 0.3,
      maxTokens: 420,
      systemPrompt: buildPrompt(assignment, { shouldForceFinish: true, maxTurns }),
    },
    {
      temperature: 0,
      maxTokens: 420,
      systemPrompt: `${buildPrompt(assignment, { shouldForceFinish: true, maxTurns })}

=== 출력 형식 재강조 ===
- 이번 응답은 마지막 응답이야.
- 추가 질문은 하지 마.
- 2~4문장으로 짧게 마무리한 뒤 아래 태그를 반드시 포함해.
[SCORE:X]${reachedStageTag}
[FEEDBACK:현재 점수를 준 이유]
[${tipTag}:${tipDesc}]`,
    },
  ];

  for (const attempt of attempts) {
    const reply = await createChatReply(
      [{ role: 'system', content: attempt.systemPrompt }, ...artPrimingMessages, ...conversationMessages],
      { temperature: attempt.temperature, maxTokens: attempt.maxTokens }
    );
    const parsed = extractCompletionData(reply, assignment);

    if (parsed.finished) {
      return parsed;
    }
  }

  return null;
}

async function createStructuredForcedFinalReply(assignment, conversationMessages) {
  const transcript = buildConversationTranscript(conversationMessages);
  const dataUrl = assignment.type === 'art' ? await fetchImageAsDataUrl(assignment?.imageUrl) : null;
  const hasImage = Boolean(dataUrl);

  const evalUserContent = hasImage
    ? [
        { type: 'text', text: '이 작품을 직접 확인하고 아래 대화를 평가해 주세요:' },
        { type: 'image_url', image_url: { url: dataUrl } },
        { type: 'text', text: `\n아래 대화는 이미 마지막 학생 답변까지 끝난 상태야. 추가 질문 없이 이 대화 자체만 보고 최종 평가해.\n\n${transcript}` },
      ]
    : `아래 대화는 이미 마지막 학생 답변까지 끝난 상태야. 추가 질문 없이 이 대화 자체만 보고 최종 평가해.\n\n${transcript}`;

  const attempts = [
    { temperature: 0, maxTokens: 360 },
    { temperature: 0.2, maxTokens: 420 },
  ];

  for (const attempt of attempts) {
    const reply = await createChatReply(
      [
        { role: 'system', content: buildForcedFinalEvaluationPrompt(assignment) },
        { role: 'user', content: evalUserContent },
      ],
      {
        temperature: attempt.temperature,
        maxTokens: attempt.maxTokens,
        responseFormat: { type: 'json_object' },
      }
    );

    const parsed = normalizeStructuredFinalReply(parseJsonResponse(reply), assignment);
    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function applyMinimumScore(score, scoreOptions, conversationMessages) {
  if (!Number.isFinite(score) || score !== scoreOptions[0] || scoreOptions.length < 2) {
    return score;
  }
  const totalStudentBytes = conversationMessages
    .filter((m) => m.role === 'user')
    .reduce((sum, m) => sum + getUtf8ByteLength(String(m.content || '')), 0);
  return totalStudentBytes > 20 ? scoreOptions[1] : score;
}

async function buildArtImagePrimingMessages(assignment) {
  const dataUrl = await fetchImageAsDataUrl(assignment?.imageUrl);
  if (!dataUrl) return [];
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: '이것이 오늘 학생들이 감상하는 작품입니다. 잘 살펴봐 주세요.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ],
    },
    {
      role: 'assistant',
      content: '네, 작품을 확인했습니다. 학생과의 미술 감상 대화를 시작할게요.',
    },
  ];
}

function buildFallbackCompletion(assignment, partialReply = '') {
  const isArt = assignment.type === 'art';
  const scoreOptions = getAssignmentScoreOptions(assignment);
  const fallbackScore = scoreOptions.length >= 2 ? scoreOptions[1] : scoreOptions[0];
  const nextHigherScore = getNextHigherScore(scoreOptions, fallbackScore);
  const fallbackTip = isArt
    ? '다음에는 그림에서 가장 먼저 눈에 띈 부분 하나를 고르고, 왜 그렇게 느꼈는지 색이나 모양, 분위기를 붙여서 말해 보면 더 깊은 감상이 돼. 예를 들면 "밝은 색과 웃는 표정 때문에 가족이 함께하는 즐거움이 잘 느껴져."처럼 말할 수 있어.'
    : nextHigherScore === null
      ? '이미 최고 점수야.'
      : `${nextHigherScore}점을 받으려면 장난이나 짧은 답으로 끝내지 말고, 오늘 배운 핵심이 무엇인지와 왜 그런지 또는 어떤 예시가 있는지 함께 설명해 줘. 예를 들면 "오늘 배운 핵심은 ~이고, 그 이유는 ~이기 때문이야."처럼 말할 수 있어.`;

  return {
    finished: true,
    score: fallbackScore,
    feedback: '오늘 수업과 연결된 핵심 설명이 충분히 드러나지 않아 낮은 점수로 마무리했어.',
    higherScoreTip: isArt ? '' : fallbackTip,
    nextStepTip: isArt ? fallbackTip : '',
    reachedStage: null,
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
    const isArt = assignment.type === 'art';
    const chatConstraints = normalizeAssignmentConstraints(assignment);
    const effectiveMaxTurns = chatConstraints.maxTurns;
    const minTurns = chatConstraints.minTurns;
    const userMessageBytes = getUtf8ByteLength(userMessage);

    if (userMessageBytes < chatConstraints.minStudentMessageBytes) {
      return NextResponse.json(
        {
          success: false,
          error: `답변이 너무 짧아요. 최소 ${chatConstraints.minStudentMessageBytes}B 이상으로 적어 주세요.`,
          messageBytes: userMessageBytes,
          minStudentMessageBytes: chatConstraints.minStudentMessageBytes,
          maxStudentMessageBytes: chatConstraints.maxStudentMessageBytes,
        },
        { status: 400 }
      );
    }

    if (userMessageBytes > chatConstraints.maxStudentMessageBytes) {
      return NextResponse.json(
        {
          success: false,
          error: `답변이 너무 길어요. 최대 ${chatConstraints.maxStudentMessageBytes}B 안으로 적어 주세요.`,
          messageBytes: userMessageBytes,
          minStudentMessageBytes: chatConstraints.minStudentMessageBytes,
          maxStudentMessageBytes: chatConstraints.maxStudentMessageBytes,
        },
        { status: 400 }
      );
    }

    const shouldForceFinish = studentTurnCount >= effectiveMaxTurns;
    const allowFinish = studentTurnCount >= minTurns;

    const conversationMessages = [
      ...existingMessages.map((message) => ({
        role: message.role === 'unicorn' ? 'assistant' : 'user',
        content: message.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const artPrimingMessages = isArt ? await buildArtImagePrimingMessages(assignment) : [];

    const systemPrompt = isArt
      ? buildArtSystemPrompt(assignment, { shouldForceFinish, allowFinish, maxTurns: effectiveMaxTurns })
      : buildSystemPrompt(assignment, { shouldForceFinish, allowFinish, maxTurns: effectiveMaxTurns });

    let parsedReply = extractCompletionData(
      await createChatReply(
        [
          { role: 'system', content: systemPrompt },
          ...artPrimingMessages,
          ...conversationMessages,
        ],
        { temperature: shouldForceFinish ? 0.35 : 0.7, maxTokens: 650 }
      ),
      assignment
    );

    // 서버 사이드 가드: 최소 턴 미달 시 AI가 멋대로 종료하는 것을 차단
    if (parsedReply.finished && !allowFinish) {
      parsedReply = {
        finished: false,
        score: null,
        feedback: null,
        higherScoreTip: null,
        reply: parsedReply.reply || '조금 더 설명해 줄 수 있어? 어떤 부분이 특히 중요했는지 알려줘.',
      };
    }

    if (shouldForceFinish && !parsedReply.finished) {
      const forcedFinalReply =
        await createStructuredForcedFinalReply(assignment, conversationMessages) ||
        await createForcedFinalReply(assignment, conversationMessages, artPrimingMessages);
      if (forcedFinalReply) {
        parsedReply = forcedFinalReply;
      }
    }

    if (shouldForceFinish && !parsedReply.finished) {
      console.warn('Forced finalization fell back to default completion.', {
        assignmentId,
        conversationId,
        assignmentType: assignment.type || 'math',
      });
      parsedReply = buildFallbackCompletion(assignment, parsedReply.reply);
    }

    const scoreOptions = getAssignmentScoreOptions(assignment);
    if (parsedReply.finished && Number.isFinite(parsedReply.score)) {
      parsedReply = { ...parsedReply, score: applyMinimumScore(parsedReply.score, scoreOptions, conversationMessages) };
    }

    const { reply, finished, score, feedback, higherScoreTip, nextStepTip, reachedStage } = parsedReply;
    const safeFeedback = typeof feedback === 'string' ? feedback : '';
    const safeHigherScoreTip = typeof higherScoreTip === 'string' ? higherScoreTip : '';
    const safeNextStepTip = typeof nextStepTip === 'string' ? nextStepTip : '';

    const updatedMessages = [
      ...existingMessages,
      { role: 'student', content: userMessage, timestamp: new Date().toISOString() },
      { role: 'unicorn', content: reply, timestamp: new Date().toISOString() },
    ];

    const updateData = {
      messages: updatedMessages,
      studentMessageCount: studentTurnCount,
    };

    if (finished) {
      updateData.score = score;
      updateData.feedback = safeFeedback;
      updateData.higherScoreTip = safeHigherScoreTip;
      updateData.nextStepTip = safeNextStepTip;
      updateData.status = 'completed';
      updateData.approved = false;
      updateData.completedAt = FieldValue.serverTimestamp();
      updateData.sessionTokenHash = null;

      if (isArt && reachedStage) {
        updateData.reachedStage = reachedStage;
      }
    }

    await conversationRef.update(updateData);

    const remainingTurns = Math.max(0, effectiveMaxTurns - studentTurnCount);

    const response = NextResponse.json({
      success: true,
      reply,
      finished,
      score,
      feedback: safeFeedback,
      higherScoreTip: safeHigherScoreTip,
      nextStepTip: safeNextStepTip,
      remainingTurns,
      maxTurns: effectiveMaxTurns,
      currentTurn: studentTurnCount,
      ...(isArt && reachedStage ? { reachedStage } : {}),
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
    console.error('=== Chat API Error Details ===');
    console.error('Error message:', error?.message || 'Unknown error');
    console.error('Error name:', error?.name || 'Unknown');
    console.error('Error stack:', error?.stack || 'No stack trace');
    if (error?.response) {
      console.error('API Response status:', error.response.status);
      console.error('API Response data:', JSON.stringify(error.response.data, null, 2));
    }
    if (error?.code) {
      console.error('Error code:', error.code);
    }
    try {
      const bodyText = await request.clone().text();
      console.error('Request body:', bodyText);
    } catch (_) {
      console.error('Could not read request body');
    }
    console.error('=== End Chat API Error ===');
    return NextResponse.json(
      { success: false, error: `서버 오류: ${error?.message || '알 수 없는 오류'}` },
      { status: 500 }
    );
  }
}
