import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  fetchQueryableObjectDefinitions,
  coreQuery,
  planDynamicObjectQuery,
  synthesizeCrmQueryReply,
} = vi.hoisted(() => ({
  fetchQueryableObjectDefinitions: vi.fn(),
  coreQuery: vi.fn(),
  planDynamicObjectQuery: vi.fn(),
  synthesizeCrmQueryReply: vi.fn(),
}));

vi.mock('src/utils/metadata-client', () => ({
  fetchQueryableObjectDefinitions,
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

const licenseDefinition = {
  id: 'license-object',
  universalIdentifier: 'license-uid',
  nameSingular: 'license',
  namePlural: 'licenses',
  labelSingular: '라이선스',
  labelPlural: '라이선스',
  description: '갱신 관리 객체',
  icon: null,
  color: null,
  shortcut: 'L',
  isCustom: true,
  isRemote: false,
  isActive: true,
  isSystem: false,
  isUIReadOnly: false,
  isSearchable: true,
  labelIdentifierFieldMetadataId: 'field-name',
  imageIdentifierFieldMetadataId: null,
  isLabelSyncedWithName: true,
  fields: [
    {
      id: 'field-name',
      universalIdentifier: 'field-name-uid',
      type: 'TEXT',
      name: 'name',
      label: '라이선스명',
      description: null,
      icon: null,
      isCustom: false,
      isActive: true,
      isSystem: true,
      isUIReadOnly: false,
      isNullable: false,
      isUnique: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      defaultValue: null,
      options: null,
      settings: null,
      isLabelSyncedWithName: true,
      morphId: null,
      applicationId: 'app-id',
      objectMetadataId: 'license-object',
      relation: null,
      morphRelations: null,
    },
    {
      id: 'field-product',
      universalIdentifier: 'field-product-uid',
      type: 'TEXT',
      name: 'productName',
      label: '제품명',
      description: null,
      icon: null,
      isCustom: false,
      isActive: true,
      isSystem: false,
      isUIReadOnly: false,
      isNullable: true,
      isUnique: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      defaultValue: null,
      options: null,
      settings: null,
      isLabelSyncedWithName: false,
      morphId: null,
      applicationId: 'app-id',
      objectMetadataId: 'license-object',
      relation: null,
      morphRelations: null,
    },
    {
      id: 'field-risk',
      universalIdentifier: 'field-risk-uid',
      type: 'SELECT',
      name: 'renewalRiskLevel',
      label: '갱신 리스크',
      description: null,
      icon: null,
      isCustom: false,
      isActive: true,
      isSystem: false,
      isUIReadOnly: false,
      isNullable: true,
      isUnique: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      defaultValue: null,
      options: null,
      settings: null,
      isLabelSyncedWithName: false,
      morphId: null,
      applicationId: 'app-id',
      objectMetadataId: 'license-object',
      relation: null,
      morphRelations: null,
    },
    {
      id: 'field-expiry',
      universalIdentifier: 'field-expiry-uid',
      type: 'DATE',
      name: 'expiryDate',
      label: '만료일',
      description: null,
      icon: null,
      isCustom: false,
      isActive: true,
      isSystem: false,
      isUIReadOnly: false,
      isNullable: true,
      isUnique: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      defaultValue: null,
      options: null,
      settings: null,
      isLabelSyncedWithName: false,
      morphId: null,
      applicationId: 'app-id',
      objectMetadataId: 'license-object',
      relation: null,
      morphRelations: null,
    },
    {
      id: 'field-activity',
      universalIdentifier: 'field-activity-uid',
      type: 'DATE_TIME',
      name: 'lastActivityAt',
      label: '최근 활동일',
      description: null,
      icon: null,
      isCustom: false,
      isActive: true,
      isSystem: false,
      isUIReadOnly: false,
      isNullable: true,
      isUnique: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      defaultValue: null,
      options: null,
      settings: null,
      isLabelSyncedWithName: false,
      morphId: null,
      applicationId: 'app-id',
      objectMetadataId: 'license-object',
      relation: null,
      morphRelations: null,
    },
    {
      id: 'field-vendor',
      universalIdentifier: 'field-vendor-uid',
      type: 'RELATION',
      name: 'vendorCompany',
      label: '공급사',
      description: null,
      icon: null,
      isCustom: false,
      isActive: true,
      isSystem: false,
      isUIReadOnly: false,
      isNullable: true,
      isUnique: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      defaultValue: null,
      options: null,
      settings: null,
      isLabelSyncedWithName: false,
      morphId: null,
      applicationId: 'app-id',
      objectMetadataId: 'license-object',
      relation: {
        type: 'MANY_TO_ONE',
        sourceObjectMetadata: {
          id: 'license-object',
          nameSingular: 'license',
          namePlural: 'licenses',
        },
        targetObjectMetadata: {
          id: 'company-object',
          nameSingular: 'company',
          namePlural: 'companies',
        },
        sourceFieldMetadata: {
          id: 'field-vendor',
          name: 'vendorCompany',
        },
        targetFieldMetadata: {
          id: 'company-name-field',
          name: 'name',
        },
      },
      morphRelations: null,
    },
    {
      id: 'field-value',
      universalIdentifier: 'field-value-uid',
      type: 'CURRENCY',
      name: 'contractValue',
      label: '계약 금액',
      description: null,
      icon: null,
      isCustom: false,
      isActive: true,
      isSystem: false,
      isUIReadOnly: false,
      isNullable: true,
      isUnique: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      defaultValue: null,
      options: null,
      settings: null,
      isLabelSyncedWithName: false,
      morphId: null,
      applicationId: 'app-id',
      objectMetadataId: 'license-object',
      relation: null,
      morphRelations: null,
    },
  ],
} as const;

const companyDefinition = {
  id: 'company-object',
  universalIdentifier: 'company-uid',
  nameSingular: 'company',
  namePlural: 'companies',
  labelSingular: '회사',
  labelPlural: '회사',
  description: '법인 객체',
  icon: null,
  color: null,
  shortcut: 'C',
  isCustom: false,
  isRemote: false,
  isActive: true,
  isSystem: false,
  isUIReadOnly: false,
  isSearchable: true,
  labelIdentifierFieldMetadataId: 'company-name-field',
  imageIdentifierFieldMetadataId: null,
  isLabelSyncedWithName: true,
  fields: [
    {
      id: 'company-name-field',
      universalIdentifier: 'company-name-field-uid',
      type: 'TEXT',
      name: 'name',
      label: '회사명',
      description: null,
      icon: null,
      isCustom: false,
      isActive: true,
      isSystem: true,
      isUIReadOnly: false,
      isNullable: false,
      isUnique: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      defaultValue: null,
      options: null,
      settings: null,
      isLabelSyncedWithName: true,
      morphId: null,
      applicationId: 'app-id',
      objectMetadataId: 'company-object',
      relation: null,
      morphRelations: null,
    },
    {
      id: 'company-licenses-field',
      universalIdentifier: 'company-licenses-field-uid',
      type: 'RELATION',
      name: 'licenses',
      label: '라이선스',
      description: null,
      icon: null,
      isCustom: false,
      isActive: true,
      isSystem: false,
      isUIReadOnly: false,
      isNullable: true,
      isUnique: false,
      createdAt: '2026-04-14T00:00:00.000Z',
      updatedAt: '2026-04-14T00:00:00.000Z',
      defaultValue: null,
      options: null,
      settings: null,
      isLabelSyncedWithName: false,
      morphId: null,
      applicationId: 'app-id',
      objectMetadataId: 'company-object',
      relation: {
        type: 'ONE_TO_MANY',
        sourceObjectMetadata: {
          id: 'company-object',
          nameSingular: 'company',
          namePlural: 'companies',
        },
        targetObjectMetadata: {
          id: 'license-object',
          nameSingular: 'license',
          namePlural: 'licenses',
        },
        sourceFieldMetadata: {
          id: 'company-licenses-field',
          name: 'licenses',
        },
        targetFieldMetadata: {
          id: 'field-vendor',
          name: 'vendorCompany',
        },
      },
      morphRelations: null,
    },
  ],
} as const;

describe('dynamic object query reply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    synthesizeCrmQueryReply.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('ranks license highest and builds a detailed priority reply', async () => {
    fetchQueryableObjectDefinitions.mockResolvedValue([
      licenseDefinition,
      companyDefinition,
    ]);

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

    coreQuery.mockImplementation(async (query: Record<string, unknown>) => {
      if (Object.prototype.hasOwnProperty.call(query, '__schema')) {
        return {
          __schema: {
            queryType: {
              fields: [
                {
                  name: 'licenseRecords',
                  type: {
                    kind: 'OBJECT',
                    name: 'LicenseRecordConnection',
                  },
                },
                {
                  name: 'companies',
                  type: {
                    kind: 'OBJECT',
                    name: 'CompanyConnection',
                  },
                },
              ],
            },
          },
        };
      }

      if (Object.prototype.hasOwnProperty.call(query, 'licenseRecords')) {
        return {
          licenseRecords: {
            edges: [
              {
                node: {
                  id: 'license-1',
                  createdAt: '2026-04-14T00:00:00.000Z',
                  updatedAt: '2026-04-14T00:00:00.000Z',
                  name: '서울메디컬센터 Nubo VMI Subscription 2026',
                  productName: 'Nubo VMI',
                  renewalRiskLevel: 'HIGH',
                  expiryDate: '2026-05-13',
                  lastActivityAt: '2026-04-01T00:00:00.000Z',
                  vendorCompany: {
                    id: 'company-1',
                    name: '서울메디컬센터',
                  },
                  contractValue: {
                    amountMicros: 72_000_000_000_000,
                    currencyCode: 'KRW',
                  },
                },
              },
              {
                node: {
                  id: 'license-2',
                  createdAt: '2026-04-14T00:00:00.000Z',
                  updatedAt: '2026-04-14T00:00:00.000Z',
                  name: '미래금융그룹 Citrix VDI Annual Renewal 2026',
                  productName: 'Citrix VDI',
                  renewalRiskLevel: 'WATCH',
                  expiryDate: '2026-07-12',
                  lastActivityAt: '2026-04-05T00:00:00.000Z',
                  vendorCompany: {
                    id: 'company-2',
                    name: '미래금융그룹',
                  },
                  contractValue: {
                    amountMicros: 180_000_000_000_000,
                    currencyCode: 'KRW',
                  },
                },
              },
            ],
          },
        };
      }

      throw new Error('Unexpected query root field');
    });

    const { findRelevantObjectCatalog, buildDynamicObjectQueryReply } =
      await import('src/utils/dynamic-object-query');

    const ranked = await findRelevantObjectCatalog(
      'CRM에서 전체 라이선스 데이터 조회해서 우선순위가 높은 건 순으로 상세하게 정리해서 보고서 작성해줘.',
    );

    expect(ranked[0]).toMatchObject({
      id: 'license-object',
      nameSingular: 'license',
    });

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
      text: 'CRM에서 전체 라이선스 데이터 조회해서 우선순위가 높은 건 순으로 상세하게 정리해서 보고서 작성해줘.',
    });

    expect(result.handled).toBe(true);
    expect(result.reply.text).toContain('라이선스');
    expect(JSON.stringify(result.reply.blocks ?? [])).toContain(
      '서울메디컬센터 Nubo VMI Subscription 2026',
    );
    expect(result.resultJson).toMatchObject({
      handled: true,
      count: 2,
      selectedObject: {
        id: 'license-object',
        nameSingular: 'license',
      },
      selectedRootField: 'licenseRecords',
    });
    expect(result.resultJson.records).toHaveLength(2);
    expect(
      (result.resultJson.records as Array<{ fields: Record<string, unknown> }>)[0]
        .fields['갱신 리스크'],
    ).toBe('HIGH');
    expect(coreQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        licenseRecords: expect.objectContaining({
          __args: expect.objectContaining({
            first: 20,
          }),
          edges: expect.objectContaining({
            node: expect.objectContaining({
              id: true,
              createdAt: true,
              updatedAt: true,
              name: true,
              productName: true,
              renewalRiskLevel: true,
              expiryDate: true,
              lastActivityAt: true,
              vendorCompany: expect.objectContaining({
                id: true,
                name: true,
              }),
            }),
          }),
        }),
      }),
    );
    expect(
      coreQuery.mock.calls[1]?.[0]?.licenseRecords?.edges?.node?.vendorCompany,
    ).toMatchObject({ id: true, name: true });
    expect(coreQuery.mock.calls[1]?.[0]).not.toHaveProperty('licenses');
  });

  it('returns handled false when the text does not point at a queryable object', async () => {
    fetchQueryableObjectDefinitions.mockResolvedValue([
      licenseDefinition,
      companyDefinition,
    ]);

    planDynamicObjectQuery.mockResolvedValue(null);

    const { buildDynamicObjectQueryReply } = await import(
      'src/utils/dynamic-object-query'
    );

    const result = await buildDynamicObjectQueryReply({
      classification: {
        intentType: 'QUERY',
        confidence: 0.5,
        summary: 'irrelevant',
        queryCategory: 'GENERAL',
        detailLevel: 'SUMMARY',
        timeframe: 'ALL_TIME',
        focusEntity: 'GENERAL',
        entityHints: {
          companies: [],
          people: [],
          opportunities: [],
          solutions: [],
        },
      },
      text: '안녕하세요. 이슈 하나 공유합니다.',
    });

    expect(result.handled).toBe(false);
    expect(result.reply.text).toContain('특정하지 못했습니다');
  });
});
