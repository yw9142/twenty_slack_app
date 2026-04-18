import type { RoutePayload } from 'twenty-sdk';

import { LOAD_SLACK_REQUEST_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleLoadSlackRequestRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleLoadSlackRequestRoute(event);

export default defineLogicFunction({
  universalIdentifier: LOAD_SLACK_REQUEST_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'load-slack-request',
  description: 'Loads a stored Slack 요청 record for the Codex runner',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/load-slack-request',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
