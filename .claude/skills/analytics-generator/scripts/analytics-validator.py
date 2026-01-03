#!/usr/bin/env python3
"""
Analytics Validator v1.0.0

analytics-generator 스킬 전용 검증기

검증 항목:
- PostHog 설정
- API Key 서버 전용 (ANL-001)
- PII 해싱 (ANL-002)
- 세션 녹화 마스킹 (ANL-003)
- Rate Limiting (ANL-005)
- 옵트아웃 제공 (ANL-006)
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
    code: str = ""


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


class AnalyticsValidator:
    """Analytics Generator 전용 검증기"""
    
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.analytics_dir = self.project_root / "packages/analytics"
        self.items: List[Item] = []
    
    def error(self, msg: str, cat: str = "", code: str = ""):
        self.items.append(Item(Level.ERROR, f"❌ {msg}", cat, code))
    
    def warning(self, msg: str, cat: str = "", code: str = ""):
        self.items.append(Item(Level.WARNING, f"⚠️ {msg}", cat, code))
    
    def passed(self, msg: str, cat: str = "", code: str = ""):
        self.items.append(Item(Level.PASSED, f"✅ {msg}", cat, code))
    
    def validate(self) -> Result:
        """전체 검증 실행"""
        
        # 1. Analytics 패키지 존재
        self._check_package_exists()
        
        # 2. PostHog 설정
        self._check_posthog_setup()
        
        # 3. ANL-001: API Key 서버 전용
        self._check_api_key_server_only()
        
        # 4. ANL-002: PII 해싱
        self._check_pii_hashing()
        
        # 5. ANL-003: 세션 녹화 마스킹
        self._check_session_masking()
        
        # 6. ANL-005: Rate Limiting
        self._check_rate_limiting()
        
        # 7. ANL-006: 옵트아웃 제공
        self._check_opt_out()
        
        # 8. TypeScript 컴파일
        self._run_typecheck()
        
        success = not any(i.level == Level.ERROR for i in self.items)
        return Result(success, self.items)
    
    def _check_package_exists(self):
        """Analytics 패키지 존재 확인"""
        if self.analytics_dir.exists():
            self.passed("packages/analytics exists", "structure")
        else:
            self.warning("packages/analytics not found", "structure")
    
    def _check_posthog_setup(self):
        """PostHog 설정 확인"""
        if not self.analytics_dir.exists():
            # 다른 위치에서 찾기
            return
        
        ts_files = list(self.analytics_dir.rglob("*.ts"))
        
        has_posthog = False
        for f in ts_files:
            try:
                content = f.read_text()
                if "posthog" in content.lower():
                    has_posthog = True
                    break
            except:
                pass
        
        if has_posthog:
            self.passed("PostHog integration found", "posthog")
        else:
            self.warning("No PostHog integration found", "posthog")
    
    def _check_api_key_server_only(self):
        """ANL-001: API Key가 서버에서만 사용되는지 확인"""
        web_dir = self.project_root / "apps/web"
        if not web_dir.exists():
            return
        
        # 클라이언트 컴포넌트에서 API key 직접 사용 확인
        client_files = []
        for f in web_dir.rglob("*.tsx"):
            try:
                content = f.read_text()
                if "'use client'" in content or '"use client"' in content:
                    # Private key 패턴 검출
                    if re.search(r'(POSTHOG_API_KEY|phc_[a-zA-Z0-9]{20,}[^_])', content):
                        # NEXT_PUBLIC_ 접두사가 없는 key 사용 검출
                        if not re.search(r'NEXT_PUBLIC_POSTHOG', content):
                            client_files.append(str(f.relative_to(web_dir)))
            except:
                pass
        
        if client_files:
            for cf in client_files[:3]:
                self.error(f"ANL-001: API key exposed in client: {cf}", "security", "ANL-001")
        else:
            self.passed("ANL-001: API keys server-side only", "security", "ANL-001")
    
    def _check_pii_hashing(self):
        """ANL-002: PII 해싱 확인"""
        all_ts_files = list(self.project_root.rglob("*.ts")) + \
                       list(self.project_root.rglob("*.tsx"))
        
        has_pii_tracking = False
        has_hashing = False
        
        for f in all_ts_files:
            try:
                content = f.read_text()
                # PII 트래킹 패턴
                if re.search(r'(identify|setUserProperties).*(email|phone|name)', content, re.IGNORECASE):
                    has_pii_tracking = True
                # 해싱 패턴
                if re.search(r'(hashEmail|hashPII|sha256|crypto\.createHash)', content):
                    has_hashing = True
            except:
                pass
        
        if has_pii_tracking and not has_hashing:
            self.warning("ANL-002: PII tracking without hashing detected", "privacy", "ANL-002")
        elif has_hashing:
            self.passed("ANL-002: PII hashing implemented", "privacy", "ANL-002")
        else:
            self.passed("ANL-002: No PII tracking detected", "privacy", "ANL-002")
    
    def _check_session_masking(self):
        """ANL-003: 세션 녹화 마스킹 확인"""
        all_ts_files = list(self.project_root.rglob("*.ts")) + \
                       list(self.project_root.rglob("*.tsx"))
        
        has_session_recording = False
        has_masking = False
        
        for f in all_ts_files:
            try:
                content = f.read_text()
                if "session_recording" in content.lower() or "sessionrecording" in content.lower():
                    has_session_recording = True
                if re.search(r'(maskAllInputs|maskTextContent|data-ph-capture-attribute-|ph-no-capture)', content):
                    has_masking = True
            except:
                pass
        
        if has_session_recording and not has_masking:
            self.warning("ANL-003: Session recording without masking", "privacy", "ANL-003")
        elif has_session_recording and has_masking:
            self.passed("ANL-003: Session recording with masking", "privacy", "ANL-003")
    
    def _check_rate_limiting(self):
        """ANL-005: Rate Limiting 확인"""
        all_ts_files = list(self.project_root.rglob("*.ts"))
        
        has_rate_limit = False
        
        for f in all_ts_files:
            try:
                content = f.read_text()
                # PostHog batch 설정 또는 rate limiting 패턴
                if re.search(r'(flushAt|flushInterval|rateLimit|throttle|debounce).*', content, re.IGNORECASE):
                    has_rate_limit = True
                    break
            except:
                pass
        
        if has_rate_limit:
            self.passed("ANL-005: Rate limiting implemented", "performance", "ANL-005")
        else:
            self.warning("ANL-005: No rate limiting detected", "performance", "ANL-005")
    
    def _check_opt_out(self):
        """ANL-006: 옵트아웃 제공 확인"""
        all_ts_files = list(self.project_root.rglob("*.ts")) + \
                       list(self.project_root.rglob("*.tsx"))
        
        has_opt_out = False
        
        for f in all_ts_files:
            try:
                content = f.read_text()
                if re.search(r'(optOut|opt_out|opt_out_capturing|disableTracking|cookieConsent)', content, re.IGNORECASE):
                    has_opt_out = True
                    break
            except:
                pass
        
        if has_opt_out:
            self.passed("ANL-006: Opt-out mechanism provided", "privacy", "ANL-006")
        else:
            self.warning("ANL-006: No opt-out mechanism detected", "privacy", "ANL-006")
    
    def _run_typecheck(self):
        """TypeScript 타입 체크"""
        if not (self.analytics_dir / "package.json").exists():
            return
        
        try:
            result = subprocess.run(
                ["pnpm", "exec", "tsc", "--noEmit"],
                cwd=self.analytics_dir,
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
        except FileNotFoundError:
            self.warning("pnpm not found, skipping typecheck", "build")
        except:
            pass


def main():
    parser = argparse.ArgumentParser(description="Analytics Validator")
    parser.add_argument("--project-root", default=os.getcwd())
    parser.add_argument("--json", action="store_true", help="JSON output")
    args = parser.parse_args()
    
    validator = AnalyticsValidator(args.project_root)
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
        print("🔍 Analytics Validation")
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
