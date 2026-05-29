# MindFlow — 코드 작업 메모

## 🔖 아이콘 / 이모지 컨벤션

같은 의미를 이모지와 Material Symbols 양쪽으로 쓰지 않는다.
용도별로 둘 중 하나를 고정해서 쓴다.

### 1. UI 컨트롤 (버튼·툴바·FAB·인라인 액션) → **Material Symbols 전용**

`<span class="mi mi-sm">아이콘이름</span>` 형식.
이미 50+ 위치에서 표준으로 자리잡음.

### 2. 액션 시트 / 모달 안의 항목 버튼 → **Material Symbols 전용**

기존에 이모지(✏️🗑📌⧉↺) 섞여있는 곳들. 다음과 같이 매핑한다:

| 의미 | ❌ 이모지 (지양) | ✅ Material Symbol |
|---|---|---|
| 이름 변경 | ✏️ | `edit` |
| 삭제 | 🗑 | `delete` |
| 고정 / 핀 | 📌 | `push_pin` (고정 해제는 `mi-fill` 토글) |
| 복제 | ⧉ | `content_copy` |
| 화면 초기화 / 리셋 | ↺ | `restart_alt` |
| 폴더 | 📁 | `folder` |
| 새로고침 / 동기화 | 🔄 | `refresh` 또는 `sync` |
| 설정 | ⚙️ | `settings` |
| 드로잉 | 🎨 | `brush` (이미 사용중) |
| 메모 | 📝 | `edit_note` (이미 사용중) |
| 검색 | 🔍 | `search` |
| 별표 | ⭐ | `star` |

액션 시트 버튼 표준 형식:
```html
<button onclick="..."><span class="mi mi-sm">delete</span> 삭제</button>
```

### 3. 본문 안내 / 경고 / 도움말 / toast / alert → **이모지 OK**

시각적 의미 표지자(semantic marker)로만 쓴다. 다음만 사용:

| 용도 | 이모지 |
|---|---|
| 팁·힌트 | 💡 |
| 경고 | ⚠️ |
| 에러 | ❌ |
| 성공 | ✅ |
| 정보 | ℹ️ |
| 첨부 파일 표지자 | 📎 |

기존 toast/alert(`💡 본인 Google 계정...`, `⚠️ JSON 불러오기는...`, `❌ 연결 실패`)는 그대로 유지.

### 3-1. ❌ 금지 — 파일 타입별 이모지 다양화

메모 본문에 삽입되는 마크다운 링크는 모든 파일에 동일 표지자(📎) 사용.
파일 타입별로 📄📝📊🗜️🎬🎵📃⚙️🌐📜 다양화하면 일관성 깨짐 (해본 적 있음, 2026-05-29 revert).

### 4. 적용 시점

전면 마이그레이션은 별도 작업으로 진행. 새로 추가/수정하는 액션 시트·버튼은 1·2번 규칙을 즉시 따름.

---

## 📐 기타 코드 컨벤션

- **워크플로**: `main` 브랜치 직접 커밋 (feature 브랜치 안 만듦)
- **커밋 메시지**: 한국어
- **캐시 버스팅**: `js/xxx.js?v=YYYYMMDD?` 형식 (index.html `<script>` 태그). 파일 수정 시 버전 bump 필요
- **localStorage 키**: `mindflow_` 접두사 (utils.js `save()`가 자동 처리)
- **빌드 시스템 없음**: 바닐라 JS, deferred script 순서 의존
