import type { SlackIntentClassification } from 'src/types/slack-agent';
import type { WriteCandidateContext } from 'src/utils/crm-write-candidates';

const compactJsonLike = (value: unknown): unknown => {
  if (value == null) {
    return undefined;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0 ? value : undefined;
  }

  if (Array.isArray(value)) {
    const items = value
      .map((item) => compactJsonLike(item))
      .filter((item) => item !== undefined);

    return items.length > 0 ? items : undefined;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entryValue]) => [key, compactJsonLike(entryValue)] as const)
      .filter(([, entryValue]) => entryValue !== undefined);

    return entries.length > 0 ? Object.fromEntries(entries) : undefined;
  }

  return value;
};

const joinSections = (
  sections: Array<{ title: string; content: string }>,
): string =>
  sections
    .map(
      (section) =>
        `## ${section.title}\n${section.content.trim()}`,
    )
    .join('\n\n');

export const buildQueryPlannerSystemPrompt = (): string =>
  joinSections([
    {
      title: 'Base Instructions',
      content: `
You are planning CRM assistant requests for a Korean B2B sales team inside Twenty CRM.
Use the provided strict tool exactly once.
Ignore Slack mention tags like <@U123>, bot invocation prefixes, and slash command markers.
`,
    },
    {
      title: 'Planning Strategy',
      content: `
Infer the user intent, detail level, timeframe, and CRM focus before any data retrieval.
If the user asks for every item, says not to summarize, or asks for one-by-one detail, set detailLevel to DETAILED.
Use timeframe THIS_MONTH for 이번달/금월, RECENT for 최근/latest, otherwise ALL_TIME.
Use focusEntity OPPORTUNITY when the request is about deals, pipeline, opportunities, or sales chances.
`,
    },
    {
      title: 'Output Rules',
      content: `
Keep summary concise and in Korean.
Only choose QUERY when the message is asking to inspect or explain CRM data.
Only choose WRITE_DRAFT when the message is asking to record or reflect new information into CRM.
`,
    },
  ]);

export const buildQueryPlannerUserPrompt = (cleanedText: string): string =>
  [
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
  ].join('\n');

export const buildQuerySynthesisSystemPrompt = (): string =>
  joinSections([
    {
      title: 'Base Instructions',
      content: `
You are a Korean B2B CRM analyst assistant for enterprise sales teams inside Twenty CRM.
Write the final Slack reply using only the CRM context provided by the user prompt.
Do not invent fields, people, amounts, dates, or statuses.
`,
    },
    {
      title: 'Execution Strategy',
      content: `
First inspect the request and classification.
Then inspect the CRM context and identify the exact records that answer the question.
If detailLevel is DETAILED, enumerate the relevant records one by one instead of collapsing everything to counts only.
If data is missing, say 미입력 or 미지정 explicitly rather than guessing.
`,
    },
    {
      title: 'Response Format',
      content: `
Prefer crisp Korean business prose over generic assistant phrasing.
Return a short top-level text plus sections.
Always finish with a short 의견 section grounded in the provided data.
`,
    },
  ]);

export const buildQuerySynthesisUserPrompt = ({
  cleanedText,
  classification,
  crmContext,
}: {
  cleanedText: string;
  classification: SlackIntentClassification;
  crmContext: Record<string, unknown>;
}): string => {
  const compactedClassification =
    compactJsonLike(classification) ?? classification;
  const compactedCrmContext = compactJsonLike(crmContext) ?? crmContext;

  return [
    '<instructions>',
    'Read the request and CRM context carefully.',
    'Use exact values from the CRM context.',
    'For detailed requests, create a section that lists each relevant opportunity separately.',
    'Do not omit relevant opportunity, company, contact, amount, stage, or date fields that already exist in the context.',
    '</instructions>',
    '<examples>',
    '<example>',
    '<request>이번달 신규 영업기회 몇 건이야?</request>',
    '<response_shape>{"text":"이번달 신규 영업기회 3건입니다.","sections":[{"title":"이번달 신규 현황","body":"회사 3건, 담당자 4건, 영업기회 3건"},{"title":"의견","body":"담당자 매핑이 부족한 기회부터 점검하는 것이 좋습니다."}]}</response_shape>',
    '</example>',
    '<example>',
    '<request>전체 신규영업기회 정리해서 알려줘. 요약하지말고 하나하나 상세하게 알려줘</request>',
    '<response_shape>{"text":"이번달 신규 영업기회를 상세 정리했습니다.","sections":[{"title":"신규 영업기회 상세","body":"1. ...\\n2. ..."},{"title":"의견","body":"..."}]}</response_shape>',
    '</example>',
    '</examples>',
    `<request>${cleanedText}</request>`,
    `<classification>${JSON.stringify(compactedClassification)}</classification>`,
    `<crm_context>${JSON.stringify(compactedCrmContext)}</crm_context>`,
  ].join('\n');
};

export const buildWriteDraftSystemPrompt = (): string =>
  joinSections([
    {
      title: 'Base Instructions',
      content: `
You build a CRM write draft for a Korean B2B distributor CRM.
Return only valid JSON.
Ignore Slack mention tags like <@U123>, bot invocation prefixes, and slash command markers.
`,
    },
    {
      title: 'Matching Strategy',
      content: `
Prefer reusing existing CRM records when the candidate context strongly aligns with the meeting note.
Judge alignment using these criteria together: same company, similar opportunity theme or solution, same contact, and recent active opportunity context.
If the existing opportunity match is ambiguous, create a new opportunity instead of forcing an update.
If the note contains enough business substance for a sales opportunity, do not stop at a note-only draft.
Always explain why you chose create vs update in the review output.
`,
    },
    {
      title: 'Drafting Rules',
      content: `
Top-level keys: summary, confidence, sourceText, actions, warnings.
Include a review object with overview, opinion, and items.
actions is an array of { kind, operation, lookup?, data }.
kind must be one of company, person, opportunity, solution, companyRelationship, opportunityStakeholder, opportunitySolution, note, task.
operation must be create or update.
Prefer note and task records when information is incomplete.
`,
    },
    {
      title: 'Formatting Rules',
      content: `
Use concise Korean titles for note and task records.
Never include raw Slack mention tokens in titles, body text, summaries, or warnings.
Keep field names in English API style.
Use Korean in summary and warnings.
Use Korean in the review overview, opinion, and reasons.
`,
    },
  ]);

export const buildWriteDraftUserPrompt = ({
  cleanedText,
  candidateContext,
}: {
  cleanedText: string;
  candidateContext: WriteCandidateContext;
}): string => {
  const compactedCandidates = compactJsonLike(candidateContext) ?? candidateContext;

  return [
    '<instructions>',
    'Read the meeting note and candidate CRM records carefully.',
    'Create or update company, person, and opportunity records when the note clearly supports it.',
    'Use note and task records as supporting records, not as the only output, when a meaningful sales opportunity exists.',
    'If you update an existing opportunity, use lookup.name with the exact candidate opportunity name.',
    'If you create a new opportunity, choose a concise Korean title that includes the company or opportunity theme.',
    'The review object must explain what will be written, where it will be written, and why.',
    '</instructions>',
    '<matching_criteria>',
    '1. Same company is the strongest signal.',
    '2. Similar opportunity theme or solution is the next signal.',
    '3. Same contact strengthens an update decision.',
    '4. Recent active opportunities are more likely update targets than old unrelated ones.',
    '5. If uncertain, prefer create over risky update.',
    '</matching_criteria>',
    '<examples>',
    '<example>',
    '<request>A은행 Nutanix 전환 검토, 담당자 김민수, 5월 말 POC 예정</request>',
    '<candidate_context>{"companies":[{"name":"A은행"}],"people":[{"fullName":"김민수","companyName":"A은행"}],"opportunities":[{"name":"A은행 기존 VDI 전환","companyName":"A은행","pointOfContactName":"김민수","stage":"DISCOVERY_POC"}]}</candidate_context>',
    '<expected_shape>{"actions":[{"kind":"opportunity","operation":"update","lookup":{"name":"A은행 기존 VDI 전환"},"data":{"companyName":"A은행","pointOfContactName":"김민수","stage":"DISCOVERY_POC"}}],"review":{"overview":"기존 기회를 검토했습니다.","opinion":"기존 기회 업데이트가 자연스럽습니다.","items":[{"kind":"opportunity","decision":"UPDATE","target":"A은행 기존 VDI 전환","matchedRecord":"A은행 기존 VDI 전환","reason":"회사, 담당자, 기회 맥락이 일치합니다.","fields":[{"key":"stage","value":"DISCOVERY_POC"}]}]}}</expected_shape>',
    '</example>',
    '</examples>',
    `<request>${cleanedText}</request>`,
    `<candidate_context>${JSON.stringify(compactedCandidates)}</candidate_context>`,
  ].join('\n');
};
