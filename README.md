# 다우 Slack Agent

`daou-slack-agent`는 Twenty self-hosted 인스턴스에 독립 앱으로 배포하는 Slack x CRM 자동화 앱입니다. 로컬 `twenty` 코어 repo를 수정하는 방식이 아니라, 이 앱만 별도로 개발해서 운영 Azure 서버에 `yarn twenty deploy`로 올리는 구조를 전제로 합니다.

## 포함된 기능

- Slack Events API 수신: `POST /s/slack/events`
- Slack Slash Command 수신: `POST /s/slack/commands`
- Slack 승인 카드 수신: `POST /s/slack/interactivity`
- `Slack 요청` 커스텀 객체와 운영 뷰
- CRM 조회 응답
- CRM 반영 초안 생성
- 승인 후 CRM 반영
- 일간 영업기회 건강도 점검
- 노트 기반 후속 작업 생성
- 단계 변경 점검
- 주간 브리핑 / 월간 업셀 브리핑

## 주요 객체

- `Slack 요청`
  - Slack 원문
  - 의도 분류
  - 처리 상태
  - draft / result JSON
  - 승인 이력

## 개발

```bash
yarn
yarn lint
yarn typecheck
yarn test
yarn build
```

통합 테스트는 로컬 Twenty 인스턴스가 있을 때만 별도로 실행합니다.

```bash
RUN_TWENTY_INTEGRATION_TESTS=true yarn test:integration
```

## 환경변수

앱 변수 / 서버 변수는 Twenty 앱 설정 화면에서 넣습니다.

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_VERIFICATION_TOKEN`
- `SLACK_APP_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `TWENTY_BASE_URL`
- `ALLOWED_CHANNEL_IDS`
- `ADMIN_SLACK_USER_IDS`
- `MANAGEMENT_CHANNEL_ID`
- `VENDOR_ALIGNED_STAGE_VALUES`
- `QUOTE_STAGE_VALUES`

## Azure 배포 방식

현재 운영 가정:

- Azure 단일 VM
- `docker-compose`로 Twenty 운영
- `STORAGE_TYPE=local`
- `server-local-data` 볼륨 유지

이 앱은 코어 Docker 이미지를 다시 빌드하지 않아도 됩니다. 앱 tarball만 운영 Twenty에 배포하면 됩니다.

```bash
yarn twenty remote add --api-url https://<your-twenty-domain> --api-key <api-key> --as production
yarn twenty deploy --remote production
```

그 다음 Twenty UI에서 앱을 설치하거나 업그레이드합니다.

## Slack 설정

Slack App Request URL은 아래로 연결합니다.

- Events API: `https://<your-twenty-domain>/s/slack/events`
- Slash Command `/crm`: `https://<your-twenty-domain>/s/slack/commands`
- Interactivity: `https://<your-twenty-domain>/s/slack/interactivity`

필요 권한:

- `app_mentions:read`
- `chat:write`
- `commands`
- `users:read.email`
- 채널 접근 권한

## 현재 제약

- Twenty route payload 문서상 기본 보장은 `JSON body` 위주라서, Slack의 `application/x-www-form-urlencoded` payload는 Twenty 버전에 따라 제한이 있을 수 있습니다.
- 이 앱은 `signature` 검증을 우선 사용하고, 필요 시 `SLACK_VERIFICATION_TOKEN` fallback도 지원합니다.
- Slack 사용자 이메일과 Twenty 사용자 자동 매핑은 아직 MVP 범위 밖이라, 현재 승인 이력에는 Slack user id를 저장합니다.

## 다음 단계

- Slack 사용자 이메일 기반 권한 매핑
- Notes / Tasks target 자동 연결 고도화
- 더 정교한 한국어 프롬프트와 structured output 강화
- 운영 대시보드의 자동화 탭까지 앱에서 같이 provision
