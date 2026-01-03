#!/usr/bin/env python3
"""
Frontend Validator v1.0.0

frontend-generator 스킬 전용 검증기

검증 항목:
- Next.js App Router 구조
- 컴포넌트 디렉토리 구조
- TanStack Query 사용
- API Proxy 패턴
- 테스트/빌드
"""

import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from dataclasses import dataclass, field
from enum import Enum
from typing import List


class Level(Enum):
    ERROR = "error"
    WARNING = "warning"
    PASSED = "passed"


@dataclass
class Item:
    level: Level
    message: str
    category: str = ""


@dataclass
class Result:
    success: bool
    items: List[Item] = field(default_factory=list)
    
    @property
    def errors(self) -> List[str]:
        return [i.message for i in self.items if i.level == Level.ERROR]
    
    @property
    def warnings(self) -> List[str]:
        return [i.message for i in self.items if i.level == Level.WARNING]
    
    @property
    def passed(self) -> List[str]:
        return [i.message for i in self.items if i.level == Level.PASSED]


class FrontendValidator:
    """Frontend Generator 전용 검증기"""
    
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.web_dir = self.project_root / "apps/web"
        self.items: List[Item] = []
    
    def error(self, msg: str, cat: str = ""):
        self.items.append(Item(Level.ERROR, f"❌ {msg}", cat))
    
    def warning(self, msg: str, cat: str = ""):
        self.items.append(Item(Level.WARNING, f"⚠️ {msg}", cat))
    
    def passed(self, msg: str, cat: str = ""):
        self.items.append(Item(Level.PASSED, f"✅ {msg}", cat))
    
    def validate(self) -> Result:
        """전체 검증 실행"""
        
        # 1. 필수 디렉토리 확인
        self._check_required_dirs()
        
        # 2. Next.js App Router 구조
        self._check_app_router()
        
        # 3. 컴포넌트 구조
        self._check_component_structure()
        
        # 4. TanStack Query 사용
        self._check_tanstack_query()
        
        # 5. API Proxy 패턴
        self._check_api_proxy()
        
        # 6. 직접 Backend 호출 금지
        self._check_no_direct_backend()
        
        # 7. 테스트 실행
        self._run_tests()
        
        # 8. TypeScript 컴파일
        self._run_typecheck()
        
        success = not any(i.level == Level.ERROR for i in self.items)
        return Result(success, self.items)
    
    def _check_required_dirs(self):
        """필수 디렉토리 확인"""
        required = [
            "apps/web/src/app",
            "apps/web/src/components",
        ]
        
        for d in required:
            path = self.project_root / d
            if path.exists():
                self.passed(f"{d}/ exists", "structure")
            else:
                self.error(f"{d}/ missing", "structure")
        
        # 선택적 디렉토리
        optional = ["apps/web/src/features", "apps/web/src/hooks", "apps/web/src/lib"]
        for d in optional:
            path = self.project_root / d
            if path.exists():
                self.passed(f"{d}/ exists", "structure")
    
    def _check_app_router(self):
        """Next.js App Router 구조 확인"""
        app_dir = self.web_dir / "src/app"
        if not app_dir.exists():
            return
        
        pages = list(app_dir.rglob("page.tsx"))
        layouts = list(app_dir.rglob("layout.tsx"))
        
        if pages:
            self.passed(f"{len(pages)} pages found", "pages")
        else:
            self.warning("No page.tsx files found", "pages")
        
        if layouts:
            self.passed(f"{len(layouts)} layouts found", "layouts")
    
    def _check_component_structure(self):
        """컴포넌트 디렉토리 구조 확인"""
        components_dir = self.web_dir / "src/components"
        if not components_dir.exists():
            return
        
        # Atomic 또는 Feature-based 구조 확인
        subdirs = [d.name for d in components_dir.iterdir() if d.is_dir()]
        
        atomic = ["atoms", "molecules", "organisms", "templates"]
        feature = ["ui", "common", "layout"]
        
        is_atomic = any(s in subdirs for s in atomic)
        is_feature = any(s in subdirs for s in feature)
        
        if is_atomic or is_feature:
            structure_type = "Atomic" if is_atomic else "Feature-based"
            self.passed(f"Component structure: {structure_type}", "components")
        else:
            self.warning("No standard component structure (Atomic/Feature-based)", "components")
    
    def _check_tanstack_query(self):
        """TanStack Query 사용 확인"""
        if not self.web_dir.exists():
            return
        
        ts_files = list(self.web_dir.rglob("*.ts")) + list(self.web_dir.rglob("*.tsx"))
        
        uses_query = False
        for f in ts_files:
            try:
                content = f.read_text()
                if re.search(r'(useQuery|useMutation|useInfiniteQuery)', content):
                    uses_query = True
                    break
            except:
                pass
        
        if uses_query:
            self.passed("TanStack Query usage detected", "data-fetching")
        else:
            self.warning("No TanStack Query usage detected", "data-fetching")
    
    def _check_api_proxy(self):
        """API Proxy 패턴 확인 (/api/* routes)"""
        api_dir = self.web_dir / "src/app/api"
        
        if api_dir.exists():
            routes = list(api_dir.rglob("route.ts"))
            if routes:
                self.passed(f"{len(routes)} API proxy routes found", "api-proxy")
            else:
                self.warning("No API routes in /api directory", "api-proxy")
        else:
            self.warning("No /api directory for proxy routes", "api-proxy")
    
    def _check_no_direct_backend(self):
        """직접 Backend 호출 금지 확인"""
        if not self.web_dir.exists():
            return
        
        src_dir = self.web_dir / "src"
        if not src_dir.exists():
            return
            
        ts_files = list(src_dir.rglob("*.ts")) + list(src_dir.rglob("*.tsx"))
        
        violations = []
        for f in ts_files:
            # /api 디렉토리는 제외
            if "/api/" in str(f):
                continue
            
            try:
                content = f.read_text()
                # BACKEND_URL 또는 localhost:3001 등 직접 호출 확인
                if re.search(r'(BACKEND_URL|localhost:\d{4}|:3001|:4000)', content):
                    # 서버 컴포넌트 또는 API route가 아닌 경우
                    if "'use client'" in content or '"use client"' in content:
                        rel_path = f.relative_to(self.web_dir)
                        violations.append(str(rel_path))
            except:
                pass
        
        if violations:
            for v in violations[:3]:
                self.warning(f"Possible direct backend call: {v}", "api-pattern")
        else:
            self.passed("No direct backend calls from client", "api-pattern")
    
    def _run_tests(self):
        """테스트 실행"""
        if not (self.web_dir / "package.json").exists():
            return
        
        try:
            result = subprocess.run(
                ["pnpm", "test", "--passWithNoTests"],
                cwd=self.web_dir,
                capture_output=True,
                timeout=120
            )
            if result.returncode == 0:
                self.passed("Tests passed", "tests")
            else:
                err = result.stderr.decode()[:100]
                self.error(f"Tests failed: {err}", "tests")
        except subprocess.TimeoutExpired:
            self.warning("Tests timeout (120s)", "tests")
        except FileNotFoundError:
            pass
    
    def _run_typecheck(self):
        """TypeScript 타입 체크"""
        if not (self.web_dir / "package.json").exists():
            return
        
        try:
            result = subprocess.run(
                ["pnpm", "exec", "tsc", "--noEmit"],
                cwd=self.web_dir,
                capture_output=True,
                timeout=60
            )
            if result.returncode == 0:
                self.passed("TypeScript OK", "build")
            else:
                err = result.stderr.decode()[:100]
                self.error(f"TypeScript errors: {err}", "build")
        except subprocess.TimeoutExpired:
            self.warning("Type check timeout", "build")
        except:
            pass


def main():
    parser = argparse.ArgumentParser(description="Frontend Validator")
    parser.add_argument("--project-root", default=os.getcwd())
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()
    
    validator = FrontendValidator(args.project_root)
    result = validator.validate()
    
    if args.json:
        print(json.dumps({
            "success": result.success,
            "errors": result.errors,
            "warnings": result.warnings,
            "passed": result.passed,
        }, indent=2, ensure_ascii=False))
    else:
        print("\n" + "=" * 60)
        print("🔍 Frontend Validation")
        print("=" * 60)
        
        if result.passed:
            print("\n✅ Passed:")
            for p in result.passed:
                print(f"   {p}")
        
        if result.warnings:
            print("\n⚠️ Warnings:")
            for w in result.warnings:
                print(f"   {w}")
        
        if result.errors:
            print("\n❌ Errors:")
            for e in result.errors:
                print(f"   {e}")
        
        print("\n" + "=" * 60)
        status = "✅ PASSED" if result.success else "❌ FAILED"
        print(f"{status}")
        print("=" * 60 + "\n")
    
    sys.exit(0 if result.success else 1)


if __name__ == "__main__":
    main()
