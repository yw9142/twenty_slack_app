import { defineLogicFunction } from 'twenty-sdk';

import { ANSWER_QUERY_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { answerCrmQuery } from 'src/utils/crm-query';
import { classifySlackText } from 'src/utils/intelligence';

const handler = async ({
  text,
}: {
  text: string;
}): Promise<Record<string, unknown>> => {
  const classification = await classifySlackText(text);
  const answer = await answerCrmQuery({
    classification,
    text,
  });

  return {
    classification,
    ...answer,
  };
};

export default defineLogicFunction({
  universalIdentifier: ANSWER_QUERY_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'answer-crm-query',
  description: 'Answers a CRM question using current Twenty workspace data',
  timeoutSeconds: 20,
  handler,
});
