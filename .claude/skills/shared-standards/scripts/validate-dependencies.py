#!/usr/bin/env python3
"""
Dependency Validation Hook

비호환 또는 위험한 패키지 설치 차단.
프로젝트 표준에 맞는 패키지만 허용.
"""

import sys
import json
import re
from typing import Optional, Tuple


# 차단할 패키지들
BLOCKED_PACKAGES = {
    # ORM 충돌
    "typeorm": "Use Prisma instead (project standard)",
    "sequelize": "Use Prisma instead (project standard)",
    "mongoose": "Use Prisma instead (project standard)",
    "knex": "Use Prisma instead (project standard)",
    
    # 상태 관리 충돌
    "redux": "Use Zustand for client state (project standard)",
    "redux-toolkit": "Use Zustand for client state (project standard)",
    "mobx": "Use Zustand for client state (project standard)",
    "recoil": "Use Zustand for client state (project standard)",
    "jotai": "Use Zustand for client state (project standard)",
    
    # HTTP 클라이언트 충돌
    "node-fetch": "Use Axios (project standard)",
    "got": "Use Axios (project standard)",
    "superagent": "Use Axios (project standard)",
    
    # 테스트 프레임워크 충돌
    "jest": "Use Vitest for unit tests (project standard)",
    "mocha": "Use Vitest for unit tests (project standard)",
    "jasmine": "Use Vitest for unit tests (project standard)",
    "cypress": "Use Playwright for E2E tests (project standard)",
    "puppeteer": "Use Playwright for E2E tests (project standard)",
    
    # 보안 위험
    "eval": "Security risk - eval is dangerous",
    "vm2": "Security risk - sandbox escape vulnerabilities",
    
    # 유지보수 문제
    "moment": "Use date-fns or dayjs instead (moment is deprecated)",
    "request": "Deprecated - use Axios",
    "lodash": "Consider native methods or lodash-es for tree-shaking",
}


# 경고할 패키지들 (허용하지만 주의)
WARN_PACKAGES = {
    "lodash": "Consider using lodash-es for better tree-shaking",
    "uuid": "Consider using crypto.randomUUID() in modern environments",
    "dotenv": "Already included in Next.js/NestJS - may be redundant",
}


# 권장 대체 패키지
RECOMMENDED_ALTERNATIVES = {
    "moment": ["date-fns", "dayjs"],
    "lodash": ["lodash-es", "remeda"],
    "node-fetch": ["axios"],
    "request": ["axios", "got"],
}


def extract_packages_from_command(command: str) -> list[str]:
    """npm/yarn/pnpm 명령어에서 패키지명 추출"""
    packages = []
    
    # npm install, yarn add, pnpm add 패턴
    patterns = [
        r"npm\s+(?:install|i|add)\s+(.+)",
        r"yarn\s+add\s+(.+)",
        r"pnpm\s+(?:add|install)\s+(.+)",
    ]
    
    for pattern in patterns:
        match = re.search(pattern, command, re.IGNORECASE)
        if match:
            pkg_string = match.group(1)
            # 플래그 제거 후 패키지명만 추출
            for part in pkg_string.split():
                if not part.startswith("-"):
                    # @scope/package@version 형식 처리
                    pkg_name = re.sub(r"@[\d.]+.*$", "", part)  # 버전 제거
                    if pkg_name:
                        packages.append(pkg_name)
    
    return packages


def check_package(package: str) -> Tuple[str, Optional[str]]:
    """패키지 체크 결과 반환"""
    # @scope/package에서 패키지명만 추출
    pkg_base = package.split("/")[-1] if "/" in package else package
    
    if pkg_base in BLOCKED_PACKAGES:
        return "block", BLOCKED_PACKAGES[pkg_base]
    
    if pkg_base in WARN_PACKAGES:
        return "warn", WARN_PACKAGES[pkg_base]
    
    return "allow", None


def validate(input_data: dict) -> dict:
    """메인 검증 로직"""
    tool_input = input_data.get("tool_input", {})
    command = tool_input.get("command", "")
    
    if not command:
        return {"decision": "allow"}
    
    # 패키지 설치 명령어가 아니면 통과
    install_patterns = ["npm install", "npm i ", "npm add", "yarn add", "pnpm add", "pnpm install"]
    is_install = any(p in command.lower() for p in install_patterns)
    
    if not is_install:
        return {"decision": "allow"}
    
    packages = extract_packages_from_command(command)
    
    if not packages:
        return {"decision": "allow"}
    
    blocked = []
    warnings = []
    
    for pkg in packages:
        status, message = check_package(pkg)
        if status == "block":
            blocked.append((pkg, message))
        elif status == "warn":
            warnings.append((pkg, message))
    
    if blocked:
        alternatives_section = []
        for pkg, _ in blocked:
            pkg_base = pkg.split("/")[-1] if "/" in pkg else pkg
            if pkg_base in RECOMMENDED_ALTERNATIVES:
                alts = RECOMMENDED_ALTERNATIVES[pkg_base]
                alternatives_section.append(f"  {pkg} → {', '.join(alts)}")
        
        return {
            "decision": "block",
            "reason": "\n".join([
                "🚫 Blocked Package(s) Detected",
                "",
                "The following packages conflict with project standards:",
                "",
                *[f"  ❌ {pkg}: {msg}" for pkg, msg in blocked],
                "",
                "Recommended alternatives:" if alternatives_section else "",
                *alternatives_section,
                "",
                "📚 Reference: Project uses standardized stack:",
                "   - ORM: Prisma",
                "   - State: Zustand (client) + TanStack Query (server)",
                "   - HTTP: Axios",
                "   - Testing: Vitest (unit) + Playwright (E2E)",
            ])
        }
    
    if warnings:
        return {
            "decision": "allow",
            "warning": "\n".join([
                "⚠️ Package Warning(s):",
                *[f"  {pkg}: {msg}" for pkg, msg in warnings],
            ])
        }
    
    return {"decision": "allow"}


if __name__ == "__main__":
    try:
        input_data = json.loads(sys.stdin.read())
        result = validate(input_data)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({
            "decision": "allow",
            "error": str(e)
        }))
