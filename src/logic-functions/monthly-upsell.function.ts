import { defineLogicFunction } from 'twenty-sdk';

import { MONTHLY_UPSELL_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { postMonthlyUpsellBriefing } from 'src/utils/crm-automations';

const handler = async (): Promise<Record<string, unknown>> => {
  await postMonthlyUpsellBriefing();

  return {
    ok: true,
  };
};

export default defineLogicFunction({
  universalIdentifier: MONTHLY_UPSELL_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'monthly-upsell',
  description: 'Posts a monthly upsell candidate summary to Slack',
  timeoutSeconds: 20,
  handler,
  cronTriggerSettings: {
    pattern: '0 0 1 * *',
  },
});
