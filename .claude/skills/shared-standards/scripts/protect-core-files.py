#!/usr/bin/env python3
"""
핵심 설정 파일 보호 Hook

중요한 파일들을 실수로 덮어쓰는 것을 방지.
수정 시도 시 사용자에게 확인 요청.
"""

import sys
import json
from pathlib import Path
from typing import Optional


# 보호할 파일 패턴들
PROTECTED_PATTERNS = {
    # 완전 차단 (절대 수정 불가)
    "block": [
        ".env",
        ".env.local",
        ".env.production",
        "package-lock.json",
        "pnpm-lock.yaml",
        "yarn.lock",
    ],
    
    # 확인 필요 (사용자 승인 후 수정)
    "ask": [
        "prisma/schema.prisma",      # 마이그레이션 필요
        "package.json",               # 의존성 관리
        "tsconfig.json",              # 타입스크립트 설정
        "next.config.js",             # Next.js 설정
        "next.config.mjs",
        "tailwind.config.js",         # Tailwind 설정
        "tailwind.config.ts",
        "CLAUDE.md",                  # 프로젝트 가이드
        "docker-compose.yml",         # Docker 설정
        "Dockerfile",
        ".github/workflows",          # CI/CD
    ],
    
    # 경고만 (진행은 허용)
    "warn": [
        "README.md",
        ".gitignore",
        ".eslintrc",
        ".prettierrc",
    ]
}


def get_protection_level(file_path: str) -> tuple[str, Optional[str]]:
    """파일의 보호 레벨 반환"""
    path = Path(file_path)
    file_name = path.name
    
    # 전체 경로 또는 파일명으로 매칭
    for level, patterns in PROTECTED_PATTERNS.items():
        for pattern in patterns:
            if file_path.endswith(pattern) or file_name == pattern:
                return level, pattern
            # 디렉토리 패턴 매칭
            if pattern in file_path:
                return level, pattern
    
    return "allow", None


def validate(input_data: dict) -> dict:
    """메인 검증 로직"""
    tool_input = input_data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    
    if not file_path:
        return {"decision": "allow"}
    
    level, matched_pattern = get_protection_level(file_path)
    
    if level == "block":
        return {
            "decision": "block",
            "reason": "\n".join([
                f"🔒 Protected File: `{matched_pattern}`",
                "",
                "This file cannot be modified directly.",
                "",
                "Reasons:",
                "- Environment files contain secrets",
                "- Lock files should only be updated by package managers",
                "",
                "If you need to modify environment variables:",
                "1. Tell the user which variables to add",
                "2. User manually updates the file",
            ])
        }
    
    if level == "ask":
        return {
            "decision": "ask",
            "message": "\n".join([
                f"⚠️ Protected File: `{matched_pattern}`",
                "",
                "This is a critical configuration file.",
                "",
                "Modifying it may:",
                "- Require database migration (prisma/schema.prisma)",
                "- Break existing dependencies (package.json)",
                "- Affect build process (config files)",
                "",
                "Are you sure you want to modify this file?",
            ])
        }
    
    if level == "warn":
        # 경고 로그만 남기고 진행 허용
        return {
            "decision": "allow",
            "warning": f"📝 Note: Modifying `{matched_pattern}`"
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
