import { describe, expect, it } from 'vitest';

import { handleSlackEventsRoute } from 'src/utils/slack-route-handler';

describe('slack events route', () => {
  it('returns the Slack challenge for url verification before request verification', async () => {
    const result = await handleSlackEventsRoute({
      headers: {
        'content-type': 'application/json',
      },
      body: {
        type: 'url_verification',
        challenge: 'challenge-token',
      },
      isBase64Encoded: false,
      pathParameters: {},
      queryStringParameters: {},
      requestContext: {
        http: {
          method: 'POST',
          path: '/s/slack/events',
        },
      },
    });

    expect(result).toEqual({
      challenge: 'challenge-token',
    });
  });
});
