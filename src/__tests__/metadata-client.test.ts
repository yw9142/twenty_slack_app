import { beforeEach, describe, expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('twenty-client-sdk/metadata', () => ({
  MetadataApiClient: vi.fn().mockImplementation(() => ({
    query,
  })),
}));

import {
  fetchObjectCatalog,
  fetchObjectDefinition,
  fetchObjectFields,
} from 'src/utils/metadata-client';

describe('metadata client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads and caches object metadata from Twenty', async () => {
    query.mockResolvedValueOnce({
      objects: {
        edges: [
          {
            node: {
              id: 'license-id',
              universalIdentifier: 'license-uid',
              nameSingular: 'license',
              namePlural: 'licenses',
              labelSingular: '라이선스',
              labelPlural: '라이선스',
              description: 'license object',
              icon: 'IconLicense',
              color: 'red',
              shortcut: 'L',
              isCustom: true,
              isRemote: false,
              isActive: true,
              isSystem: false,
              isUIReadOnly: false,
              isSearchable: true,
              createdAt: '2026-04-14T00:00:00.000Z',
              updatedAt: '2026-04-14T00:00:00.000Z',
              labelIdentifierFieldMetadataId: 'license-name-field',
              imageIdentifierFieldMetadataId: null,
              isLabelSyncedWithName: true,
              fieldsList: [
                {
                  id: 'license-name-field',
                  universalIdentifier: 'license-name-field-uid',
                  type: 'TEXT',
                  name: 'name',
                  label: 'Name',
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
                  objectMetadataId: 'license-id',
                  relation: null,
                  morphRelations: null,
                },
                {
                  id: 'vendor-relation-field',
                  universalIdentifier: 'vendor-relation-field-uid',
                  type: 'RELATION',
                  name: 'vendorCompany',
                  label: 'Vendor Company',
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
                  objectMetadataId: 'license-id',
                  relation: {
                    type: 'MANY_TO_ONE',
                    sourceObjectMetadata: {
                      id: 'license-id',
                      nameSingular: 'license',
                      namePlural: 'licenses',
                    },
                    targetObjectMetadata: {
                      id: 'company-id',
                      nameSingular: 'company',
                      namePlural: 'companies',
                    },
                    sourceFieldMetadata: {
                      id: 'vendor-relation-field',
                      name: 'vendorCompany',
                    },
                    targetFieldMetadata: {
                      id: 'company-name-field',
                      name: 'name',
                    },
                  },
                  morphRelations: null,
                },
              ],
            },
          },
        ],
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      },
    });

    const catalog = await fetchObjectCatalog();
    const fields = await fetchObjectFields('license');
    const definition = await fetchObjectDefinition('license');

    expect(catalog).toEqual([
      expect.objectContaining({
        id: 'license-id',
        nameSingular: 'license',
        labelPlural: '라이선스',
        isSearchable: true,
      }),
    ]);
    expect(fields).toHaveLength(2);
    expect(fields[0]).toMatchObject({
      name: 'name',
      type: 'TEXT',
    });
    expect(fields[1]).toMatchObject({
      name: 'vendorCompany',
      type: 'RELATION',
      relation: expect.objectContaining({
        targetObjectMetadata: expect.objectContaining({
          nameSingular: 'company',
        }),
      }),
    });
    expect(definition).toMatchObject({
      nameSingular: 'license',
      fields: expect.any(Array),
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
