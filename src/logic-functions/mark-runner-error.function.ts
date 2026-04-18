import type { RoutePayload } from 'twenty-sdk';

import { MARK_RUNNER_ERROR_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleMarkRunnerErrorRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleMarkRunnerErrorRoute(event);

export default defineLogicFunction({
  universalIdentifier: MARK_RUNNER_ERROR_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'mark-runner-error',
  description: 'Marks a Slack request as failed by the Codex runner',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/mark-runner-error',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
