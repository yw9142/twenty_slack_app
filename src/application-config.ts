import {
  APP_DESCRIPTION,
  APP_DISPLAY_NAME,
  APPLICATION_UNIVERSAL_IDENTIFIER,
  DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
} from 'src/constants/universal-identifiers';
import { defineApplication } from 'src/utils/twenty-shim';

export default defineApplication({
  universalIdentifier: APPLICATION_UNIVERSAL_IDENTIFIER,
  displayName: APP_DISPLAY_NAME,
  description: APP_DESCRIPTION,
  icon: 'IconBrandSlack',
  author: 'Daou Data Virtualization Division Demo',
  category: 'Automation',
  logoUrl: 'public/logo.svg',
  screenshots: [
    'public/screenshot-overview.svg',
    'public/screenshot-slack-flow.svg',
  ],
  websiteUrl: 'https://www.daoudata.co.kr',
  emailSupport: 'demo@daoudata.local',
  issueReportUrl: 'https://github.com/yw9142/twenty_slack_app/issues',
  aboutDescription: `
# 다우 Slack Agent

다우 Slack Agent는 Slack에서 올라오는 한국어 영업 대화를 분석해 Twenty CRM에 맞는 조회 응답, 입력 초안, 승인 기반 반영 흐름을 제공하는 데모 앱입니다.

## 이 앱이 하는 일

- Slack 멘션과 \`/crm\` 커맨드를 받아 CRM 질의와 입력 요청으로 분류합니다.
- 회사, 담당자, 영업기회, 솔루션 중심으로 조회 응답을 생성합니다.
- 자유 텍스트 메모를 CRM 반영 초안으로 구조화하고 Slack 승인 후 적용합니다.
- Slack 요청을 \`Slack 요청\` 운영 객체에 저장해 승인 대기, 오류, 처리 이력을 추적합니다.
- 일간 영업기회 점검, 단계 점검, 주간 브리핑, 월간 업셀 후보 분석 로직을 제공합니다.

## 데모 시나리오

1. Slack에서 "이번달 신규 영업기회 알려줘" 같은 질문을 보냅니다.
2. 앱이 Twenty 데이터를 조회해 한국어 요약으로 답변합니다.
3. Slack에서 "미래금융이 Citrix VDI 검토 중, 에이맥스 공동영업" 같은 메모를 올립니다.
4. 앱이 회사/담당자/영업기회/솔루션 초안을 만들고 승인 카드를 보냅니다.
5. 승인하면 Twenty CRM에 구조화된 데이터가 반영됩니다.

## 운영 포인트

- 승인 전에는 실제 CRM 데이터를 변경하지 않습니다.
- Slack 요청 이력을 별도 객체로 남겨 감사와 운영 추적이 가능합니다.
- 앱 구성 변수만으로 Slack/OpenAI 연동 설정을 관리합니다.
`,
  applicationVariables: {
    ALLOWED_CHANNEL_IDS: {
      universalIdentifier: '9489113c-eee1-4daa-b515-d873d107b2f0',
      description:
        'Comma-separated Slack channel IDs that the app is allowed to process.',
      value: '',
      isSecret: false,
    },
    ADMIN_SLACK_USER_IDS: {
      universalIdentifier: '8d104689-75bd-45f3-ad52-a4a88aadc477',
      description:
        'Comma-separated Slack user IDs that should receive operational alerts.',
      value: '',
      isSecret: false,
    },
    VENDOR_ALIGNED_STAGE_VALUES: {
      universalIdentifier: '35bfbea9-2e6e-4224-8abe-aa90ea2e8e01',
      description:
        'Comma-separated opportunity stage values that require a primary vendor.',
      value:
        'VENDOR_ALIGNED,DISCOVERY_POC,QUOTED,NEGOTIATION,CLOSED_WON,CLOSED_LOST,ON_HOLD',
      isSecret: false,
    },
    QUOTE_STAGE_VALUES: {
      universalIdentifier: '9c9ad711-4c99-48b6-a6c3-88fb78b7df66',
      description:
        'Comma-separated opportunity stage values that require linked solutions.',
      value: 'QUOTED,NEGOTIATION,CLOSED_WON,CLOSED_LOST',
      isSecret: false,
    },
    MANAGEMENT_CHANNEL_ID: {
      universalIdentifier: '83623a81-cddf-42a6-b3bd-f42d9707704d',
      description:
        'Slack channel ID for weekly briefings and operational notifications.',
      value: '',
      isSecret: false,
    },
    SLACK_BOT_TOKEN: {
      universalIdentifier: 'add4316d-b593-4793-8de1-f76318f967c5',
      description: 'Slack bot token used for posting replies and notifications.',
      value: '',
      isSecret: true,
    },
    SLACK_SIGNING_SECRET: {
      universalIdentifier: 'b32611a3-45fb-43e6-8f12-54d9520ebe05',
      description: 'Slack signing secret used to verify inbound webhooks.',
      value: '',
      isSecret: true,
    },
    SLACK_VERIFICATION_TOKEN: {
      universalIdentifier: '96133c05-2d23-44f0-a56b-1caa94dd77d9',
      description:
        'Optional fallback verification token for environments where raw body verification is not available.',
      value: '',
      isSecret: true,
    },
    SLACK_APP_TOKEN: {
      universalIdentifier: 'a5ec4f01-fbfc-4839-91ea-cd2f200e1c2f',
      description:
        'Optional Slack app-level token for future Socket Mode support.',
      value: '',
      isSecret: true,
    },
    OPENAI_API_KEY: {
      universalIdentifier: '45155fd1-25f7-4f7b-808e-3d309ea5e6cb',
      description: 'OpenAI API key used for intent analysis and draft generation.',
      value: '',
      isSecret: true,
    },
    OPENAI_MODEL: {
      universalIdentifier: 'c6d6691e-9bf2-4378-ba73-7c63f90f4f53',
      description:
        'OpenAI model ID used for structured query and draft generation.',
      value: 'gpt-4o-mini',
      isSecret: false,
    },
    TWENTY_BASE_URL: {
      universalIdentifier: '296993ee-e53c-416e-a946-d76a4ae4ac6b',
      description:
        'Public Twenty base URL used when generating record links for Slack.',
      value: '',
      isSecret: false,
    },
  },
  defaultRoleUniversalIdentifier: DEFAULT_ROLE_UNIVERSAL_IDENTIFIER,
});
