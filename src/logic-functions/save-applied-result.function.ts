import type { RoutePayload } from 'twenty-sdk';

import { SAVE_APPLIED_RESULT_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleSaveAppliedResultRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleSaveAppliedResultRoute(event);

export default defineLogicFunction({
  universalIdentifier: SAVE_APPLIED_RESULT_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'save-applied-result',
  description: 'Stores an applied result from the Codex runner',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/save-applied-result',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
