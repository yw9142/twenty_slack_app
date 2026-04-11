import { defineObject, FieldType } from 'twenty-sdk';

import {
  SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS,
  SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';

export default defineObject({
  universalIdentifier: SLACK_REQUEST_OBJECT_UNIVERSAL_IDENTIFIER,
  nameSingular: 'slackRequest',
  namePlural: 'slackRequests',
  labelSingular: 'Slack 요청',
  labelPlural: 'Slack 요청',
  description: 'Slack에서 들어온 질의, 초안, 승인 액션을 추적하는 운영 객체',
  icon: 'IconBrandSlack',
  labelIdentifierFieldMetadataUniversalIdentifier:
    SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.name,
  fields: [
    {
      universalIdentifier: SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.name,
      type: FieldType.TEXT,
      name: 'name',
      label: '요청명',
      description: 'Slack 요청을 식별하기 위한 표시 이름',
      icon: 'IconAbc',
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.slackTeamId,
      type: FieldType.TEXT,
      name: 'slackTeamId',
      label: 'Slack 팀 ID',
      description: 'Slack workspace 식별자',
      icon: 'IconHash',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.slackChannelId,
      type: FieldType.TEXT,
      name: 'slackChannelId',
      label: 'Slack 채널 ID',
      description: '메시지가 수신된 Slack 채널 식별자',
      icon: 'IconHash',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.slackThreadTs,
      type: FieldType.TEXT,
      name: 'slackThreadTs',
      label: 'Slack 스레드 TS',
      description: '응답을 이어 붙일 Slack 스레드 타임스탬프',
      icon: 'IconMessages',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.slackMessageTs,
      type: FieldType.TEXT,
      name: 'slackMessageTs',
      label: 'Slack 메시지 TS',
      description: '원본 Slack 메시지 타임스탬프',
      icon: 'IconMessage',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.slackUserId,
      type: FieldType.TEXT,
      name: 'slackUserId',
      label: 'Slack 사용자 ID',
      description: '요청을 보낸 Slack 사용자 식별자',
      icon: 'IconUser',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.sourceType,
      type: FieldType.TEXT,
      name: 'sourceType',
      label: '입력 경로',
      description: 'Slack 요청이 들어온 경로',
      icon: 'IconRoute',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.slackResponseUrl,
      type: FieldType.TEXT,
      name: 'slackResponseUrl',
      label: 'Slack 응답 URL',
      description: '후속 응답을 위해 Slack이 제공한 response_url',
      icon: 'IconLink',
      isNullable: true,
    },
    {
      universalIdentifier: SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.rawText,
      type: FieldType.TEXT,
      name: 'rawText',
      label: '원문',
      description: 'Slack에서 받은 원문 텍스트',
      icon: 'IconFileText',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.normalizedText,
      type: FieldType.TEXT,
      name: 'normalizedText',
      label: '정규화 텍스트',
      description: '분석과 검색을 위해 정규화한 요청 텍스트',
      icon: 'IconTextRecognition',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.intentType,
      type: FieldType.TEXT,
      name: 'intentType',
      label: '의도',
      description: 'AI가 분류한 요청 의도',
      icon: 'IconSparkles',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.processingStatus,
      type: FieldType.TEXT,
      name: 'processingStatus',
      label: '처리 상태',
      description: '현재 요청 처리 상태',
      icon: 'IconStatusChange',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.confidence,
      type: FieldType.TEXT,
      name: 'confidence',
      label: '신뢰도',
      description: '의도 분류와 초안 생성 결과의 신뢰도',
      icon: 'IconPercentage',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.draftJson,
      type: FieldType.TEXT,
      name: 'draftJson',
      label: '초안 JSON',
      description: '승인 전 생성된 구조화 초안을 문자열 JSON으로 저장',
      icon: 'IconBraces',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.resultJson,
      type: FieldType.TEXT,
      name: 'resultJson',
      label: '결과 JSON',
      description: '처리 결과와 생성된 레코드 요약을 문자열 JSON으로 저장',
      icon: 'IconChecklist',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.errorMessage,
      type: FieldType.TEXT,
      name: 'errorMessage',
      label: '오류 메시지',
      description: '실패 시 마지막 오류 메시지',
      icon: 'IconAlertCircle',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.dedupeKey,
      type: FieldType.TEXT,
      name: 'dedupeKey',
      label: '중복 방지 키',
      description: 'Slack 재시도 이벤트를 식별하는 키',
      icon: 'IconFingerprint',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.approvedByWorkspaceMemberId,
      type: FieldType.TEXT,
      name: 'approvedByWorkspaceMemberId',
      label: '승인자 Workspace Member ID',
      description: '승인 액션을 누른 Twenty 사용자 ID',
      icon: 'IconShieldCheck',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.receivedAt,
      type: FieldType.TEXT,
      name: 'receivedAt',
      label: '수신 시각',
      description: 'Slack 요청이 접수된 시각',
      icon: 'IconClock',
      isNullable: true,
    },
    {
      universalIdentifier:
        SLACK_REQUEST_FIELD_UNIVERSAL_IDENTIFIERS.lastProcessedAt,
      type: FieldType.TEXT,
      name: 'lastProcessedAt',
      label: '마지막 처리 시각',
      description: '요청이 마지막으로 처리된 시각',
      icon: 'IconClockCheck',
      isNullable: true,
    },
  ],
});
