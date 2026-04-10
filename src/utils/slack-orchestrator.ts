import type { CrmWriteDraft, SlackReply, SlackRequestRecord } from 'src/types/slack-agent';
import { answerCrmQuery } from 'src/utils/crm-query';
import {
  applyApprovedDraft,
  buildApplyResultJson,
  createOperationalTask,
  summarizeApplyResult,
} from 'src/utils/crm-write';
import {
  buildCrmWriteDraft,
  classifySlackText,
} from 'src/utils/intelligence';
import {
  findSlackRequestById,
  updateSlackRequest,
} from 'src/utils/slack-intake-service';
import { postSlackReplyForRequest } from 'src/utils/slack-api';

const nowIso = (): string => new Date().toISOString();

const buildApprovalReply = ({
  slackRequestId,
  summary,
  warnings,
}: {
  slackRequestId: string;
  summary: string;
  warnings: string[];
}): SlackReply => ({
  text: `CRM 반영 초안을 만들었습니다. 검토 후 승인해 주세요. ${summary}`,
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*CRM 반영 초안*\n${summary}`,
      },
    },
    ...(warnings.length > 0
      ? [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: warnings.map((warning) => `• ${warning}`).join('\n'),
            },
          },
        ]
      : []),
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          action_id: 'approve_slack_request',
          text: {
            type: 'plain_text',
            text: '반영',
          },
          style: 'primary',
          value: slackRequestId,
        },
        {
          type: 'button',
          action_id: 'reject_slack_request',
          text: {
            type: 'plain_text',
            text: '취소',
          },
          style: 'danger',
          value: slackRequestId,
        },
      ],
    },
  ],
});

const notifyOperations = async ({
  title,
  body,
}: {
  title: string;
  body: string;
}): Promise<void> => {
  await createOperationalTask({
    title,
    body,
  });
};

const setSlackRequestError = async ({
  slackRequest,
  error,
}: {
  slackRequest: SlackRequestRecord;
  error: Error;
}): Promise<void> => {
  await updateSlackRequest({
    id: slackRequest.id,
    data: {
      processingStatus: 'ERROR',
      errorMessage: error.message,
      lastProcessedAt: nowIso(),
    },
  });

  await notifyOperations({
    title: `[Slack Agent 오류] ${slackRequest.name ?? slackRequest.id}`,
    body: error.stack ?? error.message,
  });
};

export const processSlackRequest = async (
  slackRequest: SlackRequestRecord,
): Promise<SlackRequestRecord> => {
  try {
    const classification = await classifySlackText(slackRequest.rawText ?? '');
    await updateSlackRequest({
      id: slackRequest.id,
      data: {
        intentType: classification.intentType,
        confidence: classification.confidence,
        processingStatus: 'CLASSIFIED',
        resultJson: {
          classification,
        },
        lastProcessedAt: nowIso(),
      },
    });

    if (classification.intentType === 'QUERY') {
      const answer = await answerCrmQuery({
        classification,
        text: slackRequest.rawText ?? '',
      });

      const answeredRequest = await updateSlackRequest({
        id: slackRequest.id,
        data: {
          processingStatus: 'ANSWERED',
          resultJson: answer.resultJson,
          lastProcessedAt: nowIso(),
        },
      });

      await postSlackReplyForRequest({
        slackRequest: answeredRequest,
        reply: answer.reply,
      });

      return answeredRequest;
    }

    if (classification.intentType === 'WRITE_DRAFT') {
      const draft = await buildCrmWriteDraft(slackRequest.rawText ?? '');
      const draftedRequest = await updateSlackRequest({
        id: slackRequest.id,
        data: {
          processingStatus: 'AWAITING_CONFIRMATION',
          draftJson: draft,
          resultJson: {
            classification,
          },
          lastProcessedAt: nowIso(),
        },
      });

      await postSlackReplyForRequest({
        slackRequest: draftedRequest,
        reply: buildApprovalReply({
          slackRequestId: draftedRequest.id,
          summary: draft.summary,
          warnings: draft.warnings,
        }),
      });

      return draftedRequest;
    }

    const unknownRequest = await updateSlackRequest({
      id: slackRequest.id,
      data: {
        processingStatus: 'ERROR',
        errorMessage: '지원되지 않는 Slack 요청 의도입니다.',
        lastProcessedAt: nowIso(),
      },
    });

    await postSlackReplyForRequest({
      slackRequest: unknownRequest,
      reply: {
        text: '지원되지 않는 요청 형식입니다. 조회 또는 CRM 반영 요청 형태로 다시 보내주세요.',
      },
    });

    return unknownRequest;
  } catch (error) {
    const typedError =
      error instanceof Error ? error : new Error('Unknown Slack processing error');
    await setSlackRequestError({
      slackRequest,
      error: typedError,
    });
    throw typedError;
  }
};

export const processSlackRequestById = async (
  slackRequestId: string,
): Promise<SlackRequestRecord> => {
  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    throw new Error(`Slack 요청 ${slackRequestId}를 찾지 못했습니다.`);
  }

  return processSlackRequest(slackRequest);
};

export const approveSlackRequest = async ({
  slackRequestId,
  approvedBySlackUserId,
}: {
  slackRequestId: string;
  approvedBySlackUserId?: string;
}): Promise<SlackRequestRecord> => {
  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    throw new Error(`Slack 요청 ${slackRequestId}를 찾지 못했습니다.`);
  }

  if (!slackRequest.draftJson) {
    throw new Error('승인할 draftJson이 없습니다.');
  }

  const confirmedRequest = await updateSlackRequest({
    id: slackRequest.id,
    data: {
      processingStatus: 'CONFIRMED',
      approvedByWorkspaceMemberId: approvedBySlackUserId ?? null,
      lastProcessedAt: nowIso(),
    },
  });

  const applyResult = await applyApprovedDraft(
    confirmedRequest.draftJson as CrmWriteDraft,
  );

  const appliedRequest = await updateSlackRequest({
    id: confirmedRequest.id,
    data: {
      processingStatus: applyResult.errors.length === 0 ? 'APPLIED' : 'ERROR',
      resultJson: buildApplyResultJson(applyResult),
      errorMessage:
        applyResult.errors.length > 0 ? applyResult.errors.join('\n') : null,
      lastProcessedAt: nowIso(),
    },
  });

  await postSlackReplyForRequest({
    slackRequest: appliedRequest,
    reply: {
      text: `CRM 반영을 마쳤습니다. ${summarizeApplyResult(applyResult)}`,
    },
  });

  return appliedRequest;
};

export const rejectSlackRequest = async ({
  slackRequestId,
  reason,
}: {
  slackRequestId: string;
  reason?: string;
}): Promise<SlackRequestRecord> => {
  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    throw new Error(`Slack 요청 ${slackRequestId}를 찾지 못했습니다.`);
  }

  const rejectedRequest = await updateSlackRequest({
    id: slackRequest.id,
    data: {
      processingStatus: 'REJECTED',
      errorMessage: reason ?? 'Slack에서 취소됨',
      lastProcessedAt: nowIso(),
    },
  });

  await postSlackReplyForRequest({
    slackRequest: rejectedRequest,
    reply: {
      text: 'CRM 반영 요청을 취소했습니다.',
    },
  });

  return rejectedRequest;
};
