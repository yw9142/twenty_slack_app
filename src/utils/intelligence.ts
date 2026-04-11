import { DEFAULT_ANTHROPIC_MODEL } from 'src/constants/slack-intake';
import {
  buildQueryPlannerSystemPrompt,
  buildQueryPlannerUserPrompt,
  buildQuerySynthesisSystemPrompt,
  buildQuerySynthesisUserPrompt,
  buildPublicEnrichmentSystemPrompt,
  buildPublicEnrichmentUserPrompt,
  buildWriteDraftSystemPrompt,
  buildWriteDraftUserPrompt,
} from 'src/constants/slack-agent-prompts';
import type {
  CrmWriteReview,
  CrmActionRecord,
  CrmWriteDraft,
  DraftReviewItem,
  EntityHints,
  QueryDetailLevel,
  QueryFocusEntity,
  QueryTimeframe,
  SlackReply,
  SlackIntentClassification,
} from 'src/types/slack-agent';
import { extractMeetingFacts } from 'src/utils/crm-facts';
import type { WriteCandidateContext } from 'src/utils/crm-write-candidates';
import { fetchWriteCandidateContext } from 'src/utils/crm-write-candidates';
import {
  extractEntityHints,
  sanitizeCompanyName,
  sanitizePersonName,
} from 'src/utils/entity-hints';
import { getAnthropicModel, getOptionalEnv } from 'src/utils/env';
import {
  cleanSlackText,
  normalizeText,
  truncate,
  uniqueNonEmpty,
} from 'src/utils/strings';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
const ANTHROPIC_MAX_TOKENS = 1024;
const ANTHROPIC_QUERY_REPLY_MAX_TOKENS = 2048;
const CRM_QUERY_PLAN_TOOL_NAME = 'plan_crm_query';

type JsonSchema = Record<string, unknown>;

type AnthropicToolDefinition = Record<string, unknown>;

type AnthropicTextBlock = {
  type?: string;
  text?: string;
};

type AnthropicToolUseBlock = {
  type?: string;
  name?: string;
  input?: Record<string, unknown>;
};

type AnthropicMessageResponse = {
  content?: Array<AnthropicTextBlock | AnthropicToolUseBlock>;
};

type CrmReplySection = {
  title: string;
  body: string;
};

type SynthesizedCrmReply = {
  text: string;
  sections: CrmReplySection[];
};

type StructuredCrmWriteDraft = CrmWriteDraft;

type PublicEnrichmentResponse = {
  companies: Array<{
    name: string;
    domainName?: string;
    linkedinLink?: string;
    employees?: number;
  }>;
  people: Array<{
    name: string;
    companyName?: string;
    jobTitle?: string;
    linkedinLink?: string;
    city?: string;
  }>;
};

type MeetingFacts = ReturnType<typeof extractMeetingFacts>;

const SUPPORTED_WRITE_KINDS = [
  'company',
  'person',
  'opportunity',
  'note',
  'task',
] as const;

type SupportedWriteKind = (typeof SUPPORTED_WRITE_KINDS)[number];

const WRITE_ALLOWED_FIELDS: Record<SupportedWriteKind, Set<string>> = {
  company: new Set(['name', 'domainName', 'linkedinLink', 'employees']),
  person: new Set([
    'name',
    'companyName',
    'jobTitle',
    'primaryEmail',
    'linkedinLink',
    'city',
  ]),
  opportunity: new Set([
    'name',
    'companyName',
    'pointOfContactName',
    'stage',
    'closeDate',
    'amount',
    'currencyCode',
  ]),
  note: new Set([
    'title',
    'body',
    'bodyV2',
    'companyName',
    'pointOfContactName',
    'opportunityName',
  ]),
  task: new Set([
    'title',
    'body',
    'bodyV2',
    'status',
    'dueAt',
    'companyName',
    'pointOfContactName',
    'opportunityName',
  ]),
};

const crmReplySchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          body: { type: 'string' },
        },
        required: ['title', 'body'],
        additionalProperties: false,
      },
    },
  },
  required: ['text', 'sections'],
  additionalProperties: false,
} as const satisfies JsonSchema;

const crmQueryPlanSchema = {
  type: 'object',
  properties: {
    intentType: {
      type: 'string',
      enum: ['QUERY', 'WRITE_DRAFT', 'APPROVAL_ACTION', 'UNKNOWN'],
    },
    confidence: { type: 'number' },
    summary: { type: 'string' },
    queryCategory: {
      type: 'string',
      enum: [
        'MONTHLY_NEW',
        'OPPORTUNITY_STATUS',
        'RISK_REVIEW',
        'PIPELINE_SUMMARY',
        'RECORD_LOOKUP',
        'GENERAL',
      ],
    },
    detailLevel: {
      type: 'string',
      enum: ['SUMMARY', 'DETAILED'],
    },
    timeframe: {
      type: 'string',
      enum: ['THIS_MONTH', 'RECENT', 'ALL_TIME'],
    },
    focusEntity: {
      type: 'string',
      enum: ['GENERAL', 'COMPANY', 'PERSON', 'OPPORTUNITY', 'TASK', 'NOTE'],
    },
    entityHints: {
      type: 'object',
      properties: {
        companies: {
          type: 'array',
          items: { type: 'string' },
        },
        people: {
          type: 'array',
          items: { type: 'string' },
        },
        opportunities: {
          type: 'array',
          items: { type: 'string' },
        },
        solutions: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['companies', 'people', 'opportunities', 'solutions'],
      additionalProperties: false,
    },
  },
  required: [
    'intentType',
    'confidence',
    'summary',
    'queryCategory',
    'detailLevel',
    'timeframe',
    'focusEntity',
    'entityHints',
  ],
  additionalProperties: false,
} as const satisfies JsonSchema;

const draftReviewSchema = {
  type: 'object',
  properties: {
    overview: { type: 'string' },
    opinion: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: [...SUPPORTED_WRITE_KINDS],
          },
          decision: {
            type: 'string',
            enum: ['CREATE', 'UPDATE', 'SKIP'],
          },
          target: { type: 'string' },
          matchedRecord: { type: 'string' },
          reason: { type: 'string' },
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                value: { type: 'string' },
              },
              required: ['key', 'value'],
              additionalProperties: false,
            },
          },
        },
        required: ['kind', 'decision', 'target', 'fields'],
        additionalProperties: false,
      },
    },
  },
  required: ['overview', 'opinion', 'items'],
  additionalProperties: false,
} as const satisfies JsonSchema;

const crmWriteDraftSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    confidence: { type: 'number' },
    sourceText: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: [...SUPPORTED_WRITE_KINDS],
          },
          operation: {
            type: 'string',
            enum: ['create', 'update'],
          },
          lookup: {
            type: 'object',
            additionalProperties: {
              type: 'string',
            },
          },
          data: {
            type: 'object',
            additionalProperties: true,
          },
        },
        required: ['kind', 'operation', 'data'],
        additionalProperties: false,
      },
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
    review: draftReviewSchema,
  },
  required: ['summary', 'confidence', 'sourceText', 'actions', 'warnings', 'review'],
  additionalProperties: false,
} as const satisfies JsonSchema;

const publicEnrichmentSchema = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          domainName: { type: 'string' },
          linkedinLink: { type: 'string' },
          employees: { type: 'number' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
    people: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          companyName: { type: 'string' },
          jobTitle: { type: 'string' },
          linkedinLink: { type: 'string' },
          city: { type: 'string' },
        },
        required: ['name'],
        additionalProperties: false,
      },
    },
  },
  required: ['companies', 'people'],
  additionalProperties: false,
} as const satisfies JsonSchema;

const containsAny = (value: string, keywords: string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword));

const toSingleLineSlackText = (value: string): string =>
  cleanSlackText(value, { singleLine: true });

const determineDetailLevel = (normalized: string): QueryDetailLevel =>
  containsAny(normalized, [
    '상세',
    '상세하게',
    '하나하나',
    '전부',
    '싹',
    '전체',
    '요약하지말고',
    '빠짐없이',
    '자세히',
    'full detail',
    'detailed',
  ])
    ? 'DETAILED'
    : 'SUMMARY';

const determineTimeframe = (normalized: string): QueryTimeframe =>
  containsAny(normalized, ['이번달', '금월', 'this month'])
    ? 'THIS_MONTH'
    : containsAny(normalized, ['최근', 'latest', 'recent'])
      ? 'RECENT'
      : 'ALL_TIME';

const mentionsThisMonth = (normalized: string): boolean =>
  containsAny(normalized, ['이번달', '금월', 'this month']);

const mentionsRecent = (normalized: string): boolean =>
  containsAny(normalized, ['최근', 'latest', 'recent']);

const determineFocusEntity = (
  normalized: string,
  entityHints: EntityHints,
): QueryFocusEntity => {
  if (
    entityHints.opportunities.length > 0 ||
    containsAny(normalized, ['영업기회', '기회', '딜', '파이프라인'])
  ) {
    return 'OPPORTUNITY';
  }

  if (entityHints.people.length > 0 || containsAny(normalized, ['담당자', '사람', '연락처'])) {
    return 'PERSON';
  }

  if (entityHints.companies.length > 0 || containsAny(normalized, ['회사', '고객사', '고객'])) {
    return 'COMPANY';
  }

  if (containsAny(normalized, ['작업', 'task', 'todo'])) {
    return 'TASK';
  }

  if (containsAny(normalized, ['노트', '메모', 'note'])) {
    return 'NOTE';
  }

  return 'GENERAL';
};


const buildFallbackClassification = (
  text: string,
): SlackIntentClassification => {
  const cleanedText = cleanSlackText(text);
  const normalized = normalizeText(cleanedText);
  const entityHints = extractEntityHints(cleanedText);

  if (
    containsAny(normalized, [
      '이번달',
      '몇 건',
      '상태',
      '리스크',
      '조회',
      '알려',
      '보여',
      '무슨',
      'what',
      'show',
      'status',
      '?',
    ])
  ) {
      return {
        intentType: 'QUERY',
        confidence: 0.68,
        summary: 'CRM 조회 요청으로 분류했습니다.',
      queryCategory: containsAny(normalized, ['이번달', '신규'])
        ? 'MONTHLY_NEW'
        : containsAny(normalized, ['리스크', '누락', '정체'])
          ? 'RISK_REVIEW'
          : containsAny(normalized, ['상태', '단계', '딜'])
            ? 'OPPORTUNITY_STATUS'
            : 'GENERAL',
        detailLevel: determineDetailLevel(normalized),
        timeframe: determineTimeframe(normalized),
        focusEntity: determineFocusEntity(normalized, entityHints),
        entityHints,
      };
    }

  return {
    intentType: 'WRITE_DRAFT',
    confidence: 0.58,
    summary: 'CRM 반영 초안 요청으로 분류했습니다.',
    queryCategory: 'GENERAL',
    detailLevel: 'SUMMARY',
    timeframe: determineTimeframe(normalized),
    focusEntity: determineFocusEntity(normalized, entityHints),
    entityHints,
  };
};

const fallbackWriteActions = (text: string): CrmActionRecord[] => {
  const actions: CrmActionRecord[] = [];
  const cleanedText = cleanSlackText(text);
  const entityHints = extractEntityHints(cleanedText);
  const facts = extractMeetingFacts(cleanedText);
  const cleanedSingleLine = toSingleLineSlackText(cleanedText);
  const normalized = normalizeText(cleanedText);
  const companyName = facts.companyName ?? entityHints.companies[0] ?? null;
  const pointOfContactName = facts.personName ?? entityHints.people[0] ?? null;
  const noteTitle = facts.noteTitle || truncate(cleanedSingleLine || '영업 메모', 50);

  actions.push({
    kind: 'note',
    operation: 'create',
    data: {
      title: noteTitle,
      bodyV2: {
        markdown: cleanedText,
        blocknote: null,
      },
      ...(companyName ? { companyName } : {}),
      ...(pointOfContactName ? { pointOfContactName } : {}),
      ...(facts.opportunityName ? { opportunityName: facts.opportunityName } : {}),
    },
  });

  if (companyName) {
    actions.push({
      kind: 'company',
      operation: 'create',
      lookup: { name: companyName },
      data: {
        name: companyName,
      },
    });
  }

  if (pointOfContactName) {
    actions.push({
      kind: 'person',
      operation: 'create',
      lookup: {
        name: pointOfContactName,
        ...(companyName ? { companyName } : {}),
      },
      data: {
        name: pointOfContactName,
        ...(companyName ? { companyName } : {}),
        ...(facts.personTitle ? { jobTitle: facts.personTitle } : {}),
      },
    });
  }

  if (
    companyName &&
    (entityHints.solutions[0] ||
      containsAny(normalized, ['기회', '검토', '전환', '제안', 'poc', '견적', '도입', '수요']))
  ) {
    actions.push({
      kind: 'opportunity',
      operation: 'create',
      data: {
        name: facts.opportunityName ?? `${companyName} 신규 영업기회`,
        companyName,
        ...(pointOfContactName ? { pointOfContactName } : {}),
        stage:
          facts.stage ??
          (containsAny(normalized, ['poc'])
            ? 'DISCOVERY_POC'
            : containsAny(normalized, ['견적', '제안'])
              ? 'QUOTED'
              : 'VENDOR_ALIGNED'),
        ...(facts.closeDate ? { closeDate: facts.closeDate } : {}),
      },
    });
  }

  if (
    facts.taskTitle ||
    facts.nextAction ||
    containsAny(normalizeText(text), ['할일', 'todo', '후속', '액션', '요청받았다', '전달해야'])
  ) {
    actions.push({
      kind: 'task',
      operation: 'create',
      data: {
        title:
          facts.taskTitle ??
          (companyName
            ? `${companyName} 후속 작업`
            : `후속 작업 - ${truncate(cleanedSingleLine, 36)}`),
        status: 'TODO',
        bodyV2: {
          markdown: facts.taskBody ?? cleanedText,
          blocknote: null,
        },
        ...(facts.dueAt ? { dueAt: facts.dueAt } : {}),
        ...(companyName ? { companyName } : {}),
        ...(pointOfContactName ? { pointOfContactName } : {}),
        ...(facts.opportunityName ? { opportunityName: facts.opportunityName } : {}),
      },
    });
  }

  return actions;
};

const buildFallbackDraft = (text: string): CrmWriteDraft => {
  const cleanedText = cleanSlackText(text);
  const actions = fallbackWriteActions(cleanedText);
  const facts = extractMeetingFacts(cleanedText);

  return {
    summary: '정리된 메모를 기준으로 CRM 반영 초안을 만들었습니다.',
    confidence: 0.45,
    sourceText: cleanedText,
    actions,
    warnings: [
      '자동 추출 초안입니다. 실제 반영 전 Slack 승인 카드에서 반드시 확인하세요.',
    ],
    review: {
      overview: '자동 추출 결과를 기반으로 반영 계획을 만들었습니다.',
      opinion:
        facts.companyName && actions.some((action) => action.kind === 'opportunity')
          ? '회사와 기회 신호가 있어 영업기회 생성 초안을 포함했습니다.'
          : '정보가 제한적이어서 메모 중심으로 보수적으로 작성했습니다.',
      items: actions.map((action) => ({
        kind: action.kind,
        decision: action.operation === 'update' ? 'UPDATE' : 'CREATE',
        target:
          typeof action.data.title === 'string'
            ? action.data.title
            : typeof action.data.name === 'string'
              ? action.data.name
              : action.lookup?.name ?? action.kind,
        matchedRecord: action.lookup?.name ?? null,
        reason:
          action.kind === 'opportunity'
            ? '회사와 기회 신호가 있어 영업기회 반영 대상으로 판단했습니다.'
            : '메모 내용을 구조화해 보조 기록으로 남깁니다.',
        fields: Object.entries(action.data)
          .filter(([, value]) =>
            typeof value === 'string' || typeof value === 'number',
          )
          .slice(0, 4)
          .map(([key, value]) => ({
            key,
            value: String(value),
          })),
      })),
    },
  };
};

const sanitizeDraftTextField = (
  value: unknown,
  { singleLine = false }: { singleLine?: boolean } = {},
): unknown => {
  if (typeof value !== 'string') {
    return value;
  }

  return cleanSlackText(value, { singleLine });
};

const isSupportedWriteKind = (kind: CrmActionRecord['kind']): kind is SupportedWriteKind =>
  (SUPPORTED_WRITE_KINDS as readonly string[]).includes(kind);

const filterAllowedWriteFields = (
  kind: SupportedWriteKind,
  data: Record<string, unknown>,
): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(data).filter(([key]) => WRITE_ALLOWED_FIELDS[kind].has(key)),
  );

const hasRequiredWriteShape = (
  kind: SupportedWriteKind,
  data: Record<string, unknown>,
): boolean => {
  if (kind === 'company' || kind === 'person' || kind === 'opportunity') {
    return typeof data.name === 'string' && data.name.trim().length > 0;
  }

  if (kind === 'note' || kind === 'task') {
    return Boolean(
      (typeof data.title === 'string' && data.title.trim().length > 0) ||
      typeof data.body === 'string' ||
      (data.bodyV2 &&
        typeof data.bodyV2 === 'object' &&
        typeof (data.bodyV2 as { markdown?: unknown }).markdown === 'string'),
    );
  }

  return false;
};

const sanitizeDraftAction = (
  action: CrmActionRecord,
  sourceText: string,
): CrmActionRecord | null => {
  if (!isSupportedWriteKind(action.kind)) {
    return null;
  }

  const nextData = filterAllowedWriteFields(action.kind, { ...action.data });
  const cleanedSource = toSingleLineSlackText(sourceText);

  if (typeof nextData.title === 'string') {
    nextData.title =
      action.kind === 'note' && nextData.title.startsWith('Slack 메모')
        ? truncate(cleanedSource || String(nextData.title), 50)
        : sanitizeDraftTextField(nextData.title, { singleLine: true });
  }

  if (typeof nextData.name === 'string') {
    nextData.name = sanitizeDraftTextField(nextData.name, { singleLine: true });
  }

  if (typeof nextData.companyName === 'string') {
    const sanitizedCompanyName = sanitizeCompanyName(nextData.companyName);

    if (sanitizedCompanyName) {
      nextData.companyName = sanitizedCompanyName;
    } else {
      delete nextData.companyName;
    }
  }

  if (typeof nextData.pointOfContactName === 'string') {
    const sanitizedPointOfContactName = sanitizePersonName(
      nextData.pointOfContactName,
    );

    if (sanitizedPointOfContactName) {
      nextData.pointOfContactName = sanitizedPointOfContactName;
    } else {
      delete nextData.pointOfContactName;
    }
  }

  if (typeof nextData.body === 'string') {
    nextData.body = sanitizeDraftTextField(nextData.body);
  }

  if (
    nextData.bodyV2 &&
    typeof nextData.bodyV2 === 'object' &&
    !Array.isArray(nextData.bodyV2)
  ) {
    const bodyV2 = { ...(nextData.bodyV2 as Record<string, unknown>) };

    if (typeof bodyV2.markdown === 'string') {
      bodyV2.markdown = cleanSlackText(bodyV2.markdown);
    }

    nextData.bodyV2 = bodyV2;
  }

  if (!hasRequiredWriteShape(action.kind, nextData)) {
    return null;
  }

  return {
    ...action,
    data: nextData,
  };
};

const sanitizeDraft = (draft: CrmWriteDraft, sourceText: string): CrmWriteDraft => {
  const cleanedSourceText = cleanSlackText(
    typeof draft.sourceText === 'string' ? draft.sourceText : sourceText,
  );

  return {
    ...draft,
    summary: cleanSlackText(draft.summary, { singleLine: true }),
    sourceText: cleanedSourceText,
    actions: draft.actions
      .map((action) => sanitizeDraftAction(action, cleanedSourceText))
      .filter((action): action is CrmActionRecord => action !== null),
    warnings: draft.warnings.map((warning) =>
      cleanSlackText(warning, { singleLine: true }),
    ),
    review: sanitizeDraftReview(draft.review),
  };
};

const sanitizeDraftReview = (
  review: CrmWriteReview | undefined,
): CrmWriteReview | undefined => {
  if (!review) {
    return undefined;
  }

  return {
    overview: cleanSlackText(review.overview, { singleLine: true }),
    opinion: cleanSlackText(review.opinion),
    items: review.items
      .filter(
        (item): item is DraftReviewItem =>
          typeof item.target === 'string' && item.target.trim().length > 0,
      )
      .map((item) => ({
        ...item,
        target: cleanSlackText(item.target, { singleLine: true }),
        matchedRecord:
          typeof item.matchedRecord === 'string'
            ? cleanSlackText(item.matchedRecord, { singleLine: true })
            : item.matchedRecord,
        reason:
          typeof item.reason === 'string' ? cleanSlackText(item.reason) : item.reason,
        fields: item.fields
          .filter(
            (field) =>
              typeof field.key === 'string' &&
              field.key.trim().length > 0 &&
              typeof field.value === 'string' &&
              field.value.trim().length > 0,
          )
          .map((field) => ({
            key: cleanSlackText(field.key, { singleLine: true }),
            value: cleanSlackText(field.value, { singleLine: true }),
          })),
      })),
  };
};

const hasTextValue = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isEmptyDraftValue = (value: unknown): boolean =>
  value == null || (typeof value === 'string' && value.trim().length === 0);

const isGenericDraftValue = ({
  kind,
  key,
  value,
}: {
  kind: CrmActionRecord['kind'];
  key: string;
  value: unknown;
}): boolean => {
  if (typeof value !== 'string') {
    return false;
  }

  const normalized = normalizeText(cleanSlackText(value, { singleLine: true }));

  if (key === 'companyName') {
    return sanitizeCompanyName(value) == null;
  }

  if (key === 'pointOfContactName') {
    return sanitizePersonName(value) == null;
  }

  if (key === 'name' && kind === 'company') {
    return sanitizeCompanyName(value) == null;
  }

  if (key === 'name' && kind === 'person') {
    return sanitizePersonName(value) == null;
  }

  if (key === 'name' && kind === 'opportunity') {
    return normalized.includes('신규 영업기회') || normalized.includes('관련해서');
  }

  if (key === 'title' && (kind === 'note' || kind === 'task')) {
    return (
      normalized.includes('영업 메모') ||
      normalized.includes('후속 작업') ||
      normalized === '미팅 메모'
    );
  }

  return false;
};

const shouldReplaceWithGroundedValue = ({
  kind,
  key,
  currentValue,
}: {
  kind: CrmActionRecord['kind'];
  key: string;
  currentValue: unknown;
}): boolean => isEmptyDraftValue(currentValue) || isGenericDraftValue({ kind, key, value: currentValue });

const mergeActionData = (
  action: CrmActionRecord,
  groundedData: Record<string, unknown>,
): CrmActionRecord => {
  const nextData = { ...action.data };

  for (const [key, value] of Object.entries(groundedData)) {
    if (value == null) {
      continue;
    }

    if (
      shouldReplaceWithGroundedValue({
        kind: action.kind,
        key,
        currentValue: nextData[key],
      })
    ) {
      nextData[key] = value;
    }
  }

  return {
    ...action,
    data: nextData,
  };
};

const ensureAction = ({
  actions,
  kind,
  groundedData,
  factory,
}: {
  actions: CrmActionRecord[];
  kind: CrmActionRecord['kind'];
  groundedData: Record<string, unknown>;
  factory: () => CrmActionRecord;
}): CrmActionRecord[] => {
  const index = actions.findIndex((action) => action.kind === kind);

  if (index >= 0) {
    const nextActions = [...actions];
    nextActions[index] = mergeActionData(nextActions[index], groundedData);

    return nextActions;
  }

  return [...actions, mergeActionData(factory(), groundedData)];
};

const createBodyV2 = (markdown: string): { markdown: string; blocknote: null } => ({
  markdown,
  blocknote: null,
});

const hasOpportunitySignal = (sourceText: string, facts: MeetingFacts): boolean => {
  const normalized = normalizeText(sourceText);

  return Boolean(
    facts.companyName &&
      (facts.solutionName ||
        facts.vendorName ||
        facts.stage ||
        facts.closeDate ||
        facts.nextAction ||
        containsAny(normalized, [
          '기회',
          '검토',
          '전환',
          '제안',
          'poc',
          '견적',
          '도입',
          '수요',
          '업그레이드',
          '고도화',
          '증설',
        ])),
  );
};

const getFirstActionByKind = (
  draft: CrmWriteDraft,
  kind: SupportedWriteKind,
): CrmActionRecord | undefined => draft.actions.find((action) => action.kind === kind);

const getStringField = (
  value: unknown,
): string | null => (typeof value === 'string' && value.trim().length > 0 ? value : null);

const deriveDraftMatchContext = ({
  draft,
  facts,
}: {
  draft: CrmWriteDraft;
  facts: MeetingFacts;
}) => {
  const companyAction = getFirstActionByKind(draft, 'company');
  const personAction = getFirstActionByKind(draft, 'person');
  const opportunityAction = getFirstActionByKind(draft, 'opportunity');
  const noteAction = getFirstActionByKind(draft, 'note');
  const taskAction = getFirstActionByKind(draft, 'task');

  const companyName =
    getStringField(companyAction?.data.name) ??
    getStringField(opportunityAction?.data.companyName) ??
    getStringField(personAction?.data.companyName) ??
    getStringField(noteAction?.data.companyName) ??
    getStringField(taskAction?.data.companyName) ??
    facts.companyName;

  const personName =
    getStringField(personAction?.data.name) ??
    getStringField(opportunityAction?.data.pointOfContactName) ??
    getStringField(noteAction?.data.pointOfContactName) ??
    getStringField(taskAction?.data.pointOfContactName) ??
    facts.personName;

  const opportunityName =
    getStringField(opportunityAction?.data.name) ??
    getStringField(noteAction?.data.opportunityName) ??
    getStringField(taskAction?.data.opportunityName) ??
    facts.opportunityName;

  return {
    companyName,
    personName,
    opportunityName,
    solutionName: facts.solutionName,
  };
};

const isSameNormalized = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => hasTextValue(left ?? null) && hasTextValue(right ?? null)
  ? normalizeText(left) === normalizeText(right)
  : false;

const pickMatchingOpportunityCandidate = ({
  candidateContext,
  context,
}: {
  candidateContext: WriteCandidateContext;
  context: {
    companyName: string | null;
    personName: string | null;
    opportunityName: string | null;
    solutionName: string | null;
  };
}) => {
  const scored = candidateContext.opportunities
    .map((opportunity: WriteCandidateContext['opportunities'][number]) => {
      let score = 0;

      if (!isSameNormalized(opportunity.companyName ?? null, context.companyName)) {
        return {
          opportunity,
          score: -1,
        };
      }

      score += 5;

      if (
        context.personName &&
        isSameNormalized(opportunity.pointOfContactName ?? null, context.personName)
      ) {
        score += 3;
      }

      if (
        context.solutionName &&
        normalizeText(opportunity.name).includes(normalizeText(context.solutionName))
      ) {
        score += 2;
      }

      if (
        context.opportunityName &&
        (normalizeText(opportunity.name).includes(normalizeText(context.opportunityName)) ||
          normalizeText(context.opportunityName).includes(normalizeText(opportunity.name)))
      ) {
        score += 2;
      }

      return {
        opportunity,
        score,
      };
    })
    .filter((entry: { opportunity: WriteCandidateContext['opportunities'][number]; score: number }) => entry.score >= 6)
    .sort(
      (
        left: { opportunity: WriteCandidateContext['opportunities'][number]; score: number },
        right: { opportunity: WriteCandidateContext['opportunities'][number]; score: number },
      ) => right.score - left.score,
    );

  return scored[0]?.opportunity ?? null;
};

const applyCandidateLookups = ({
  draft,
  candidateContext,
  facts,
}: {
  draft: CrmWriteDraft;
  candidateContext: WriteCandidateContext;
  facts: MeetingFacts;
}): CrmWriteDraft => {
  const context = deriveDraftMatchContext({
    draft,
    facts,
  });
  const companyCandidate = candidateContext.companies.find((company) =>
    isSameNormalized(company.name, context.companyName),
  );
  const personCandidate = candidateContext.people.find(
    (person: WriteCandidateContext['people'][number]) =>
      isSameNormalized(person.fullName, context.personName) &&
      (!context.companyName ||
        isSameNormalized(person.companyName ?? null, context.companyName)),
  );
  const opportunityCandidate = pickMatchingOpportunityCandidate({
    candidateContext,
    context,
  });

  return {
    ...draft,
    actions: draft.actions.map((action) => {
      if (action.kind === 'company' && companyCandidate) {
        return {
          ...action,
          lookup: {
            ...(action.lookup ?? {}),
            name: companyCandidate.name,
          },
        };
      }

      if (action.kind === 'person' && personCandidate) {
        return {
          ...action,
          lookup: {
            ...(action.lookup ?? {}),
            name: personCandidate.fullName,
            ...(personCandidate.companyName ? { companyName: personCandidate.companyName } : {}),
          },
        };
      }

      if (action.kind === 'opportunity' && opportunityCandidate) {
        return {
          ...action,
          operation: 'update',
          lookup: {
            ...(action.lookup ?? {}),
            name: opportunityCandidate.name,
          },
        };
      }

      return action;
    }),
  };
};

const toReviewFieldEntries = (data: Record<string, unknown>) =>
  Object.entries(data)
    .flatMap(([key, value]) => {
      if (typeof value === 'string' || typeof value === 'number') {
        return [{ key, value: String(value) }];
      }

      if (
        value &&
        typeof value === 'object' &&
        typeof (value as { primaryLinkUrl?: unknown }).primaryLinkUrl === 'string'
      ) {
        return [{ key, value: String((value as { primaryLinkUrl: string }).primaryLinkUrl) }];
      }

      if (
        key === 'bodyV2' &&
        value &&
        typeof value === 'object' &&
        typeof (value as { markdown?: unknown }).markdown === 'string'
      ) {
        return [{ key: 'body', value: truncate(String((value as { markdown: string }).markdown), 80) }];
      }

      return [];
    })
    .slice(0, 6);

const buildReviewReason = ({
  action,
}: {
  action: CrmActionRecord;
}): string => {
  if (action.kind === 'company') {
    return '고객사 정보를 근거로 회사 레코드에 반영합니다.';
  }

  if (action.kind === 'person') {
    return '담당자와 직함 정보가 확인되어 담당자 레코드에 반영합니다.';
  }

  if (action.kind === 'opportunity') {
    return action.operation === 'update'
      ? '회사, 담당자, 솔루션 후보 맥락이 맞아 기존 영업기회를 업데이트합니다.'
      : '회사와 기회 신호가 충분해 신규 영업기회로 반영합니다.';
  }

  if (action.kind === 'task') {
    return '후속 일정이나 요청사항이 있어 작업으로 남깁니다.';
  }

  return '원문 미팅 메모를 근거 기록으로 남깁니다.';
};

const buildReviewFromDraft = ({
  draft,
}: {
  draft: CrmWriteDraft;
}): CrmWriteReview => {
  const hasOpportunityAction = draft.actions.some((action) => action.kind === 'opportunity');
  const hasTaskAction = draft.actions.some((action) => action.kind === 'task');
  const hasPersonAction = draft.actions.some((action) => action.kind === 'person');

  const overview = hasOpportunityAction
    ? hasTaskAction
      ? '회사, 담당자, 영업기회와 후속 작업 기준으로 CRM 반영 계획을 정리했습니다.'
      : '회사, 담당자, 영업기회 기준으로 CRM 반영 계획을 정리했습니다.'
    : hasPersonAction
      ? '회사와 담당자 중심으로 CRM 반영 계획을 정리했습니다.'
      : '메모 중심으로 CRM 반영 계획을 정리했습니다.';

  const opinion = draft.actions.some(
    (action) => action.kind === 'opportunity' && action.operation === 'update',
  )
    ? '기존 CRM 후보와 맥락이 맞는 항목은 업데이트 중심으로, 나머지는 신규 생성 중심으로 정리했습니다.'
    : hasOpportunityAction
      ? '회사와 기회 신호가 충분해 영업기회 반영 초안을 포함했습니다.'
      : '정보가 제한적이어서 메모와 보조 기록 중심으로 정리했습니다.';

  return {
    overview,
    opinion,
    items: draft.actions.map((action) => ({
      kind: action.kind,
      decision: action.operation === 'update' ? 'UPDATE' : 'CREATE',
      target:
        typeof action.data.title === 'string'
          ? action.data.title
          : typeof action.data.name === 'string'
            ? action.data.name
            : action.lookup?.name ?? action.kind,
      matchedRecord: action.lookup?.name ?? null,
      reason: buildReviewReason({ action }),
      fields: toReviewFieldEntries(action.data),
    })),
  };
};

const fillMissingActionsFromMeetingFacts = ({
  draft,
  sourceText,
  candidateContext,
}: {
  draft: CrmWriteDraft;
  sourceText: string;
  candidateContext: WriteCandidateContext;
}): CrmWriteDraft => {
  const facts = extractMeetingFacts(sourceText);
  let actions = [...draft.actions];

  actions = ensureAction({
    actions,
    kind: 'note',
    groundedData: {
      title: facts.noteTitle,
      bodyV2: createBodyV2(sourceText),
      ...(facts.companyName ? { companyName: facts.companyName } : {}),
      ...(facts.personName ? { pointOfContactName: facts.personName } : {}),
      ...(facts.opportunityName ? { opportunityName: facts.opportunityName } : {}),
    },
    factory: () => ({
      kind: 'note',
      operation: 'create',
      data: {
        title: facts.noteTitle,
        bodyV2: createBodyV2(sourceText),
      },
    }),
  });

  if (facts.companyName) {
    actions = ensureAction({
      actions,
      kind: 'company',
      groundedData: {
        name: facts.companyName,
      },
      factory: () => ({
        kind: 'company',
        operation: 'create',
        lookup: {
          name: facts.companyName as string,
        },
        data: {
          name: facts.companyName as string,
        },
      }),
    });
  }

  if (facts.personName) {
    actions = ensureAction({
      actions,
      kind: 'person',
      groundedData: {
        name: facts.personName,
        ...(facts.personTitle ? { jobTitle: facts.personTitle } : {}),
        ...(facts.companyName ? { companyName: facts.companyName } : {}),
      },
      factory: () => ({
        kind: 'person',
        operation: 'create',
        lookup: {
          name: facts.personName as string,
          ...(facts.companyName ? { companyName: facts.companyName } : {}),
        },
        data: {
          name: facts.personName as string,
          ...(facts.personTitle ? { jobTitle: facts.personTitle } : {}),
          ...(facts.companyName ? { companyName: facts.companyName } : {}),
        },
      }),
    });
  }

  if (hasOpportunitySignal(sourceText, facts)) {
    actions = ensureAction({
      actions,
      kind: 'opportunity',
      groundedData: {
        ...(facts.opportunityName ? { name: facts.opportunityName } : {}),
        ...(facts.companyName ? { companyName: facts.companyName } : {}),
        ...(facts.personName ? { pointOfContactName: facts.personName } : {}),
        ...(facts.stage ? { stage: facts.stage } : {}),
        ...(facts.closeDate ? { closeDate: facts.closeDate } : {}),
      },
      factory: () => ({
        kind: 'opportunity',
        operation: 'create',
        data: {
          name: facts.opportunityName ?? '신규 영업기회',
          ...(facts.companyName ? { companyName: facts.companyName } : {}),
          ...(facts.personName ? { pointOfContactName: facts.personName } : {}),
          ...(facts.stage ? { stage: facts.stage } : {}),
          ...(facts.closeDate ? { closeDate: facts.closeDate } : {}),
        },
      }),
    });
  }

  if (facts.taskTitle || facts.nextAction) {
    actions = ensureAction({
      actions,
      kind: 'task',
      groundedData: {
        ...(facts.taskTitle ? { title: facts.taskTitle } : {}),
        status: 'TODO',
        ...(facts.taskBody ? { bodyV2: createBodyV2(facts.taskBody) } : {}),
        ...(facts.dueAt ? { dueAt: facts.dueAt } : {}),
        ...(facts.companyName ? { companyName: facts.companyName } : {}),
        ...(facts.personName ? { pointOfContactName: facts.personName } : {}),
        ...(facts.opportunityName ? { opportunityName: facts.opportunityName } : {}),
      },
      factory: () => ({
        kind: 'task',
        operation: 'create',
        data: {
          title: facts.taskTitle ?? '후속 작업',
          status: 'TODO',
          ...(facts.taskBody ? { bodyV2: createBodyV2(facts.taskBody) } : {}),
          ...(facts.dueAt ? { dueAt: facts.dueAt } : {}),
          ...(facts.companyName ? { companyName: facts.companyName } : {}),
          ...(facts.personName ? { pointOfContactName: facts.personName } : {}),
          ...(facts.opportunityName ? { opportunityName: facts.opportunityName } : {}),
        },
      }),
    });
  }

  const groundedDraft = applyCandidateLookups({
    draft: {
      ...draft,
      sourceText,
      actions,
    },
    candidateContext,
    facts,
  });

  return {
    ...groundedDraft,
    review: buildReviewFromDraft({
      draft: groundedDraft,
    }),
  };
};

const buildWebSearchTool = (): AnthropicToolDefinition => ({
  type: 'web_search_20250305',
  name: 'web_search',
  max_uses: 4,
  user_location: {
    type: 'approximate',
    city: 'Seoul',
    region: 'Seoul',
    country: 'KR',
    timezone: 'Asia/Seoul',
  },
});

const toLinksValue = (primaryLinkUrl: string): { primaryLinkUrl: string } => ({
  primaryLinkUrl,
});

const mergePublicEnrichmentIntoDraft = (
  draft: CrmWriteDraft,
  enrichment: PublicEnrichmentResponse | null,
): CrmWriteDraft => {
  if (!enrichment) {
    return draft;
  }

  return {
    ...draft,
    actions: draft.actions.map((action) => {
      if (action.kind === 'company') {
        const name =
          typeof action.data.name === 'string'
            ? action.data.name
            : typeof action.lookup?.name === 'string'
              ? action.lookup.name
              : null;
        const enriched = enrichment.companies.find(
          (company) =>
            typeof name === 'string' &&
            normalizeText(company.name) === normalizeText(name),
        );

        if (!enriched) {
          return action;
        }

        return {
          ...action,
          data: {
            ...action.data,
            ...(enriched.domainName && !action.data.domainName
              ? { domainName: toLinksValue(enriched.domainName) }
              : {}),
            ...(enriched.linkedinLink && !action.data.linkedinLink
              ? { linkedinLink: toLinksValue(enriched.linkedinLink) }
              : {}),
            ...(typeof enriched.employees === 'number' &&
            action.data.employees == null
              ? { employees: enriched.employees }
              : {}),
          },
        };
      }

      if (action.kind === 'person') {
        const name =
          typeof action.data.name === 'string'
            ? action.data.name
            : typeof action.lookup?.name === 'string'
              ? action.lookup.name
              : null;
        const companyName =
          typeof action.data.companyName === 'string'
            ? action.data.companyName
            : typeof action.lookup?.companyName === 'string'
              ? action.lookup.companyName
              : undefined;
        const enriched = enrichment.people.find(
          (person) =>
            typeof name === 'string' &&
            normalizeText(person.name) === normalizeText(name) &&
            (!companyName ||
              !person.companyName ||
              normalizeText(person.companyName) === normalizeText(companyName)),
        );

        if (!enriched) {
          return action;
        }

        return {
          ...action,
          data: {
            ...action.data,
            ...(enriched.jobTitle && !action.data.jobTitle
              ? { jobTitle: enriched.jobTitle }
              : {}),
            ...(enriched.companyName && !action.data.companyName
              ? { companyName: enriched.companyName }
              : {}),
            ...(enriched.linkedinLink && !action.data.linkedinLink
              ? { linkedinLink: toLinksValue(enriched.linkedinLink) }
              : {}),
            ...(enriched.city && !action.data.city ? { city: enriched.city } : {}),
          },
        };
      }

      return action;
    }),
  };
};

const enrichDraftWithPublicContext = async ({
  draft,
  sourceText,
}: {
  draft: CrmWriteDraft;
  sourceText: string;
}): Promise<CrmWriteDraft> => {
  const entities = {
    companies: draft.actions
      .filter((action) => action.kind === 'company')
      .map((action) => ({
        name:
          typeof action.data.name === 'string'
            ? action.data.name
            : action.lookup?.name ?? '',
      }))
      .filter((company) => company.name.length > 0),
    people: draft.actions
      .filter((action) => action.kind === 'person')
      .map((action) => ({
        name:
          typeof action.data.name === 'string'
            ? action.data.name
            : action.lookup?.name ?? '',
        companyName:
          typeof action.data.companyName === 'string'
            ? action.data.companyName
            : action.lookup?.companyName,
      }))
      .filter((person) => person.name.length > 0),
  };

  if (entities.companies.length === 0 && entities.people.length === 0) {
    return draft;
  }

  const enrichment = await callAnthropicStructuredJson<PublicEnrichmentResponse>({
    systemPrompt: buildPublicEnrichmentSystemPrompt(),
    userPrompt: buildPublicEnrichmentUserPrompt({
      sourceText,
      entities,
    }),
    schema: publicEnrichmentSchema,
    maxTokens: 1200,
    tools: [buildWebSearchTool()],
  });

  return mergePublicEnrichmentIntoDraft(draft, enrichment);
};

const buildAnthropicRequestHeaders = (apiKey: string) => ({
  'anthropic-version': ANTHROPIC_API_VERSION,
  'content-type': 'application/json; charset=utf-8',
  'x-api-key': apiKey,
});

const parseAnthropicTextContent = <TResponse extends Record<string, unknown>>(
  payload: AnthropicMessageResponse,
): TResponse | null => {
  const textBlocks = (payload.content ?? []).filter(
    (block): block is AnthropicTextBlock =>
      block.type === 'text' && 'text' in block && typeof block.text === 'string',
  );

  for (const content of [...textBlocks].reverse()) {
    try {
      return JSON.parse(content.text as string) as TResponse;
    } catch {
      continue;
    }
  }

  return null;
};

const callAnthropicStructuredJson = async <TResponse extends Record<string, unknown>>({
  systemPrompt,
  userPrompt,
  schema,
  maxTokens = ANTHROPIC_MAX_TOKENS,
  effort = 'medium',
  tools,
}: {
  systemPrompt: string;
  userPrompt: string;
  schema: JsonSchema;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
  tools?: AnthropicToolDefinition[];
}): Promise<TResponse | null> => {
  const apiKey = getOptionalEnv('ANTHROPIC_API_KEY');

  if (!apiKey) {
    return null;
  }

  const model = getAnthropicModel() || DEFAULT_ANTHROPIC_MODEL;
  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: buildAnthropicRequestHeaders(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      output_config: {
        effort,
        format: {
          type: 'json_schema',
          schema,
        },
      },
      ...(tools && tools.length > 0 ? { tools } : {}),
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  return parseAnthropicTextContent<TResponse>(
    (await response.json()) as AnthropicMessageResponse,
  );
};

const callAnthropicToolInput = async <TInput extends Record<string, unknown>>({
  systemPrompt,
  userPrompt,
  toolName,
  toolDescription,
  inputSchema,
  maxTokens = ANTHROPIC_MAX_TOKENS,
  effort = 'medium',
}: {
  systemPrompt: string;
  userPrompt: string;
  toolName: string;
  toolDescription: string;
  inputSchema: JsonSchema;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
}): Promise<TInput | null> => {
  const apiKey = getOptionalEnv('ANTHROPIC_API_KEY');

  if (!apiKey) {
    return null;
  }

  const model = getAnthropicModel() || DEFAULT_ANTHROPIC_MODEL;
  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: buildAnthropicRequestHeaders(apiKey),
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      output_config: {
        effort,
      },
      system: systemPrompt,
      tools: [
        {
          name: toolName,
          description: toolDescription,
          strict: true,
          input_schema: inputSchema,
        },
      ],
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as AnthropicMessageResponse;
  const toolUseBlock = payload.content?.find(
    (block) => block.type === 'tool_use' && (block as AnthropicToolUseBlock).name === toolName,
  ) as AnthropicToolUseBlock | undefined;

  return toolUseBlock?.input ? (toolUseBlock.input as TInput) : null;
};

export const classifySlackText = async (
  text: string,
): Promise<SlackIntentClassification> => {
  const cleanedText = cleanSlackText(text);
  const normalized = normalizeText(cleanedText);
  const fallback = buildFallbackClassification(cleanedText);
  const aiResult = await callAnthropicToolInput<SlackIntentClassification>({
    systemPrompt: buildQueryPlannerSystemPrompt(),
    toolName: CRM_QUERY_PLAN_TOOL_NAME,
    toolDescription: 'Plan the CRM query intent and answer style.',
    inputSchema: crmQueryPlanSchema,
    userPrompt: buildQueryPlannerUserPrompt(cleanedText),
  });

  if (!aiResult) {
    return fallback;
  }

  return {
    ...fallback,
    ...aiResult,
    detailLevel:
      aiResult.detailLevel === 'DETAILED' ? 'DETAILED' : fallback.detailLevel,
    timeframe: mentionsThisMonth(normalized)
      ? 'THIS_MONTH'
      : mentionsRecent(normalized)
        ? 'RECENT'
        : 'ALL_TIME',
    focusEntity:
      aiResult.focusEntity === 'COMPANY' ||
      aiResult.focusEntity === 'PERSON' ||
      aiResult.focusEntity === 'OPPORTUNITY' ||
      aiResult.focusEntity === 'TASK' ||
      aiResult.focusEntity === 'NOTE'
        ? aiResult.focusEntity
        : fallback.focusEntity,
    entityHints: {
      companies: uniqueNonEmpty(aiResult.entityHints?.companies ?? []),
      people: uniqueNonEmpty(aiResult.entityHints?.people ?? []),
      opportunities: uniqueNonEmpty(aiResult.entityHints?.opportunities ?? []),
      solutions: uniqueNonEmpty(aiResult.entityHints?.solutions ?? []),
    },
  };
};

const buildSlackReplyFromSections = (
  response: SynthesizedCrmReply,
): SlackReply => ({
  text: cleanSlackText(response.text, { singleLine: true }),
  blocks: response.sections
    .filter(
      (section) =>
        typeof section.title === 'string' &&
        section.title.trim().length > 0 &&
        typeof section.body === 'string' &&
        section.body.trim().length > 0,
    )
    .map((section) => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*${cleanSlackText(section.title, { singleLine: true })}*\n` +
          cleanSlackText(section.body),
      },
    })),
});

export const synthesizeCrmQueryReply = async ({
  requestText,
  classification,
  crmContext,
}: {
  requestText: string;
  classification: SlackIntentClassification;
  crmContext: Record<string, unknown>;
}): Promise<SlackReply | null> => {
  const cleanedText = cleanSlackText(requestText);
  const response = await callAnthropicStructuredJson<SynthesizedCrmReply>({
    systemPrompt: buildQuerySynthesisSystemPrompt(),
    schema: crmReplySchema,
    maxTokens: ANTHROPIC_QUERY_REPLY_MAX_TOKENS,
    effort: 'medium',
    userPrompt: buildQuerySynthesisUserPrompt({
      cleanedText,
      classification,
      crmContext,
    }),
  });

  if (!response) {
    return null;
  }

  return buildSlackReplyFromSections(response);
};

export const buildCrmWriteDraft = async (
  text: string,
): Promise<CrmWriteDraft> => {
  const cleanedText = cleanSlackText(text);
  const fallback = buildFallbackDraft(cleanedText);
  const meetingFacts = extractMeetingFacts(cleanedText);
  const candidateContext = await fetchWriteCandidateContext({
    text: cleanedText,
    entityHints: extractEntityHints(cleanedText),
  });
  const aiResult = await callAnthropicStructuredJson<StructuredCrmWriteDraft>({
    systemPrompt: buildWriteDraftSystemPrompt(),
    userPrompt: buildWriteDraftUserPrompt({
      cleanedText,
      candidateContext,
      meetingFacts,
    }),
    schema: crmWriteDraftSchema,
    effort: 'medium',
  });

  if (!aiResult) {
    return enrichDraftWithPublicContext({
      draft: fillMissingActionsFromMeetingFacts({
        draft: fallback,
        sourceText: cleanedText,
        candidateContext,
      }),
      sourceText: cleanedText,
    });
  }

  const sanitizedDraft = sanitizeDraft(
    {
      summary:
        typeof aiResult.summary === 'string'
          ? aiResult.summary
          : fallback.summary,
      confidence:
        typeof aiResult.confidence === 'number'
          ? aiResult.confidence
          : fallback.confidence,
      sourceText:
        typeof aiResult.sourceText === 'string'
          ? aiResult.sourceText
          : cleanedText,
      actions: Array.isArray(aiResult.actions) ? aiResult.actions : fallback.actions,
      warnings: Array.isArray(aiResult.warnings)
        ? aiResult.warnings.filter(
            (warning): warning is string => typeof warning === 'string',
          )
        : fallback.warnings,
      review:
        aiResult.review && typeof aiResult.review === 'object'
          ? (aiResult.review as CrmWriteReview)
          : fallback.review,
    },
    cleanedText,
  );
  const groundedDraft = fillMissingActionsFromMeetingFacts({
    draft: sanitizedDraft,
    sourceText: cleanedText,
    candidateContext,
  });

  return enrichDraftWithPublicContext({
    draft: groundedDraft,
    sourceText: cleanedText,
  });
};
