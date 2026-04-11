import type {
  BasicCompanyRecord,
  BasicNoteRecord,
  BasicOpportunityRecord,
  BasicPersonRecord,
  BasicTaskRecord,
  SlackIntentClassification,
  SlackReply,
} from 'src/types/slack-agent';
import { createCoreClient } from 'src/utils/core-client';
import { synthesizeCrmQueryReply } from 'src/utils/intelligence';
import { normalizeText } from 'src/utils/strings';

const THIS_MONTH_PREFIX = new Date().toISOString().slice(0, 7);

const companyRichSelection = {
  id: true,
  name: true,
  createdAt: true,
  accountSegment: true,
  businessUnit: true,
  companyStatus: true,
} as const;

const companyBasicSelection = {
  id: true,
  name: true,
  createdAt: true,
} as const;

const personRichSelection = {
  id: true,
  createdAt: true,
  name: {
    firstName: true,
    lastName: true,
  },
  emails: {
    primaryEmail: true,
  },
  jobTitle: true,
  contactRoleType: true,
  company: {
    name: true,
  },
} as const;

const personBasicSelection = {
  id: true,
  createdAt: true,
  name: {
    firstName: true,
    lastName: true,
  },
  emails: {
    primaryEmail: true,
  },
  jobTitle: true,
  company: {
    name: true,
  },
} as const;

const opportunityRichSelection = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  stage: true,
  closeDate: true,
  amount: {
    amountMicros: true,
    currencyCode: true,
  },
  company: {
    name: true,
  },
  pointOfContact: {
    name: {
      firstName: true,
      lastName: true,
    },
  },
  primaryVendorCompany: {
    name: true,
  },
  primaryPartnerCompany: {
    name: true,
  },
} as const;

const opportunityBasicSelection = {
  id: true,
  name: true,
  createdAt: true,
  updatedAt: true,
  stage: true,
  closeDate: true,
  company: {
    name: true,
  },
  pointOfContact: {
    name: {
      firstName: true,
      lastName: true,
    },
  },
  amount: {
    amountMicros: true,
    currencyCode: true,
  },
} as const;

type RichOrBasicSelection = Record<string, unknown>;
type ConnectionFilter = Record<string, unknown>;

const noteSelection = {
  id: true,
  title: true,
  createdAt: true,
  bodyV2: {
    markdown: true,
  },
} as const;

const taskSelection = {
  id: true,
  title: true,
  createdAt: true,
  status: true,
} as const;

const toFullName = (
  name: Record<string, unknown> | null | undefined,
): string => {
  if (!name) {
    return '';
  }

  const firstName =
    typeof name.firstName === 'string' ? name.firstName.trim() : '';
  const lastName =
    typeof name.lastName === 'string' ? name.lastName.trim() : '';

  return `${firstName} ${lastName}`.trim();
};

const safeConnectionEdges = (
  value: Record<string, unknown> | null | undefined,
): Array<Record<string, unknown>> => {
  if (!value || !Array.isArray(value.edges)) {
    return [];
  }

  return value.edges
    .map((edge) =>
      edge && typeof edge === 'object' && edge.node && typeof edge.node === 'object'
        ? (edge.node as Record<string, unknown>)
        : null,
    )
    .filter((node): node is Record<string, unknown> => node !== null);
};

export const buildConnectionArgs = ({
  first = 100,
  filter,
}: {
  first?: number;
  filter?: ConnectionFilter;
}) => ({
  first,
  ...(filter ? { filter } : {}),
});

const queryWithFallback = async <
  TRecord extends Record<string, unknown>,
>({
  root,
  richSelection,
  fallbackSelection,
}: {
  root: string;
  richSelection: RichOrBasicSelection;
  fallbackSelection: RichOrBasicSelection;
}): Promise<TRecord[]> => {
  const client = createCoreClient();
  const buildSelection = (selection: RichOrBasicSelection) => ({
    [root]: {
      __args: buildConnectionArgs({
        first: 100,
      }),
      edges: {
        node: selection,
      },
    },
  });

  try {
    const response = await client.query<Record<string, unknown>>(
      buildSelection(richSelection),
    );

    return safeConnectionEdges(response[root] as Record<string, unknown>) as TRecord[];
  } catch {
    const response = await client.query<Record<string, unknown>>(
      buildSelection(fallbackSelection),
    );

    return safeConnectionEdges(response[root] as Record<string, unknown>) as TRecord[];
  }
};

export const fetchCompanies = async (): Promise<BasicCompanyRecord[]> => {
  const records = await queryWithFallback<Record<string, unknown>>({
    root: 'companies',
    richSelection: companyRichSelection,
    fallbackSelection: companyBasicSelection,
  });

  return records.map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    name: typeof record.name === 'string' ? record.name : null,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    accountSegment:
      typeof record.accountSegment === 'string' ? record.accountSegment : null,
    businessUnit:
      typeof record.businessUnit === 'string' ? record.businessUnit : null,
    companyStatus:
      typeof record.companyStatus === 'string' ? record.companyStatus : null,
  }));
};

export const fetchPeople = async (): Promise<BasicPersonRecord[]> => {
  const records = await queryWithFallback<Record<string, unknown>>({
    root: 'people',
    richSelection: personRichSelection,
    fallbackSelection: personBasicSelection,
  });

  return records.map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    fullName: toFullName(
      record.name && typeof record.name === 'object'
        ? (record.name as Record<string, unknown>)
        : null,
    ),
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    primaryEmail:
      record.emails &&
      typeof record.emails === 'object' &&
      typeof (record.emails as { primaryEmail?: unknown }).primaryEmail ===
        'string'
        ? ((record.emails as { primaryEmail?: string }).primaryEmail ?? null)
        : null,
    jobTitle: typeof record.jobTitle === 'string' ? record.jobTitle : null,
    contactRoleType:
      typeof record.contactRoleType === 'string' ? record.contactRoleType : null,
    companyName:
      record.company &&
      typeof record.company === 'object' &&
      typeof (record.company as { name?: unknown }).name === 'string'
        ? ((record.company as { name?: string }).name ?? null)
        : null,
  }));
};

export const fetchOpportunities = async (): Promise<BasicOpportunityRecord[]> => {
  const records = await queryWithFallback<Record<string, unknown>>({
    root: 'opportunities',
    richSelection: opportunityRichSelection,
    fallbackSelection: opportunityBasicSelection,
  });

  return records.map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    name: typeof record.name === 'string' ? record.name : '이름 없는 영업기회',
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : null,
    stage: typeof record.stage === 'string' ? record.stage : null,
    closeDate: typeof record.closeDate === 'string' ? record.closeDate : null,
    companyName:
      record.company &&
      typeof record.company === 'object' &&
      typeof (record.company as { name?: unknown }).name === 'string'
        ? ((record.company as { name?: string }).name ?? null)
        : null,
    primaryVendorCompanyName:
      record.primaryVendorCompany &&
      typeof record.primaryVendorCompany === 'object' &&
      typeof (record.primaryVendorCompany as { name?: unknown }).name ===
        'string'
        ? ((record.primaryVendorCompany as { name?: string }).name ?? null)
        : null,
    primaryPartnerCompanyName:
      record.primaryPartnerCompany &&
      typeof record.primaryPartnerCompany === 'object' &&
      typeof (record.primaryPartnerCompany as { name?: unknown }).name ===
        'string'
        ? ((record.primaryPartnerCompany as { name?: string }).name ?? null)
        : null,
    pointOfContactName:
      record.pointOfContact &&
      typeof record.pointOfContact === 'object' &&
      (record.pointOfContact as { name?: unknown }).name &&
      typeof (record.pointOfContact as { name?: unknown }).name === 'object'
        ? toFullName(
            (record.pointOfContact as { name?: Record<string, unknown> }).name,
          )
        : null,
    amountMicros:
      record.amount &&
      typeof record.amount === 'object' &&
      typeof (record.amount as { amountMicros?: unknown }).amountMicros ===
        'number'
        ? ((record.amount as { amountMicros?: number }).amountMicros ?? null)
        : null,
    currencyCode:
      record.amount &&
      typeof record.amount === 'object' &&
      typeof (record.amount as { currencyCode?: unknown }).currencyCode ===
        'string'
        ? ((record.amount as { currencyCode?: string }).currencyCode ?? null)
        : null,
  }));
};

export const fetchNotes = async (): Promise<BasicNoteRecord[]> => {
  const client = createCoreClient();
  const response = await client.query<{
    notes?: { edges: Array<{ node: Record<string, unknown> }> };
  }>({
    notes: {
      __args: buildConnectionArgs({
        first: 100,
      }),
      edges: {
        node: noteSelection,
      },
    },
  });

  return safeConnectionEdges(response.notes as Record<string, unknown>).map(
    (record) => ({
      id: typeof record.id === 'string' ? record.id : '',
      title: typeof record.title === 'string' ? record.title : null,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
      markdown:
        record.bodyV2 &&
        typeof record.bodyV2 === 'object' &&
        typeof (record.bodyV2 as { markdown?: unknown }).markdown === 'string'
          ? ((record.bodyV2 as { markdown?: string }).markdown ?? null)
          : null,
    }),
  );
};

export const fetchTasks = async (): Promise<BasicTaskRecord[]> => {
  const client = createCoreClient();
  const response = await client.query<{
    tasks?: { edges: Array<{ node: Record<string, unknown> }> };
  }>({
    tasks: {
      __args: buildConnectionArgs({
        first: 100,
      }),
      edges: {
        node: taskSelection,
      },
    },
  });

  return safeConnectionEdges(response.tasks as Record<string, unknown>).map(
    (record) => ({
      id: typeof record.id === 'string' ? record.id : '',
      title: typeof record.title === 'string' ? record.title : null,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : null,
      status: typeof record.status === 'string' ? record.status : null,
    }),
  );
};

const formatCurrency = ({
  amountMicros,
  currencyCode,
}: Pick<BasicOpportunityRecord, 'amountMicros' | 'currencyCode'>): string => {
  if (typeof amountMicros !== 'number') {
    return '미입력';
  }

  const amount = amountMicros / 1_000_000;
  const formatted = new Intl.NumberFormat('ko-KR').format(amount);

  return `${formatted} ${currencyCode ?? 'KRW'}`;
};

const sortNewestFirst = <T extends { createdAt?: string | null }>(items: T[]): T[] =>
  [...items].sort((left, right) =>
    (right.createdAt ?? '').localeCompare(left.createdAt ?? ''),
  );

const limitItems = <T>(items: T[], limit: number): T[] => items.slice(0, limit);

const toOpportunityContext = (opportunity: BasicOpportunityRecord) => ({
  name: opportunity.name,
  companyName: opportunity.companyName ?? '미지정',
  pointOfContactName: opportunity.pointOfContactName ?? '미지정',
  stage: opportunity.stage ?? '미입력',
  amount: formatCurrency(opportunity),
  closeDate: opportunity.closeDate ?? '미입력',
  primaryVendorCompanyName: opportunity.primaryVendorCompanyName ?? '미지정',
  primaryPartnerCompanyName: opportunity.primaryPartnerCompanyName ?? '미지정',
  createdAt: opportunity.createdAt ?? null,
  updatedAt: opportunity.updatedAt ?? null,
});

const toCompanyContext = (company: BasicCompanyRecord) => ({
  name: company.name ?? '이름 미입력',
  accountSegment: company.accountSegment ?? '미입력',
  businessUnit: company.businessUnit ?? '미입력',
  companyStatus: company.companyStatus ?? '미입력',
  createdAt: company.createdAt ?? null,
});

const toPersonContext = (person: BasicPersonRecord) => ({
  fullName: person.fullName || '이름 미입력',
  companyName: person.companyName ?? '미지정',
  primaryEmail: person.primaryEmail ?? '미입력',
  jobTitle: person.jobTitle ?? '미입력',
  contactRoleType: person.contactRoleType ?? '미입력',
  createdAt: person.createdAt ?? null,
});

const maybeSynthesizeReply = async ({
  requestText,
  classification,
  crmContext,
  fallbackReply,
}: {
  requestText: string;
  classification: SlackIntentClassification;
  crmContext: Record<string, unknown>;
  fallbackReply: SlackReply;
}): Promise<SlackReply> => {
  const synthesized = await synthesizeCrmQueryReply({
    requestText,
    classification,
    crmContext,
  });

  return synthesized ?? fallbackReply;
};

export const buildMonthlyNewOpinion = ({
  companyCount,
  peopleCount,
  opportunityCount,
}: {
  companyCount: number;
  peopleCount: number;
  opportunityCount: number;
}): string => {
  if (opportunityCount === 0) {
    return '이번달 신규 영업기회가 없어 신규 발굴 활동 점검이 필요합니다.';
  }

  if (peopleCount < companyCount) {
    return '신규 회사 수 대비 담당자 등록이 적어 후속 접점 확보가 필요합니다.';
  }

  if (opportunityCount >= companyCount) {
    return '신규 파이프라인 유입은 양호합니다. 상위 기회의 다음 액션을 빠르게 확정하세요.';
  }

  return '신규 접점은 생기고 있으니, 실제 딜 전환 여부를 이번 주 안에 점검하는 것이 좋습니다.';
};

export const buildOpportunityOpinion = (
  opportunity: Pick<
    BasicOpportunityRecord,
    | 'name'
    | 'stage'
    | 'closeDate'
    | 'primaryVendorCompanyName'
    | 'primaryPartnerCompanyName'
    | 'pointOfContactName'
  >,
): string => {
  const gaps: string[] = [];

  if (!opportunity.primaryVendorCompanyName) {
    gaps.push('주 벤더사');
  }

  if (
    opportunity.stage &&
    ['QUOTED', 'NEGOTIATION'].includes(opportunity.stage) &&
    !opportunity.primaryPartnerCompanyName
  ) {
    gaps.push('주 파트너사');
  }

  if (!opportunity.pointOfContactName) {
    gaps.push('주요 담당자');
  }

  if (!opportunity.closeDate) {
    gaps.push('예상 마감일');
  }

  if (gaps.length === 0) {
    return '핵심 상업 정보는 비교적 잘 채워져 있습니다. 다음 단계 진입 조건만 점검하면 됩니다.';
  }

  return `${gaps.join(', ')} 정보 보강이 필요합니다. 이 항목부터 정리한 뒤 다음 액션을 확정하세요.`;
};

const buildGeneralSummaryOpinion = ({
  opportunityCount,
  taskCount,
}: {
  opportunityCount: number;
  taskCount: number;
}): string => {
  if (opportunityCount === 0) {
    return '현재 파이프라인이 비어 있어 신규 기회 발굴 활동을 우선 점검해야 합니다.';
  }

  if (taskCount > opportunityCount) {
    return '오픈 작업 수가 많아 후속 우선순위 정리가 필요합니다.';
  }

  return '파이프라인과 후속 작업 수는 균형적인 편입니다. 상위 딜 중심으로 실행력을 점검하세요.';
};

const buildRiskOpinion = (count: number): string =>
  count === 0
    ? '현재 기준에서는 즉시 보완이 필요한 리스크 딜이 없습니다.'
    : '견적·협상 단계에서 벤더/파트너 정보가 빈 딜부터 우선 정리하는 것이 좋습니다.';

const countThisMonth = (values: Array<{ createdAt?: string | null }>): number =>
  values.filter((value) => value.createdAt?.startsWith(THIS_MONTH_PREFIX)).length;

const findBestOpportunityMatch = (
  opportunities: BasicOpportunityRecord[],
  classification: SlackIntentClassification,
  text: string,
): BasicOpportunityRecord | null => {
  const hints = classification.entityHints.opportunities;
  const normalizedText = normalizeText(text);

  for (const hint of hints) {
    const match = opportunities.find((opportunity) =>
      normalizeText(opportunity.name).includes(normalizeText(hint)),
    );

    if (match) {
      return match;
    }
  }

  return (
    opportunities.find((opportunity) =>
      normalizedText.includes(normalizeText(opportunity.name)),
    ) ?? null
  );
};

const buildMonthlyNewReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const [companies, people, opportunities] = await Promise.all([
    fetchCompanies(),
    fetchPeople(),
    fetchOpportunities(),
  ]);

  const companyCount = countThisMonth(companies);
  const peopleCount = countThisMonth(people);
  const opportunityCount = countThisMonth(opportunities);
  const monthlyCompanies = sortNewestFirst(
    companies.filter((company) => company.createdAt?.startsWith(THIS_MONTH_PREFIX)),
  );
  const monthlyPeople = sortNewestFirst(
    people.filter((person) => person.createdAt?.startsWith(THIS_MONTH_PREFIX)),
  );
  const monthlyOpportunities = sortNewestFirst(
    opportunities.filter((opportunity) =>
      opportunity.createdAt?.startsWith(THIS_MONTH_PREFIX),
    ),
  );
  const detailLimit = classification.detailLevel === 'DETAILED' ? 20 : 8;
  const resultJson = {
    queryCategory: classification.queryCategory,
    detailLevel: classification.detailLevel,
    timeframe: classification.timeframe,
    companyCount,
    peopleCount,
    opportunityCount,
    companies: limitItems(monthlyCompanies.map(toCompanyContext), detailLimit),
    people: limitItems(monthlyPeople.map(toPersonContext), detailLimit),
    opportunities: limitItems(
      monthlyOpportunities.map(toOpportunityContext),
      detailLimit,
    ),
  };
  const fallbackReply = {
    text: `이번달 신규 현황입니다. 회사 ${companyCount}건, 담당자 ${peopleCount}건, 영업기회 ${opportunityCount}건입니다.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*이번달 신규 현황*\n` +
            `• 회사: *${companyCount}건*\n` +
            `• 담당자: *${peopleCount}건*\n` +
            `• 영업기회: *${opportunityCount}건*`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*의견*\n${buildMonthlyNewOpinion({
            companyCount,
            peopleCount,
            opportunityCount,
          })}`,
        },
      },
    ],
  } satisfies SlackReply;

  return {
    reply: await maybeSynthesizeReply({
      requestText: text,
      classification,
      crmContext: {
        queryLabel: '이번달 신규 현황',
        ...resultJson,
      },
      fallbackReply,
    }),
    resultJson,
  };
};

const buildOpportunityStatusReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const opportunities = await fetchOpportunities();
  const match = findBestOpportunityMatch(opportunities, classification, text);

  if (!match) {
    return {
      reply: {
        text: '일치하는 영업기회를 찾지 못했습니다. 영업기회명이나 엔드고객명을 조금 더 구체적으로 알려주세요.',
      },
      resultJson: {
        found: false,
      },
    };
  }

  const resultJson = {
    found: true,
    opportunity: toOpportunityContext(match),
  };
  const fallbackReply = {
    text:
      `${match.name} 상태입니다. ` +
      `단계 ${match.stage ?? '미입력'}, ` +
      `엔드고객 ${match.companyName ?? '미지정'}, ` +
      `주 벤더사 ${match.primaryVendorCompanyName ?? '미지정'}, ` +
      `주 파트너사 ${match.primaryPartnerCompanyName ?? '미지정'}.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*${match.name}*\n` +
            `• 단계: ${match.stage ?? '미입력'}\n` +
            `• 엔드고객: ${match.companyName ?? '미지정'}\n` +
            `• 주 벤더사: ${match.primaryVendorCompanyName ?? '미지정'}\n` +
            `• 주 파트너사: ${match.primaryPartnerCompanyName ?? '미지정'}\n` +
            `• 예상 금액: ${formatCurrency(match)}\n` +
            `• 예상 마감일: ${match.closeDate ?? '미입력'}\n` +
            `• 주요 담당자: ${match.pointOfContactName ?? '미지정'}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*의견*\n${buildOpportunityOpinion(match)}`,
        },
      },
    ],
  } satisfies SlackReply;

  return {
    reply: await maybeSynthesizeReply({
      requestText: text,
      classification,
      crmContext: {
        queryLabel: '영업기회 상태',
        ...resultJson,
      },
      fallbackReply,
    }),
    resultJson,
  };
};

const buildRiskReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const opportunities = await fetchOpportunities();
  const risky = opportunities.filter(
    (opportunity) =>
      (opportunity.stage &&
        ['VENDOR_ALIGNED', 'DISCOVERY_POC', 'QUOTED', 'NEGOTIATION'].includes(
          opportunity.stage,
        ) &&
        !opportunity.primaryVendorCompanyName) ||
      ((opportunity.stage === 'QUOTED' || opportunity.stage === 'NEGOTIATION') &&
        !opportunity.primaryPartnerCompanyName),
  );

  const lines = risky.slice(0, 5).map(
    (opportunity) =>
      `• ${opportunity.name} / 단계 ${opportunity.stage ?? '미입력'} / 벤더 ${opportunity.primaryVendorCompanyName ?? '미지정'} / 파트너 ${opportunity.primaryPartnerCompanyName ?? '미지정'}`,
  );
  const resultJson = {
    count: risky.length,
    opportunities: limitItems(
      risky.map(toOpportunityContext),
      classification.detailLevel === 'DETAILED' ? 20 : 8,
    ),
  };
  const fallbackReply = {
    text:
      risky.length === 0
        ? '현재 규칙 기준으로 감지된 리스크 영업기회가 없습니다.'
        : `리스크 영업기회 ${risky.length}건을 찾았습니다.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            risky.length === 0
              ? '*리스크 영업기회가 없습니다.*'
              : `*리스크 영업기회 ${risky.length}건*\n${lines.join('\n')}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*의견*\n${buildRiskOpinion(risky.length)}`,
        },
      },
    ],
  } satisfies SlackReply;

  return {
    reply: await maybeSynthesizeReply({
      requestText: text,
      classification,
      crmContext: {
        queryLabel: '리스크 영업기회',
        ...resultJson,
      },
      fallbackReply,
    }),
    resultJson,
  };
};

const buildGeneralSummaryReply = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const [companies, people, opportunities, tasks, notes] = await Promise.all([
    fetchCompanies(),
    fetchPeople(),
    fetchOpportunities(),
    fetchTasks(),
    fetchNotes(),
  ]);
  const resultJson = {
    companyCount: companies.length,
    peopleCount: people.length,
    opportunityCount: opportunities.length,
    taskCount: tasks.length,
    noteCount: notes.length,
    topOpportunities: limitItems(
      sortNewestFirst(opportunities).map(toOpportunityContext),
      classification.detailLevel === 'DETAILED' ? 12 : 6,
    ),
    recentTasks: limitItems(
      sortNewestFirst(tasks).map((task) => ({
        title: task.title ?? '제목 미입력',
        status: task.status ?? '미입력',
        createdAt: task.createdAt ?? null,
      })),
      6,
    ),
    recentNotes: limitItems(
      sortNewestFirst(notes).map((note) => ({
        title: note.title ?? '제목 미입력',
        markdown: note.markdown ?? '',
        createdAt: note.createdAt ?? null,
      })),
      4,
    ),
  };
  const fallbackReply = {
    text:
      `현재 CRM 요약입니다. 회사 ${companies.length}건, 담당자 ${people.length}건, ` +
      `영업기회 ${opportunities.length}건, 작업 ${tasks.length}건, 노트 ${notes.length}건입니다.`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text:
            `*현재 CRM 요약*\n` +
            `• 회사: *${companies.length}건*\n` +
            `• 담당자: *${people.length}건*\n` +
            `• 영업기회: *${opportunities.length}건*\n` +
            `• 작업: *${tasks.length}건*\n` +
            `• 노트: *${notes.length}건*`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*의견*\n${buildGeneralSummaryOpinion({
            opportunityCount: opportunities.length,
            taskCount: tasks.length,
          })}`,
        },
      },
    ],
  } satisfies SlackReply;

  return {
    reply: await maybeSynthesizeReply({
      requestText: text,
      classification,
      crmContext: {
        queryLabel: '현재 CRM 요약',
        ...resultJson,
      },
      fallbackReply,
    }),
    resultJson,
  };
};

export const answerCrmQuery = async ({
  classification,
  text,
}: {
  classification: SlackIntentClassification;
  text: string;
}): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  if (classification.queryCategory === 'MONTHLY_NEW') {
    return buildMonthlyNewReply({ classification, text });
  }

  if (
    classification.queryCategory === 'OPPORTUNITY_STATUS' ||
    classification.entityHints.opportunities.length > 0
  ) {
    return buildOpportunityStatusReply({ classification, text });
  }

  if (classification.queryCategory === 'RISK_REVIEW') {
    return buildRiskReply({ classification, text });
  }

  return buildGeneralSummaryReply({ classification, text });
};
