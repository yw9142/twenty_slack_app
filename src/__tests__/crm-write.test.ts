import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mutation, query } = vi.hoisted(() => ({
  mutation: vi.fn(),
  query: vi.fn(),
}));

const { fetchObjectFields } = vi.hoisted(() => ({
  fetchObjectFields: vi.fn(),
}));

vi.mock('src/utils/core-client', () => ({
  createCoreClient: () => ({
    query,
    mutation,
  }),
}));

vi.mock('src/utils/metadata-client', () => ({
  fetchObjectFields,
}));

const getMetadataFields = (kind: string) => {
  switch (kind) {
    case 'company':
      return [
        { name: 'name', type: 'TEXT' },
        { name: 'domainName', type: 'LINKS' },
        { name: 'linkedinLink', type: 'LINKS' },
        { name: 'employees', type: 'NUMBER' },
        {
          name: 'companyStatus',
          type: 'SELECT',
          options: [
            { label: '활성', value: 'ACTIVE' },
            { label: '휴면', value: 'DORMANT' },
            { label: '비활성', value: 'INACTIVE' },
          ],
        },
      ];
    case 'person':
      return [
        { name: 'name' },
        { name: 'company', relation: { type: 'MANY_TO_ONE' } },
        { name: 'jobTitle' },
        { name: 'emails' },
        { name: 'linkedinLink' },
        { name: 'city' },
      ];
    case 'opportunity':
      return [
        { name: 'name', type: 'TEXT' },
        { name: 'company', relation: { type: 'MANY_TO_ONE' } },
        { name: 'pointOfContact', relation: { type: 'MANY_TO_ONE' } },
        {
          name: 'stage',
          type: 'SELECT',
          options: [
            { label: '발굴', value: 'IDENTIFIED' },
            { label: '자격확인', value: 'QUALIFIED' },
            { label: '벤더협의', value: 'VENDOR_ALIGNED' },
            { label: '제안/PoC', value: 'DISCOVERY_POC' },
            { label: '견적', value: 'QUOTED' },
            { label: '협상', value: 'NEGOTIATION' },
            { label: '수주', value: 'CLOSED_WON' },
            { label: '실주', value: 'CLOSED_LOST' },
            { label: '보류', value: 'ON_HOLD' },
          ],
        },
        { name: 'closeDate', type: 'DATE' },
        { name: 'amount', type: 'CURRENCY' },
      ];
    case 'note':
      return [{ name: 'title' }, { name: 'bodyV2' }];
    case 'task':
      return [
        { name: 'title' },
        { name: 'bodyV2' },
        { name: 'status' },
        { name: 'dueAt' },
      ];
    default:
      return [];
  }
};

describe('crm write helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchObjectFields.mockImplementation(async (kind: string) =>
      getMetadataFields(kind),
    );
  });

  it('builds a lead package draft with company/person reuse and deterministic create actions', async () => {
    const { buildLeadPackageDraft } = await import('src/utils/crm-write');

    query
      .mockResolvedValueOnce({
        companies: {
          edges: [
            {
              node: {
                id: 'company-1',
                name: '서광건설엔지니어링',
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
                  firstName: '박성훈',
                  lastName: '',
                },
                emails: {
                  primaryEmail: 'sh.park@seogwang-demo.co.kr',
                },
                company: {
                  name: '서광건설엔지니어링',
                },
              },
            },
          ],
        },
      });

    const result = await buildLeadPackageDraft({
      companyName: '서광건설엔지니어링',
      contactName: '박성훈',
      jobTitle: 'BIM혁신팀 수석',
      primaryEmail: 'sh.park@seogwang-demo.co.kr',
      phone: '010-7714-2203',
      vendorName: 'Autodesk',
      solutionName: 'Autodesk AEC Collection',
      currentSituation:
        '건축과 설비 프로젝트를 Revit 중심으로 표준화하려고 하고, 본사 40명 + 협력사 20명까지 포함한 BIM 운영 체계를 검토 중.',
      expectedScale: 'AEC Collection 60석, 교육 및 초기 컨설팅 포함 요청',
      budgetText: '1차 연 1.2억원 내외',
      budgetAmount: 120000000,
      targetQuarterOrDate: '2026년 3분기',
      sourceChannel: '다우데이타 BIM 컨설팅 사례 보고 문의',
      nextAction: '라이선스 견적 초안과 BIM 컨설팅 범위안 같이 제안해줘',
      sourceText: 'CRM에 신규 리드로 등록해줘',
    });

    expect(result.plannedRecords).toEqual({
      company: {
        decision: 'REUSE',
        label: '서광건설엔지니어링',
        matchedRecord: {
          id: 'company-1',
          label: '서광건설엔지니어링',
        },
      },
      person: {
        decision: 'REUSE',
        label: '박성훈',
        matchedRecord: {
          id: 'person-1',
          label: '박성훈',
        },
      },
      opportunity: {
        decision: 'CREATE',
        label: '서광건설엔지니어링 Autodesk AEC Collection 신규 리드',
        matchedRecord: null,
      },
      note: {
        decision: 'CREATE',
        label: '서광건설엔지니어링 신규 리드 메모',
        matchedRecord: null,
      },
      task: {
        decision: 'CREATE',
        label: '서광건설엔지니어링 후속 제안 준비',
        matchedRecord: null,
      },
    });
    expect(result.draft.actions).toEqual([
      {
        kind: 'opportunity',
        operation: 'create',
        data: {
          name: '서광건설엔지니어링 Autodesk AEC Collection 신규 리드',
          companyName: '서광건설엔지니어링',
          pointOfContactName: '박성훈',
          stage: 'IDENTIFIED',
          amount: 120000000,
          closeDate: '2026-09-30',
        },
      },
      {
        kind: 'note',
        operation: 'create',
        data: {
          title: '서광건설엔지니어링 신규 리드 메모',
          body: expect.stringContaining(
            '관심 솔루션/벤더: Autodesk AEC Collection / Autodesk',
          ),
          companyName: '서광건설엔지니어링',
          pointOfContactName: '박성훈',
          opportunityName: '서광건설엔지니어링 Autodesk AEC Collection 신규 리드',
        },
      },
      {
        kind: 'task',
        operation: 'create',
        data: {
          title: '서광건설엔지니어링 후속 제안 준비',
          body: expect.stringContaining(
            '라이선스 견적 초안과 BIM 컨설팅 범위안 같이 제안해줘',
          ),
          companyName: '서광건설엔지니어링',
          pointOfContactName: '박성훈',
          opportunityName: '서광건설엔지니어링 Autodesk AEC Collection 신규 리드',
        },
      },
    ]);
    expect(result.draft.review?.items).toEqual([
      expect.objectContaining({
        kind: 'company',
        decision: 'SKIP',
        target: '서광건설엔지니어링',
        matchedRecord: '서광건설엔지니어링',
      }),
      expect.objectContaining({
        kind: 'person',
        decision: 'SKIP',
        target: '박성훈',
        matchedRecord: '박성훈',
      }),
      expect.objectContaining({
        kind: 'opportunity',
        decision: 'CREATE',
      }),
      expect.objectContaining({
        kind: 'note',
        decision: 'CREATE',
      }),
      expect.objectContaining({
        kind: 'task',
        decision: 'CREATE',
      }),
    ]);
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
            primaryVendorCompanyName: 'Nutanix',
            primaryPartnerCompanyName: 'Daou Data',
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
    expect(payload).not.toHaveProperty('primaryVendorCompanyName');
    expect(payload).not.toHaveProperty('primaryPartnerCompanyName');
  });

  it('normalizes contactName aliases before opportunity create mutations', async () => {
    const { applyApprovedDraft } = await import('src/utils/crm-write');

    query
      .mockResolvedValueOnce({
        companies: {
          edges: [
            {
              node: {
                id: 'company-1',
                name: '서광건설엔지니어링',
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
                  firstName: '박성훈',
                  lastName: '',
                },
                company: {
                  name: '서광건설엔지니어링',
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
      summary: '리드 등록 초안',
      confidence: 0.9,
      sourceText: '서광건설엔지니어링 신규 리드 등록',
      warnings: [],
      actions: [
        {
          kind: 'opportunity',
          operation: 'create',
          data: {
            name: '서광건설엔지니어링 Autodesk BIM 운영 체계',
            companyName: '서광건설엔지니어링',
            contactName: '박성훈',
            stage: 'DISCOVERY',
          },
        },
      ],
    });

    expect(mutation).toHaveBeenCalledWith({
      createOpportunity: {
        __args: {
          data: expect.objectContaining({
            name: '서광건설엔지니어링 Autodesk BIM 운영 체계',
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

    expect(payload).not.toHaveProperty('contactName');
  });

  it('drops invalid company status values and unsupported company fields', async () => {
    const { applyApprovedDraft } = await import('src/utils/crm-write');

    mutation.mockResolvedValue({
      createCompany: {
        id: 'company-1',
      },
    });

    await applyApprovedDraft({
      summary: '리드 등록 초안',
      confidence: 0.9,
      sourceText: '서광건설엔지니어링 신규 리드 등록',
      warnings: [],
      actions: [
        {
          kind: 'company',
          operation: 'create',
          data: {
            name: '서광건설엔지니어링',
            status: 'PROSPECT',
            unsupportedField: 'drop-me',
          },
        },
      ],
    });

    expect(mutation).toHaveBeenCalledWith({
      createCompany: {
        __args: {
          data: expect.objectContaining({
            name: '서광건설엔지니어링',
          }),
        },
        id: true,
      },
    });

    const payload = mutation.mock.calls[0]?.[0]?.createCompany?.__args?.data ?? {};

    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('companyStatus');
    expect(payload).not.toHaveProperty('unsupportedField');
  });

  it('normalizes opportunity stage aliases to allowed metadata option values', async () => {
    const { applyApprovedDraft } = await import('src/utils/crm-write');

    mutation.mockResolvedValue({
      createOpportunity: {
        id: 'opp-1',
      },
    });

    await applyApprovedDraft({
      summary: '리드 등록 초안',
      confidence: 0.9,
      sourceText: '서광건설엔지니어링 신규 리드 등록',
      warnings: [],
      actions: [
        {
          kind: 'opportunity',
          operation: 'create',
          data: {
            name: '서광건설엔지니어링 Autodesk BIM 운영 체계',
            stage: 'Lead',
          },
        },
      ],
    });

    expect(mutation).toHaveBeenCalledWith({
      createOpportunity: {
        __args: {
          data: expect.objectContaining({
            name: '서광건설엔지니어링 Autodesk BIM 운영 체계',
            stage: 'IDENTIFIED',
          }),
        },
        id: true,
      },
    });
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

    const notePayload =
      mutation.mock.calls[3]?.[0]?.createNote?.__args?.data ?? {};
    const taskPayload =
      mutation.mock.calls[7]?.[0]?.createTask?.__args?.data ?? {};

    expect(notePayload).not.toHaveProperty('companyId');
    expect(notePayload).not.toHaveProperty('pointOfContactId');
    expect(taskPayload).not.toHaveProperty('companyId');
    expect(taskPayload).not.toHaveProperty('pointOfContactId');
  });

  it('reuses existing company and person records when applying a lead package draft', async () => {
    const { applyApprovedDraft } = await import('src/utils/crm-write');

    query.mockImplementation(async (request: Record<string, unknown>) => {
      if ('companies' in request) {
        return {
          companies: {
            edges: [
              {
                node: {
                  id: 'company-1',
                  name: '서광건설엔지니어링',
                },
              },
            ],
          },
        };
      }

      if ('people' in request) {
        return {
          people: {
            edges: [
              {
                node: {
                  id: 'person-1',
                  name: {
                    firstName: '박성훈',
                    lastName: '',
                  },
                  emails: {
                    primaryEmail: 'sh.park@seogwang-demo.co.kr',
                  },
                  company: {
                    name: '서광건설엔지니어링',
                  },
                },
              },
            ],
          },
        };
      }

      return {};
    });

    mutation
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
      summary: '서광건설엔지니어링 신규 리드 등록 초안',
      confidence: 0.93,
      sourceText: 'CRM에 신규 리드로 등록해줘',
      warnings: [],
      actions: [
        {
          kind: 'opportunity',
          operation: 'create',
          data: {
            name: '서광건설엔지니어링 Autodesk AEC Collection 신규 리드',
            companyName: '서광건설엔지니어링',
            pointOfContactName: '박성훈',
            stage: 'IDENTIFIED',
          },
        },
        {
          kind: 'note',
          operation: 'create',
          data: {
            title: '서광건설엔지니어링 신규 리드 메모',
            body: '현재 상황',
            companyName: '서광건설엔지니어링',
            pointOfContactName: '박성훈',
            opportunityName: '서광건설엔지니어링 Autodesk AEC Collection 신규 리드',
          },
        },
        {
          kind: 'task',
          operation: 'create',
          data: {
            title: '서광건설엔지니어링 후속 제안 준비',
            body: '라이선스 견적 초안과 BIM 컨설팅 범위안 같이 제안',
            companyName: '서광건설엔지니어링',
            pointOfContactName: '박성훈',
            opportunityName: '서광건설엔지니어링 Autodesk AEC Collection 신규 리드',
          },
        },
      ],
    });

    expect(mutation).not.toHaveBeenCalledWith(
      expect.objectContaining({
        createCompany: expect.anything(),
      }),
    );
    expect(mutation).not.toHaveBeenCalledWith(
      expect.objectContaining({
        createPerson: expect.anything(),
      }),
    );
    expect(mutation).toHaveBeenCalledWith({
      createOpportunity: {
        __args: {
          data: expect.objectContaining({
            name: '서광건설엔지니어링 Autodesk AEC Collection 신규 리드',
            companyId: 'company-1',
            pointOfContactId: 'person-1',
            stage: 'IDENTIFIED',
          }),
        },
        id: true,
      },
    });
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
    expect(result.created).toEqual([
      { kind: 'opportunity', id: 'opp-1' },
      { kind: 'note', id: 'note-1' },
      { kind: 'task', id: 'task-1' },
    ]);
  });

  it('builds approval previews for delete actions from resolved records', async () => {
    const { previewApprovalAction } = await import('src/utils/crm-write');

    query.mockResolvedValueOnce({
      companies: {
        edges: [
          {
            node: {
              id: 'company-1',
              name: '미래금융',
            },
          },
        ],
      },
    });

    const preview = await previewApprovalAction({
      kind: 'company',
      operation: 'delete',
      lookup: {
        id: 'company-1',
        name: '미래금융',
      },
      data: {},
    });

    expect(preview).toEqual({
      action: {
        kind: 'company',
        operation: 'delete',
        lookup: {
          id: 'company-1',
          name: '미래금융',
        },
        data: {},
      },
      matchedRecord: {
        id: 'company-1',
        label: '미래금융',
      },
      reviewItem: {
        kind: 'company',
        decision: 'DELETE',
        target: '미래금융',
        matchedRecord: '미래금융',
        reason: '승인 후 실제 삭제가 실행됩니다.',
        fields: [],
      },
    });
  });

  it('deletes matched records during approved draft application', async () => {
    const { applyApprovedDraft } = await import('src/utils/crm-write');

    mutation.mockResolvedValueOnce({
      deleteCompany: {
        id: 'company-1',
      },
    });

    const result = await applyApprovedDraft({
      summary: '삭제 초안',
      confidence: 0.95,
      sourceText: '미래금융 삭제',
      warnings: [],
      actions: [
        {
          kind: 'company',
          operation: 'delete',
          lookup: {
            id: 'company-1',
            name: '미래금융',
          },
          data: {},
        },
      ],
    });

    expect(mutation).toHaveBeenCalledWith({
      deleteCompany: {
        __args: {
          id: 'company-1',
        },
        id: true,
      },
    });
    expect(result).toEqual({
      created: [],
      deleted: [{ kind: 'company', id: 'company-1' }],
      errors: [],
      skipped: [],
      updated: [],
    });
  });

  it('prefers targetId over lookup resolution when deleting', async () => {
    const { applyApprovedDraft } = await import('src/utils/crm-write');

    mutation.mockResolvedValueOnce({
      deleteCompany: {
        id: 'company-target',
      },
    });

    const result = await applyApprovedDraft({
      summary: '삭제 초안',
      confidence: 0.95,
      sourceText: '미래금융 삭제',
      warnings: [],
      actions: [
        {
          kind: 'company',
          operation: 'delete',
          targetId: 'company-target',
          lookup: {
            name: '미래금융',
          },
          data: {},
        },
      ],
    });

    expect(query).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledWith({
      deleteCompany: {
        __args: {
          id: 'company-target',
        },
        id: true,
      },
    });
    expect(result.deleted).toEqual([
      {
        kind: 'company',
        id: 'company-target',
      },
    ]);
  });
});
