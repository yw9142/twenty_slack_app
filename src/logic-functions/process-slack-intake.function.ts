import type {
  DatabaseEventPayload,
  ObjectRecordCreateEvent,
} from 'twenty-sdk';

import { PROCESS_INTAKE_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { processSlackRequestById } from 'src/utils/slack-orchestrator';

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
    | DatabaseEventPayload<ObjectRecordCreateEvent<Record<string, unknown>>>,
): Promise<Record<string, unknown>> => {
  const slackRequestId = resolveSlackRequestId(payload);
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
  timeoutSeconds: 60,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'slackRequest.created',
  },
});
