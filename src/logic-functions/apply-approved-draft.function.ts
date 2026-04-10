import { defineLogicFunction } from 'twenty-sdk';

import { APPLY_DRAFT_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { approveSlackRequest } from 'src/utils/slack-orchestrator';

const handler = async ({
  slackRequestId,
  approvedBySlackUserId,
}: {
  slackRequestId: string;
  approvedBySlackUserId?: string;
}): Promise<Record<string, unknown>> => {
  const slackRequest = await approveSlackRequest({
    slackRequestId,
    approvedBySlackUserId,
  });

  return {
    slackRequestId: slackRequest.id,
    processingStatus: slackRequest.processingStatus,
    resultJson: slackRequest.resultJson,
  };
};

export default defineLogicFunction({
  universalIdentifier: APPLY_DRAFT_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'apply-approved-draft',
  description: 'Applies an approved CRM write draft stored on Slack 요청',
  timeoutSeconds: 20,
  handler,
});
