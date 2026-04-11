import { describe, expect, it } from 'vitest';

import applicationConfig from 'src/application-config';

const runtimeVariableKeys = [
  'SLACK_BOT_TOKEN',
  'SLACK_SIGNING_SECRET',
  'SLACK_VERIFICATION_TOKEN',
  'SLACK_APP_TOKEN',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'TWENTY_BASE_URL',
] as const;

describe('application config', () => {
  it('declares runtime configuration through applicationVariables only', () => {
    expect(applicationConfig.config.serverVariables).toBeUndefined();

    for (const key of runtimeVariableKeys) {
      expect(applicationConfig.config.applicationVariables).toHaveProperty(key);
    }
  });
});
