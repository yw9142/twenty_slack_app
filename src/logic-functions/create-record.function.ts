import type { RoutePayload } from 'twenty-sdk';

import { CREATE_RECORD_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleCreateRecordRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleCreateRecordRoute(event);

export default defineLogicFunction({
  universalIdentifier: CREATE_RECORD_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'create-record',
  description: 'Creates a CRM record immediately for the Codex runner',
  timeoutSeconds: 20,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/create-record',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
