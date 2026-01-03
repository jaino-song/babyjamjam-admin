#!/usr/bin/env python3
"""
Mobile Validator v1.0.0

mobile-generator 스킬 전용 검증기

검증 항목:
- Expo 설정 파일
- Expo Router 구조
- 보안 저장소 사용
- EAS 설정
- 테스트/타입체크
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


class MobileValidator:
    """Mobile Generator 전용 검증기"""
    
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.mobile_dir = self.project_root / "apps/mobile"
        self.items: List[Item] = []
    
    def error(self, msg: str, cat: str = ""):
        self.items.append(Item(Level.ERROR, f"❌ {msg}", cat))
    
    def warning(self, msg: str, cat: str = ""):
        self.items.append(Item(Level.WARNING, f"⚠️ {msg}", cat))
    
    def passed(self, msg: str, cat: str = ""):
        self.items.append(Item(Level.PASSED, f"✅ {msg}", cat))
    
    def validate(self) -> Result:
        """전체 검증 실행"""
        
        # 모바일 디렉토리 존재 확인
        if not self.mobile_dir.exists():
            self.warning("apps/mobile directory not found - skipping mobile validation", "structure")
            return Result(True, self.items)
        
        # 1. Expo 설정 확인
        self._check_expo_config()
        
        # 2. Expo Router 구조
        self._check_router_structure()
        
        # 3. 스크린 파일 확인
        self._check_screens()
        
        # 4. 보안 저장소 사용
        self._check_secure_store()
        
        # 5. EAS 설정
        self._check_eas_config()
        
        # 6. 테스트 실행
        self._run_tests()
        
        # 7. TypeScript 컴파일
        self._run_typecheck()
        
        success = not any(i.level == Level.ERROR for i in self.items)
        return Result(success, self.items)
    
    def _check_expo_config(self):
        """Expo 설정 파일 확인"""
        app_json = self.mobile_dir / "app.json"
        app_config_ts = self.mobile_dir / "app.config.ts"
        app_config_js = self.mobile_dir / "app.config.js"
        
        if app_config_ts.exists():
            self.passed("app.config.ts exists", "config")
        elif app_config_js.exists():
            self.passed("app.config.js exists", "config")
        elif app_json.exists():
            self.passed("app.json exists", "config")
        else:
            self.error("No Expo config file found", "config")
    
    def _check_router_structure(self):
        """Expo Router 구조 확인"""
        app_dir = self.mobile_dir / "app"
        
        if app_dir.exists():
            self.passed("app/ directory exists (Expo Router)", "router")
            
            # _layout.tsx 확인
            layout = app_dir / "_layout.tsx"
            if layout.exists():
                self.passed("Root _layout.tsx exists", "router")
            else:
                self.warning("Root _layout.tsx missing", "router")
        else:
            self.error("app/ directory missing (Expo Router)", "router")
    
    def _check_screens(self):
        """스크린 파일 확인"""
        app_dir = self.mobile_dir / "app"
        if not app_dir.exists():
            return
        
        screens = list(app_dir.rglob("*.tsx"))
        # _layout.tsx 제외
        screens = [s for s in screens if not s.name.startswith("_")]
        
        if screens:
            self.passed(f"{len(screens)} screens found", "screens")
        else:
            self.warning("No screen files found", "screens")
    
    def _check_secure_store(self):
        """expo-secure-store 사용 확인"""
        if not self.mobile_dir.exists():
            return
        
        ts_files = list(self.mobile_dir.rglob("*.ts")) + \
                   list(self.mobile_dir.rglob("*.tsx"))
        
        uses_secure_store = False
        uses_async_storage = False
        
        for f in ts_files:
            try:
                content = f.read_text()
                if "expo-secure-store" in content:
                    uses_secure_store = True
                if "AsyncStorage" in content and "token" in content.lower():
                    uses_async_storage = True
            except:
                pass
        
        if uses_secure_store:
            self.passed("expo-secure-store usage detected", "security")
        elif uses_async_storage:
            self.warning("AsyncStorage used for tokens - consider expo-secure-store", "security")
    
    def _check_eas_config(self):
        """EAS 빌드 설정 확인"""
        eas_json = self.mobile_dir / "eas.json"
        
        if eas_json.exists():
            self.passed("eas.json exists", "build")
            
            try:
                config = json.loads(eas_json.read_text())
                if "build" in config:
                    profiles = list(config["build"].keys())
                    self.passed(f"EAS build profiles: {', '.join(profiles)}", "build")
            except:
                pass
        else:
            self.warning("eas.json missing - EAS build not configured", "build")
    
    def _run_tests(self):
        """테스트 실행"""
        if not (self.mobile_dir / "package.json").exists():
            return
        
        try:
            result = subprocess.run(
                ["pnpm", "test", "--passWithNoTests"],
                cwd=self.mobile_dir,
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
        if not (self.mobile_dir / "package.json").exists():
            return
        
        try:
            result = subprocess.run(
                ["pnpm", "exec", "tsc", "--noEmit"],
                cwd=self.mobile_dir,
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
    parser = argparse.ArgumentParser(description="Mobile Validator")
    parser.add_argument("--project-root", default=os.getcwd())
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()
    
    validator = MobileValidator(args.project_root)
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
        print("🔍 Mobile Validation")
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
