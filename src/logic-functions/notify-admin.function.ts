import { defineLogicFunction } from 'twenty-sdk';

import { NOTIFY_ADMIN_FUNCTION_UNIVERSAL_IDENTIFIER } from 'src/constants/universal-identifiers';
import { createOperationalTask } from 'src/utils/crm-write';

const handler = async ({
  message,
  details,
}: {
  message: string;
  details?: string;
}): Promise<Record<string, unknown>> => {
  const taskId = await createOperationalTask({
    title: `[Slack Agent 알림] ${message}`,
    body: details ?? message,
  });

  return {
    taskId,
  };
};

export default defineLogicFunction({
  universalIdentifier: NOTIFY_ADMIN_FUNCTION_UNIVERSAL_IDENTIFIER,
  name: 'notify-admin',
  description: 'Creates an operational task for administrator follow-up',
  timeoutSeconds: 10,
  handler,
});
