import type { RoutePayload } from 'twenty-sdk';

import { PREVIEW_RECORD_ACTION_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handlePreviewRecordActionRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handlePreviewRecordActionRoute(event);

export default defineLogicFunction({
  universalIdentifier: PREVIEW_RECORD_ACTION_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'preview-record-action',
  description: 'Builds a review preview for an approval-gated CRM action',
  timeoutSeconds: 15,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/preview-record-action',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
