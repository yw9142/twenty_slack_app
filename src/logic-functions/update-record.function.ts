import type { RoutePayload } from 'twenty-sdk';

import { UPDATE_RECORD_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleUpdateRecordRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleUpdateRecordRoute(event);

export default defineLogicFunction({
  universalIdentifier: UPDATE_RECORD_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'update-record',
  description: 'Plans a CRM record update and returns approval metadata',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/update-record',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
