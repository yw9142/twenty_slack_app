import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { metadataQuery, coreQuery, planDynamicObjectQuery, synthesizeCrmQueryReply } =
  vi.hoisted(() => ({
    metadataQuery: vi.fn(),
    coreQuery: vi.fn(),
    planDynamicObjectQuery: vi.fn(),
    synthesizeCrmQueryReply: vi.fn(),
  }));

vi.mock('src/utils/metadata-client', () => ({
  createMetadataClient: () => ({
    query: metadataQuery,
  }),
}));

vi.mock('src/utils/core-client', () => ({
  createCoreClient: () => ({
    query: coreQuery,
  }),
}));

vi.mock('src/utils/intelligence', async () => {
  const actual = await vi.importActual<typeof import('src/utils/intelligence')>(
    'src/utils/intelligence',
  );

  return {
    ...actual,
    planDynamicObjectQuery,
    synthesizeCrmQueryReply,
  };
});

describe('dynamic object query reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    synthesizeCrmQueryReply.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('builds a metadata-driven priority report for a matched custom object', async () => {
    metadataQuery
      .mockResolvedValueOnce({
        minimalMetadata: {
          objectMetadataItems: [
            {
              id: 'license-object',
              nameSingular: 'license',
              namePlural: 'licenses',
              labelSingular: '라이선스',
              labelPlural: '라이선스',
              description: '갱신 관리 객체',
              isCustom: true,
              isActive: true,
              isSystem: false,
              isRemote: false,
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        fields: {
          edges: [
            {
              node: {
                id: 'field-name',
                name: 'name',
                label: '라이선스명',
                type: 'TEXT',
                isActive: true,
                isSystem: false,
                isUIReadOnly: false,
                isNullable: false,
              },
            },
            {
              node: {
                id: 'field-risk',
                name: 'renewalRiskLevel',
                label: '갱신 리스크',
                type: 'SELECT',
                isActive: true,
                isSystem: false,
                isUIReadOnly: false,
                isNullable: true,
              },
            },
            {
              node: {
                id: 'field-expiry',
                name: 'expiryDate',
                label: '만료일',
                type: 'DATE',
                isActive: true,
                isSystem: false,
                isUIReadOnly: false,
                isNullable: true,
              },
            },
            {
              node: {
                id: 'field-value',
                name: 'contractValue',
                label: '계약 금액',
                type: 'CURRENCY',
                isActive: true,
                isSystem: false,
                isUIReadOnly: false,
                isNullable: true,
              },
            },
          ],
        },
      });

    coreQuery.mockResolvedValue({
      licenses: {
        edges: [
          {
            node: {
              id: 'license-1',
              name: '서울메디컬센터 Nubo VMI Subscription 2026',
              renewalRiskLevel: 'HIGH',
              expiryDate: '2026-05-13',
              contractValue: {
                amountMicros: 72_000_000_000_000,
                currencyCode: 'KRW',
              },
            },
          },
          {
            node: {
              id: 'license-2',
              name: '미래금융그룹 Citrix VDI Annual Renewal 2026',
              renewalRiskLevel: 'WATCH',
              expiryDate: '2026-07-12',
              contractValue: {
                amountMicros: 180_000_000_000_000,
                currencyCode: 'KRW',
              },
            },
          },
        ],
      },
    });

    planDynamicObjectQuery.mockResolvedValue({
      handled: true,
      confidence: 0.9,
      summary: '라이선스 객체 조회',
      reportMode: 'PRIORITY_REPORT',
      targetObjectId: 'license-object',
      targetObjectNameSingular: 'license',
      targetObjectNamePlural: 'licenses',
      targetObjectLabelSingular: '라이선스',
      targetObjectLabelPlural: '라이선스',
    });

    const { buildDynamicObjectQueryReply } = await import(
      'src/utils/dynamic-object-query'
    );

    const result = await buildDynamicObjectQueryReply({
      classification: {
        intentType: 'QUERY',
        confidence: 0.92,
        summary: '라이선스 우선순위 조회',
        queryCategory: 'LICENSE_PRIORITY',
        detailLevel: 'DETAILED',
        timeframe: 'ALL_TIME',
        focusEntity: 'LICENSE',
        entityHints: {
          companies: [],
          people: [],
          opportunities: [],
          solutions: [],
        },
      },
      text: '전체 라이선스 데이터 조회해서 우선순위 높은 순으로 상세 보고서 작성해줘',
    });

    expect(result.handled).toBe(true);
    expect(result.reply.text).toContain('라이선스');
    expect(JSON.stringify(result.reply.blocks ?? [])).toContain(
      '서울메디컬센터 Nubo VMI Subscription 2026',
    );
    expect(result.resultJson).toMatchObject({
      handled: true,
      count: 2,
    });
  });
});
