#!/usr/bin/env python3
"""
Project Completion Validator
- Cross-phase 호환성 검증
- 공유 패키지 일관성 검증
- README.md 완성도 검증
"""

import os
import sys
import json
import re
from pathlib import Path
from typing import Dict, List, Tuple


class ProjectCompletionValidator:
    def __init__(self, project_root: str = "."):
        self.project_root = Path(project_root)
        self.errors: List[str] = []
        self.warnings: List[str] = []
        
    def validate(self) -> Tuple[bool, List[str], List[str]]:
        """Run all validations"""
        self._validate_project_structure()
        self._validate_docs()
        self._validate_shared_packages()
        self._validate_apps()
        self._validate_env_example()
        self._validate_readme()
        self._validate_cross_phase_compatibility()
        
        return len(self.errors) == 0, self.errors, self.warnings
    
    def _validate_project_structure(self):
        """Validate basic project structure"""
        required_dirs = ["apps", "docs"]
        
        for dir_name in required_dirs:
            dir_path = self.project_root / dir_name
            if not dir_path.exists():
                self.errors.append(f"Missing required directory: {dir_name}/")
    
    def _validate_docs(self):
        """Validate documentation files"""
        docs_dir = self.project_root / "docs"
        
        if not docs_dir.exists():
            return
        
        # Check implementation-plan.md
        plan_file = docs_dir / "implementation-plan.md"
        if not plan_file.exists():
            self.errors.append("Missing docs/implementation-plan.md (Phase 0)")
        else:
            content = plan_file.read_text()
            required_sections = [
                "프로젝트 개요",
                "핵심 기능",
                "데이터 모델",
                "인증"
            ]
            for section in required_sections:
                if section not in content:
                    self.warnings.append(f"implementation-plan.md missing section: {section}")
        
        # Check dev-context.md
        context_file = docs_dir / "dev-context.md"
        if not context_file.exists():
            self.errors.append("Missing docs/dev-context.md")
    
    def _validate_shared_packages(self):
        """Validate packages/ directory"""
        packages_dir = self.project_root / "packages"
        
        if not packages_dir.exists():
            self.warnings.append("No packages/ directory - shared types may be missing")
            return
        
        # Check types package
        types_dir = packages_dir / "types"
        if types_dir.exists():
            # Verify index.ts exists
            index_file = types_dir / "src" / "index.ts"
            if not index_file.exists():
                self.warnings.append("packages/types/src/index.ts not found")
    
    def _validate_apps(self):
        """Validate apps/ directory"""
        apps_dir = self.project_root / "apps"
        
        if not apps_dir.exists():
            return
        
        # Check backend (required)
        backend_dir = apps_dir / "backend"
        if not backend_dir.exists():
            self.errors.append("Missing apps/backend/ (Phase 1)")
        else:
            self._validate_backend(backend_dir)
        
        # Check admin (required)
        admin_dir = apps_dir / "admin"
        if not admin_dir.exists():
            self.warnings.append("Missing apps/admin/ (Phase 4)")
        else:
            self._validate_admin(admin_dir)
        
        # Check frontend (optional)
        web_dir = apps_dir / "web"
        if web_dir.exists():
            self._validate_frontend(web_dir)
        
        # Check mobile (optional)
        mobile_dir = apps_dir / "mobile"
        if mobile_dir.exists():
            self._validate_mobile(mobile_dir)
    
    def _validate_backend(self, backend_dir: Path):
        """Validate backend app structure"""
        # Check structure.md
        structure_file = backend_dir / "structure.md"
        if not structure_file.exists():
            self.errors.append("Missing apps/backend/structure.md")
        
        # Check Clean Architecture directories
        src_dir = backend_dir / "src"
        if src_dir.exists():
            required_layers = ["domain", "application", "infrastructure", "presentation"]
            for layer in required_layers:
                if not (src_dir / layer).exists():
                    self.warnings.append(f"Backend missing layer: src/{layer}/")
        
        # Check Prisma schema
        prisma_file = self.project_root / "prisma" / "schema.prisma"
        if not prisma_file.exists():
            self.errors.append("Missing prisma/schema.prisma")
    
    def _validate_frontend(self, web_dir: Path):
        """Validate frontend app structure"""
        # Check structure.md
        structure_file = web_dir / "structure.md"
        if not structure_file.exists():
            self.warnings.append("Missing apps/web/structure.md")
        
        # Check Next.js structure
        src_dir = web_dir / "src"
        if src_dir.exists():
            if not (src_dir / "app").exists():
                self.warnings.append("Frontend missing src/app/ (App Router)")
    
    def _validate_mobile(self, mobile_dir: Path):
        """Validate mobile app structure"""
        # Check structure.md
        structure_file = mobile_dir / "structure.md"
        if not structure_file.exists():
            self.warnings.append("Missing apps/mobile/structure.md")
        
        # Check Expo structure
        app_dir = mobile_dir / "app"
        if not app_dir.exists():
            self.warnings.append("Mobile missing app/ (Expo Router)")
    
    def _validate_admin(self, admin_dir: Path):
        """Validate admin app structure"""
        # Check structure.md
        structure_file = admin_dir / "structure.md"
        if not structure_file.exists():
            self.warnings.append("Missing apps/admin/structure.md")
    
    def _validate_env_example(self):
        """Validate .env.example exists"""
        env_example = self.project_root / ".env.example"
        if not env_example.exists():
            self.errors.append("Missing .env.example")
        else:
            content = env_example.read_text()
            required_vars = ["DATABASE_URL"]
            for var in required_vars:
                if var not in content:
                    self.warnings.append(f".env.example missing: {var}")
    
    def _validate_readme(self):
        """Validate README.md completeness"""
        readme_file = self.project_root / "README.md"
        
        if not readme_file.exists():
            self.errors.append("Missing README.md")
            return
        
        content = readme_file.read_text()
        
        # Check required sections
        required_sections = [
            ("# ", "Project title"),
            ("## ", "Section headers"),
            ("```", "Code blocks"),
        ]
        
        for pattern, description in required_sections:
            if pattern not in content:
                self.warnings.append(f"README.md may be incomplete: missing {description}")
        
        # Check minimum length
        if len(content) < 500:
            self.warnings.append("README.md seems too short (< 500 chars)")
    
    def _validate_cross_phase_compatibility(self):
        """Validate compatibility between phases"""
        # Check if backend types match frontend imports
        backend_structure = self.project_root / "apps" / "backend" / "structure.md"
        web_structure = self.project_root / "apps" / "web" / "structure.md"
        mobile_structure = self.project_root / "apps" / "mobile" / "structure.md"
        
        if backend_structure.exists():
            backend_content = backend_structure.read_text()
            
            # Extract endpoints from backend structure
            endpoints = re.findall(r'(GET|POST|PATCH|PUT|DELETE)\s+(/\S+)', backend_content)
            
            if endpoints:
                # Check if frontend references these endpoints
                if web_structure.exists():
                    web_content = web_structure.read_text()
                    # Just a basic check - could be more sophisticated
                    if "api" not in web_content.lower():
                        self.warnings.append("Frontend structure.md doesn't reference API")
                
                if mobile_structure.exists():
                    mobile_content = mobile_structure.read_text()
                    if "api" not in mobile_content.lower():
                        self.warnings.append("Mobile structure.md doesn't reference API")


def main():
    # Find project root (look for apps/ or docs/ directory)
    current = Path.cwd()
    project_root = current
    
    # Try to find project root
    for parent in [current] + list(current.parents):
        if (parent / "apps").exists() or (parent / "docs").exists():
            project_root = parent
            break
    
    print(f"\n{'='*60}")
    print("🔍 Project Completion Validator")
    print(f"{'='*60}")
    print(f"📁 Project root: {project_root}\n")
    
    validator = ProjectCompletionValidator(str(project_root))
    success, errors, warnings = validator.validate()
    
    # Print results
    if errors:
        print("❌ ERRORS:")
        for error in errors:
            print(f"   • {error}")
        print()
    
    if warnings:
        print("⚠️  WARNINGS:")
        for warning in warnings:
            print(f"   • {warning}")
        print()
    
    if success and not warnings:
        print("✅ All validations passed!")
    elif success:
        print(f"✅ Validation passed with {len(warnings)} warning(s)")
    else:
        print(f"❌ Validation failed with {len(errors)} error(s)")
    
    print(f"\n{'='*60}\n")
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
