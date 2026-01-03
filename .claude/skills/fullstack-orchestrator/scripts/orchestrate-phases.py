#!/usr/bin/env python3
"""
Orchestrate Phases v1.0.0

Phase 순차 실행 및 컨텍스트 관리

사용법:
  python orchestrate-phases.py --action status
  python orchestrate-phases.py --action next
  python orchestrate-phases.py --action complete --phase 1
  python orchestrate-phases.py --action init --project-name "MyApp" --platform both
"""

import argparse
import json
import os
import re
import sys
from pathlib import Path
from datetime import datetime
from typing import Optional


class PhaseOrchestrator:
    """Phase 오케스트레이션 관리"""
    
    PHASES = {
        0: {"name": "Planning", "skill": None, "output": "docs/implementation-plan.md"},
        1: {"name": "Backend", "skill": "backend-generator", "output": "apps/backend/structure.md"},
        2: {"name": "Frontend", "skill": "frontend-generator", "output": "apps/web/structure.md"},
        3: {"name": "Mobile", "skill": "mobile-generator", "output": "apps/mobile/structure.md"},
        4: {"name": "Admin", "skill": "admin-generator", "output": "apps/admin/structure.md"},
        5: {"name": "Analytics", "skill": "analytics-generator", "output": None},
    }
    
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.context_file = self.project_root / "docs/dev-context.md"
        self.context = self._load_context()
    
    def _load_context(self) -> dict:
        """dev-context.md에서 컨텍스트 로드"""
        default_context = {
            "completed_phases": [],
            "current_phase": 0,
            "platform": None,  # "web", "mobile", "both"
            "project_name": "",
            "last_updated": None,
        }
        
        if not self.context_file.exists():
            return default_context
        
        try:
            content = self.context_file.read_text(encoding="utf-8")
            
            # Markdown에서 JSON 블록 파싱 (```json ... ```)
            json_pattern = r'```json\s*\n(.*?)\n```'
            match = re.search(json_pattern, content, re.DOTALL)
            
            if match:
                json_str = match.group(1)
                parsed = json.loads(json_str)
                # 기본값과 병합
                return {**default_context, **parsed}
            
            # YAML-like 형식 파싱 (fallback)
            context = default_context.copy()
            
            # completed_phases 파싱
            phases_match = re.search(r'completed_phases:\s*\[(.*?)\]', content)
            if phases_match:
                phases_str = phases_match.group(1)
                if phases_str.strip():
                    context["completed_phases"] = [int(p.strip()) for p in phases_str.split(",") if p.strip()]
            
            # current_phase 파싱
            current_match = re.search(r'current_phase:\s*(\d+)', content)
            if current_match:
                context["current_phase"] = int(current_match.group(1))
            
            # platform 파싱
            platform_match = re.search(r'platform:\s*(\w+)', content)
            if platform_match:
                context["platform"] = platform_match.group(1)
            
            # project_name 파싱
            name_match = re.search(r'project_name:\s*["\']?([^"\'\n]+)["\']?', content)
            if name_match:
                context["project_name"] = name_match.group(1).strip()
            
            return context
            
        except Exception as e:
            print(f"⚠️ Warning: Failed to parse context file: {e}", file=sys.stderr)
            return default_context
    
    def _save_context(self):
        """dev-context.md에 컨텍스트 저장"""
        # docs 디렉토리 생성
        self.context_file.parent.mkdir(parents=True, exist_ok=True)
        
        # 현재 시간 업데이트
        self.context["last_updated"] = datetime.now().isoformat()
        
        # Markdown 형식으로 저장
        content = f"""# Development Context

프로젝트 상태 및 Phase 진행 정보

## Project Info

- **Project Name**: {self.context.get("project_name", "Unknown")}
- **Platform**: {self.context.get("platform", "both")}
- **Last Updated**: {self.context.get("last_updated", "N/A")}

## Phase Status

- **Current Phase**: {self.context.get("current_phase", 0)}
- **Completed Phases**: {self.context.get("completed_phases", [])}

## Context Data

```json
{json.dumps(self.context, indent=2, ensure_ascii=False)}
```

## Phase Progress

| Phase | Name | Status | Output |
|-------|------|--------|--------|
"""
        # Phase 진행 상황 테이블 추가
        for phase_num, phase_info in self.PHASES.items():
            completed = phase_num in self.context.get("completed_phases", [])
            status = "✅ Complete" if completed else "⏳ Pending"
            
            # 플랫폼에 따른 스킵 표시
            platform = self.context.get("platform", "both")
            if phase_num == 2 and platform == "mobile":
                status = "⏭️ Skipped (mobile only)"
            elif phase_num == 3 and platform == "web":
                status = "⏭️ Skipped (web only)"
            
            output = phase_info.get("output") or "N/A"
            content += f"| {phase_num} | {phase_info['name']} | {status} | {output} |\n"
        
        self.context_file.write_text(content, encoding="utf-8")
    
    def init(self, project_name: str, platform: str = "both"):
        """프로젝트 초기화"""
        self.context = {
            "completed_phases": [],
            "current_phase": 0,
            "platform": platform,
            "project_name": project_name,
            "last_updated": datetime.now().isoformat(),
        }
        self._save_context()
        print(f"✅ Project initialized: {project_name} ({platform})")
    
    def status(self) -> dict:
        """현재 Phase 상태 반환"""
        next_phase = self._get_next_phase()
        
        return {
            "project_name": self.context.get("project_name", ""),
            "current_phase": self.context.get("current_phase", 0),
            "completed_phases": self.context.get("completed_phases", []),
            "platform": self.context.get("platform"),
            "next_phase": next_phase,
            "next_phase_name": self.PHASES[next_phase]["name"] if next_phase is not None else None,
            "last_updated": self.context.get("last_updated"),
            "progress": self._calculate_progress(),
        }
    
    def _calculate_progress(self) -> str:
        """진행률 계산"""
        completed = len(self.context.get("completed_phases", []))
        platform = self.context.get("platform", "both")
        
        # 플랫폼에 따른 총 Phase 수 계산
        total = 6  # Phase 0-5
        if platform == "mobile":
            total -= 1  # Frontend 스킵
        elif platform == "web":
            total -= 1  # Mobile 스킵
        
        percentage = (completed / total) * 100 if total > 0 else 0
        return f"{completed}/{total} ({percentage:.0f}%)"
    
    def _get_next_phase(self) -> Optional[int]:
        """다음 실행할 Phase 결정"""
        completed = set(self.context.get("completed_phases", []))
        platform = self.context.get("platform", "both")
        
        for phase_num in range(6):
            if phase_num in completed:
                continue
            
            # 플랫폼에 따른 스킵
            if phase_num == 2 and platform == "mobile":
                continue
            if phase_num == 3 and platform == "web":
                continue
            
            return phase_num
        
        return None  # 모든 Phase 완료
    
    def verify_phase_output(self, phase: int) -> tuple[bool, str]:
        """Phase 출력물 존재 확인"""
        phase_info = self.PHASES.get(phase)
        if not phase_info:
            return False, f"Unknown phase: {phase}"
        
        output = phase_info.get("output")
        if not output:
            return True, "No output file required"
        
        output_path = self.project_root / output
        if output_path.exists():
            return True, f"Output exists: {output}"
        else:
            return False, f"Output missing: {output}"
    
    def complete_phase(self, phase: int, force: bool = False) -> bool:
        """Phase 완료 처리"""
        phase_info = self.PHASES.get(phase)
        if not phase_info:
            print(f"❌ Unknown phase: {phase}")
            return False
        
        # output 파일 확인 (force가 아닌 경우)
        if not force and phase_info.get("output"):
            exists, message = self.verify_phase_output(phase)
            if not exists:
                print(f"⚠️ Phase {phase} output not found: {phase_info['output']}")
                print("Use --force to mark as complete anyway")
                return False
        
        # 완료 처리
        if phase not in self.context["completed_phases"]:
            self.context["completed_phases"].append(phase)
            self.context["completed_phases"].sort()
        
        # current_phase 업데이트
        next_phase = self._get_next_phase()
        if next_phase is not None:
            self.context["current_phase"] = next_phase
        
        self._save_context()
        return True
    
    def uncomplete_phase(self, phase: int) -> bool:
        """Phase 완료 취소"""
        if phase in self.context.get("completed_phases", []):
            self.context["completed_phases"].remove(phase)
            self._save_context()
            print(f"✅ Phase {phase} marked as incomplete")
            return True
        else:
            print(f"⚠️ Phase {phase} was not marked as complete")
            return False
    
    def get_task_command(self, phase: int) -> str:
        """Phase 스킬 호출 Task 명령 생성"""
        phase_info = self.PHASES.get(phase)
        if not phase_info:
            return ""
        
        skill = phase_info.get("skill")
        name = phase_info["name"]
        output = phase_info.get("output", "structure.md")
        
        # Phase 0은 스킬이 없음 (Planning)
        if not skill:
            if phase == 0:
                return f"""
## Task: Phase 0 - Planning

프로젝트 계획을 수립해주세요.

### Context
- 프로젝트: {self.context.get('project_name', 'unknown')}
- 플랫폼: {self.context.get('platform', 'both')}

### 완료 조건
- [ ] docs/implementation-plan.md 생성
- [ ] 기능 요구사항 정의
- [ ] 데이터 모델 설계
- [ ] API 설계
- [ ] 마일스톤 정의

### 다음 단계
완료 후: `python orchestrate-phases.py --action complete --phase 0`
"""
            return ""
        
        # 이전 Phase 정보 수집
        prev_outputs = []
        for prev_phase in range(phase):
            prev_info = self.PHASES.get(prev_phase)
            if prev_info and prev_info.get("output"):
                prev_outputs.append(prev_info["output"])
        
        return f"""
## Task: Phase {phase} - {name}

{skill} 스킬을 사용해서 {name}를 구현해주세요.

### Context
- 프로젝트: {self.context.get('project_name', 'unknown')}
- 플랫폼: {self.context.get('platform', 'both')}
- 계획서: docs/implementation-plan.md

### 참조할 이전 Phase 결과물
{chr(10).join(f'- {o}' for o in prev_outputs) if prev_outputs else '- (없음)'}

### 완료 조건
- [ ] 구현 완료
- [ ] {output} 생성
- [ ] 테스트 통과

### 스킬 호출
```
{skill} 스킬을 실행해주세요
```

### 다음 단계
완료 후: `python orchestrate-phases.py --action complete --phase {phase}`
"""
    
    def print_status_pretty(self):
        """상태를 예쁘게 출력"""
        status = self.status()
        
        print("\n" + "=" * 60)
        print(f"📋 PROJECT: {status['project_name'] or 'Unknown'}")
        print("=" * 60)
        print(f"Platform:   {status['platform'] or 'both'}")
        print(f"Progress:   {status['progress']}")
        print(f"Updated:    {status['last_updated'] or 'N/A'}")
        print("-" * 60)
        
        print("\n📊 Phase Status:\n")
        for phase_num, phase_info in self.PHASES.items():
            completed = phase_num in status["completed_phases"]
            is_next = phase_num == status["next_phase"]
            
            # 상태 아이콘
            if completed:
                icon = "✅"
            elif is_next:
                icon = "👉"
            else:
                icon = "⏳"
            
            # 플랫폼 스킵 표시
            platform = status.get("platform", "both")
            if phase_num == 2 and platform == "mobile":
                icon = "⏭️"
            elif phase_num == 3 and platform == "web":
                icon = "⏭️"
            
            print(f"  {icon} Phase {phase_num}: {phase_info['name']}")
        
        print("-" * 60)
        
        if status["next_phase"] is not None:
            print(f"\n🎯 Next: Phase {status['next_phase']} - {status['next_phase_name']}")
            print(f"   Run: python orchestrate-phases.py --action next")
        else:
            print("\n🎉 All phases completed!")
        
        print()


def main():
    parser = argparse.ArgumentParser(
        description="Phase Orchestrator - Phase 순차 실행 및 컨텍스트 관리",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # 프로젝트 초기화
  python orchestrate-phases.py --action init --project-name "MyApp" --platform both

  # 현재 상태 확인
  python orchestrate-phases.py --action status

  # 다음 Phase Task 출력
  python orchestrate-phases.py --action next

  # Phase 완료 처리
  python orchestrate-phases.py --action complete --phase 1

  # Phase 완료 취소
  python orchestrate-phases.py --action uncomplete --phase 1

  # JSON 형식으로 상태 출력
  python orchestrate-phases.py --action status --json
        """
    )
    parser.add_argument("--project-root", default=os.getcwd(),
                        help="프로젝트 루트 디렉토리 (기본: 현재 디렉토리)")
    parser.add_argument("--action", 
                        choices=["status", "next", "complete", "uncomplete", "init", "verify"],
                        required=True,
                        help="수행할 작업")
    parser.add_argument("--phase", type=int, 
                        help="Phase 번호 (complete/uncomplete/verify 작업 시 필수)")
    parser.add_argument("--project-name", 
                        help="프로젝트 이름 (init 작업 시 필수)")
    parser.add_argument("--platform", choices=["web", "mobile", "both"], default="both",
                        help="플랫폼 선택 (init 작업 시)")
    parser.add_argument("--force", action="store_true",
                        help="출력물 확인 없이 강제 완료 처리")
    parser.add_argument("--json", action="store_true",
                        help="JSON 형식으로 출력")
    
    args = parser.parse_args()
    
    orchestrator = PhaseOrchestrator(args.project_root)
    
    if args.action == "init":
        if not args.project_name:
            print("Error: --project-name required for init action")
            sys.exit(1)
        orchestrator.init(args.project_name, args.platform)
    
    elif args.action == "status":
        if args.json:
            result = orchestrator.status()
            print(json.dumps(result, indent=2, ensure_ascii=False))
        else:
            orchestrator.print_status_pretty()
    
    elif args.action == "next":
        next_phase = orchestrator._get_next_phase()
        if next_phase is not None:
            task = orchestrator.get_task_command(next_phase)
            print(task)
        else:
            print("🎉 All phases completed!")
    
    elif args.action == "complete":
        if args.phase is None:
            print("Error: --phase required for complete action")
            sys.exit(1)
        
        success = orchestrator.complete_phase(args.phase, force=args.force)
        if success:
            print(f"✅ Phase {args.phase} marked as complete")
            
            # 다음 Phase 안내
            next_phase = orchestrator._get_next_phase()
            if next_phase is not None:
                print(f"\n📌 Next: Phase {next_phase} - {orchestrator.PHASES[next_phase]['name']}")
                print("   Run: python orchestrate-phases.py --action next")
            else:
                print("\n🎉 All phases completed!")
        else:
            print(f"❌ Failed to complete Phase {args.phase}")
            sys.exit(1)
    
    elif args.action == "uncomplete":
        if args.phase is None:
            print("Error: --phase required for uncomplete action")
            sys.exit(1)
        
        orchestrator.uncomplete_phase(args.phase)
    
    elif args.action == "verify":
        if args.phase is None:
            print("Error: --phase required for verify action")
            sys.exit(1)
        
        exists, message = orchestrator.verify_phase_output(args.phase)
        if exists:
            print(f"✅ {message}")
        else:
            print(f"❌ {message}")
            sys.exit(1)


if __name__ == "__main__":
    main()
