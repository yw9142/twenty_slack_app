import { defineLogicFunction } from 'twenty-sdk';

import { PROCESS_INTAKE_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { processSlackRequestById } from 'src/utils/slack-orchestrator';

const handler = async ({
  slackRequestId,
}: {
  slackRequestId: string;
}): Promise<Record<string, unknown>> => {
  const slackRequest = await processSlackRequestById(slackRequestId);

  return {
    slackRequestId: slackRequest.id,
    processingStatus: slackRequest.processingStatus,
  };
};

export default defineLogicFunction({
  universalIdentifier: PROCESS_INTAKE_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'process-slack-intake',
  description: 'Processes a stored Slack 요청 record by id',
  timeoutSeconds: 20,
  handler,
});
