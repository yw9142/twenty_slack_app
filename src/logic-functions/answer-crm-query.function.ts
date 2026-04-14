import { ANSWER_QUERY_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { answerCrmQuery } from 'src/utils/crm-query';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { classifySlackTextWithDiagnostics } from 'src/utils/intelligence';

const handler = async ({
  text,
}: {
  text: string;
}): Promise<Record<string, unknown>> => {
  const classified = await classifySlackTextWithDiagnostics(text);
  const classification = classified.classification;
  const answer = await answerCrmQuery({
    classification,
    text,
  });

  return {
    classification,
    aiDiagnostics: {
      classification: classified.aiDiagnostics,
      ...(answer.resultJson?.aiDiagnostics &&
      typeof answer.resultJson.aiDiagnostics === 'object'
        ? (answer.resultJson.aiDiagnostics as Record<string, unknown>)
        : {}),
    },
    ...answer,
    text: answer.reply.text,
    blocks: answer.reply.blocks,
  };
};

export default defineLogicFunction({
  universalIdentifier: ANSWER_QUERY_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'answer-crm-query',
  description: 'Answers a CRM question using current Twenty workspace data',
  timeoutSeconds: 60,
  handler,
});
