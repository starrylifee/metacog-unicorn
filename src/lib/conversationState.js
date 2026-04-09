function getConversationMessages(conversation) {
  return Array.isArray(conversation?.messages) ? conversation.messages : [];
}

function isStudentRole(role) {
  return role === 'student' || role === 'user';
}

export function getStudentMessageCount(conversation) {
  const rawCount = conversation?.studentMessageCount;

  if (Number.isFinite(rawCount) && rawCount >= 0) {
    return rawCount;
  }

  return getConversationMessages(conversation).filter((message) => isStudentRole(message?.role)).length;
}

export function hasStudentStartedConversation(conversation) {
  return getStudentMessageCount(conversation) > 0;
}
