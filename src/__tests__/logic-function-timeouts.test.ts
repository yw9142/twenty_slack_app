import { describe, expect, it } from 'vitest';

import continueClassifiedSlackRequestFunction from 'src/logic-functions/continue-classified-slack-request.function';
import processSlackIntakeFunction from 'src/logic-functions/process-slack-intake.function';

describe('logic function timeouts', () => {
  it('keeps runner handoff functions short because Codex work is delegated', () => {
    expect(continueClassifiedSlackRequestFunction.config.timeoutSeconds).toBe(15);
    expect(processSlackIntakeFunction.config.timeoutSeconds).toBe(15);
  });
});
