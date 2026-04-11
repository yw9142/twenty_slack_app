import { DEFAULT_ANTHROPIC_MODEL } from 'src/constants/slack-intake';
import {
  buildQueryPlannerSystemPrompt,
  buildQueryPlannerUserPrompt,
  buildQuerySynthesisSystemPrompt,
  buildQuerySynthesisUserPrompt,
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
import { fetchWriteCandidateContext } from 'src/utils/crm-write-candidates';
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
            enum: [
              'company',
              'person',
              'opportunity',
              'solution',
              'companyRelationship',
              'opportunityStakeholder',
              'opportunitySolution',
              'note',
              'task',
            ],
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
            enum: [
              'company',
              'person',
              'opportunity',
              'solution',
              'companyRelationship',
              'opportunityStakeholder',
              'opportunitySolution',
              'note',
              'task',
            ],
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

const containsAny = (value: string, keywords: string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword));

const toSingleLineSlackText = (value: string): string =>
  cleanSlackText(value, { singleLine: true });

const COMPANY_STOPWORDS = new Set([
  '관련해서',
  '그대로',
  '고객',
  '고객사',
  '회사',
  '오늘',
  '이번',
  '기존에',
  '현재',
  '후속',
  '미팅',
]);

const PERSON_PREFIX_PATTERN =
  /^(?:담당자는?|실무\s*담당자는?|의사결정자는?|참석자는?|그대로)\s+/;
const PERSON_TITLE_PATTERN =
  /\s*(?:부장|차장|팀장|책임|이사|매니저|본부장|실장|대리|과장|상무|전무|대표)(?:이다|입니다)?$/;

const normalizeEntityToken = (value: string): string =>
  cleanSlackText(value, { singleLine: true })
    .replace(/[“”"'`()[\]{}<>]/g, ' ')
    .replace(/[,:;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const sanitizeCompanyName = (value: string): string | null => {
  const normalized = normalizeEntityToken(value).replace(
    /^(?:오늘|이번|기존에|현재|후속|관련해서|그대로)\s+/,
    '',
  );

  if (normalized.length < 2 || COMPANY_STOPWORDS.has(normalized)) {
    return null;
  }

  return normalized;
};

const sanitizePersonName = (value: string): string | null => {
  const normalized = normalizeEntityToken(value)
    .replace(PERSON_PREFIX_PATTERN, '')
    .replace(PERSON_TITLE_PATTERN, '')
    .trim();

  return normalized.length >= 2 ? normalized : null;
};

const collectMatches = (
  text: string,
  pattern: RegExp,
  sanitizer: (value: string) => string | null,
): string[] =>
  Array.from(text.matchAll(pattern))
    .map((match) => sanitizer(match[1] ?? ''))
    .filter((value): value is string => Boolean(value));

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

const extractEntityHints = (text: string): EntityHints => {
  const companyMatches = [
    ...collectMatches(
      text,
      /([A-Za-z0-9가-힣&._-]{2,})(?:\s*)(?:회사|고객|고객사|벤더|파트너)/g,
      sanitizeCompanyName,
    ),
    ...collectMatches(
      text,
      /([A-Za-z0-9가-힣&._-]{2,}(?:은행|금융|증권|보험|카드|전자|제조|물산|건설|화학|반도체|그룹))/g,
      sanitizeCompanyName,
    ),
    ...collectMatches(
      text,
      /([A-Za-z0-9가-힣&._-]{2,})\s+(?:인프라팀|보안팀|설계본부|본부장|운영총괄|영업팀|구매팀|총괄|실무팀)/g,
      sanitizeCompanyName,
    ),
  ];

  const opportunityMatches = Array.from(
    text.matchAll(/([A-Za-z0-9가-힣&._\-/]{2,})(?:\s*)(?:딜|기회|영업기회|PoC|견적)/g),
  ).map((match) => match[1] ?? '');

  const personMatches = [
    ...collectMatches(
      text,
      /(?:담당자는?|실무\s*담당자는?|의사결정자는?)\s*((?:그대로\s+)?[A-Za-z가-힣]{2,}(?:\s+[A-Za-z가-힣]{2,})?)(?:\s*)(?:부장|차장|팀장|책임|이사|매니저|본부장)?/g,
      sanitizePersonName,
    ),
    ...collectMatches(
      text,
      /([A-Za-z가-힣]{2,}(?:\s+[A-Za-z가-힣]{2,})?)(?:\s*)(?:담당자|매니저|이사|부장|차장|팀장|책임|본부장)/g,
      sanitizePersonName,
    ),
  ];

  const solutionMatches = Array.from(
    text.matchAll(
      /(Citrix|NetScaler|Nubo|Tibco|TIBCO|Spotfire|VDI|VMI|ADC|Analytics)/gi,
    ),
  ).map((match) => match[1] ?? '');

  return {
    companies: uniqueNonEmpty(companyMatches),
    opportunities: uniqueNonEmpty(opportunityMatches),
    people: uniqueNonEmpty(personMatches),
    solutions: uniqueNonEmpty(solutionMatches),
  };
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
  const cleanedSingleLine = toSingleLineSlackText(cleanedText);
  const normalized = normalizeText(cleanedText);
  const noteTitle =
    entityHints.companies[0] && entityHints.solutions[0]
      ? `${entityHints.companies[0]} ${entityHints.solutions[0]} 기회 메모`
      : entityHints.companies[0]
        ? `${entityHints.companies[0]} 영업 메모`
        : truncate(cleanedSingleLine || '영업 메모', 50);

  actions.push({
    kind: 'note',
    operation: 'create',
    data: {
      title: noteTitle,
      bodyV2: {
        markdown: cleanedText,
        blocknote: null,
      },
    },
  });

  const companyName = entityHints.companies[0];

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

  if (
    entityHints.companies[0] &&
    (entityHints.solutions[0] ||
      containsAny(normalized, ['기회', '검토', '전환', '제안', 'poc', '견적', '도입', '수요']))
  ) {
    actions.push({
      kind: 'opportunity',
      operation: 'create',
      data: {
        name:
          entityHints.companies[0] && entityHints.solutions[0]
            ? `${entityHints.companies[0]} ${entityHints.solutions[0]} 전환`
            : `${entityHints.companies[0]} 신규 영업기회`,
        companyName: entityHints.companies[0],
        pointOfContactName: entityHints.people[0] ?? undefined,
        stage: containsAny(normalized, ['poc'])
          ? 'DISCOVERY_POC'
          : containsAny(normalized, ['견적', '제안'])
            ? 'QUOTED'
            : 'VENDOR_ALIGNED',
      },
    });
  }

  if (containsAny(normalizeText(text), ['할일', 'todo', '후속', '액션'])) {
    actions.push({
      kind: 'task',
      operation: 'create',
      data: {
        title:
          entityHints.companies[0]
            ? `${entityHints.companies[0]} 후속 작업`
            : `후속 작업 - ${truncate(cleanedSingleLine, 36)}`,
        status: 'TODO',
        bodyV2: {
          markdown: cleanedText,
          blocknote: null,
        },
      },
    });
  }

  return actions;
};

const buildFallbackDraft = (text: string): CrmWriteDraft => {
  const cleanedText = cleanSlackText(text);
  const entityHints = extractEntityHints(cleanedText);
  const actions = fallbackWriteActions(cleanedText);

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
        entityHints.companies[0] && actions.some((action) => action.kind === 'opportunity')
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

const sanitizeDraftAction = (
  action: CrmActionRecord,
  sourceText: string,
): CrmActionRecord => {
  const nextData = { ...action.data };
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
    actions: draft.actions.map((action) =>
      sanitizeDraftAction(action, cleanedSourceText),
    ),
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

const buildAnthropicRequestHeaders = (apiKey: string) => ({
  'anthropic-version': ANTHROPIC_API_VERSION,
  'content-type': 'application/json; charset=utf-8',
  'x-api-key': apiKey,
});

const parseAnthropicTextContent = <TResponse extends Record<string, unknown>>(
  payload: AnthropicMessageResponse,
): TResponse | null => {
  const content = payload.content?.find((block) => block.type === 'text') as
    | AnthropicTextBlock
    | undefined;

  if (!content?.text) {
    return null;
  }

  try {
    return JSON.parse(content.text) as TResponse;
  } catch {
    return null;
  }
};

const callAnthropicStructuredJson = async <TResponse extends Record<string, unknown>>({
  systemPrompt,
  userPrompt,
  schema,
  maxTokens = ANTHROPIC_MAX_TOKENS,
  effort = 'medium',
}: {
  systemPrompt: string;
  userPrompt: string;
  schema: JsonSchema;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high';
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
    timeframe:
      aiResult.timeframe === 'THIS_MONTH' || aiResult.timeframe === 'RECENT'
        ? aiResult.timeframe
        : fallback.timeframe,
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
  const candidateContext = await fetchWriteCandidateContext({
    text: cleanedText,
    entityHints: extractEntityHints(cleanedText),
  });
  const aiResult = await callAnthropicStructuredJson<StructuredCrmWriteDraft>({
    systemPrompt: buildWriteDraftSystemPrompt(),
    userPrompt: buildWriteDraftUserPrompt({
      cleanedText,
      candidateContext,
    }),
    schema: crmWriteDraftSchema,
    effort: 'medium',
  });

  if (!aiResult) {
    return fallback;
  }

  return sanitizeDraft({
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
  }, cleanedText);
};
