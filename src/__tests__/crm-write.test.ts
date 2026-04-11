import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutation, query } = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));

vi.mock('src/utils/core-client', () => ({
  createCoreClient: () => ({
    query,
    mutation,
  }),
}));

describe('crm write helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes helper lookup fields before opportunity mutations', async () => {
    const { applyApprovedDraft } = await import('src/utils/crm-write');

    query
      .mockResolvedValueOnce({
        companies: {
          edges: [
            {
              node: {
                id: 'company-1',
                name: 'A은행',
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        people: {
          edges: [
            {
              node: {
                id: 'person-1',
                name: {
                  firstName: '김민수',
                  lastName: '',
                },
                company: {
                  name: 'A은행',
                },
              },
            },
          ],
        },
      });

    mutation.mockResolvedValue({
      createOpportunity: {
        id: 'opp-1',
      },
    });

    await applyApprovedDraft({
      summary: '초안',
      confidence: 0.8,
      sourceText: 'A은행 Nutanix 전환',
      warnings: [],
      actions: [
        {
          kind: 'opportunity',
          operation: 'create',
          data: {
            name: 'A은행 Nutanix 전환',
            companyName: 'A은행',
            pointOfContactName: '김민수',
            stage: 'DISCOVERY_POC',
          },
        },
      ],
    });

    expect(mutation).toHaveBeenCalledWith({
      createOpportunity: {
        __args: {
          data: expect.objectContaining({
            name: 'A은행 Nutanix 전환',
            companyId: 'company-1',
            pointOfContactId: 'person-1',
            stage: 'DISCOVERY_POC',
          }),
        },
        id: true,
      },
    });

    const payload =
      mutation.mock.calls[0]?.[0]?.createOpportunity?.__args?.data ?? {};

    expect(payload).not.toHaveProperty('companyName');
    expect(payload).not.toHaveProperty('pointOfContactName');
  });
});
