import type { RoutePayload } from 'twenty-sdk';

import { LOAD_THREAD_CONTEXT_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleLoadThreadContextRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleLoadThreadContextRoute(event);

export default defineLogicFunction({
  universalIdentifier: LOAD_THREAD_CONTEXT_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'load-thread-context',
  description: 'Loads same-thread Slack memory for the Codex runner',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/load-thread-context',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
