import type { SlackIntakeDraft } from 'src/utils/slack';
import { createCoreClient } from 'src/utils/core-client';
import type { SlackRequestRecord } from 'src/types/slack-agent';

const slackRequestSelection = {
  id: true,
  name: true,
  slackTeamId: true,
  slackChannelId: true,
  slackThreadTs: true,
  slackMessageTs: true,
  slackUserId: true,
  sourceType: true,
  slackResponseUrl: true,
  rawText: true,
  normalizedText: true,
  intentType: true,
  processingStatus: true,
  confidence: true,
  draftJson: true,
  resultJson: true,
  errorMessage: true,
  dedupeKey: true,
  approvedByWorkspaceMemberId: true,
  receivedAt: true,
  lastProcessedAt: true,
} as const;

type SlackRequestLookupInput = {
  dedupeKey?: string;
  id?: string;
};

const parseJsonTextField = (
  value: unknown,
): Record<string, unknown> | null => {
  if (!value) {
    return null;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
};

const serializeJsonTextField = (
  value: unknown,
): Record<string, unknown> | string | null | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return JSON.stringify(value);
};

const parseNullableNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
};

const normalizeSlackRequestMutationData = (
  data: Record<string, unknown>,
): Record<string, unknown> => {
  const normalizedData = { ...data };

  if ('draftJson' in normalizedData) {
    normalizedData.draftJson = serializeJsonTextField(normalizedData.draftJson);
  }

  if ('resultJson' in normalizedData) {
    normalizedData.resultJson = serializeJsonTextField(
      normalizedData.resultJson,
    );
  }

  return normalizedData;
};

const mapSlackRequestNode = (
  node: Record<string, unknown> | null | undefined,
): SlackRequestRecord | null => {
  if (!node || typeof node !== 'object') {
    return null;
  }

  return {
    id: typeof node.id === 'string' ? node.id : '',
    name: typeof node.name === 'string' ? node.name : null,
    slackTeamId:
      typeof node.slackTeamId === 'string' ? node.slackTeamId : null,
    slackChannelId:
      typeof node.slackChannelId === 'string' ? node.slackChannelId : null,
    slackThreadTs:
      typeof node.slackThreadTs === 'string' ? node.slackThreadTs : null,
    slackMessageTs:
      typeof node.slackMessageTs === 'string' ? node.slackMessageTs : null,
    slackUserId:
      typeof node.slackUserId === 'string' ? node.slackUserId : null,
    sourceType:
      typeof node.sourceType === 'string'
        ? (node.sourceType as SlackRequestRecord['sourceType'])
        : null,
    slackResponseUrl:
      typeof node.slackResponseUrl === 'string' ? node.slackResponseUrl : null,
    rawText: typeof node.rawText === 'string' ? node.rawText : null,
    normalizedText:
      typeof node.normalizedText === 'string' ? node.normalizedText : null,
    intentType:
      typeof node.intentType === 'string'
        ? (node.intentType as SlackRequestRecord['intentType'])
        : null,
    processingStatus:
      typeof node.processingStatus === 'string'
        ? (node.processingStatus as SlackRequestRecord['processingStatus'])
        : null,
    confidence: parseNullableNumber(node.confidence),
    draftJson: parseJsonTextField(node.draftJson),
    resultJson: parseJsonTextField(node.resultJson),
    errorMessage:
      typeof node.errorMessage === 'string' ? node.errorMessage : null,
    dedupeKey: typeof node.dedupeKey === 'string' ? node.dedupeKey : null,
    approvedByWorkspaceMemberId:
      typeof node.approvedByWorkspaceMemberId === 'string'
        ? node.approvedByWorkspaceMemberId
        : null,
    receivedAt: typeof node.receivedAt === 'string' ? node.receivedAt : null,
    lastProcessedAt:
      typeof node.lastProcessedAt === 'string' ? node.lastProcessedAt : null,
  };
};

export const buildSlackRequestLookupSelection = ({
  dedupeKey,
  id,
}: SlackRequestLookupInput) => {
  const filter: Record<string, { eq: string }> = {};

  if (dedupeKey) {
    filter.dedupeKey = {
      eq: dedupeKey,
    };
  }

  if (id) {
    filter.id = {
      eq: id,
    };
  }

  return {
    slackRequests: {
      __args: {
        filter,
      },
      edges: {
        node: slackRequestSelection,
      },
    },
  };
};

export const findSlackRequestByDedupeKey = async (
  dedupeKey: string,
): Promise<SlackRequestRecord | null> => {
  const client = createCoreClient();
  const response = await client.query<{
    slackRequests?: {
      edges: Array<{ node: Record<string, unknown> }>;
    };
  }>(
    buildSlackRequestLookupSelection({
      dedupeKey,
    }),
  );

  return mapSlackRequestNode(response.slackRequests?.edges[0]?.node);
};

export const findSlackRequestById = async (
  id: string,
): Promise<SlackRequestRecord | null> => {
  const client = createCoreClient();
  const response = await client.query<{
    slackRequests?: {
      edges: Array<{ node: Record<string, unknown> }>;
    };
  }>(
    buildSlackRequestLookupSelection({
      id,
    }),
  );

  return mapSlackRequestNode(response.slackRequests?.edges[0]?.node);
};

export const createSlackRequest = async (
  intake: SlackIntakeDraft,
): Promise<SlackRequestRecord> => {
  const client = createCoreClient();
  const response = await client.mutation<{
    createSlackRequest?: Record<string, unknown>;
  }>({
    createSlackRequest: {
      __args: {
        data: normalizeSlackRequestMutationData(
          intake as unknown as Record<string, unknown>,
        ),
      },
      ...slackRequestSelection,
    },
  });

  const record = mapSlackRequestNode(response.createSlackRequest);

  if (!record) {
    throw new Error('Failed to create Slack 요청 record');
  }

  return record;
};

export const updateSlackRequest = async ({
  id,
  data,
}: {
  id: string;
  data: Record<string, unknown>;
}): Promise<SlackRequestRecord> => {
  const client = createCoreClient();
  const response = await client.mutation<{
    updateSlackRequest?: Record<string, unknown>;
  }>({
    updateSlackRequest: {
      __args: {
        id,
        data: normalizeSlackRequestMutationData(data),
      },
      ...slackRequestSelection,
    },
  });

  const record = mapSlackRequestNode(response.updateSlackRequest);

  if (!record) {
    throw new Error(`Failed to update Slack 요청 ${id}`);
  }

  return record;
};

export const createOrLoadSlackRequest = async (
  intake: SlackIntakeDraft,
): Promise<SlackRequestRecord> => {
  const existing = await findSlackRequestByDedupeKey(intake.dedupeKey);

  if (existing) {
    return existing;
  }

  return createSlackRequest(intake);
};
