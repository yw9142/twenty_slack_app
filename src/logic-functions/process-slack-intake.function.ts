import type {
  DatabaseEventPayload,
  ObjectRecordCreateEvent,
} from 'twenty-sdk';

import { PROCESS_INTAKE_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { handoffSlackRequestToRunner } from 'src/utils/codex-runner';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { updateSlackRequest } from 'src/utils/slack-intake-service';

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
  await updateSlackRequest({
    id: slackRequestId,
    data: {
      processingStatus: 'PROCESSING',
      lastProcessedAt: new Date().toISOString(),
    },
  });

  const processingStatus = await handoffSlackRequestToRunner({
    slackRequestId,
  });

  return {
    slackRequestId,
    processingStatus,
  };
};

export default defineLogicFunction({
  universalIdentifier: PROCESS_INTAKE_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'process-slack-intake',
  description: 'Processes a stored Slack 요청 record by id',
  timeoutSeconds: 15,
  handler,
  databaseEventTriggerSettings: {
    eventName: 'slackRequest.created',
  },
});
