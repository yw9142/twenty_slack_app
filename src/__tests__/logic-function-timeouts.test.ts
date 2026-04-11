import { describe, expect, it } from 'vitest';

import answerCrmQueryFunction from 'src/logic-functions/answer-crm-query.function';
import buildCrmWriteDraftFunction from 'src/logic-functions/build-crm-write-draft.function';
import processSlackIntakeFunction from 'src/logic-functions/process-slack-intake.function';

describe('logic function timeouts', () => {
  it('gives Anthropic-backed async flows enough time to finish', () => {
    expect(answerCrmQueryFunction.config.timeoutSeconds).toBe(60);
    expect(buildCrmWriteDraftFunction.config.timeoutSeconds).toBe(60);
    expect(processSlackIntakeFunction.config.timeoutSeconds).toBe(60);
  });
});
