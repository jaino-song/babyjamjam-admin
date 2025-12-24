## Sub-Agent Workflow

### New Project Request
When user asks to build a new app/service:

1. **Delegate to fullstack-planner**
```
   Use the fullstack-planner subagent to gather requirements
```

2. **Wait for plan**
   - Sub-agent creates `docs/tasks/implementation-plan.md`
   - Sub-agent updates `docs/context.md`

3. **Implement from plan**
   - Read the implementation-plan.md
   - Follow the Implementation Order checklist
   - Update context.md as you complete each step

### File-Based Context
- `docs/context.md` - Project status tracker
- `docs/tasks/*.md` - Task-specific plans
- Read these instead of relying on chat history
```

## 4. Architecture Skill 추가 (선택)

`.claude/skills/fullstack-architecture/` 에 reference 파일들 복사:
```
.claude/
├── agents/
│   └── fullstack-planner.md
└── skills/
    └── fullstack-architecture/
        ├── SKILL.md
        └── references/
            ├── generation-workflow.md
            ├── templates.md
            ├── backend-nestjs.md
            └── ... (필요한 것만)
```

## 5. 사용 예시

### 방법 1: 자동 위임
```
> Todo 앱 만들어줘

Claude: [fullstack-planner 서브에이전트에게 위임]
        [요구사항 질문...]
        [implementation-plan.md 생성]
        [plan 기반으로 코드 구현]
```

### 방법 2: 명시적 호출
```
> Use the fullstack-planner subagent to plan a todo app

[Sub-agent gathers requirements]
[Creates implementation-plan.md]

> Now implement the plan in implementation-plan.md
```

## 6. 전체 파일 구조
```
your-project/
├── .claude/
│   ├── agents/
│   │   └── fullstack-planner.md    # Sub-agent 정의
│   └── skills/
│       └── fullstack-architecture/  # (선택) Reference 파일들
├── docs/
│   ├── context.md                   # 프로젝트 상태
│   └── tasks/
│       └── implementation-plan.md   # Sub-agent 출력
├── CLAUDE.md                        # 메인 설정
└── ...