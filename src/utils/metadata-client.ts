import { MetadataApiClient } from 'twenty-client-sdk/metadata';

import { normalizeText, uniqueNonEmpty } from 'src/utils/strings';

type GraphQlRecord = Record<string, unknown>;

type MetadataQueryPage = {
  objects?: {
    edges?: Array<{
      node?: GraphQlRecord;
    }>;
    pageInfo?: {
      hasNextPage?: boolean | null;
      endCursor?: string | null;
    } | null;
  };
};

type MetadataRelationReference = {
  id: string;
  nameSingular: string;
  namePlural: string;
};

type MetadataRelation = {
  type?: string | null;
  sourceObjectMetadata?: MetadataRelationReference | null;
  targetObjectMetadata?: MetadataRelationReference | null;
  sourceFieldMetadata?: {
    id?: string | null;
    name?: string | null;
  } | null;
  targetFieldMetadata?: {
    id?: string | null;
    name?: string | null;
  } | null;
};

export type ObjectCatalogItem = {
  id: string;
  universalIdentifier: string;
  nameSingular: string;
  namePlural: string;
  labelSingular: string;
  labelPlural: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  shortcut: string | null;
  isCustom: boolean;
  isRemote: boolean;
  isActive: boolean;
  isSystem: boolean;
  isUIReadOnly: boolean;
  isSearchable: boolean;
  labelIdentifierFieldMetadataId: string | null;
  imageIdentifierFieldMetadataId: string | null;
  isLabelSyncedWithName: boolean;
};

export type ObjectFieldMetadata = {
  id: string;
  universalIdentifier: string;
  type: string;
  name: string;
  label: string;
  description: string | null;
  icon: string | null;
  isCustom: boolean | null;
  isActive: boolean | null;
  isSystem: boolean | null;
  isUIReadOnly: boolean | null;
  isNullable: boolean | null;
  isUnique: boolean | null;
  createdAt: string;
  updatedAt: string;
  defaultValue: unknown | null;
  options: unknown | null;
  settings: unknown | null;
  isLabelSyncedWithName: boolean | null;
  morphId: string | null;
  applicationId: string | null;
  objectMetadataId: string | null;
  relation: MetadataRelation | null;
  morphRelations: MetadataRelation[] | null;
};

export type ObjectDefinition = ObjectCatalogItem & {
  fields: ObjectFieldMetadata[];
};

const OBJECT_METADATA_SELECTION = {
  id: true,
  universalIdentifier: true,
  nameSingular: true,
  namePlural: true,
  labelSingular: true,
  labelPlural: true,
  description: true,
  icon: true,
  color: true,
  shortcut: true,
  isCustom: true,
  isRemote: true,
  isActive: true,
  isSystem: true,
  isUIReadOnly: true,
  isSearchable: true,
  createdAt: true,
  updatedAt: true,
  labelIdentifierFieldMetadataId: true,
  imageIdentifierFieldMetadataId: true,
  isLabelSyncedWithName: true,
  fieldsList: {
    id: true,
    universalIdentifier: true,
    type: true,
    name: true,
    label: true,
    description: true,
    icon: true,
    isCustom: true,
    isActive: true,
    isSystem: true,
    isUIReadOnly: true,
    isNullable: true,
    isUnique: true,
    createdAt: true,
    updatedAt: true,
    defaultValue: true,
    options: true,
    settings: true,
    isLabelSyncedWithName: true,
    morphId: true,
    applicationId: true,
    objectMetadataId: true,
    relation: {
      type: true,
      sourceObjectMetadata: {
        id: true,
        nameSingular: true,
        namePlural: true,
      },
      targetObjectMetadata: {
        id: true,
        nameSingular: true,
        namePlural: true,
      },
      sourceFieldMetadata: {
        id: true,
        name: true,
      },
      targetFieldMetadata: {
        id: true,
        name: true,
      },
    },
    morphRelations: {
      type: true,
      sourceObjectMetadata: {
        id: true,
        nameSingular: true,
        namePlural: true,
      },
      targetObjectMetadata: {
        id: true,
        nameSingular: true,
        namePlural: true,
      },
      sourceFieldMetadata: {
        id: true,
        name: true,
      },
      targetFieldMetadata: {
        id: true,
        name: true,
      },
    },
  },
} as const;

const toStringOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const toBoolean = (value: unknown): boolean =>
  typeof value === 'boolean' ? value : false;

const toNullableBoolean = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : null;

const toRecord = (value: unknown): GraphQlRecord | null =>
  value && typeof value === 'object' ? (value as GraphQlRecord) : null;

const toRelationReference = (
  value: unknown,
): MetadataRelationReference | null => {
  const record = toRecord(value);

  if (!record) {
    return null;
  }

  const id = toStringOrNull(record.id);
  const nameSingular = toStringOrNull(record.nameSingular);
  const namePlural = toStringOrNull(record.namePlural);

  if (!id || !nameSingular || !namePlural) {
    return null;
  }

  return {
    id,
    nameSingular,
    namePlural,
  };
};

const toRelation = (value: unknown): MetadataRelation | null => {
  const record = toRecord(value);

  if (!record) {
    return null;
  }

  return {
    type: toStringOrNull(record.type),
    sourceObjectMetadata: toRelationReference(record.sourceObjectMetadata),
    targetObjectMetadata: toRelationReference(record.targetObjectMetadata),
    sourceFieldMetadata: toRecord(record.sourceFieldMetadata)
      ? {
          id: toStringOrNull((record.sourceFieldMetadata as GraphQlRecord).id),
          name: toStringOrNull((record.sourceFieldMetadata as GraphQlRecord).name),
        }
      : null,
    targetFieldMetadata: toRecord(record.targetFieldMetadata)
      ? {
          id: toStringOrNull((record.targetFieldMetadata as GraphQlRecord).id),
          name: toStringOrNull((record.targetFieldMetadata as GraphQlRecord).name),
        }
      : null,
  };
};

const toFieldMetadata = (value: unknown): ObjectFieldMetadata | null => {
  const record = toRecord(value);

  if (!record) {
    return null;
  }

  const id = toStringOrNull(record.id);
  const universalIdentifier = toStringOrNull(record.universalIdentifier);
  const type = toStringOrNull(record.type);
  const name = toStringOrNull(record.name);
  const label = toStringOrNull(record.label);
  const createdAt = toStringOrNull(record.createdAt);
  const updatedAt = toStringOrNull(record.updatedAt);

  if (!id || !universalIdentifier || !type || !name || !label || !createdAt || !updatedAt) {
    return null;
  }

  return {
    id,
    universalIdentifier,
    type,
    name,
    label,
    description: toStringOrNull(record.description),
    icon: toStringOrNull(record.icon),
    isCustom: toNullableBoolean(record.isCustom),
    isActive: toNullableBoolean(record.isActive),
    isSystem: toNullableBoolean(record.isSystem),
    isUIReadOnly: toNullableBoolean(record.isUIReadOnly),
    isNullable: toNullableBoolean(record.isNullable),
    isUnique: toNullableBoolean(record.isUnique),
    createdAt,
    updatedAt,
    defaultValue:
      Object.prototype.hasOwnProperty.call(record, 'defaultValue') &&
      record.defaultValue !== undefined
        ? record.defaultValue
        : null,
    options:
      Object.prototype.hasOwnProperty.call(record, 'options') && record.options !== undefined
        ? record.options
        : null,
    settings:
      Object.prototype.hasOwnProperty.call(record, 'settings') &&
      record.settings !== undefined
        ? record.settings
        : null,
    isLabelSyncedWithName: toNullableBoolean(record.isLabelSyncedWithName),
    morphId: toStringOrNull(record.morphId),
    applicationId: toStringOrNull(record.applicationId),
    objectMetadataId: toStringOrNull(record.objectMetadataId),
    relation: toRelation(record.relation),
    morphRelations: Array.isArray(record.morphRelations)
      ? record.morphRelations.map(toRelation).filter(
          (relation): relation is MetadataRelation => relation !== null,
        )
      : null,
  };
};

const toObjectDefinition = (value: unknown): ObjectDefinition | null => {
  const record = toRecord(value);

  if (!record) {
    return null;
  }

  const id = toStringOrNull(record.id);
  const universalIdentifier = toStringOrNull(record.universalIdentifier);
  const nameSingular = toStringOrNull(record.nameSingular);
  const namePlural = toStringOrNull(record.namePlural);
  const labelSingular = toStringOrNull(record.labelSingular);
  const labelPlural = toStringOrNull(record.labelPlural);
  const createdAt = toStringOrNull(record.createdAt);
  const updatedAt = toStringOrNull(record.updatedAt);

  if (
    !id ||
    !universalIdentifier ||
    !nameSingular ||
    !namePlural ||
    !labelSingular ||
    !labelPlural ||
    !createdAt ||
    !updatedAt
  ) {
    return null;
  }

  return {
    id,
    universalIdentifier,
    nameSingular,
    namePlural,
    labelSingular,
    labelPlural,
    description: toStringOrNull(record.description),
    icon: toStringOrNull(record.icon),
    color: toStringOrNull(record.color),
    shortcut: toStringOrNull(record.shortcut),
    isCustom: toBoolean(record.isCustom),
    isRemote: toBoolean(record.isRemote),
    isActive: toBoolean(record.isActive),
    isSystem: toBoolean(record.isSystem),
    isUIReadOnly: toBoolean(record.isUIReadOnly),
    isSearchable: toBoolean(record.isSearchable),
    labelIdentifierFieldMetadataId: toStringOrNull(
      record.labelIdentifierFieldMetadataId,
    ),
    imageIdentifierFieldMetadataId: toStringOrNull(
      record.imageIdentifierFieldMetadataId,
    ),
    isLabelSyncedWithName: toBoolean(record.isLabelSyncedWithName),
    fields: Array.isArray(record.fieldsList)
      ? record.fieldsList
          .map(toFieldMetadata)
          .filter((field): field is ObjectFieldMetadata => field !== null)
      : [],
  };
};

const matchesObjectIdentifier = (definition: ObjectDefinition, identifier: string) => {
  const normalizedIdentifier = normalizeText(identifier);
  const normalizedTerms = uniqueNonEmpty([
    definition.id,
    definition.universalIdentifier,
    definition.nameSingular,
    definition.namePlural,
    definition.labelSingular,
    definition.labelPlural,
  ]).map((term) => normalizeText(term));

  return normalizedTerms.some((term) => term === normalizedIdentifier);
};

let objectDefinitionsPromise: Promise<ObjectDefinition[]> | null = null;
let objectDefinitionsCache: ObjectDefinition[] = [];
let objectDefinitionsById = new Map<string, ObjectDefinition>();

export const resetMetadataClientCache = (): void => {
  objectDefinitionsPromise = null;
  objectDefinitionsCache = [];
  objectDefinitionsById = new Map<string, ObjectDefinition>();
};

const loadAllObjectDefinitions = async (): Promise<ObjectDefinition[]> => {
  const client = new MetadataApiClient();
  const definitions: ObjectDefinition[] = [];
  let after: string | null = null;

  do {
    const response: any = await client.query<any>({
      objects: {
        __args: {
          paging: after ? { first: 1000, after } : { first: 1000 },
          filter: {
            isActive: {
              is: true,
            },
          },
        },
        edges: {
          node: OBJECT_METADATA_SELECTION,
        },
        pageInfo: {
          hasNextPage: true,
          endCursor: true,
        },
      },
    });

    const pageObjects = response.objects?.edges ?? [];

    for (const edge of pageObjects) {
      const definition = toObjectDefinition(edge.node);

      if (!definition) {
        continue;
      }

      definitions.push(definition);
    }

    const pageInfo: any = response.objects?.pageInfo ?? null;
    after =
      pageInfo?.hasNextPage && typeof pageInfo.endCursor === 'string'
        ? pageInfo.endCursor
        : null;
  } while (after);

  objectDefinitionsCache = definitions;
  objectDefinitionsById = new Map(definitions.map((definition) => [definition.id, definition]));

  return definitions;
};

const getAllObjectDefinitions = async (): Promise<ObjectDefinition[]> => {
  if (!objectDefinitionsPromise) {
    objectDefinitionsPromise = loadAllObjectDefinitions().catch((error) => {
      objectDefinitionsPromise = null;
      throw error;
    });
  }

  return objectDefinitionsPromise;
};

export const createMetadataClient = () => new MetadataApiClient();

export const fetchObjectCatalog = async (): Promise<ObjectCatalogItem[]> => {
  const definitions = await getAllObjectDefinitions();

  return definitions
    .filter((definition) => definition.isActive)
    .map((definition) => ({
      id: definition.id,
      universalIdentifier: definition.universalIdentifier,
      nameSingular: definition.nameSingular,
      namePlural: definition.namePlural,
      labelSingular: definition.labelSingular,
      labelPlural: definition.labelPlural,
      description: definition.description,
      icon: definition.icon,
      color: definition.color,
      shortcut: definition.shortcut,
      isCustom: definition.isCustom,
      isRemote: definition.isRemote,
      isActive: definition.isActive,
      isSystem: definition.isSystem,
      isUIReadOnly: definition.isUIReadOnly,
      isSearchable: definition.isSearchable,
      labelIdentifierFieldMetadataId: definition.labelIdentifierFieldMetadataId,
      imageIdentifierFieldMetadataId: definition.imageIdentifierFieldMetadataId,
      isLabelSyncedWithName: definition.isLabelSyncedWithName,
    }))
    .sort((left, right) =>
      left.labelPlural.localeCompare(right.labelPlural, 'ko-KR'),
    );
};

export const fetchObjectDefinition = async (
  identifier: string,
): Promise<ObjectDefinition | null> => {
  const definitions = await getAllObjectDefinitions();
  const normalizedIdentifier = normalizeText(identifier);

  return (
    objectDefinitionsById.get(identifier) ??
    definitions.find((definition) => matchesObjectIdentifier(definition, normalizedIdentifier)) ??
    null
  );
};

export const fetchObjectFields = async (
  identifier: string,
): Promise<ObjectFieldMetadata[]> => {
  const definition = await fetchObjectDefinition(identifier);

  return definition?.fields ?? [];
};

export const fetchQueryableObjectDefinitions = async (): Promise<ObjectDefinition[]> =>
  getAllObjectDefinitions();
