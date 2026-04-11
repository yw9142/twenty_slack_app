import { DEFAULT_ANTHROPIC_MODEL } from 'src/constants/slack-intake';
import type {
  CrmActionRecord,
  CrmWriteDraft,
  EntityHints,
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

const containsAny = (value: string, keywords: string[]): boolean =>
  keywords.some((keyword) => value.includes(keyword));

const toSingleLineSlackText = (value: string): string =>
  cleanSlackText(value, { singleLine: true });

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
    headers: {
      'anthropic-version': ANTHROPIC_API_VERSION,
      'content-type': 'application/json; charset=utf-8',
      'x-api-key': apiKey,
    },
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

  const payload = (await response.json()) as {
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };

  const content = payload.content?.find((block) => block.type === 'text')?.text;

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
  const cleanedText = cleanSlackText(text);
  const fallback = buildFallbackClassification(cleanedText);
  const aiResult = await callAnthropicJson<SlackIntentClassification>({
    systemPrompt: [
      'You classify Slack messages for a Korean B2B CRM assistant.',
      'Return only valid JSON.',
      'Ignore Slack mention tags like <@U123>, bot invocation prefixes, and slash command markers.',
      'intentType must be one of QUERY, WRITE_DRAFT, APPROVAL_ACTION, UNKNOWN.',
      'queryCategory must be one of MONTHLY_NEW, OPPORTUNITY_STATUS, RISK_REVIEW, PIPELINE_SUMMARY, RECORD_LOOKUP, GENERAL.',
      'entityHints must contain arrays for companies, people, opportunities, solutions.',
      'Use Korean-friendly summaries.',
    ].join(' '),
    userPrompt: cleanedText,
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
