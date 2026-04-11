import { DEFAULT_ANTHROPIC_MODEL } from 'src/constants/slack-intake';
import type {
  CrmActionRecord,
  CrmWriteDraft,
  EntityHints,
  QueryDetailLevel,
  QueryFocusEntity,
  QueryTimeframe,
  SlackReply,
  SlackIntentClassification,
} from 'src/types/slack-agent';
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
  const companyMatches = Array.from(
    text.matchAll(/([A-Za-z0-9가-힣&._-]{2,})(?:\s*)(?:회사|고객|고객사|벤더|파트너)/g),
  ).map((match) => match[1] ?? '');

  const opportunityMatches = Array.from(
    text.matchAll(/([A-Za-z0-9가-힣&._\-/]{2,})(?:\s*)(?:딜|기회|영업기회|PoC|견적)/g),
  ).map((match) => match[1] ?? '');

  const personMatches = Array.from(
    text.matchAll(/([A-Za-z가-힣]{2,}(?:\s+[A-Za-z가-힣]{2,})?)(?:\s*)(?:담당자|매니저|이사|부장)/g),
  ).map((match) => match[1] ?? '');

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

  return {
  summary: '정리된 메모를 기준으로 CRM 반영 초안을 만들었습니다.',
  confidence: 0.45,
  sourceText: cleanedText,
  actions: fallbackWriteActions(cleanedText),
  warnings: [
    '자동 추출 초안입니다. 실제 반영 전 Slack 승인 카드에서 반드시 확인하세요.',
  ],
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

const callAnthropicJson = async <TResponse extends Record<string, unknown>>({
  systemPrompt,
  userPrompt,
}: {
  systemPrompt: string;
  userPrompt: string;
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
      max_tokens: ANTHROPIC_MAX_TOKENS,
      output_config: {
        effort: 'low',
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

export const classifySlackText = async (
  text: string,
): Promise<SlackIntentClassification> => {
  const cleanedText = cleanSlackText(text);
  const fallback = buildFallbackClassification(cleanedText);
  const aiResult = await callAnthropicToolInput<SlackIntentClassification>({
    systemPrompt: [
      'You plan CRM assistant requests for a Korean B2B sales team.',
      'Use the provided strict tool exactly once.',
      'Ignore Slack mention tags like <@U123>, bot invocation prefixes, and slash command markers.',
      'If the user asks for every item, says not to summarize, or asks for one-by-one detail, set detailLevel to DETAILED.',
      'Use timeframe THIS_MONTH for 이번달/금월, RECENT for 최근/latest, otherwise ALL_TIME.',
      'Use focusEntity OPPORTUNITY when the request is about deals, pipeline, opportunities, or sales chances.',
      'Keep summary concise and in Korean.',
    ].join(' '),
    toolName: CRM_QUERY_PLAN_TOOL_NAME,
    toolDescription: 'Plan the CRM query intent and answer style.',
    inputSchema: crmQueryPlanSchema,
    userPrompt: [
      '<instructions>',
      'Infer the user intent, detail level, timeframe, and CRM focus.',
      'When the request says "요약하지말고", "하나하나", or "상세하게", choose DETAILED.',
      '</instructions>',
      '<examples>',
      '<example>',
      '<message>이번달 신규 영업기회 몇 건이야?</message>',
      '<expected>QUERY / MONTHLY_NEW / SUMMARY / THIS_MONTH / OPPORTUNITY</expected>',
      '</example>',
      '<example>',
      '<message>전체 신규영업기회 정리해서 알려줘. 요약하지말고 하나하나 상세하게 알려줘</message>',
      '<expected>QUERY / MONTHLY_NEW / DETAILED / THIS_MONTH / OPPORTUNITY</expected>',
      '</example>',
      '</examples>',
      `<message>${cleanedText}</message>`,
    ].join('\n'),
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
    systemPrompt: [
      'You are a Korean B2B CRM analyst assistant for enterprise sales teams.',
      'Write the final Slack reply using only the CRM context provided by the user prompt.',
      'Do not invent fields, people, amounts, or dates.',
      'If a field is missing, say 미입력 or 미지정 explicitly.',
      'If detailLevel is DETAILED, enumerate the records one by one instead of collapsing to counts only.',
      'Always finish with a short 의견 section grounded in the data.',
      'Prefer crisp Korean business prose over generic assistant phrasing.',
    ].join(' '),
    schema: crmReplySchema,
    maxTokens: ANTHROPIC_QUERY_REPLY_MAX_TOKENS,
    effort: 'medium',
    userPrompt: [
      '<instructions>',
      'Read the request and CRM context carefully.',
      'Use exact values from the CRM context.',
      'For detailed requests, create a section that lists each relevant opportunity separately.',
      'Do not omit relevant opportunity/company/contact details that already exist in the context.',
      '</instructions>',
      '<examples>',
      '<example>',
      '<request>이번달 신규 영업기회 몇 건이야?</request>',
      '<response_shape>{"text":"이번달 신규 영업기회 3건입니다.","sections":[{"title":"이번달 신규 현황","body":"회사 3건, 담당자 4건, 영업기회 3건"},{"title":"의견","body":"담당자 매핑이 부족한 기회부터 점검하는 것이 좋습니다."}]}</response_shape>',
      '</example>',
      '<example>',
      '<request>전체 신규영업기회 정리해서 알려줘. 요약하지말고 하나하나 상세하게 알려줘</request>',
      '<response_shape>{"text":"이번달 신규 영업기회를 상세 정리했습니다.","sections":[{"title":"신규 영업기회 상세","body":"1. ...\\n2. ..."},{"title":"의견","body":"..." }]}</response_shape>',
      '</example>',
      '</examples>',
      `<request>${cleanedText}</request>`,
      `<classification>${JSON.stringify(classification)}</classification>`,
      `<crm_context>${JSON.stringify(crmContext)}</crm_context>`,
    ].join('\n'),
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
  const aiResult = await callAnthropicJson<CrmWriteDraft>({
    systemPrompt: [
      'You build a CRM write draft for a Korean B2B distributor CRM.',
      'Return only valid JSON.',
      'Ignore Slack mention tags like <@U123>, bot invocation prefixes, and slash command markers.',
      'Top-level keys: summary, confidence, sourceText, actions, warnings.',
      'actions is an array of { kind, operation, lookup?, data }.',
      'kind must be one of company, person, opportunity, solution, companyRelationship, opportunityStakeholder, opportunitySolution, note, task.',
      'operation must be create or update.',
      'Prefer note and task records when information is incomplete.',
      'Use concise Korean titles for note and task records.',
      'Never include raw Slack mention tokens in titles, body text, summaries, or warnings.',
      'Keep field names in English API style.',
      'Use Korean in summary and warnings.',
    ].join(' '),
    userPrompt: cleanedText,
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
  }, cleanedText);
};
