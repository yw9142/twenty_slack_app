import type { RoutePayload } from 'twenty-sdk';

import { DELETE_RECORD_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleDeleteRecordRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleDeleteRecordRoute(event);

export default defineLogicFunction({
  universalIdentifier: DELETE_RECORD_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'delete-record',
  description: 'Plans a CRM record delete and returns approval metadata',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/delete-record',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
