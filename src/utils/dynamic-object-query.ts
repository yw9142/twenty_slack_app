import type { DynamicObjectQueryPlan } from 'src/utils/intelligence';
import {
  planDynamicObjectQuery,
  synthesizeCrmQueryReply,
} from 'src/utils/intelligence';
import { createCoreClient } from 'src/utils/core-client';
import {
  fetchQueryableObjectDefinitions,
  type ObjectCatalogItem,
  type ObjectDefinition,
  type ObjectFieldMetadata,
} from 'src/utils/metadata-client';
import type {
  SlackIntentClassification,
  SlackReply,
} from 'src/types/slack-agent';
import {
  cleanSlackText,
  normalizeText,
  uniqueNonEmpty,
} from 'src/utils/strings';

type GraphQlSelection = Record<string, unknown>;

type RankedObjectDefinition = {
  definition: ObjectDefinition;
  score: number;
  matchScore: number;
  supportScore: number;
  reasons: string[];
};

type FlattenedDynamicRecord = {
  id: string;
  title: string;
  fields: Record<string, string | number | boolean | null>;
  priorityScore: number;
  priorityReasons: string[];
};

type DynamicObjectQueryResult = {
  handled: boolean;
  reply: SlackReply;
  resultJson: Record<string, unknown>;
};

const MIN_OBJECT_SCORE = 8;
const MAX_PLANNER_CANDIDATES = 12;
const ROOT_FIELD_LIMIT = 12;
const NESTED_FIELD_LIMIT = 4;
const SUMMARY_RECORD_LIMIT = 8;
const DETAIL_RECORD_LIMIT = 20;

const SIMPLE_FIELD_TYPES = new Set<ObjectFieldMetadata['type']>([
  'ARRAY',
  'BOOLEAN',
  'DATE',
  'DATE_TIME',
  'MULTI_SELECT',
  'NUMBER',
  'NUMERIC',
  'POSITION',
  'RAW_JSON',
  'RATING',
  'SELECT',
  'TEXT',
  'TS_VECTOR',
  'UUID',
]);

const COMPOSITE_FIELD_SELECTIONS: Partial<
  Record<ObjectFieldMetadata['type'], GraphQlSelection>
> = {
  ACTOR: {
    source: true,
    workspaceMemberId: true,
    name: true,
    context: true,
  },
  ADDRESS: {
    addressStreet1: true,
    addressStreet2: true,
    addressCity: true,
    addressState: true,
    addressCountry: true,
    addressPostcode: true,
    addressLat: true,
    addressLng: true,
  },
  CURRENCY: {
    amountMicros: true,
    currencyCode: true,
  },
  EMAILS: {
    primaryEmail: true,
    additionalEmails: true,
  },
  FILES: {
    fileId: true,
    label: true,
    extension: true,
    url: true,
  },
  FULL_NAME: {
    firstName: true,
    lastName: true,
  },
  LINKS: {
    primaryLinkUrl: true,
    primaryLinkLabel: true,
    secondaryLinks: true,
  },
  PHONES: {
    primaryPhoneNumber: true,
    primaryPhoneCountryCode: true,
    primaryPhoneCallingCode: true,
    additionalPhones: true,
  },
  RICH_TEXT: {
    blocknote: true,
    markdown: true,
  },
};

const splitSlackBodyIntoChunks = (
  body: string,
  maxLength = 2800,
): string[] => {
  if (body.length <= maxLength) {
    return [body];
  }

  const paragraphs = body.split('\n\n');
  const chunks: string[] = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const candidate = current.length === 0 ? paragraph : `${current}\n\n${paragraph}`;

    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }

    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }

    const lines = paragraph.split('\n');
    let lineChunk = '';

    for (const line of lines) {
      const lineCandidate =
        lineChunk.length === 0 ? line : `${lineChunk}\n${line}`;

      if (lineCandidate.length <= maxLength) {
        lineChunk = lineCandidate;
        continue;
      }

      if (lineChunk.length > 0) {
        chunks.push(lineChunk);
      }

      lineChunk = line;
    }

    current = lineChunk;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks;
};

const buildSectionBlocks = (title: string, body: string): Record<string, unknown>[] =>
  splitSlackBodyIntoChunks(body).map((chunk, index) => ({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `*${index === 0 ? title : `${title} (계속)`}*\n${chunk}`,
    },
  }));

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : null;

const toString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const formatCurrency = (value: Record<string, unknown>): string | null => {
  if (typeof value.amountMicros !== 'number') {
    return null;
  }

  const amount = value.amountMicros / 1_000_000;
  const currencyCode =
    typeof value.currencyCode === 'string' && value.currencyCode.trim().length > 0
      ? value.currencyCode
      : 'KRW';

  return `${new Intl.NumberFormat('ko-KR').format(amount)} ${currencyCode}`;
};

const tokenize = (text: string): string[] =>
  uniqueNonEmpty(
    normalizeText(cleanSlackText(text, { singleLine: true }))
      .split(/[^a-z0-9가-힣]+/gi)
      .map((token) => token.trim()),
  );

const fieldText = (field: ObjectFieldMetadata): string =>
  normalizeText(
    `${field.name} ${field.label} ${field.description ?? ''} ${
      field.type
    } ${field.relation?.targetObjectMetadata?.nameSingular ?? ''} ${
      field.relation?.targetObjectMetadata?.namePlural ?? ''
    }`,
  );

const fieldImportanceScore = (field: ObjectFieldMetadata): number => {
  const normalized = fieldText(field);
  let score = 0;

  if (field.name === 'name') {
    score += 100;
  }

  if (normalized.includes('risk') || normalized.includes('리스크')) {
    score += 80;
  }

  if (
    normalized.includes('expiry') ||
    normalized.includes('expiration') ||
    normalized.includes('만료') ||
    normalized.includes('due') ||
    normalized.includes('예정일')
  ) {
    score += 75;
  }

  if (
    normalized.includes('stage') ||
    normalized.includes('status') ||
    normalized.includes('단계') ||
    normalized.includes('상태')
  ) {
    score += 70;
  }

  if (
    normalized.includes('value') ||
    normalized.includes('amount') ||
    normalized.includes('금액') ||
    normalized.includes('매출')
  ) {
    score += 60;
  }

  if (
    normalized.includes('company') ||
    normalized.includes('customer') ||
    normalized.includes('client') ||
    normalized.includes('vendor') ||
    normalized.includes('product') ||
    normalized.includes('solution')
  ) {
    score += 50;
  }

  if (
    normalized.includes('activity') ||
    normalized.includes('contact') ||
    normalized.includes('owner') ||
    normalized.includes('담당')
  ) {
    score += 40;
  }

  if (normalized.includes('renewal') || normalized.includes('renew')) {
    score += 35;
  }

  if (SIMPLE_FIELD_TYPES.has(field.type)) {
    score += 10;
  }

  if (field.type === 'CURRENCY') {
    score += 8;
  }

  if (field.type === 'RELATION' || field.type === 'MORPH_RELATION') {
    score += 5;
  }

  return score;
};

const scoreDefinition = (
  definition: ObjectDefinition,
  tokens: string[],
): RankedObjectDefinition => {
  const normalizedIdentifiers = uniqueNonEmpty([
    definition.id,
    definition.universalIdentifier,
    definition.nameSingular,
    definition.namePlural,
    definition.labelSingular,
    definition.labelPlural,
    definition.description ?? '',
  ]).map((value) => normalizeText(value));

  let matchScore = 0;
  let supportScore = 0;
  const reasons: string[] = [];

  for (const token of tokens) {
    const exactMatch = normalizedIdentifiers.some((identifier) => identifier === token);
    const partialMatch = normalizedIdentifiers.some((identifier) =>
      identifier.includes(token),
    );

    if (exactMatch) {
      matchScore += 30;
      reasons.push(`정확 일치: ${token}`);
      continue;
    }

    if (partialMatch) {
      matchScore += 12;
      reasons.push(`부분 일치: ${token}`);
    }
  }

  const fieldScores = definition.fields
    .filter((field) => field.isActive !== false)
    .map((field) => ({
      field,
      score: fieldImportanceScore(field),
    }))
    .sort((left, right) => right.score - left.score);

  for (const { field, score: fieldScore } of fieldScores.slice(0, 8)) {
    supportScore += Math.floor(fieldScore / 10);

    const normalizedField = fieldText(field);
    for (const token of tokens) {
      if (normalizedField.includes(token)) {
        matchScore += 3;
      }
    }

    if (field.type === 'RELATION' && field.relation?.targetObjectMetadata) {
      const targetIdentifiers = uniqueNonEmpty([
        field.relation.targetObjectMetadata.nameSingular,
        field.relation.targetObjectMetadata.namePlural,
      ]).map((value) => normalizeText(value));

      if (tokens.some((token) => targetIdentifiers.some((identifier) => identifier.includes(token)))) {
        matchScore += 8;
        reasons.push(`연관 객체: ${field.label}`);
      }
    }
  }

  return {
    definition,
    score: matchScore + supportScore,
    matchScore,
    supportScore,
    reasons: reasons.slice(0, 4),
  };
};

const rankDefinitions = (
  definitions: ObjectDefinition[],
  text: string,
): RankedObjectDefinition[] => {
  const tokens = tokenize(text);

  return definitions
    .map((definition) => scoreDefinition(definition, tokens))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.definition.labelPlural.localeCompare(
        right.definition.labelPlural,
        'ko-KR',
      );
    });
};

const toCatalogItem = (definition: ObjectDefinition): ObjectCatalogItem => ({
  id: definition.id,
  universalIdentifier: definition.universalIdentifier,
  nameSingular: definition.nameSingular,
  namePlural: definition.namePlural,
  labelSingular: definition.labelSingular,
  labelPlural: definition.labelPlural,
  description: definition.description ?? null,
  icon: definition.icon ?? null,
  color: definition.color ?? null,
  shortcut: definition.shortcut ?? null,
  isCustom: definition.isCustom,
  isRemote: definition.isRemote,
  isActive: definition.isActive,
  isSystem: definition.isSystem,
  isUIReadOnly: definition.isUIReadOnly,
  isSearchable: definition.isSearchable,
  labelIdentifierFieldMetadataId: definition.labelIdentifierFieldMetadataId,
  imageIdentifierFieldMetadataId: definition.imageIdentifierFieldMetadataId,
  isLabelSyncedWithName: definition.isLabelSyncedWithName,
});

const buildFieldSelectionForDefinition = (
  definition: ObjectDefinition,
  definitionsById: Map<string, ObjectDefinition>,
  depth = 0,
): GraphQlSelection => {
  const selection: GraphQlSelection = {
    id: true,
  };

  if (depth === 0) {
    selection.createdAt = true;
    selection.updatedAt = true;
  }

  const fields = definition.fields
    .filter((field) => field.isActive !== false)
    .sort((left, right) => fieldImportanceScore(right) - fieldImportanceScore(left));

  const preferredFieldIds = new Set<string>();
  if (definition.labelIdentifierFieldMetadataId) {
    preferredFieldIds.add(definition.labelIdentifierFieldMetadataId);
  }

  let appendedFields = 0;
  for (const field of fields) {
    if (appendedFields >= (depth === 0 ? ROOT_FIELD_LIMIT : NESTED_FIELD_LIMIT)) {
      break;
    }

    if (preferredFieldIds.has(field.id) || field.name === 'name') {
      preferredFieldIds.delete(field.id);
    }

    if (Object.prototype.hasOwnProperty.call(selection, field.name)) {
      continue;
    }

    const fieldSelection = buildFieldSelectionValue(field, definitionsById, depth);

    if (fieldSelection === null) {
      continue;
    }

    selection[field.name] = fieldSelection;
    appendedFields += 1;
  }

  if (preferredFieldIds.size > 0) {
    for (const field of fields) {
      if (!preferredFieldIds.has(field.id)) {
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(selection, field.name)) {
        const fieldSelection = buildFieldSelectionValue(field, definitionsById, depth);
        if (fieldSelection !== null) {
          selection[field.name] = fieldSelection;
        }
      }
    }
  }

  return selection;
};

const buildFieldSelectionValue = (
  field: ObjectFieldMetadata,
  definitionsById: Map<string, ObjectDefinition>,
  depth: number,
): GraphQlSelection | boolean | null => {
  if (SIMPLE_FIELD_TYPES.has(field.type)) {
    return true;
  }

  if (field.type in COMPOSITE_FIELD_SELECTIONS) {
    return COMPOSITE_FIELD_SELECTIONS[field.type] ?? null;
  }

  if (field.type === 'RELATION') {
    return buildRelationSelection(field, definitionsById, depth);
  }

  if (field.type === 'MORPH_RELATION') {
    return buildMorphRelationSelection(field, definitionsById, depth);
  }

  return null;
};

const buildRelationSelection = (
  field: ObjectFieldMetadata,
  definitionsById: Map<string, ObjectDefinition>,
  depth: number,
): GraphQlSelection => {
  const relationType = field.relation?.type;
  const targetId = field.relation?.targetObjectMetadata?.id;
  const targetDefinition = targetId ? definitionsById.get(targetId) ?? null : null;
  const nestedSelection = targetDefinition
    ? buildFieldSelectionForDefinition(targetDefinition, definitionsById, depth + 1)
    : {
        id: true,
        name: true,
      };

  if (relationType === 'ONE_TO_MANY') {
    return {
      edges: {
        node: nestedSelection,
      },
    };
  }

  return nestedSelection;
};

const buildMorphRelationSelection = (
  field: ObjectFieldMetadata,
  definitionsById: Map<string, ObjectDefinition>,
  depth: number,
): GraphQlSelection => {
  const firstMorphRelation =
    field.morphRelations?.find((relation) => relation.targetObjectMetadata?.id) ??
    null;
  const targetId = firstMorphRelation?.targetObjectMetadata?.id ?? null;
  const targetDefinition = targetId ? definitionsById.get(targetId) ?? null : null;

  if (!targetDefinition) {
    return {
      id: true,
      name: true,
    };
  }

  const nestedSelection = buildFieldSelectionForDefinition(
    targetDefinition,
    definitionsById,
    depth + 1,
  );

  if (firstMorphRelation?.type === 'ONE_TO_MANY') {
    return {
      edges: {
        node: nestedSelection,
      },
    };
  }

  return nestedSelection;
};

const extractReadableValue = (value: unknown): string | number | boolean | null => {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  const record = toRecord(value);

  if (!record) {
    return null;
  }

  const currency = formatCurrency(record);
  if (currency) {
    return currency;
  }

  const fullName = uniqueNonEmpty([
    toString(record.firstName) ?? '',
    toString(record.lastName) ?? '',
  ]).join(' ');
  if (fullName.length > 0) {
    return fullName;
  }

  if (toString(record.primaryEmail)) {
    return toString(record.primaryEmail);
  }

  if (toString(record.primaryPhoneNumber)) {
    return toString(record.primaryPhoneNumber);
  }

  if (toString(record.primaryLinkLabel) || toString(record.primaryLinkUrl)) {
    return toString(record.primaryLinkLabel) ?? toString(record.primaryLinkUrl);
  }

  if (toString(record.markdown) || toString(record.blocknote)) {
    return toString(record.markdown) ?? toString(record.blocknote);
  }

  if (toString(record.label) || toString(record.url)) {
    return toString(record.label) ?? toString(record.url);
  }

  if (Array.isArray(record.secondaryLinks)) {
    const secondaryLinks = record.secondaryLinks
      .map((link) => extractReadableValue(link))
      .filter((item): item is string | number | boolean => item !== null);

    if (secondaryLinks.length > 0) {
      return secondaryLinks.join(', ');
    }
  }

  if (Array.isArray(record.additionalEmails)) {
    const emails = record.additionalEmails
      .map((entry) => extractReadableValue(entry))
      .filter((item): item is string | number | boolean => item !== null);

    if (emails.length > 0) {
      return emails.join(', ');
    }
  }

  if (Array.isArray(record.additionalPhones)) {
    const phones = record.additionalPhones
      .map((entry) => extractReadableValue(entry))
      .filter((item): item is string | number | boolean => item !== null);

    if (phones.length > 0) {
      return phones.join(', ');
    }
  }

  if (Array.isArray(record.edges)) {
    const nodes = record.edges
      .map((edge) => toRecord(edge)?.node)
      .map((node) => extractReadableValue(node))
      .filter((item): item is string | number | boolean => item !== null);

    if (nodes.length > 0) {
      return nodes.join(', ');
    }
  }

  const preferredKeys = [
    'name',
    'title',
    'label',
    'displayName',
    'summary',
    'value',
  ];

  for (const key of preferredKeys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  if (typeof record.id === 'string' && record.id.trim().length > 0) {
    return record.id.trim();
  }

  return null;
};

const flattenRelationValue = (value: unknown): string | number | boolean | null => {
  const readable = extractReadableValue(value);

  if (readable !== null) {
    return readable;
  }

  const record = toRecord(value);
  if (!record) {
    return null;
  }

  const fallback = Object.values(record)
    .map((entry) => extractReadableValue(entry))
    .filter((item): item is string | number | boolean => item !== null);

  if (fallback.length > 0) {
    return fallback.join(', ');
  }

  return null;
};

const fieldFlattenValue = (
  field: ObjectFieldMetadata,
  value: unknown,
): string | number | boolean | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  const record = toRecord(value);

  if (!record) {
    return null;
  }

  if (field.type === 'CURRENCY') {
    return formatCurrency(record);
  }

  if (field.type === 'FULL_NAME') {
    return (
      uniqueNonEmpty([
        toString(record.firstName) ?? '',
        toString(record.lastName) ?? '',
      ]).join(' ') || null
    );
  }

  if (field.type === 'EMAILS') {
    return (
      toString(record.primaryEmail) ??
      (Array.isArray(record.additionalEmails)
        ? record.additionalEmails
            .map((entry) => extractReadableValue(entry))
            .filter((item): item is string | number | boolean => item !== null)
            .join(', ') || null
        : null)
    );
  }

  if (field.type === 'PHONES') {
    return (
      toString(record.primaryPhoneNumber) ??
      (Array.isArray(record.additionalPhones)
        ? record.additionalPhones
            .map((entry) => extractReadableValue(entry))
            .filter((item): item is string | number | boolean => item !== null)
            .join(', ') || null
        : null)
    );
  }

  if (field.type === 'LINKS') {
    return (
      toString(record.primaryLinkLabel) ??
      toString(record.primaryLinkUrl) ??
      (Array.isArray(record.secondaryLinks)
        ? record.secondaryLinks
            .map((entry) => extractReadableValue(entry))
            .filter((item): item is string | number | boolean => item !== null)
            .join(', ') || null
        : null)
    );
  }

  if (field.type === 'FILES') {
    return (
      toString(record.label) ??
      toString(record.url) ??
      toString(record.fileId)
    );
  }

  if (field.type === 'RICH_TEXT') {
    return toString(record.markdown) ?? toString(record.blocknote);
  }

  if (field.type === 'ADDRESS') {
    return uniqueNonEmpty([
      toString(record.addressStreet1) ?? '',
      toString(record.addressStreet2) ?? '',
      toString(record.addressCity) ?? '',
      toString(record.addressState) ?? '',
      toString(record.addressCountry) ?? '',
      toString(record.addressPostcode) ?? '',
    ]).join(' ');
  }

  if (field.type === 'ACTOR') {
    return (
      toString(record.name) ??
      toString(record.source) ??
      toString(record.workspaceMemberId)
    );
  }

  if (field.type === 'RELATION' || field.type === 'MORPH_RELATION') {
    return flattenRelationValue(value);
  }

  const readable = extractReadableValue(value);
  if (readable !== null) {
    return readable;
  }

  return null;
};

const buildPriorityFromFields = (
  fields: Record<string, string | number | boolean | null>,
): { score: number; reasons: string[] } => {
  let score = 0;
  const reasons: string[] = [];

  for (const [label, rawValue] of Object.entries(fields)) {
    const normalizedLabel = normalizeText(label);

    if (typeof rawValue === 'string') {
      const normalizedValue = normalizeText(rawValue);

      if (
        normalizedLabel.includes('risk') ||
        normalizedLabel.includes('리스크') ||
        normalizedValue.includes('risk') ||
        normalizedValue.includes('high') ||
        normalizedValue.includes('주의')
      ) {
        score += 60;
        reasons.push(`${label} 리스크`);
      }

      if (
        normalizedLabel.includes('expiry') ||
        normalizedLabel.includes('만료') ||
        normalizedLabel.includes('due') ||
        normalizedLabel.includes('deadline') ||
        normalizedValue.includes('expire') ||
        normalizedValue.includes('overdue') ||
        normalizedValue.includes('만료')
      ) {
        score += 55;
        reasons.push(`${label} 기한`);
      }

      if (
        normalizedLabel.includes('stage') ||
        normalizedLabel.includes('status') ||
        normalizedLabel.includes('단계') ||
        normalizedLabel.includes('상태')
      ) {
        if (
          normalizedValue.includes('expired') ||
          normalizedValue.includes('terminated') ||
          normalizedValue.includes('closed lost')
        ) {
          score += 50;
          reasons.push('상태 비정상');
        } else {
          score += 18;
        }
      }

      if (
        normalizedLabel.includes('activity') ||
        normalizedLabel.includes('활동') ||
        normalizedLabel.includes('contact') ||
        normalizedValue.includes('최근') ||
        normalizedValue.includes('last')
      ) {
        score += 15;
      }
    }

    if (
      typeof rawValue === 'number' &&
      (normalizedLabel.includes('value') ||
        normalizedLabel.includes('amount') ||
        normalizedLabel.includes('금액') ||
        normalizedLabel.includes('매출'))
    ) {
      if (rawValue >= 100_000_000) {
        score += 20;
        reasons.push(`${label} 큼`);
      } else if (rawValue >= 50_000_000) {
        score += 10;
        reasons.push(`${label} 중대`);
      }
    }
  }

  return {
    score,
    reasons: reasons.slice(0, 4),
  };
};

const flattenRecord = (
  record: Record<string, unknown>,
  fields: ObjectFieldMetadata[],
): FlattenedDynamicRecord => {
  const flattenedFields: Record<string, string | number | boolean | null> = {};

  for (const field of fields) {
    if (!(field.name in record)) {
      continue;
    }

    const flattened = fieldFlattenValue(field, record[field.name]);
    if (flattened === null) {
      continue;
    }

    flattenedFields[field.label] = flattened;
  }

  const titleCandidate =
    (typeof record.name === 'string' && record.name.trim().length > 0
      ? record.name
      : undefined) ??
    Object.values(flattenedFields).find(
      (value) => typeof value === 'string' && value.trim().length > 0,
    );
  const { score, reasons } = buildPriorityFromFields(flattenedFields);

  return {
    id: typeof record.id === 'string' ? record.id : '',
    title:
      typeof titleCandidate === 'string' && titleCandidate.trim().length > 0
        ? titleCandidate.trim()
        : '제목 미입력',
    fields: flattenedFields,
    priorityScore: score,
    priorityReasons: reasons,
  };
};

const buildRecordDetailBody = (records: FlattenedDynamicRecord[]): string =>
  records
    .map((record, index) => {
      const lines = Object.entries(record.fields)
        .filter(([, value]) => value !== null && String(value).trim().length > 0)
        .slice(0, 8)
        .map(([label, value]) => `- ${label}: ${value}`);

      return [
        `${index + 1}. ${record.title}`,
        ...lines,
        `- 우선순위 근거: ${record.priorityReasons.join(', ') || '근거 부족'}`,
      ].join('\n');
    })
    .join('\n\n');

const buildDynamicOpinion = ({
  objectLabel,
  records,
}: {
  objectLabel: string;
  records: FlattenedDynamicRecord[];
}): string => {
  if (records.length === 0) {
    return `${objectLabel} 데이터가 없어 추가 점검 대상이 없습니다.`;
  }

  const top = records[0];

  return `${top.title}부터 우선 점검하는 것이 좋습니다. ${
    top.priorityReasons.join(', ') ||
    `${objectLabel} 핵심 필드를 기준으로 정렬했습니다.`
  }`;
};

const buildFallbackDynamicReply = ({
  objectLabel,
  reportMode,
  records,
  totalCount,
}: {
  objectLabel: string;
  reportMode: DynamicObjectQueryPlan['reportMode'];
  records: FlattenedDynamicRecord[];
  totalCount: number;
}): SlackReply => {
  const reportLabel =
    reportMode === 'PRIORITY_REPORT'
      ? `${objectLabel} 우선순위 보고서`
      : reportMode === 'STATUS_REPORT'
        ? `${objectLabel} 상태 보고서`
        : reportMode === 'LIST_REPORT'
          ? `${objectLabel} 상세 목록`
          : `${objectLabel} 요약`;
  const detailBody = buildRecordDetailBody(records);

  return {
    text:
      reportMode === 'PRIORITY_REPORT'
        ? `${objectLabel} 데이터를 우선순위 기준으로 정리했습니다. 대상 ${totalCount}건입니다.`
        : `${objectLabel} 데이터를 정리했습니다. 대상 ${totalCount}건입니다.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*${reportLabel}*\n` +
            `• 대상 레코드: *${totalCount}건*\n` +
            `• 응답 형태: *${reportMode}*`,
        },
      },
      ...(reportMode === 'PRIORITY_REPORT'
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  '*우선순위 기준*\n기한, 리스크, 상태, 최근 활동, 금액 관련 필드를 우선 반영했습니다.',
              },
            },
          ]
        : []),
      ...buildSectionBlocks('상세', detailBody),
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*의견*\n${buildDynamicOpinion({
            objectLabel,
            records,
          })}`,
        },
      },
    ],
  };
};

const isDynamicReplySufficient = ({
  reply,
  records,
}: {
  reply: SlackReply;
  records: FlattenedDynamicRecord[];
}): boolean => {
  const flattened = [
    reply.text,
    ...(reply.blocks ?? []).flatMap((block) => {
      const text =
        block &&
        typeof block === 'object' &&
        'text' in block &&
        block.text &&
        typeof block.text === 'object' &&
        typeof (block.text as { text?: unknown }).text === 'string'
          ? [(block.text as { text: string }).text]
          : [];

      return text;
    }),
  ].join('\n');

  if (flattened.length < 120) {
    return false;
  }

  const requiredTitles = records
    .slice(0, Math.min(records.length, 3))
    .map((record) => record.title);
  const matched = requiredTitles.filter((title) => flattened.includes(title));

  return matched.length >= Math.min(requiredTitles.length, 2);
};

const resolvePlanTarget = (
  plan: DynamicObjectQueryPlan | null,
  definitions: ObjectDefinition[],
): ObjectDefinition | null => {
  if (!plan?.handled) {
    return null;
  }

  const byId =
    (plan.targetObjectId &&
      definitions.find((definition) => definition.id === plan.targetObjectId)) ??
    null;

  if (byId) {
    return byId;
  }

  const normalizedNameSingular = normalizeText(
    plan.targetObjectNameSingular ?? '',
  );
  const normalizedNamePlural = normalizeText(plan.targetObjectNamePlural ?? '');
  const normalizedLabelSingular = normalizeText(
    plan.targetObjectLabelSingular ?? '',
  );
  const normalizedLabelPlural = normalizeText(
    plan.targetObjectLabelPlural ?? '',
  );

  return (
    definitions.find((definition) =>
      uniqueNonEmpty([
        definition.nameSingular,
        definition.namePlural,
        definition.labelSingular,
        definition.labelPlural,
      ])
        .map((value) => normalizeText(value))
        .some(
          (value) =>
            value === normalizedNameSingular ||
            value === normalizedNamePlural ||
            value === normalizedLabelSingular ||
            value === normalizedLabelPlural,
        ),
    ) ?? null
  );
};

const buildDynamicQueryReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<DynamicObjectQueryResult> => {
  const definitions = await fetchQueryableObjectDefinitions();
  if (definitions.length === 0) {
    return {
      handled: false,
      reply: {
        text: '조회할 수 있는 Twenty 객체를 찾지 못했습니다.',
      },
      resultJson: {
        handled: false,
        reason: 'NO_QUERYABLE_OBJECTS',
      },
    };
  }

  const rankedDefinitions = rankDefinitions(definitions, text);
  const plannerCatalog = rankedDefinitions
    .slice(0, MAX_PLANNER_CANDIDATES)
    .map((item) => toCatalogItem(item.definition));
  const plan = await planDynamicObjectQuery({
    text,
    objectCatalog: plannerCatalog,
  });

  const selectedDefinition =
    resolvePlanTarget(plan, definitions) ??
    (rankedDefinitions[0]?.matchScore >= MIN_OBJECT_SCORE
      ? rankedDefinitions[0].definition
      : null);

  if (!selectedDefinition) {
    return {
      handled: false,
      reply: {
        text: '질의에 맞는 CRM 객체를 특정하지 못했습니다.',
      },
      resultJson: {
        handled: false,
        reason: 'UNMATCHED_OBJECT',
        rankedCatalog: rankedDefinitions.slice(0, 5).map(({ definition, score, matchScore, supportScore, reasons }) => ({
          object: toCatalogItem(definition),
          score,
          matchScore,
          supportScore,
          reasons,
        })),
      },
    };
  }

  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const selection = buildFieldSelectionForDefinition(selectedDefinition, definitionsById);
  const client = createCoreClient();
  const response = await client.query<Record<string, unknown>>({
    [selectedDefinition.namePlural]: {
      __args: {
        paging: {
          first:
            classification.detailLevel === 'DETAILED' ||
            plan?.reportMode === 'PRIORITY_REPORT'
              ? DETAIL_RECORD_LIMIT
              : SUMMARY_RECORD_LIMIT,
        },
      },
      edges: {
        node: selection,
      },
    },
  });

  const connection = response[selectedDefinition.namePlural] as
    | { edges?: Array<{ node?: Record<string, unknown> }> }
    | undefined;
  const rawRecords = (connection?.edges ?? [])
    .map((edge) => edge.node)
    .filter((node): node is Record<string, unknown> => Boolean(node));

  if (rawRecords.length === 0) {
    return {
      handled: true,
      reply: {
        text: `${selectedDefinition.labelPlural} 데이터가 없습니다.`,
      },
      resultJson: {
        handled: true,
        selectedObject: toCatalogItem(selectedDefinition),
        plan,
        count: 0,
        fieldCount: selectedDefinition.fields.length,
        records: [],
      },
    };
  }

  const flattenedRecords = rawRecords
    .map((record) => flattenRecord(record, selectedDefinition.fields))
    .sort((left, right) => {
      if ((plan?.reportMode ?? 'SUMMARY_REPORT') === 'PRIORITY_REPORT') {
        return right.priorityScore - left.priorityScore;
      }

      return left.title.localeCompare(right.title, 'ko-KR');
    });

  const reportRecords = flattenedRecords.slice(
    0,
    classification.detailLevel === 'DETAILED' ? DETAIL_RECORD_LIMIT : SUMMARY_RECORD_LIMIT,
  );
  const reportMode = plan?.reportMode ?? 'SUMMARY_REPORT';
  const fallbackReply = buildFallbackDynamicReply({
    objectLabel: selectedDefinition.labelPlural,
    reportMode,
    records: reportRecords,
    totalCount: rawRecords.length,
  });
  const synthesized = await synthesizeCrmQueryReply({
    requestText: cleanSlackText(text),
    classification,
    crmContext: {
      queryLabel: `${selectedDefinition.labelPlural} 동적 조회`,
      selectedObject: toCatalogItem(selectedDefinition),
      plan,
      selection,
      records: reportRecords,
      count: rawRecords.length,
      fieldCount: selectedDefinition.fields.length,
      rankedCatalog: rankedDefinitions.slice(0, 5).map(({ definition, score, matchScore, supportScore, reasons }) => ({
        object: toCatalogItem(definition),
        score,
        matchScore,
        supportScore,
        reasons,
      })),
    },
  });

  const reply =
    synthesized &&
    isDynamicReplySufficient({
      reply: synthesized,
      records: reportRecords,
    })
      ? synthesized
      : fallbackReply;

  return {
    handled: true,
    reply,
    resultJson: {
      handled: true,
      selectedObject: toCatalogItem(selectedDefinition),
      plan,
      count: rawRecords.length,
      fieldCount: selectedDefinition.fields.length,
      selection,
      records: reportRecords,
    },
  };
};

export const findRelevantObjectCatalog = async (
  text: string,
): Promise<ObjectCatalogItem[]> => {
  const definitions = await fetchQueryableObjectDefinitions();

  return rankDefinitions(definitions, text).map(({ definition }) =>
    toCatalogItem(definition),
  );
};

export const fetchAndFlattenDynamicObjectRecords = async ({
  text,
  classification,
}: {
  text: string;
  classification: SlackIntentClassification;
}): Promise<DynamicObjectQueryResult> => buildDynamicQueryReply({ text, classification });

export const buildDynamicObjectQueryReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<DynamicObjectQueryResult> => buildDynamicQueryReply({ classification, text });
