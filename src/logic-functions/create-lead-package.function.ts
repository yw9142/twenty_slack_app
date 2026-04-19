import type { RoutePayload } from 'twenty-sdk';

import { CREATE_LEAD_PACKAGE_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { defineLogicFunction } from 'src/utils/define-logic-function';
import { handleCreateLeadPackageRoute } from 'src/utils/codex-tools';

const handler = async (
  event: RoutePayload<Record<string, unknown> | string | null>,
): Promise<Record<string, unknown>> => handleCreateLeadPackageRoute(event);

export default defineLogicFunction({
  universalIdentifier: CREATE_LEAD_PACKAGE_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'create-lead-package',
  description:
    'Builds an approval-first lead registration package for the Codex runner',
  timeoutSeconds: 20,
  handler,
  httpRouteTriggerSettings: {
    path: '/tools/create-lead-package',
    httpMethod: 'POST',
    isAuthRequired: false,
    forwardedRequestHeaders: ['x-tool-shared-secret', 'content-type'],
  },
});
