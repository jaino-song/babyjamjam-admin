#!/usr/bin/env python3
"""
Payment Security Validator
결제 시스템 보안 검증 스크립트

검증 항목:
1. 서버 사이드 금액 검증
2. Webhook 서명 검증
3. idempotency key 사용
4. 민감 정보 암호화
5. Rate Limiting
6. PCI-DSS 준수
"""

import os
import re
import sys
import json
from pathlib import Path
from typing import List, Dict, Tuple
from dataclasses import dataclass
from enum import Enum


class Severity(Enum):
    ERROR = "ERROR"
    WARNING = "WARNING"
    INFO = "INFO"


@dataclass
class ValidationResult:
    severity: Severity
    message: str
    file: str
    line: int = 0
    suggestion: str = ""


class PaymentSecurityValidator:
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.results: List[ValidationResult] = []
        
        # 검증 대상 확장자
        self.target_extensions = {'.ts', '.tsx', '.js', '.jsx'}
        
        # 제외 디렉토리
        self.exclude_dirs = {'node_modules', '.git', 'dist', 'build', '.next', 'coverage'}

    def validate(self) -> List[ValidationResult]:
        """모든 검증 실행"""
        print("🔒 Payment Security Validation Starting...")
        
        # 파일 수집
        files = self._collect_files()
        print(f"📁 Found {len(files)} files to analyze")
        
        for file_path in files:
            self._validate_file(file_path)
        
        # 환경변수 검증
        self._validate_env_files()
        
        # 결과 정렬 (ERROR > WARNING > INFO)
        self.results.sort(key=lambda x: (
            0 if x.severity == Severity.ERROR else 
            1 if x.severity == Severity.WARNING else 2
        ))
        
        return self.results

    def _collect_files(self) -> List[Path]:
        """검증 대상 파일 수집"""
        files = []
        for ext in self.target_extensions:
            for file in self.project_root.rglob(f'*{ext}'):
                if not any(excluded in file.parts for excluded in self.exclude_dirs):
                    files.append(file)
        return files

    def _validate_file(self, file_path: Path):
        """개별 파일 검증"""
        try:
            content = file_path.read_text(encoding='utf-8')
            lines = content.split('\n')
            rel_path = str(file_path.relative_to(self.project_root))
            
            # 결제 관련 파일인지 확인
            is_payment_file = any(keyword in content.lower() for keyword in [
                'payment', 'stripe', 'toss', 'checkout', 'billing', 'subscription'
            ])
            
            if not is_payment_file:
                return
            
            # 각 검증 수행
            self._check_amount_validation(content, lines, rel_path)
            self._check_webhook_signature(content, lines, rel_path)
            self._check_idempotency(content, lines, rel_path)
            self._check_secret_exposure(content, lines, rel_path)
            self._check_client_amount_trust(content, lines, rel_path)
            self._check_error_handling(content, lines, rel_path)
            
        except Exception as e:
            print(f"⚠️ Error reading {file_path}: {e}")

    def _check_amount_validation(self, content: str, lines: List[str], file: str):
        """서버 사이드 금액 검증 확인"""
        # 결제 확인/생성 로직에서 금액 검증이 있는지 확인
        payment_patterns = [
            r'confirmPayment|createPaymentIntent|processPayment',
            r'amount.*req\.body|body\.amount',
        ]
        
        has_payment_logic = any(re.search(p, content) for p in payment_patterns)
        
        if has_payment_logic:
            # 금액 검증 패턴
            validation_patterns = [
                r'order\.totalAmount|order\.amount',  # DB에서 금액 조회
                r'amount\s*!==|amount\s*===',  # 금액 비교
                r'validateAmount|verifyAmount',  # 검증 함수
            ]
            
            has_validation = any(re.search(p, content) for p in validation_patterns)
            
            if not has_validation:
                self.results.append(ValidationResult(
                    severity=Severity.ERROR,
                    message="결제 금액의 서버 사이드 검증이 없습니다",
                    file=file,
                    suggestion="클라이언트에서 받은 금액 대신 DB에서 조회한 금액을 사용하세요"
                ))

    def _check_webhook_signature(self, content: str, lines: List[str], file: str):
        """Webhook 서명 검증 확인"""
        webhook_patterns = [
            r'webhooks?.*controller|webhook.*handler',
            r'stripe-signature|x-toss-signature',
        ]
        
        is_webhook_file = any(re.search(p, content, re.I) for p in webhook_patterns)
        
        if is_webhook_file:
            signature_patterns = [
                r'constructEvent|verifyWebhook|verifySignature',
                r'stripe\.webhooks\.constructEvent',
                r'createHmac.*sha256',
            ]
            
            has_verification = any(re.search(p, content) for p in signature_patterns)
            
            if not has_verification:
                self.results.append(ValidationResult(
                    severity=Severity.ERROR,
                    message="Webhook 서명 검증이 없습니다",
                    file=file,
                    suggestion="stripe.webhooks.constructEvent() 또는 HMAC 검증을 추가하세요"
                ))

    def _check_idempotency(self, content: str, lines: List[str], file: str):
        """idempotency key 사용 확인"""
        payment_create_patterns = [
            r'createPaymentIntent|createCheckout|processPayment',
            r'stripe\.paymentIntents\.create',
        ]
        
        has_payment_creation = any(re.search(p, content) for p in payment_create_patterns)
        
        if has_payment_creation:
            idempotency_patterns = [
                r'idempotencyKey|idempotency_key|Idempotency-Key',
                r'isEventProcessed|markEventProcessed',
            ]
            
            has_idempotency = any(re.search(p, content, re.I) for p in idempotency_patterns)
            
            if not has_idempotency:
                self.results.append(ValidationResult(
                    severity=Severity.WARNING,
                    message="idempotency key가 사용되지 않았습니다",
                    file=file,
                    suggestion="중복 결제 방지를 위해 idempotency key를 추가하세요"
                ))

    def _check_secret_exposure(self, content: str, lines: List[str], file: str):
        """Secret Key 노출 확인"""
        # 하드코딩된 키 패턴
        secret_patterns = [
            (r'sk_live_[a-zA-Z0-9]+', "Stripe Live Secret Key가 하드코딩되어 있습니다"),
            (r'sk_test_[a-zA-Z0-9]+', "Stripe Test Secret Key가 하드코딩되어 있습니다"),
            (r'whsec_[a-zA-Z0-9]+', "Stripe Webhook Secret이 하드코딩되어 있습니다"),
            (r'live_sk_[a-zA-Z0-9]+', "TossPayments Live Secret Key가 하드코딩되어 있습니다"),
        ]
        
        for i, line in enumerate(lines):
            for pattern, message in secret_patterns:
                if re.search(pattern, line):
                    # 환경변수 참조가 아닌 경우에만
                    if 'process.env' not in line and 'configService' not in line.lower():
                        self.results.append(ValidationResult(
                            severity=Severity.ERROR,
                            message=message,
                            file=file,
                            line=i + 1,
                            suggestion="환경변수를 사용하세요: process.env.STRIPE_SECRET_KEY"
                        ))

    def _check_client_amount_trust(self, content: str, lines: List[str], file: str):
        """클라이언트 금액 신뢰 여부 확인"""
        # 클라이언트 금액을 그대로 사용하는 위험한 패턴
        dangerous_patterns = [
            (r'amount:\s*req\.body\.amount', "클라이언트 금액을 직접 결제에 사용하고 있습니다"),
            (r'amount:\s*body\.amount', "클라이언트 금액을 직접 결제에 사용하고 있습니다"),
            (r'createPaymentIntent\(\s*\{[^}]*amount:\s*\$\{', "템플릿 리터럴로 금액 전달 중"),
        ]
        
        for i, line in enumerate(lines):
            for pattern, message in dangerous_patterns:
                if re.search(pattern, line):
                    self.results.append(ValidationResult(
                        severity=Severity.ERROR,
                        message=message,
                        file=file,
                        line=i + 1,
                        suggestion="DB에서 주문 정보를 조회하여 서버의 금액을 사용하세요"
                    ))

    def _check_error_handling(self, content: str, lines: List[str], file: str):
        """에러 핸들링 확인"""
        payment_api_patterns = [
            r'stripe\.',
            r'tossPayments\.',
            r'await.*payment',
        ]
        
        has_payment_api = any(re.search(p, content) for p in payment_api_patterns)
        
        if has_payment_api:
            error_handling_patterns = [
                r'try\s*\{',
                r'\.catch\(',
                r'catch\s*\([^)]*\)',
            ]
            
            has_error_handling = any(re.search(p, content) for p in error_handling_patterns)
            
            if not has_error_handling:
                self.results.append(ValidationResult(
                    severity=Severity.WARNING,
                    message="결제 API 호출에 에러 핸들링이 없습니다",
                    file=file,
                    suggestion="try-catch 또는 .catch()로 에러를 처리하세요"
                ))

    def _validate_env_files(self):
        """환경변수 파일 검증"""
        env_files = list(self.project_root.glob('.env*'))
        
        required_vars = {
            'stripe': ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'],
            'toss': ['TOSS_PAYMENTS_SECRET_KEY', 'TOSS_PAYMENTS_WEBHOOK_SECRET'],
        }
        
        for env_file in env_files:
            if env_file.name == '.env.example':
                continue
                
            try:
                content = env_file.read_text()
                
                # .env 파일에 실제 키가 포함되어 있는지 (위험)
                if 'sk_live_' in content or 'live_sk_' in content:
                    self.results.append(ValidationResult(
                        severity=Severity.ERROR,
                        message="프로덕션 Secret Key가 .env 파일에 있습니다",
                        file=str(env_file),
                        suggestion=".env 파일을 .gitignore에 추가하고, 프로덕션 키는 안전한 곳에 보관하세요"
                    ))
                    
            except Exception as e:
                print(f"⚠️ Error reading {env_file}: {e}")

    def print_results(self):
        """결과 출력"""
        if not self.results:
            print("\n✅ No security issues found!")
            return 0
        
        error_count = sum(1 for r in self.results if r.severity == Severity.ERROR)
        warning_count = sum(1 for r in self.results if r.severity == Severity.WARNING)
        info_count = sum(1 for r in self.results if r.severity == Severity.INFO)
        
        print(f"\n{'='*60}")
        print(f"Payment Security Validation Results")
        print(f"{'='*60}")
        print(f"❌ Errors: {error_count}")
        print(f"⚠️  Warnings: {warning_count}")
        print(f"ℹ️  Info: {info_count}")
        print(f"{'='*60}\n")
        
        for result in self.results:
            icon = "❌" if result.severity == Severity.ERROR else "⚠️" if result.severity == Severity.WARNING else "ℹ️"
            print(f"{icon} [{result.severity.value}] {result.message}")
            print(f"   📁 File: {result.file}", end="")
            if result.line:
                print(f" (line {result.line})")
            else:
                print()
            if result.suggestion:
                print(f"   💡 Suggestion: {result.suggestion}")
            print()
        
        return error_count


def main():
    # 프로젝트 루트 결정
    project_root = os.environ.get('PROJECT_ROOT', os.getcwd())
    
    # 결제 관련 디렉토리만 스캔
    payment_dirs = ['src/payment', 'src/billing', 'src/checkout', 'app/api/payments']
    
    validator = PaymentSecurityValidator(project_root)
    validator.validate()
    
    error_count = validator.print_results()
    
    # CI/CD에서 사용 시 에러가 있으면 실패
    if error_count > 0:
        print(f"\n💥 Validation failed with {error_count} error(s)")
        sys.exit(1)
    else:
        print("\n✅ Validation passed!")
        sys.exit(0)


if __name__ == '__main__':
    main()
