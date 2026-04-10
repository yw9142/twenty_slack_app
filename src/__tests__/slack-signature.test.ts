import { describe, expect, it } from 'vitest';

import {
  buildSlackSignature,
  verifySlackSignature,
} from 'src/utils/slack-signature';

describe('slack-signature', () => {
  it('should verify a valid signature', () => {
    const signingSecret = 'secret';
    const timestamp = '1710000000';
    const rawBody = '{"type":"url_verification"}';
    const signature = buildSlackSignature(signingSecret, timestamp, rawBody);

    expect(
      verifySlackSignature({
        signingSecret,
        providedSignature: signature,
        timestamp,
        rawBody,
      }),
    ).toBe(true);
  });

  it('should reject an invalid signature', () => {
    expect(
      verifySlackSignature({
        signingSecret: 'secret',
        providedSignature: 'v0=invalid',
        timestamp: '1710000000',
        rawBody: '{"type":"url_verification"}',
      }),
    ).toBe(false);
  });
});
