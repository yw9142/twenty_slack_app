import { describe, expect, it } from 'vitest';

import {
  buildSlackRequestLookupSelection,
} from 'src/utils/slack-intake-service';

describe('slack intake service', () => {
  it('builds custom object lookup queries without paging arguments', () => {
    const selection = buildSlackRequestLookupSelection({
      dedupeKey: 'APP_MENTION:event-1',
    });

    expect(selection).toEqual({
      slackRequests: {
        __args: {
          filter: {
            dedupeKey: {
              eq: 'APP_MENTION:event-1',
            },
          },
        },
        edges: {
          node: expect.any(Object),
        },
      },
    });
  });
});
