import { extractEntityHints, sanitizeCompanyName, sanitizePersonName } from 'src/utils/entity-hints';
import { cleanSlackText, normalizeText, truncate } from 'src/utils/strings';

export type MeetingFacts = {
  companyName: string | null;
  partnerName: string | null;
  personName: string | null;
  personTitle: string | null;
  solutionName: string | null;
  opportunityName: string | null;
  stage: string | null;
  closeDate: string | null;
  dueAt: string | null;
  vendorName: string | null;
  nextAction: string | null;
  noteTitle: string;
  taskTitle: string | null;
  taskBody: string | null;
};

const TITLE_VALUES = [
  '대표',
  '본부장',
  '상무',
  '전무',
  '이사',
  '실장',
  '부장',
  '차장',
  '과장',
  '대리',
  '팀장',
  '책임',
  '매니저',
] as const;

const VENDOR_BY_KEYWORD: Array<{ match: RegExp; vendor: string; solution: string }> = [
  { match: /\bnutanix\b/i, vendor: 'Nutanix', solution: 'Nutanix VDI' },
  { match: /\bcitrix\b|\bnetscaler\b|\badc\b/i, vendor: 'Citrix', solution: 'Citrix VDI' },
  { match: /\bspotfire\b/i, vendor: 'TIBCO', solution: 'Spotfire' },
  { match: /\btibco\b/i, vendor: 'TIBCO', solution: 'TIBCO' },
  { match: /\bvmware\b|\bhorizon\b/i, vendor: 'VMware', solution: 'VMware Horizon' },
  { match: /\banyware\b|\bhp\b/i, vendor: 'HP', solution: 'HP Anyware' },
];

const extractLabeledEntity = ({
  text,
  patterns,
  sanitizer,
}: {
  text: string;
  patterns: RegExp[];
  sanitizer: (value: string) => string | null;
}): string | null => {
  for (const pattern of patterns) {
    const match = pattern.exec(text);

    if (match?.[1]) {
      const sanitized = sanitizer(match[1]);

      if (sanitized) {
        return sanitized;
      }
    }
  }

  return null;
};

const toIsoDate = (year: number, month: number, day: number): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

const getMonthLastDay = (year: number, month: number): number =>
  new Date(year, month, 0).getDate();

const normalizeYear = (month: number): number => {
  const now = new Date();
  const currentMonth = now.getMonth() + 1;

  return month + 2 < currentMonth ? now.getFullYear() + 1 : now.getFullYear();
};

const toRelativeDueDate = (daysAhead: number): string => {
  const due = new Date();
  due.setDate(due.getDate() + daysAhead);

  return toIsoDate(due.getFullYear(), due.getMonth() + 1, due.getDate());
};

const extractScheduleDate = (text: string): string | null => {
  const explicitDay = text.match(/(\d{1,2})월\s*(\d{1,2})일/);

  if (explicitDay) {
    const month = Number(explicitDay[1]);
    const day = Number(explicitDay[2]);

    return toIsoDate(normalizeYear(month), month, day);
  }

  const monthEnd = text.match(/(\d{1,2})월\s*말/);

  if (monthEnd) {
    const month = Number(monthEnd[1]);
    const year = normalizeYear(month);

    return toIsoDate(year, month, getMonthLastDay(year, month));
  }

  const monthEarly = text.match(/(\d{1,2})월\s*초/);

  if (monthEarly) {
    const month = Number(monthEarly[1]);

    return toIsoDate(normalizeYear(month), month, 10);
  }

  const monthMid = text.match(/(\d{1,2})월\s*중순/);

  if (monthMid) {
    const month = Number(monthMid[1]);

    return toIsoDate(normalizeYear(month), month, 15);
  }

  if (text.includes('다음주')) {
    return toRelativeDueDate(7);
  }

  if (text.includes('이번주')) {
    return toRelativeDueDate(3);
  }

  return null;
};

const extractPerson = (text: string): { name: string | null; title: string | null } => {
  const labeledSegment = text.match(
    /(?:담당자는?|실무\s*담당자는?|의사결정자는?|참석자는?)\s*((?:그대로\s+)?[^,\n.]+)/,
  )?.[1];

  if (labeledSegment) {
    const cleanedSegment = cleanSlackText(labeledSegment, { singleLine: true })
      .replace(/^그대로\s+/, '')
      .replace(/\s+(?:이고|이며)\b.*$/u, '')
      .trim();
    const tokens = cleanedSegment
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => token.replace(/(?:이다|입니다|이고|이며)$/u, ''));
    const lastToken = tokens[tokens.length - 1] ?? '';
    const title = TITLE_VALUES.find((value) => value === lastToken) ?? null;
    const nameTokens = title ? tokens.slice(0, -1) : tokens;
    const name = sanitizePersonName(nameTokens.join(' '));

    return {
      name,
      title,
    };
  }

  const generic = text.match(
    /([A-Za-z가-힣]{2,}(?:\s+[A-Za-z가-힣]{2,})?)\s*(대표|본부장|상무|전무|이사|실장|부장|차장|과장|대리|팀장|책임|매니저)/,
  );

  if (generic) {
    return {
      name: sanitizePersonName(generic[1] ?? ''),
      title: generic[2] ?? null,
    };
  }

  return {
    name: null,
    title: null,
  };
};

const extractVendorAndSolution = (
  text: string,
  hints: ReturnType<typeof extractEntityHints>,
): { vendorName: string | null; solutionName: string | null } => {
  const explicitProduct = extractLabeledEntity({
    text,
    patterns: [
      /(?:제품은?|제품명은?|솔루션은?)\s*([A-Za-z0-9가-힣&._-]{2,})/i,
      /(?:제품|솔루션)\s*[:：]\s*([A-Za-z0-9가-힣&._-]{2,})/i,
    ],
    sanitizer: (value) =>
      cleanSlackText(value, { singleLine: true })
        .replace(/(?:이고|이며|이다|입니다)$/u, '')
        .trim(),
  });

  if (explicitProduct) {
    return {
      vendorName: explicitProduct,
      solutionName: explicitProduct,
    };
  }

  for (const candidate of VENDOR_BY_KEYWORD) {
    if (candidate.match.test(text)) {
      return {
        vendorName: candidate.vendor,
        solutionName: candidate.solution,
      };
    }
  }

  const firstSolution = hints.solutions[0] ?? null;

  return {
    vendorName: firstSolution,
    solutionName: firstSolution,
  };
};

const determineStage = (normalized: string): string | null => {
  if (
    normalized.includes('negotiation') ||
    normalized.includes('협상')
  ) {
    return 'NEGOTIATION';
  }

  if (
    normalized.includes('quoted') ||
    normalized.includes('견적') ||
    normalized.includes('제안')
  ) {
    return 'QUOTED';
  }

  if (
    normalized.includes('poc') ||
    normalized.includes('discovery/poc') ||
    normalized.includes('discovery poc') ||
    normalized.includes('파일럿') ||
    normalized.includes('검증')
  ) {
    return 'DISCOVERY_POC';
  }

  if (
    normalized.includes('vendor aligned') ||
    normalized.includes('검토') ||
    normalized.includes('도입') ||
    normalized.includes('수요')
  ) {
    return 'VENDOR_ALIGNED';
  }

  return null;
};

const buildOpportunityTheme = (
  text: string,
  normalized: string,
  solutionName: string | null,
): string => {
  const base =
    solutionName && solutionName.toLowerCase().includes('vdi')
      ? solutionName
      : solutionName ?? (normalized.includes('vmi') ? 'VMI' : 'VDI');

  if (normalized.includes('전환')) {
    return `${base} 전환`;
  }

  if (normalized.includes('증설')) {
    return `${base} 증설`;
  }

  if (normalized.includes('업그레이드')) {
    return `${base} 업그레이드`;
  }

  if (normalized.includes('고도화')) {
    return `${base} 고도화`;
  }

  if (normalized.includes('도입')) {
    return `${base} 도입`;
  }

  if (normalized.includes('연계')) {
    return `${base} 연계 검토`;
  }

  if (text.includes('PoC') || text.includes('POC') || normalized.includes('poc')) {
    return `${base} PoC`;
  }

  return `${base} 영업기회`;
};

const buildNextAction = (text: string): string | null => {
  const requestMatch = text.match(
    /((?:다음주|이번주|이번 달|금주|차주|[\d]{1,2}월\s*(?:초|중순|말|[\d]{1,2}일))[^.。\n]*(?:요청받았다|전달해야 한다|달라고 했다|필요하다|해야 한다|예정이다|예정))/,
  );

  if (requestMatch) {
    return cleanSlackText(requestMatch[1], { singleLine: true });
  }

  if (text.includes('아키텍처 초안') && text.includes('비용')) {
    return '아키텍처 초안과 예상 비용 범위를 전달';
  }

  return null;
};

const buildTaskTitle = ({
  companyName,
  nextAction,
}: {
  companyName: string | null;
  nextAction: string | null;
}): string | null => {
  if (!nextAction) {
    return null;
  }

  const prefix = companyName ? `${companyName} ` : '';

  if (nextAction.includes('아키텍처 초안') && nextAction.includes('비용')) {
    return `${prefix}아키텍처 초안 및 예상 비용 전달`;
  }

  if (nextAction.includes('POC')) {
    return `${prefix}POC 범위 검토`;
  }

  return truncate(`${prefix}${nextAction}`, 48);
};

const extractPrimaryCompanyName = (
  text: string,
  hints: ReturnType<typeof extractEntityHints>,
): string | null =>
  extractLabeledEntity({
    text,
    patterns: [
      /(?:엔드유저는|고객사는|고객은|발주처는)\s*([A-Za-z0-9가-힣&._-]{2,})/g,
      /(?:엔드유저|고객사|발주처)\s*[:：]\s*([A-Za-z0-9가-힣&._-]{2,})/g,
    ],
    sanitizer: sanitizeCompanyName,
  }) ??
  sanitizeCompanyName(hints.companies[0] ?? '') ??
  null;

const extractPartnerName = (text: string): string | null =>
  extractLabeledEntity({
    text,
    patterns: [
      /(?:파트너사는?|파트너는?|협력사는?)\s*([A-Za-z0-9가-힣&._-]{2,})/g,
      /(?:파트너사|파트너|협력사)\s*[:：]\s*([A-Za-z0-9가-힣&._-]{2,})/g,
    ],
    sanitizer: sanitizeCompanyName,
  });

export const extractMeetingFacts = (input: string): MeetingFacts => {
  const cleanedText = cleanSlackText(input);
  const normalized = normalizeText(cleanedText);
  const hints = extractEntityHints(cleanedText);
  const companyName = extractPrimaryCompanyName(cleanedText, hints);
  const partnerName = extractPartnerName(cleanedText);
  const person = extractPerson(cleanedText);
  const scheduleDate = extractScheduleDate(cleanedText);
  const { vendorName, solutionName } = extractVendorAndSolution(cleanedText, hints);
  const stage = determineStage(normalized);
  const opportunityTheme = buildOpportunityTheme(
    cleanedText,
    normalized,
    solutionName,
  );
  const opportunityName = companyName ? `${companyName} ${opportunityTheme}` : null;
  const nextAction = buildNextAction(cleanedText);
  const taskTitle = buildTaskTitle({
    companyName,
    nextAction,
  });
  const noteTitle = truncate(
    companyName ? `${companyName} ${opportunityTheme} 미팅 메모` : cleanedText || '영업 메모',
    50,
  );

  return {
    companyName,
    partnerName,
    personName: person.name,
    personTitle: person.title,
    solutionName,
    opportunityName,
    stage,
    closeDate: scheduleDate,
    dueAt: nextAction ? scheduleDate : null,
    vendorName,
    nextAction,
    noteTitle,
    taskTitle,
    taskBody: nextAction ?? null,
  };
};
