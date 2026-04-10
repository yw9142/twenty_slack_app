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
      __args: {
        paging: {
          first: 100,
        },
      },
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
      __args: {
        paging: {
          first: 100,
        },
      },
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
      __args: {
        paging: {
          first: 100,
        },
      },
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

const buildMonthlyNewReply = async (): Promise<{
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

  return {
    reply: {
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
      ],
    },
    resultJson: {
      companyCount,
      peopleCount,
      opportunityCount,
    },
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

  return {
    reply: {
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
      ],
    },
    resultJson: {
      found: true,
      opportunity: match,
    },
  };
};

const buildRiskReply = async (): Promise<{
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

  return {
    reply: {
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
      ],
    },
    resultJson: {
      count: risky.length,
      opportunities: risky,
    },
  };
};

const buildGeneralSummaryReply = async (): Promise<{
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

  return {
    reply: {
      text:
        `현재 CRM 요약입니다. 회사 ${companies.length}건, 담당자 ${people.length}건, ` +
        `영업기회 ${opportunities.length}건, 작업 ${tasks.length}건, 노트 ${notes.length}건입니다.`,
    },
    resultJson: {
      companyCount: companies.length,
      peopleCount: people.length,
      opportunityCount: opportunities.length,
      taskCount: tasks.length,
      noteCount: notes.length,
    },
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
    return buildMonthlyNewReply();
  }

  if (
    classification.queryCategory === 'OPPORTUNITY_STATUS' ||
    classification.entityHints.opportunities.length > 0
  ) {
    return buildOpportunityStatusReply({ classification, text });
  }

  if (classification.queryCategory === 'RISK_REVIEW') {
    return buildRiskReply();
  }

  return buildGeneralSummaryReply();
};
