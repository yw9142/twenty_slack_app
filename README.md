# 다우 Slack Agent

`daou-slack-agent`는 Slack에서 올라오는 한국어 영업 대화를 분석해 Twenty CRM에 맞는 조회 응답, 입력 초안, 승인 기반 반영을 수행하는 데모용 Twenty 앱입니다. 로컬 `twenty` 코어를 수정하지 않고, 독립 앱으로 개발해 원격 Twenty 서버에 tarball 형태로 배포하는 구조를 전제로 합니다.

## 데모에서 보여줄 수 있는 것

- Slack 멘션과 `/crm` 커맨드 수신
- 회사, 담당자, 영업기회, 솔루션 중심 CRM 조회 응답
- 자유 텍스트 메모를 CRM 반영 초안으로 구조화
- Slack 승인 카드 기반의 반영/보류/취소 흐름
- `Slack 요청` 운영 객체를 통한 처리 이력 추적
- 일간 영업기회 건강도 점검
- 단계 변경 점검
- 주간 브리핑 / 월간 업셀 후보 분석

## 핵심 흐름

1. Slack에서 영업 질문이나 메모를 보냅니다.
2. 앱이 의도를 `조회`, `쓰기 초안`, `승인 액션`으로 분류합니다.
3. 조회면 Twenty 데이터를 검색해 한국어 답변을 만듭니다.
4. 입력 요청이면 회사, 담당자, 영업기회, 솔루션 초안을 생성합니다.
5. Slack에서 승인하면 CRM에 실제 반영합니다.
6. 요청 이력과 결과는 `Slack 요청` 객체에 저장합니다.

## 포함된 엔드포인트

- `POST /s/slack/events`
- `POST /s/slack/commands`
- `POST /s/slack/interactivity`

## 주요 객체와 운영 뷰

### `Slack 요청`

- 요청명
- 입력 경로
- 의도
- 처리 상태
- 원문
- 정규화 텍스트
- draft JSON
- result JSON
- 오류 메시지
- 승인 이력

운영 뷰:

- `전체 Slack 요청`
- `승인 대기`
- `오류`
- `질의 이력`
- `쓰기 초안 이력`

## 앱 변수와 서버 변수

앱 변수와 서버 변수는 Twenty의 앱 설정 화면에서 입력합니다.

앱 변수:

- `ALLOWED_CHANNEL_IDS`
- `ADMIN_SLACK_USER_IDS`
- `MANAGEMENT_CHANNEL_ID`
- `VENDOR_ALIGNED_STAGE_VALUES`
- `QUOTE_STAGE_VALUES`

서버 변수:

- `SLACK_BOT_TOKEN`
- `SLACK_SIGNING_SECRET`
- `SLACK_VERIFICATION_TOKEN`
- `SLACK_APP_TOKEN`
- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `TWENTY_BASE_URL`

## 개발

```bash
yarn
yarn lint
yarn typecheck
yarn test
yarn build
```

통합 테스트는 로컬 Twenty 인스턴스가 있을 때만 실행합니다.

```bash
RUN_TWENTY_INTEGRATION_TESTS=true yarn test:integration
```

## 배포

이 앱은 코어 Docker 이미지를 다시 빌드하지 않고, tarball 업로드로 운영 Twenty에 배포합니다.

```bash
yarn twenty remote add --api-url https://<your-twenty-domain> --api-key <api-key> --as production
yarn twenty deploy --remote production
```

배포 후에는 Twenty UI에서 앱을 설치하거나 업그레이드합니다.

## Slack 설정

Slack App Request URL:

- Events API: `https://<your-twenty-domain>/s/slack/events`
- Slash Command `/crm`: `https://<your-twenty-domain>/s/slack/commands`
- Interactivity: `https://<your-twenty-domain>/s/slack/interactivity`

권장 권한:

- `app_mentions:read`
- `chat:write`
- `commands`
- `users:read.email`
- 필요한 채널 읽기 권한

## 현재 제약

- Slack 사용자 이메일과 Twenty 사용자 권한 매핑은 아직 MVP 범위 밖입니다.
- 현재 승인 이력은 Slack user id 중심으로 남깁니다.
- 설치 단계의 metadata validation 이슈를 빠르게 좁히기 위해 front component는 아직 넣지 않았습니다.

## 향후 확장

- Slack 사용자 이메일 기반 권한 매핑
- Notes / Tasks target 자동 연결 고도화
- 한국어 structured output 프롬프트 보강
- 운영 대시보드 자동 provision
- 수주/실주 후속 자동화와 리스크 딜 리마인드 고도화
