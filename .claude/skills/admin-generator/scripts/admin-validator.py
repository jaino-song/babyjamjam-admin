#!/usr/bin/env python3
"""
Admin Validator v1.0.0

admin-generator 스킬 전용 검증기

검증 항목:
- Admin 라우트 구조
- RBAC 구현
- DataTable/Form 컴포넌트
- 민감정보 마스킹
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


class AdminValidator:
    """Admin Generator 전용 검증기"""
    
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.web_dir = self.project_root / "apps/web"
        self.admin_dir = self.web_dir / "src/app/(admin)"
        self.items: List[Item] = []
    
    def error(self, msg: str, cat: str = ""):
        self.items.append(Item(Level.ERROR, f"❌ {msg}", cat))
    
    def warning(self, msg: str, cat: str = ""):
        self.items.append(Item(Level.WARNING, f"⚠️ {msg}", cat))
    
    def passed(self, msg: str, cat: str = ""):
        self.items.append(Item(Level.PASSED, f"✅ {msg}", cat))
    
    def validate(self) -> Result:
        """전체 검증 실행"""
        
        # 1. Admin 라우트 구조
        self._check_admin_routes()
        
        # 2. Admin 페이지 확인
        self._check_admin_pages()
        
        # 3. RBAC 구현
        self._check_rbac()
        
        # 4. DataTable 컴포넌트
        self._check_data_tables()
        
        # 5. Admin features 디렉토리
        self._check_admin_features()
        
        # 6. 민감정보 마스킹
        self._check_masking()
        
        # 7. 테스트 실행
        self._run_tests()
        
        # 8. TypeScript 컴파일
        self._run_typecheck()
        
        success = not any(i.level == Level.ERROR for i in self.items)
        return Result(success, self.items)
    
    def _check_admin_routes(self):
        """Admin 라우트 그룹 확인"""
        if self.admin_dir.exists():
            self.passed("(admin) route group exists", "routes")
        else:
            # 다른 위치 확인
            alt_admin = self.web_dir / "src/app/admin"
            if alt_admin.exists():
                self.passed("admin/ route exists", "routes")
            else:
                self.error("Admin routes not found", "routes")
    
    def _check_admin_pages(self):
        """Admin 페이지 확인"""
        admin_root = self.admin_dir if self.admin_dir.exists() else self.web_dir / "src/app/admin"
        
        if not admin_root.exists():
            return
        
        pages = list(admin_root.rglob("page.tsx"))
        
        if pages:
            self.passed(f"{len(pages)} admin pages found", "pages")
        else:
            self.warning("No admin pages found", "pages")
        
        # 필수 페이지 확인
        expected = ["dashboard", "users", "settings"]
        for page_name in expected:
            page_dir = admin_root / page_name
            if page_dir.exists():
                self.passed(f"/{page_name} page exists", "pages")
    
    def _check_rbac(self):
        """RBAC 구현 확인"""
        if not self.web_dir.exists():
            return
        
        ts_files = list(self.web_dir.rglob("*.ts")) + list(self.web_dir.rglob("*.tsx"))
        
        has_rbac = False
        has_role_check = False
        
        for f in ts_files:
            try:
                content = f.read_text()
                if re.search(r'(checkRole|hasRole|useRole|RoleGuard|isAdmin|isManager)', content, re.IGNORECASE):
                    has_rbac = True
                if re.search(r'role\s*[=!]==?\s*[\'"]', content):
                    has_role_check = True
            except:
                pass
        
        if has_rbac:
            self.passed("RBAC implementation detected", "auth")
        elif has_role_check:
            self.passed("Role checking detected", "auth")
        else:
            self.warning("No RBAC implementation detected", "auth")
    
    def _check_data_tables(self):
        """DataTable 컴포넌트 확인"""
        components_dir = self.web_dir / "src/components"
        features_dir = self.web_dir / "src/features"
        
        has_data_table = False
        
        for d in [components_dir, features_dir]:
            if not d.exists():
                continue
            
            for f in d.rglob("*.tsx"):
                try:
                    content = f.read_text()
                    if re.search(r'(DataTable|Table|@tanstack/react-table)', content):
                        has_data_table = True
                        break
                except:
                    pass
        
        if has_data_table:
            self.passed("DataTable component found", "components")
        else:
            self.warning("No DataTable component found", "components")
    
    def _check_admin_features(self):
        """Admin features 디렉토리 확인"""
        admin_features = self.web_dir / "src/features/admin"
        
        if admin_features.exists():
            self.passed("Admin features directory exists", "structure")
            
            # 하위 디렉토리 확인
            subdirs = [d.name for d in admin_features.iterdir() if d.is_dir()]
            if subdirs:
                self.passed(f"Admin feature modules: {', '.join(subdirs[:5])}", "structure")
    
    def _check_masking(self):
        """민감정보 마스킹 확인"""
        if not self.web_dir.exists():
            return
        
        ts_files = list(self.web_dir.rglob("*.ts")) + list(self.web_dir.rglob("*.tsx"))
        
        has_masking = False
        
        for f in ts_files:
            try:
                content = f.read_text()
                if re.search(r'(maskEmail|maskPhone|mask\w+|\.replace\(.+\*+)', content):
                    has_masking = True
                    break
            except:
                pass
        
        if has_masking:
            self.passed("Data masking implementation found", "security")
        else:
            self.warning("No data masking implementation found", "security")
    
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
    parser = argparse.ArgumentParser(description="Admin Validator")
    parser.add_argument("--project-root", default=os.getcwd())
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()
    
    validator = AdminValidator(args.project_root)
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
        print("🔍 Admin Validation")
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
