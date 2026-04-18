import type {
  ApplyDraftResult,
  CrmWriteDraft,
  SlackIntentClassification,
  SlackReply,
  SlackRequestRecord,
} from 'src/types/slack-agent';
import { answerCrmQuery } from 'src/utils/crm-query';
import {
  applyApprovedDraft,
  buildApplyResultJson,
  createOperationalTask,
  summarizeApplyResult,
} from 'src/utils/crm-write';
import {
  buildCrmWriteDraftWithDiagnostics,
  classifySlackTextWithDiagnostics,
} from 'src/utils/intelligence';
import {
  findSlackRequestById,
  updateSlackRequest,
} from 'src/utils/slack-intake-service';
import { applyThreadContextPatchToSlackRequest } from 'src/utils/slack-thread-context-service';
import { postSlackReplyForRequest } from 'src/utils/slack-api';

const nowIso = (): string => new Date().toISOString();

const formatDecision = (
  decision: 'CREATE' | 'UPDATE' | 'DELETE' | 'SKIP',
): string =>
  decision === 'UPDATE'
    ? '기존 레코드 업데이트'
    : decision === 'DELETE'
      ? '기존 레코드 삭제'
      : decision === 'SKIP'
        ? '반영 보류'
        : '신규 생성';

const buildFallbackReview = (draft: CrmWriteDraft) => ({
  overview: draft.summary,
  opinion:
    draft.warnings[0] ??
    '승인 전에 생성/수정/삭제 대상과 필드를 한 번 더 확인하세요.',
  items: draft.actions.map((action) => ({
    kind: action.kind,
    decision: (
      action.operation === 'update'
        ? 'UPDATE'
        : action.operation === 'delete'
          ? 'DELETE'
          : 'CREATE'
    ) as
      | 'UPDATE'
      | 'DELETE'
      | 'CREATE',
    target:
      typeof action.data.title === 'string'
        ? action.data.title
        : typeof action.data.name === 'string'
          ? action.data.name
          : action.lookup?.name ?? action.lookup?.id ?? action.targetId ?? action.kind,
    matchedRecord: action.lookup?.name ?? action.lookup?.id ?? action.targetId ?? null,
    reason: null,
    fields: Object.entries(action.data)
      .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
      .slice(0, 4)
      .map(([key, value]) => ({
        key,
        value: String(value),
      })),
  })),
});

const buildReviewText = (draft: CrmWriteDraft): string[] => {
  const review = draft.review ?? buildFallbackReview(draft);

  return review.items.map((item, index) => {
    const fields =
      item.fields.length > 0
        ? item.fields.map((field) => `  - ${field.key}: ${field.value}`).join('\n')
        : '  - 필드 없음';
    const matchedRecord = item.matchedRecord
      ? `\n• 대상 레코드: ${item.matchedRecord}`
      : '';
    const reason = item.reason ? `\n• 판단 근거: ${item.reason}` : '';

    return [
      `*${index + 1}. ${item.kind}*`,
      `• 결정: ${formatDecision(item.decision)}`,
      `• 반영 대상: ${item.target}`,
      matchedRecord,
      `• 반영 필드:\n${fields}`,
      reason,
    ]
      .filter((line) => line.length > 0)
      .join('\n');
  });
};

export const buildApprovalReply = ({
  slackRequestId,
  draft,
}: {
  slackRequestId: string;
  draft: CrmWriteDraft;
}): SlackReply => ({
  text: `CRM 반영 초안을 만들었습니다. 검토 후 승인해 주세요. ${draft.summary}`,
  blocks: [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*CRM 반영 초안*\n${draft.summary}`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*반영 계획*\n${buildReviewText(draft).join('\n\n')}`,
      },
    },
    ...(draft.review?.opinion
      ? [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*의견*\n${draft.review.opinion}`,
            },
          },
        ]
      : []),
    ...(draft.warnings.length > 0
      ? [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: draft.warnings.map((warning) => `• ${warning}`).join('\n'),
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

const toRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const mergeSlackRequestResultJson = ({
  current,
  patch,
}: {
  current: Record<string, unknown> | null;
  patch: Record<string, unknown>;
}): Record<string, unknown> => {
  const currentRecord = toRecord(current) ?? {};
  const patchRecord = toRecord(patch) ?? {};
  const currentAiDiagnostics = toRecord(currentRecord.aiDiagnostics);
  const patchAiDiagnostics = toRecord(patchRecord.aiDiagnostics);

  return {
    ...currentRecord,
    ...patchRecord,
    ...(currentAiDiagnostics || patchAiDiagnostics
      ? {
          aiDiagnostics: {
            ...(currentAiDiagnostics ?? {}),
            ...(patchAiDiagnostics ?? {}),
          },
        }
      : {}),
  };
};

const buildProcessingTrace = ({
  stage,
  details,
}: {
  stage: string;
  details?: Record<string, unknown>;
}) => ({
  stage,
  updatedAt: nowIso(),
  ...(details ? { details } : {}),
});

const extractStoredClassification = (
  slackRequest: SlackRequestRecord,
): SlackIntentClassification | null => {
  const classification = toRecord(slackRequest.resultJson)?.classification;

  return classification ? (classification as SlackIntentClassification) : null;
};

const buildSelectedEntitiesFromApplyResult = (
  applyResult: ApplyDraftResult,
) => {
  const companyIds = [
    ...applyResult.created,
    ...applyResult.updated,
  ]
    .filter((record) => record.kind === 'company')
    .map((record) => record.id);
  const personIds = [
    ...applyResult.created,
    ...applyResult.updated,
  ]
    .filter((record) => record.kind === 'person')
    .map((record) => record.id);
  const opportunityIds = [
    ...applyResult.created,
    ...applyResult.updated,
  ]
    .filter((record) => record.kind === 'opportunity')
    .map((record) => record.id);

  return {
    ...(companyIds.length > 0 ? { companyIds } : {}),
    ...(personIds.length > 0 ? { personIds } : {}),
    ...(opportunityIds.length > 0 ? { opportunityIds } : {}),
  };
};

const updateSlackRequestProgress = async ({
  slackRequest,
  stage,
  resultJsonPatch,
}: {
  slackRequest: SlackRequestRecord;
  stage: string;
  resultJsonPatch?: Record<string, unknown>;
}): Promise<SlackRequestRecord> =>
  updateSlackRequest({
    id: slackRequest.id,
    data: {
      resultJson: mergeSlackRequestResultJson({
        current: slackRequest.resultJson,
        patch: {
          ...(resultJsonPatch ?? {}),
          processingTrace: buildProcessingTrace({ stage }),
        },
      }),
      lastProcessedAt: nowIso(),
    },
  });

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
      resultJson: mergeSlackRequestResultJson({
        current: slackRequest.resultJson,
        patch: {
          processingTrace: buildProcessingTrace({
            stage: 'ERROR',
            details: {
              errorMessage: error.message,
            },
          }),
        },
      }),
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
  let currentRequest = slackRequest;

  try {
    const requestText =
      slackRequest.normalizedText ?? slackRequest.rawText ?? '';
    const classified = await classifySlackTextWithDiagnostics(requestText);
    const classification = classified.classification;
    const classifiedRequest = await updateSlackRequest({
      id: slackRequest.id,
      data: {
        intentType: classification.intentType,
        confidence: classification.confidence,
        processingStatus: 'CLASSIFIED',
        resultJson: {
          classification,
          aiDiagnostics: {
            classification: classified.aiDiagnostics,
          },
          processingTrace: buildProcessingTrace({
            stage: 'CLASSIFICATION_DONE',
          }),
        },
        lastProcessedAt: nowIso(),
      },
    });
    currentRequest = classifiedRequest;

    if (
      classification.intentType === 'QUERY' ||
      classification.intentType === 'WRITE_DRAFT'
    ) {
      return processClassifiedSlackRequest(classifiedRequest);
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
      slackRequest: currentRequest,
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

export const processClassifiedSlackRequest = async (
  slackRequest: SlackRequestRecord,
): Promise<SlackRequestRecord> => {
  let currentRequest = slackRequest;

  try {
    const requestText =
      slackRequest.normalizedText ?? slackRequest.rawText ?? '';
    const classification = extractStoredClassification(slackRequest);

    if (!classification) {
      throw new Error('분류 결과가 없어 후속 처리를 진행할 수 없습니다.');
    }

    if (classification.intentType === 'QUERY') {
      let startedRequest = await updateSlackRequestProgress({
        slackRequest,
        stage: 'QUERY_STARTED',
      });
      currentRequest = startedRequest;
      const answer = await answerCrmQuery({
        classification,
        text: requestText,
        onProgress: async (stage) => {
          startedRequest = await updateSlackRequestProgress({
            slackRequest: startedRequest,
            stage,
          });
          currentRequest = startedRequest;
        },
      });

      const answeredRequest = await updateSlackRequest({
        id: startedRequest.id,
        data: {
          processingStatus: 'ANSWERED',
          resultJson: mergeSlackRequestResultJson({
            current: startedRequest.resultJson,
            patch: {
              classification,
              ...(answer.resultJson ?? {}),
              processingTrace: buildProcessingTrace({
                stage: 'QUERY_COMPLETED',
              }),
            },
          }),
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
      const startedRequest = await updateSlackRequestProgress({
        slackRequest,
        stage: 'WRITE_DRAFT_STARTED',
      });
      currentRequest = startedRequest;
      const drafted = await buildCrmWriteDraftWithDiagnostics(requestText);
      const draft = drafted.draft;
      const draftedRequest = await updateSlackRequest({
        id: startedRequest.id,
        data: {
          processingStatus: 'AWAITING_CONFIRMATION',
          draftJson: draft,
          resultJson: mergeSlackRequestResultJson({
            current: startedRequest.resultJson,
            patch: {
              classification,
              aiDiagnostics: {
                writeDraft: drafted.aiDiagnostics,
              },
              processingTrace: buildProcessingTrace({
                stage: 'WRITE_DRAFT_COMPLETED',
              }),
            },
          }),
          lastProcessedAt: nowIso(),
        },
      });

      await postSlackReplyForRequest({
        slackRequest: draftedRequest,
        reply: buildApprovalReply({
          slackRequestId: draftedRequest.id,
          draft,
        }),
      });

      return draftedRequest;
    }

    return slackRequest;
  } catch (error) {
    const typedError =
      error instanceof Error ? error : new Error('Unknown Slack continuation error');
    await setSlackRequestError({
      slackRequest: currentRequest,
      error: typedError,
    });
    throw typedError;
  }
};

export const processClassifiedSlackRequestById = async (
  slackRequestId: string,
): Promise<SlackRequestRecord> => {
  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    throw new Error(`Slack 요청 ${slackRequestId}를 찾지 못했습니다.`);
  }

  return processClassifiedSlackRequest(slackRequest);
};

export const approveSlackRequest = async ({
  slackRequestId,
  approvedBySlackUserId,
}: {
  slackRequestId: string;
  approvedBySlackUserId?: string;
}): Promise<SlackRequestRecord> => {
  const confirmedRequest = await confirmSlackRequest({
    slackRequestId,
    approvedBySlackUserId,
  });

  return applyConfirmedSlackRequest(confirmedRequest.id);
};

export const confirmSlackRequest = async ({
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

  return updateSlackRequest({
    id: slackRequest.id,
    data: {
      processingStatus: 'CONFIRMED',
      approvedByWorkspaceMemberId: approvedBySlackUserId ?? null,
      lastProcessedAt: nowIso(),
    },
  });

};

export const applyConfirmedSlackRequest = async (
  slackRequestId: string,
): Promise<SlackRequestRecord> => {
  const slackRequest = await findSlackRequestById(slackRequestId);

  if (!slackRequest) {
    throw new Error(`Slack 요청 ${slackRequestId}를 찾지 못했습니다.`);
  }

  if (!slackRequest.draftJson) {
    throw new Error('승인할 draftJson이 없습니다.');
  }

  const applyResult = await applyApprovedDraft(
    slackRequest.draftJson as CrmWriteDraft,
  );

  const appliedRequest = await updateSlackRequest({
    id: slackRequest.id,
    data: {
      processingStatus: applyResult.errors.length === 0 ? 'APPLIED' : 'ERROR',
      resultJson: buildApplyResultJson(applyResult),
      errorMessage:
        applyResult.errors.length > 0 ? applyResult.errors.join('\n') : null,
      lastProcessedAt: nowIso(),
    },
  });
  const replyText = `CRM 반영을 마쳤습니다. ${summarizeApplyResult(applyResult)}`;

  await applyThreadContextPatchToSlackRequest({
    slackRequest: appliedRequest,
    patch: {
      assistantTurn: {
        text: replyText,
        outcome: 'applied',
      },
      summary: replyText,
      selectedEntities: buildSelectedEntitiesFromApplyResult(applyResult),
      lastQuerySnapshot: null,
      pendingApproval: null,
    },
  });

  await postSlackReplyForRequest({
    slackRequest: appliedRequest,
    reply: {
      text: replyText,
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
  const replyText = 'CRM 반영 요청을 취소했습니다.';

  await applyThreadContextPatchToSlackRequest({
    slackRequest: rejectedRequest,
    patch: {
      assistantTurn: {
        text: replyText,
        outcome: 'rejected',
      },
      summary: replyText,
      selectedEntities: {},
      lastQuerySnapshot: null,
      pendingApproval: null,
    },
  });

  await postSlackReplyForRequest({
    slackRequest: rejectedRequest,
    reply: {
      text: replyText,
    },
  });

  return rejectedRequest;
};
