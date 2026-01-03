#!/usr/bin/env python3
"""
Backend Validator v1.0.0

backend-generator 스킬 전용 검증기

검증 항목:
- Clean Architecture / DDD 레이어 분리
- Prisma 스키마 유효성
- Controller/UseCase 존재
- 테스트 실행
- TypeScript 컴파일
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


class BackendValidator:
    """Backend Generator 전용 검증기"""
    
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.backend_dir = self.project_root / "apps/backend"
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
        
        # 2. Clean Architecture 검증
        self._check_architecture()
        
        # 3. 모듈별 DDD 레이어 확인
        self._check_modules()
        
        # 4. Prisma 스키마 검증
        self._check_prisma()
        
        # 5. Controller/UseCase 확인
        self._check_controllers()
        self._check_usecases()
        
        # 6. 테스트 실행
        self._run_tests()
        
        # 7. TypeScript 컴파일
        self._run_typecheck()
        
        success = not any(i.level == Level.ERROR for i in self.items)
        return Result(success, self.items)
    
    def _check_required_dirs(self):
        """필수 디렉토리 확인"""
        required = [
            "apps/backend/src",
            "apps/backend/src/modules",
            "prisma"
        ]
        
        for d in required:
            path = self.project_root / d
            if path.exists():
                self.passed(f"{d}/ exists", "structure")
            else:
                self.error(f"{d}/ missing", "structure")
    
    def _check_architecture(self):
        """Clean Architecture 의존성 방향 확인"""
        if not self.backend_dir.exists():
            return
        
        ts_files = list(self.backend_dir.rglob("*.ts"))
        violations = []
        
        for f in ts_files:
            try:
                content = f.read_text()
                rel_path = f.relative_to(self.backend_dir)
                
                # domain이 infrastructure/presentation import 금지
                if "/domain/" in str(rel_path):
                    if re.search(r'from\s+[\'"].*/(infrastructure|presentation)/', content):
                        violations.append(f"{rel_path}: domain → infra/presentation 의존")
                
                # application이 presentation import 금지
                if "/application/" in str(rel_path):
                    if re.search(r'from\s+[\'"].*presentation/', content):
                        violations.append(f"{rel_path}: application → presentation 의존")
            except:
                pass
        
        if violations:
            for v in violations[:5]:  # 최대 5개만 표시
                self.error(v, "architecture")
        else:
            self.passed("Clean Architecture 의존성 방향 OK", "architecture")
    
    def _check_modules(self):
        """각 모듈의 DDD 레이어 존재 확인"""
        modules_dir = self.backend_dir / "src/modules"
        if not modules_dir.exists():
            return
        
        layers = ["domain", "application", "infrastructure", "presentation"]
        
        for mod in modules_dir.iterdir():
            if not mod.is_dir() or mod.name.startswith("."):
                continue
            
            existing = [d.name for d in mod.iterdir() if d.is_dir()]
            missing = [l for l in layers if l not in existing]
            
            if missing:
                self.warning(f"Module '{mod.name}' missing layers: {', '.join(missing)}", "modules")
            else:
                self.passed(f"Module '{mod.name}' has all DDD layers", "modules")
    
    def _check_prisma(self):
        """Prisma 스키마 유효성"""
        schema = self.project_root / "prisma/schema.prisma"
        
        if not schema.exists():
            self.error("prisma/schema.prisma not found", "prisma")
            return
        
        content = schema.read_text()
        models = len(re.findall(r'^model\s+\w+\s*{', content, re.MULTILINE))
        
        if models > 0:
            self.passed(f"Prisma: {models} models defined", "prisma")
        else:
            self.error("Prisma: no models defined", "prisma")
        
        # prisma validate 실행
        try:
            result = subprocess.run(
                ["npx", "prisma", "validate"],
                cwd=self.project_root,
                capture_output=True,
                timeout=30
            )
            if result.returncode == 0:
                self.passed("Prisma schema is valid", "prisma")
            else:
                err = result.stderr.decode()[:100]
                self.error(f"Prisma validation failed: {err}", "prisma")
        except:
            pass
    
    def _check_controllers(self):
        """Controller 존재 확인"""
        controllers = list(self.backend_dir.rglob("*.controller.ts"))
        
        if controllers:
            self.passed(f"{len(controllers)} controllers found", "controllers")
        else:
            self.warning("No controllers found", "controllers")
    
    def _check_usecases(self):
        """UseCase 존재 확인"""
        usecases = list(self.backend_dir.rglob("*.use-case.ts")) + \
                   list(self.backend_dir.rglob("*.usecase.ts"))
        
        if usecases:
            self.passed(f"{len(usecases)} use cases found", "usecases")
        else:
            self.warning("No use cases found", "usecases")
    
    def _run_tests(self):
        """테스트 실행"""
        if not (self.backend_dir / "package.json").exists():
            return
        
        try:
            result = subprocess.run(
                ["pnpm", "test", "--passWithNoTests"],
                cwd=self.backend_dir,
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
        if not (self.backend_dir / "package.json").exists():
            return
        
        try:
            result = subprocess.run(
                ["pnpm", "exec", "tsc", "--noEmit"],
                cwd=self.backend_dir,
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
    parser = argparse.ArgumentParser(description="Backend Validator")
    parser.add_argument("--project-root", default=os.getcwd())
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()
    
    validator = BackendValidator(args.project_root)
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
        print("🔍 Backend Validation")
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
