import type { RoutePayload } from 'twenty-sdk';

import { GET_TOOL_CATALOG_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleGetToolCatalogRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleGetToolCatalogRoute(event);

export default defineLogicFunction({
  universalIdentifier: GET_TOOL_CATALOG_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'get-tool-catalog',
  description: 'Returns the shared Codex tool catalog for the runner',
  timeoutSeconds: 10,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/get-tool-catalog',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
