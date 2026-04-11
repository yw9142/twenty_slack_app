import { describe, expect, it } from 'vitest';

import { buildConnectionArgs } from 'src/utils/crm-query';

describe('crm query helpers', () => {
  it('builds connection args with first instead of paging', () => {
    const args = buildConnectionArgs({
      first: 20,
      filter: {
        id: {
          eq: 'note-1',
        },
      },
    });

    expect(args).toEqual({
      first: 20,
      filter: {
        id: {
          eq: 'note-1',
        },
      },
    });
    expect(args).not.toHaveProperty('paging');
  });
});
