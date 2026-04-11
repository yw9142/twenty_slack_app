import {
  QUOTE_STAGE_VALUES,
  VENDOR_ALIGNED_STAGE_VALUES,
} from 'src/constants/slack-intake';
import type { BasicOpportunityRecord, SlackReply } from 'src/types/slack-agent';
import { createCoreClient } from 'src/utils/core-client';
import {
  buildConnectionArgs,
  fetchNotes,
  fetchOpportunities,
  fetchTasks,
} from 'src/utils/crm-query';
import { createOperationalTask } from 'src/utils/crm-write';
import {
  getConfiguredStageValues,
  getManagementChannelId,
} from 'src/utils/env';
import { postSlackThreadReply } from 'src/utils/slack-api';
import { getMarkdownText } from 'src/utils/rich-text';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const STALE_DAY_THRESHOLD = 14;

const hasExistingTask = async (title: string): Promise<boolean> => {
  const tasks = await fetchTasks();

  return tasks.some((task) => task.title === title);
};

const createTaskIfMissing = async ({
  title,
  body,
}: {
  title: string;
  body: string;
}): Promise<boolean> => {
  if (await hasExistingTask(title)) {
    return false;
  }

  await createOperationalTask({ title, body });

  return true;
};

const postManagementSummary = async (reply: SlackReply): Promise<void> => {
  const managementChannelId = getManagementChannelId();

  if (!managementChannelId) {
    return;
  }

  await postSlackThreadReply({
    channelId: managementChannelId,
    reply,
  });
};

const isStaleOpportunity = (opportunity: BasicOpportunityRecord): boolean => {
  if (!opportunity.updatedAt) {
    return false;
  }

  const updatedAt = new Date(opportunity.updatedAt).getTime();
  const now = Date.now();

  return now - updatedAt >= STALE_DAY_THRESHOLD * DAY_IN_MILLISECONDS;
};

const isVendorRisk = (opportunity: BasicOpportunityRecord): boolean =>
  opportunity.stage !== null &&
  opportunity.stage !== undefined &&
  getConfiguredStageValues(
    'VENDOR_ALIGNED_STAGE_VALUES',
    [...VENDOR_ALIGNED_STAGE_VALUES],
  ).includes(opportunity.stage) &&
  !opportunity.pointOfContactName;

const isPartnerRisk = (opportunity: BasicOpportunityRecord): boolean =>
  opportunity.stage !== null &&
  opportunity.stage !== undefined &&
  getConfiguredStageValues('QUOTE_STAGE_VALUES', [...QUOTE_STAGE_VALUES]).includes(
    opportunity.stage,
  ) &&
  !opportunity.closeDate;

const fetchOpportunitySolutionCount = async (
  opportunityId: string,
): Promise<number> => {
  const client = createCoreClient();

  try {
    const response = await client.query<{
      opportunitySolutions?: { edges: Array<{ node: { id: string } }> };
    }>({
      opportunitySolutions: {
        __args: buildConnectionArgs({
          first: 20,
          filter: {
            opportunity: {
              id: {
                eq: opportunityId,
              },
            },
          },
        }),
        edges: {
          node: {
            id: true,
          },
        },
      },
    });

    return response.opportunitySolutions?.edges.length ?? 0;
  } catch {
    return 0;
  }
};

export const runOpportunityHealthCheck = async (): Promise<{
  riskCount: number;
  tasksCreated: number;
}> => {
  const opportunities = await fetchOpportunities();
  let riskCount = 0;
  let tasksCreated = 0;

  for (const opportunity of opportunities) {
    const reasons: string[] = [];

    if (isVendorRisk(opportunity)) {
      reasons.push('주요 담당자 누락');
    }

    if (isPartnerRisk(opportunity)) {
      reasons.push('예상 마감일 누락');
    }

    if (isStaleOpportunity(opportunity)) {
      reasons.push(`최근 ${STALE_DAY_THRESHOLD}일 이상 업데이트 없음`);
    }

    if (
      opportunity.stage &&
      getConfiguredStageValues('QUOTE_STAGE_VALUES', [...QUOTE_STAGE_VALUES]).includes(
        opportunity.stage,
      )
    ) {
      const solutionCount = await fetchOpportunitySolutionCount(opportunity.id);

      if (solutionCount === 0) {
        reasons.push('영업기회 솔루션 누락');
      }
    }

    if (reasons.length === 0) {
      continue;
    }

    riskCount += 1;

    const created = await createTaskIfMissing({
      title: `[영업기회 점검] ${opportunity.name}`,
      body:
        `영업기회 *${opportunity.name}* 점검이 필요합니다.\n` +
        reasons.map((reason) => `- ${reason}`).join('\n'),
    });

    if (created) {
      tasksCreated += 1;
    }
  }

  await postManagementSummary({
    text:
      riskCount === 0
        ? '오늘 기준 리스크 영업기회가 없습니다.'
        : `영업기회 건강도 점검 완료: 리스크 ${riskCount}건, 신규 작업 ${tasksCreated}건`,
  });

  return {
    riskCount,
    tasksCreated,
  };
};

export const runOpportunityStageAutomation = async ({
  opportunityId,
}: {
  opportunityId: string;
}): Promise<{
  tasksCreated: number;
}> => {
  const opportunities = await fetchOpportunities();
  const opportunity = opportunities.find((item) => item.id === opportunityId);

  if (!opportunity) {
    return { tasksCreated: 0 };
  }

  let tasksCreated = 0;

  if (isVendorRisk(opportunity)) {
    const created = await createTaskIfMissing({
      title: `[단계 점검] ${opportunity.name} 벤더 확인`,
      body:
        `영업기회 *${opportunity.name}* 가 현재 ${opportunity.stage ?? '미입력'} 단계입니다.\n` +
        `주 벤더사를 입력해 주세요.`,
    });

    if (created) {
      tasksCreated += 1;
    }
  }

  if (isPartnerRisk(opportunity)) {
    const created = await createTaskIfMissing({
      title: `[단계 점검] ${opportunity.name} 파트너 확인`,
      body:
        `영업기회 *${opportunity.name}* 가 현재 ${opportunity.stage ?? '미입력'} 단계입니다.\n` +
        `주 파트너사를 입력해 주세요.`,
    });

    if (created) {
      tasksCreated += 1;
    }
  }

  return { tasksCreated };
};

const fetchNoteById = async (
  noteId: string,
): Promise<{ title: string | null; markdown: string } | null> => {
  const client = createCoreClient();
  const response = await client.query<{
    notes?: { edges: Array<{ node: Record<string, unknown> }> };
  }>({
    notes: {
      __args: buildConnectionArgs({
        first: 1,
        filter: {
          id: {
            eq: noteId,
          },
        },
      }),
      edges: {
        node: {
          id: true,
          title: true,
          bodyV2: {
            markdown: true,
          },
        },
      },
    },
  });

  const node = response.notes?.edges[0]?.node;

  if (!node) {
    return null;
  }

  return {
    title: typeof node.title === 'string' ? node.title : null,
    markdown: getMarkdownText(node.bodyV2),
  };
};

export const structureNoteIntoTasks = async ({
  noteId,
}: {
  noteId: string;
}): Promise<{
  tasksCreated: number;
}> => {
  const note = await fetchNoteById(noteId);

  if (!note?.markdown) {
    return { tasksCreated: 0 };
  }

  const candidateLines = note.markdown
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.startsWith('- ') ||
        line.startsWith('* ') ||
        line.toLowerCase().startsWith('action:') ||
        line.toLowerCase().startsWith('todo:'),
    );

  let tasksCreated = 0;

  for (const line of candidateLines.slice(0, 5)) {
    const normalizedLine = line
      .replace(/^[-*]\s*/, '')
      .replace(/^action:\s*/i, '')
      .replace(/^todo:\s*/i, '')
      .trim();

    if (normalizedLine.length === 0) {
      continue;
    }

    const created = await createTaskIfMissing({
      title: `[노트 후속] ${normalizedLine}`,
      body:
        `노트 *${note.title ?? '제목 없음'}* 에서 후속 작업을 추출했습니다.\n` +
        normalizedLine,
    });

    if (created) {
      tasksCreated += 1;
    }
  }

  return { tasksCreated };
};

export const buildWeeklyBriefing = async (): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const [opportunities, notes, tasks] = await Promise.all([
    fetchOpportunities(),
    fetchNotes(),
    fetchTasks(),
  ]);

  const staleOpportunities = opportunities.filter(isStaleOpportunity);
  const openTasks = tasks.filter((task) => task.status !== 'DONE');

  return {
    reply: {
      text:
        `주간 파이프라인 브리핑입니다. 영업기회 ${opportunities.length}건, ` +
        `정체 딜 ${staleOpportunities.length}건, 오픈 작업 ${openTasks.length}건입니다.`,
    },
    resultJson: {
      opportunityCount: opportunities.length,
      staleOpportunityCount: staleOpportunities.length,
      noteCount: notes.length,
      openTaskCount: openTasks.length,
    },
  };
};

export const buildMonthlyUpsellBriefing = async (): Promise<{
  reply: SlackReply;
  resultJson: Record<string, unknown>;
}> => {
  const opportunities = await fetchOpportunities();
  const wonCompanyNames = new Set(
    opportunities
      .filter((opportunity) => opportunity.stage === 'CLOSED_WON')
      .map((opportunity) => opportunity.companyName)
      .filter((companyName): companyName is string => Boolean(companyName)),
  );

  const openCompanyNames = new Set(
    opportunities
      .filter(
        (opportunity) =>
          opportunity.stage !== 'CLOSED_WON' &&
          opportunity.stage !== 'CLOSED_LOST',
      )
      .map((opportunity) => opportunity.companyName)
      .filter((companyName): companyName is string => Boolean(companyName)),
  );

  const candidateCompanies = [...wonCompanyNames].filter(
    (companyName) => !openCompanyNames.has(companyName),
  );

  return {
    reply: {
      text:
        candidateCompanies.length === 0
          ? '이번달 업셀 추천 후보가 없습니다.'
          : `이번달 업셀 추천 후보 ${candidateCompanies.length}개 회사를 찾았습니다.`,
      blocks: candidateCompanies.length
        ? [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text:
                  '*업셀 추천 후보*\n' +
                  candidateCompanies
                    .slice(0, 10)
                    .map((companyName) => `• ${companyName}`)
                    .join('\n'),
              },
            },
          ]
        : undefined,
    },
    resultJson: {
      candidates: candidateCompanies,
      candidateCount: candidateCompanies.length,
    },
  };
};

export const postWeeklyBriefing = async (): Promise<void> => {
  const briefing = await buildWeeklyBriefing();
  await postManagementSummary(briefing.reply);
};

export const postMonthlyUpsellBriefing = async (): Promise<void> => {
  const briefing = await buildMonthlyUpsellBriefing();
  await postManagementSummary(briefing.reply);
};
