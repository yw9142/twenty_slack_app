import { WEEKLY_BRIEFING_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { postWeeklyBriefing } from 'src/utils/crm-automations';
import { defineLogicFunction } from 'src/utils/define-logic-function';

const handler = async (): Promise<Record<string, unknown>> => {
  await postWeeklyBriefing();

  return {
    ok: true,
  };
};

export default defineLogicFunction({
  universalIdentifier: WEEKLY_BRIEFING_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'weekly-briefing',
  description: 'Posts a weekly pipeline briefing to the management Slack channel',
  timeoutSeconds: 20,
  handler,
  cronTriggerSettings: {
    pattern: '0 0 * * 1',
  },
});
