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

  it('creates note and task target links for resolved company, person, and opportunity records', async () => {
    const { applyApprovedDraft } = await import('src/utils/crm-write');

    mutation
      .mockResolvedValueOnce({
        createCompany: {
          id: 'company-1',
        },
      })
      .mockResolvedValueOnce({
        createPerson: {
          id: 'person-1',
        },
      })
      .mockResolvedValueOnce({
        createOpportunity: {
          id: 'opp-1',
        },
      })
      .mockResolvedValueOnce({
        createNote: {
          id: 'note-1',
        },
      })
      .mockResolvedValueOnce({
        createNoteTarget: {
          id: 'note-target-company',
        },
      })
      .mockResolvedValueOnce({
        createNoteTarget: {
          id: 'note-target-person',
        },
      })
      .mockResolvedValueOnce({
        createNoteTarget: {
          id: 'note-target-opportunity',
        },
      })
      .mockResolvedValueOnce({
        createTask: {
          id: 'task-1',
        },
      })
      .mockResolvedValueOnce({
        createTaskTarget: {
          id: 'task-target-company',
        },
      })
      .mockResolvedValueOnce({
        createTaskTarget: {
          id: 'task-target-person',
        },
      })
      .mockResolvedValueOnce({
        createTaskTarget: {
          id: 'task-target-opportunity',
        },
      });

    const result = await applyApprovedDraft({
      summary: '초안',
      confidence: 0.9,
      sourceText: 'A은행 Nutanix VDI 전환 후속 작업',
      warnings: [],
      actions: [
        {
          kind: 'company',
          operation: 'create',
          data: {
            name: 'A은행',
          },
        },
        {
          kind: 'person',
          operation: 'create',
          data: {
            name: '김민수',
            companyName: 'A은행',
            jobTitle: '부장',
          },
        },
        {
          kind: 'opportunity',
          operation: 'create',
          data: {
            name: 'A은행 Nutanix VDI 전환',
            companyName: 'A은행',
            pointOfContactName: '김민수',
            stage: 'DISCOVERY_POC',
          },
        },
        {
          kind: 'note',
          operation: 'create',
          data: {
            title: 'A은행 Nutanix VDI 전환 미팅 메모',
            body: '5월 말 POC 예정',
            companyName: 'A은행',
            pointOfContactName: '김민수',
            opportunityName: 'A은행 Nutanix VDI 전환',
          },
        },
        {
          kind: 'task',
          operation: 'create',
          data: {
            title: 'A은행 아키텍처 초안 전달',
            status: 'TODO',
            body: '다음주 안에 아키텍처 초안을 전달',
            companyName: 'A은행',
            pointOfContactName: '김민수',
            opportunityName: 'A은행 Nutanix VDI 전환',
          },
        },
      ],
    });

    expect(result.created).toEqual(
      expect.arrayContaining([
        { kind: 'company', id: 'company-1' },
        { kind: 'person', id: 'person-1' },
        { kind: 'opportunity', id: 'opp-1' },
        { kind: 'note', id: 'note-1' },
        { kind: 'task', id: 'task-1' },
      ]),
    );

    expect(mutation).toHaveBeenCalledWith({
      createNoteTarget: {
        __args: {
          data: {
            noteId: 'note-1',
            targetCompanyId: 'company-1',
          },
        },
        id: true,
      },
    });
    expect(mutation).toHaveBeenCalledWith({
      createNoteTarget: {
        __args: {
          data: {
            noteId: 'note-1',
            targetPersonId: 'person-1',
          },
        },
        id: true,
      },
    });
    expect(mutation).toHaveBeenCalledWith({
      createNoteTarget: {
        __args: {
          data: {
            noteId: 'note-1',
            targetOpportunityId: 'opp-1',
          },
        },
        id: true,
      },
    });
    expect(mutation).toHaveBeenCalledWith({
      createTaskTarget: {
        __args: {
          data: {
            taskId: 'task-1',
            targetCompanyId: 'company-1',
          },
        },
        id: true,
      },
    });
    expect(mutation).toHaveBeenCalledWith({
      createTaskTarget: {
        __args: {
          data: {
            taskId: 'task-1',
            targetPersonId: 'person-1',
          },
        },
        id: true,
      },
    });
    expect(mutation).toHaveBeenCalledWith({
      createTaskTarget: {
        __args: {
          data: {
            taskId: 'task-1',
            targetOpportunityId: 'opp-1',
          },
        },
        id: true,
      },
    });
  });
});
