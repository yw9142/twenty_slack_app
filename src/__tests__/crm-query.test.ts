import { describe, expect, it } from 'vitest';

import {
  buildConnectionArgs,
  buildMonthlyNewOpinion,
  buildOpportunityOpinion,
} from 'src/utils/crm-query';

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

  it('builds a monthly-new opinion with an actionable recommendation', () => {
    const opinion = buildMonthlyNewOpinion({
      companyCount: 3,
      peopleCount: 1,
      opportunityCount: 3,
    });

    expect(opinion).toContain('담당자');
  });

  it('highlights missing commercial inputs in opportunity opinions', () => {
    const opinion = buildOpportunityOpinion({
      id: 'opp-1',
      name: 'A은행 Nutanix 전환',
      stage: 'NEGOTIATION',
      closeDate: null,
      companyName: 'A은행',
      pointOfContactName: null,
    });

    expect(opinion).toContain('주요 담당자');
    expect(opinion).toContain('예상 마감일');
  });
});
