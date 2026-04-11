import { cleanSlackText, uniqueNonEmpty } from 'src/utils/strings';

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

export type EntityHints = {
  companies: string[];
  people: string[];
  opportunities: string[];
  solutions: string[];
};

export const normalizeEntityToken = (value: string): string =>
  cleanSlackText(value, { singleLine: true })
    .replace(/[“”"'`()[\]{}<>]/g, ' ')
    .replace(/[,:;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const sanitizeCompanyName = (value: string): string | null => {
  const normalized = normalizeEntityToken(value).replace(
    /^(?:오늘|이번|기존에|현재|후속|관련해서|그대로)\s+/,
    '',
  );

  if (normalized.length < 2 || COMPANY_STOPWORDS.has(normalized)) {
    return null;
  }

  return normalized;
};

export const sanitizePersonName = (value: string): string | null => {
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

export const extractEntityHints = (text: string): EntityHints => {
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
      /(Citrix|NetScaler|Nubo|Tibco|TIBCO|Spotfire|VDI|VMI|ADC|Analytics|Nutanix|VMware|Horizon|Anyware|HP)/gi,
    ),
  ).map((match) => match[1] ?? '');

  return {
    companies: uniqueNonEmpty(companyMatches),
    opportunities: uniqueNonEmpty(opportunityMatches),
    people: uniqueNonEmpty(personMatches),
    solutions: uniqueNonEmpty(solutionMatches),
  };
};
