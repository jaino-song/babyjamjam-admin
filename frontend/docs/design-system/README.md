# Atomic Design Default Structure

## 목적

이 문서는 이 프로젝트의 디자인 시스템을 새로 만들거나 확장할 때 따라야 할 기본 구조를 정리한다.  
핵심은 `버전명 중심 컴포넌트`가 아니라 `의도 중심 semantic API`로 설계하는 것이다.

예를 들어 버튼을 만들 때 `v3`, `blue`, `new-button` 같은 이름을 쓰지 않고 아래처럼 용도로 나눈다.

- `positive`
- `negative`
- `neutral`
- `subtle`
- `positive-outline`
- `negative-outline`

이 원칙은 버튼 하나에만 쓰는 규칙이 아니라, atomic design 전체의 기본 구조로 사용한다.

## 기본 원칙

### 1. Base, Variant, Size, Layout를 분리한다

모든 atom은 아래 순서로 설계한다.

1. `base`
   컴포넌트의 공통 골격이다.  
   예: radius, font weight, transition, focus ring, border structure, icon alignment
2. `variant`
   컴포넌트의 의미와 의도를 표현한다.  
   예: positive, negative, neutral, subtle
3. `size`
   크기만 제어한다.  
   예: height, padding, font-size, icon-size
4. `layout`
   사용하는 화면에서 제어한다.  
   예: width, flex, justify, grid span, responsive placement

중요한 규칙은 `size가 layout을 가지면 안 된다`는 점이다.  
예를 들어 `md`가 `w-full sm:w-1/2` 같은 폭 규칙을 가지면 안 된다. 폭과 배치는 사용하는 쪽에서 `className`으로 제어한다.

### 2. Variant는 semantic name으로 만든다

variant 이름은 시각이 아니라 의도로 정한다.

- 좋은 예: `positive`, `negative`, `neutral`, `subtle`, `selected`, `interactive`
- 나쁜 예: `v3`, `new`, `blue`, `round`, `thick`, `card2`

semantic name을 쓰면 나중에 색을 바꾸거나 톤을 조정해도 API를 유지할 수 있다.

### 3. Atom에서 브랜드 결정을 끝내고, Molecule에서 재정의하지 않는다

atom은 이미 충분히 재사용 가능해야 한다.  
molecule은 atom을 조합하지만, atom의 색상 체계나 구조를 다시 정의하지 않는다.

좋은 구조:

- `Button variant="positive" size="md"`
- `Badge variant="negative"`
- `Input state="error"`

나쁜 구조:

- molecule 내부에서 버튼마다 border radius를 다시 지정
- organism마다 버튼 padding, text size, hover 규칙을 다시 지정
- 페이지별로 같은 atom을 다른 naming 체계로 재정의

### 4. Default는 "가장 많이 쓰는 구조"를 공통으로 둔다

default는 가장 자주 쓰는 시각 구조를 가져야 한다.  
예를 들어 버튼은 다음 요소를 기본 구조로 공유할 수 있다.

- pill radius
- 일관된 border structure
- 동일한 focus ring
- 동일한 press / hover motion
- 공통 icon spacing

그 위에서 색상과 톤만 `variant`로 나눈다.

## Atomic Design 적용 방식

### Atoms

atom은 직접적인 시각 토큰 소비자다.

대표 예시:

- Button
- Input
- Badge
- Checkbox
- Radio
- Tabs trigger
- Card shell

atom 설계 규칙:

- 공통 골격은 `base`에 둔다
- 의미 차이는 `variant`에 둔다
- 크기 차이는 `size`에 둔다
- 폭과 배치는 두지 않는다
- 상태는 `disabled`, `selected`, `invalid`, `loading`처럼 state prop이나 data attribute로 처리한다

### Molecules

molecule은 atom 조합 단위다.

대표 예시:

- 검색 입력 + 필터 버튼
- 카드 헤더 + 상태 배지 + 액션 버튼
- 폼 필드 + 라벨 + 에러 메시지

molecule 설계 규칙:

- atom의 variant를 조합해서 의미를 만든다
- atom의 디자인 토큰을 다시 정의하지 않는다
- spacing과 조합 규칙만 책임진다

### Organisms

organism은 실제 업무 흐름을 담는 큰 조합 단위다.

대표 예시:

- 회원가입 승인 패널
- 지점 관리 split layout
- 고객 목록 + 상세 패널

organism 설계 규칙:

- 데이터 흐름, 섹션 구조, 레이아웃을 책임진다
- atom 자체의 base 스타일은 바꾸지 않는다
- 꼭 필요한 예외만 local override로 둔다

### Templates / Pages

template과 page는 배치와 정보 구조를 결정한다.

대표 예시:

- 대시보드 템플릿
- 상세 + 리스트 split template
- 설정 페이지 레이아웃

template 설계 규칙:

- 레이아웃, 정보 우선순위, 반응형 규칙을 책임진다
- atom이나 molecule의 semantic contract를 깨지 않는다

## 버튼을 기준으로 본 기본 구조

### 권장 variant

- `positive`
  승인, 저장, 생성, 완료 같은 주요 액션
- `negative`
  삭제, 거부, 비활성화 같은 위험 액션
- `neutral`
  취소, 닫기, 뒤로가기, 일반 보조 액션
- `subtle`
  필터, 보조 선택, 낮은 강조도 액션
- `positive-outline`
  강조는 필요하지만 filled가 과한 경우
- `negative-outline`
  위험 액션이지만 filled보다 한 단계 낮게 보여야 하는 경우
- `ghost`
  툴바, 아이콘 버튼, low-chrome action
- `link`
  텍스트 링크형 액션

### 권장 size

- `sm`
- `default`
- `md`
- `lg`
- `icon`

size는 아래만 바꾼다.

- height
- horizontal padding
- font size
- icon size

size는 아래를 바꾸지 않는다.

- width
- alignment
- responsive layout
- grid / flex placement

## 다른 Atom에도 같은 원칙을 적용하는 방법

### Input

input은 색상 variant보다 상태 중심으로 설계하는 편이 낫다.

- `default`
- `focused`
- `invalid`
- `success`
- `disabled`

하지만 구조는 동일하다.

- base: radius, border thickness, padding, caret, transition
- size: field height, text size
- layout: width는 사용하는 폼에서 제어

### Badge

badge는 semantic tone으로 정리한다.

- `positive`
- `negative`
- `warning`
- `neutral`
- `subtle`

### Card

card는 표면 역할로 정리한다.

- `elevated`
- `outlined`
- `interactive`
- `selected`

### Tabs / Segmented Controls

trigger는 선택 의도로 정리한다.

- `default`
- `selected`
- `subtle`

이 경우도 마찬가지로 radius, padding, motion은 공통 base에 두고, 선택 상태는 state나 variant에서 제어한다.

## 구현 체크리스트

새 atom을 만들 때는 아래를 확인한다.

- variant 이름이 semantic한가
- size가 layout을 침범하지 않는가
- width가 component 내부에 하드코딩되지 않았는가
- hover / focus / disabled 구조가 공통 base에 모여 있는가
- 같은 역할의 atom이 다른 이름 체계를 쓰고 있지 않은가
- molecule이나 organism이 atom의 시각 규칙을 다시 덮어쓰고 있지 않은가

## 새 디자인 시스템 요청 템플릿

아래 문구를 그대로 써도 된다.

```text
새 디자인 시스템은 atomic design 기준으로 설계해줘.
모든 atom은 base geometry를 공통으로 두고, variant는 intent 중심 semantic name으로 나눠줘.
variant 이름은 positive, negative, neutral, subtle, positive-outline 같은 식으로 만들어줘.
v3, new, blue 같은 버전명/색상명 variant는 만들지 말아줘.
size는 높이, 패딩, 텍스트 크기만 담당하게 하고 width나 responsive 배치는 넣지 말아줘.
layout은 각 사용처의 className이나 wrapper에서 제어하게 해줘.
molecule은 atom 조합만 책임지고, organism은 레이아웃과 데이터 흐름만 책임지게 분리해줘.
```

## 이 문서를 사용할 때의 기준

새 컴포넌트를 만들 때는 먼저 이 문서 기준으로 API를 정하고, 그 다음 시각 디테일을 붙인다.  
즉, 순서는 항상 아래와 같다.

1. semantic contract 정의
2. base structure 정의
3. variant 정의
4. size 정의
5. layout 적용

이 순서를 지키면 UI가 커져도 naming과 구조가 흔들리지 않는다.
