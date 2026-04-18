import {
  SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS,
  SLACK_THREAD_CONTEXT_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { FieldType, defineObject } from 'src/utils/twenty-shim';

export default defineObject({
  universalIdentifier: SLACK_THREAD_CONTEXT_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'slackThreadContext',
  namePlural: 'slackThreadContexts',
  labelSingular: 'Slack 스레드 컨텍스트',
  labelPlural: 'Slack 스레드 컨텍스트',
  description: '같은 Slack thread의 최근 대화, 선택된 엔티티, 승인 대기를 저장하는 운영 객체',
  icon: 'IconMessages',
  labelIdentifierFieldMetadataUniversalIdentifier:
    SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.name,
  fields: [
    {
      universalIdentifier: SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.name,
      type: FieldType.TEXT,
      name: 'name',
      label: '컨텍스트명',
      description: 'Slack thread 컨텍스트 표시 이름',
      icon: 'IconAbc',
    },
    {
      universalIdentifier:
        SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.slackTeamId,
      type: FieldType.TEXT,
      name: 'slackTeamId',
      label: 'Slack 팀 ID',
      description: 'Slack workspace 식별자',
      icon: 'IconHash',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.slackChannelId,
      type: FieldType.TEXT,
      name: 'slackChannelId',
      label: 'Slack 채널 ID',
      description: '컨텍스트가 속한 Slack 채널 식별자',
      icon: 'IconHash',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.slackThreadTs,
      type: FieldType.TEXT,
      name: 'slackThreadTs',
      label: 'Slack 스레드 TS',
      description: '같은 대화를 이어가는 Slack thread_ts 값',
      icon: 'IconMessages',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.threadKey,
      type: FieldType.TEXT,
      name: 'threadKey',
      label: '스레드 키',
      description: 'slackTeamId, slackChannelId, slackThreadTs를 합친 고유 키',
      icon: 'IconKey',
    },
    {
      universalIdentifier:
        SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.summaryJson,
      type: FieldType.RAW_JSON,
      name: 'summaryJson',
      label: '요약 JSON',
      description: '같은 thread의 최신 대화 요약',
      icon: 'IconNotebook',
      defaultValue: null,
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.recentTurnsJson,
      type: FieldType.RAW_JSON,
      name: 'recentTurnsJson',
      label: '최근 턴 JSON',
      description: '같은 thread의 최근 6턴 대화 기록',
      icon: 'IconHistory',
      defaultValue: null,
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.contextJson,
      type: FieldType.RAW_JSON,
      name: 'contextJson',
      label: '컨텍스트 JSON',
      description: '선택된 엔티티와 최근 조회 결과 축약본',
      icon: 'IconBraces',
      defaultValue: null,
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.pendingApprovalJson,
      type: FieldType.RAW_JSON,
      name: 'pendingApprovalJson',
      label: '승인 대기 JSON',
      description: '현재 활성화된 수정/삭제 승인 대기 상태',
      icon: 'IconShieldCheck',
      defaultValue: null,
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.lastSlackRequestId,
      type: FieldType.TEXT,
      name: 'lastSlackRequestId',
      label: '마지막 Slack 요청 ID',
      description: '이 thread에서 마지막으로 처리한 SlackRequest ID',
      icon: 'IconPointer',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_THREAD_CONTEXT_FIELD_UNIVERSAL_IDENTIFIERS.lastRepliedAt,
      type: FieldType.DATE_TIME,
      name: 'lastRepliedAt',
      label: '마지막 응답 시각',
      description: 'thread memory를 마지막으로 갱신한 시각',
      icon: 'IconClockCheck',
      isNullable: true,
    },
  ],
});
