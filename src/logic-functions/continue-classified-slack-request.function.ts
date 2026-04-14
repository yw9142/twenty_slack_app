import type {
  DatabaseEventPayload,
  ObjectRecordUpdateEvent,
} from 'twenty-sdk';

import { CONTINUE_CLASSIFIED_SLACK_REQUEST_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { processClassifiedSlackRequestById } from 'src/utils/slack-orchestrator';

const resolveSlackRequestId = (
  payload: {
    slackRequestId?: string;
    recordId?: string;
  },
): string => {
  if (typeof payload.slackRequestId === 'string') {
    return payload.slackRequestId;
  }

  if (typeof payload.recordId === 'string') {
    return payload.recordId;
  }

  throw new Error('slackRequestId or recordId is required');
};

const handler = async (
  payload:
    | {
        slackRequestId?: string;
        recordId?: string;
      }
    | DatabaseEventPayload<
        ObjectRecordUpdateEvent<{ processingStatus?: string }>
      >,
): Promise<Record<string, unknown>> => {
  const slackRequestId = resolveSlackRequestId(payload);
  const processingStatus =
    payload &&
    'properties' in payload &&
    payload.properties &&
    typeof payload.properties === 'object' &&
    payload.properties.after &&
    typeof payload.properties.after === 'object' &&
    typeof payload.properties.after.processingStatus === 'string'
      ? payload.properties.after.processingStatus
      : undefined;

  if (processingStatus && processingStatus !== 'CLASSIFIED') {
    return {
      slackRequestId,
      skipped: true,
      processingStatus,
    };
  }

  const slackRequest = await processClassifiedSlackRequestById(slackRequestId);

  return {
    slackRequestId: slackRequest.id,
    processingStatus: slackRequest.processingStatus,
    resultJson: slackRequest.resultJson,
  };
};

export default defineLogicFunction({
  universalIdentifier:
    CONTINUE_CLASSIFIED_SLACK_REQUEST_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'continue-classified-slack-request',
  description:
    'Manually continues a previously classified Slack request into query answering or draft generation',
  timeoutSeconds: 60,
  handler,
});
