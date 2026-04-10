import { DEFAULT_OPENAI_MODEL } from 'src/constants/slack-intake';
import type {
  CrmActionRecord,
  CrmWriteDraft,
  EntityHints,
  SlackIntentClassification,
} from 'src/types/slack-agent';
import { getOpenAiModel, getOptionalEnv } from 'src/utils/env';
import { normalizeText, truncate, uniqueNonEmpty } from 'src/utils/strings';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

const containsAny = (value: string, keywords: string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword));

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
  const normalized = normalizeText(text);
  const entityHints = extractEntityHints(text);

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
      entityHints,
    };
  }

  return {
    intentType: 'WRITE_DRAFT',
    confidence: 0.58,
    summary: 'CRM 반영 초안 요청으로 분류했습니다.',
    queryCategory: 'GENERAL',
    entityHints,
  };
};

const fallbackWriteActions = (text: string): CrmActionRecord[] => {
  const actions: CrmActionRecord[] = [];
  const entityHints = extractEntityHints(text);
  const noteTitle = truncate(text.split('\n')[0] ?? 'Slack 메모', 80);

  actions.push({
    kind: 'note',
    operation: 'create',
    data: {
      title: `Slack 메모 - ${noteTitle}`,
      bodyV2: {
        markdown: text.trim(),
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
        title: `Slack 후속 작업 - ${noteTitle}`,
        status: 'TODO',
        bodyV2: {
          markdown: text.trim(),
          blocknote: null,
        },
      },
    });
  }

  return actions;
};

const buildFallbackDraft = (text: string): CrmWriteDraft => ({
  summary: 'Slack 메모를 기준으로 기본 CRM 반영 초안을 만들었습니다.',
  confidence: 0.45,
  sourceText: text,
  actions: fallbackWriteActions(text),
  warnings: [
    '자동 추출 초안입니다. 실제 반영 전 Slack 승인 카드에서 반드시 확인하세요.',
  ],
});

const callOpenAiJson = async <TResponse extends Record<string, unknown>>({
  systemPrompt,
  userPrompt,
}: {
  systemPrompt: string;
  userPrompt: string;
}): Promise<TResponse | null> => {
  const apiKey = getOptionalEnv('OPENAI_API_KEY');

  if (!apiKey) {
    return null;
  }

  const model = getOpenAiModel() || DEFAULT_OPENAI_MODEL;
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      model,
      response_format: {
        type: 'json_object',
      },
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
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

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content) as TResponse;
  } catch {
    return null;
  }
};

export const classifySlackText = async (
  text: string,
): Promise<SlackIntentClassification> => {
  const fallback = buildFallbackClassification(text);
  const aiResult = await callOpenAiJson<SlackIntentClassification>({
    systemPrompt: [
      'You classify Slack messages for a Korean B2B CRM assistant.',
      'Return only valid JSON.',
      'intentType must be one of QUERY, WRITE_DRAFT, APPROVAL_ACTION, UNKNOWN.',
      'queryCategory must be one of MONTHLY_NEW, OPPORTUNITY_STATUS, RISK_REVIEW, PIPELINE_SUMMARY, RECORD_LOOKUP, GENERAL.',
      'entityHints must contain arrays for companies, people, opportunities, solutions.',
      'Use Korean-friendly summaries.',
    ].join(' '),
    userPrompt: text,
  });

  if (!aiResult) {
    return fallback;
  }

  return {
    ...fallback,
    ...aiResult,
    entityHints: {
      companies: uniqueNonEmpty(aiResult.entityHints?.companies ?? []),
      people: uniqueNonEmpty(aiResult.entityHints?.people ?? []),
      opportunities: uniqueNonEmpty(aiResult.entityHints?.opportunities ?? []),
      solutions: uniqueNonEmpty(aiResult.entityHints?.solutions ?? []),
    },
  };
};

export const buildCrmWriteDraft = async (
  text: string,
): Promise<CrmWriteDraft> => {
  const fallback = buildFallbackDraft(text);
  const aiResult = await callOpenAiJson<CrmWriteDraft>({
    systemPrompt: [
      'You build a CRM write draft for a Korean B2B distributor CRM.',
      'Return only valid JSON.',
      'Top-level keys: summary, confidence, sourceText, actions, warnings.',
      'actions is an array of { kind, operation, lookup?, data }.',
      'kind must be one of company, person, opportunity, solution, companyRelationship, opportunityStakeholder, opportunitySolution, note, task.',
      'operation must be create or update.',
      'Prefer note and task records when information is incomplete.',
      'Keep field names in English API style.',
      'Use Korean in summary and warnings.',
    ].join(' '),
    userPrompt: text,
  });

  if (!aiResult) {
    return fallback;
  }

  return {
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
        : text,
    actions: Array.isArray(aiResult.actions) ? aiResult.actions : fallback.actions,
    warnings: Array.isArray(aiResult.warnings)
      ? aiResult.warnings.filter(
          (warning): warning is string => typeof warning === 'string',
        )
      : fallback.warnings,
  };
};
