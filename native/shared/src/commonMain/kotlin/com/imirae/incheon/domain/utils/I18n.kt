package com.imirae.incheon.domain.utils

object I18n {
    object Common { const val save="저장"; const val cancel="취소"; const val delete="삭제"; const val confirm="확인"; const val search="검색"; const val filter="필터"; const val loading="로딩 중..."; const val edit="수정"; const val create="생성"; const val close="닫기"; const val noData="데이터가 없습니다" }
    object Auth { const val loginTitle="로그인"; const val email="이메일"; const val password="비밀번호"; const val forgotPassword="비밀번호 찾기"; const val loginSuccess="로그인 성공"; const val loginFailed="로그인 실패" }
    object Clients { const val title="고객 관리"; const val add="고객 추가"; const val edit="고객 수정"; const val searchPlaceholder="고객 검색..."; const val noData="등록된 고객이 없습니다"; const val loadError="고객 목록을 불러올 수 없습니다"; const val saveSuccess="고객 정보가 저장되었습니다"; const val deleteSuccess="고객이 삭제되었습니다" }
    object Employees { const val title="직원 관리"; const val add="직원 추가"; const val edit="직원 수정"; const val searchPlaceholder="직원 검색..."; const val noData="등록된 직원이 없습니다"; const val saveSuccess="직원 정보가 저장되었습니다"; const val deleteSuccess="직원이 삭제되었습니다" }
    object Contracts { const val title="계약 관리"; const val create="계약 생성"; const val send="발송"; const val status="상태"; const val signed="서명 완료"; const val pending="대기 중"; const val rejected="거절됨"; const val revoked="취소됨"; const val notFound="계약을 찾을 수 없습니다" }
    object Messages { const val title="메시지"; const val template="템플릿"; const val generate="생성"; const val send="발송"; const val preview="미리보기"; const val copy="복사"; const val copySuccess="복사되었습니다" }
    object Settings { const val title="설정"; const val profile="프로필"; const val notifications="알림"; const val language="언어"; const val security="보안"; const val updateSuccess="설정이 업데이트되었습니다" }
    object Errors { const val generic="오류가 발생했습니다"; const val network="네트워크 연결을 확인해 주세요"; const val server="서버 오류가 발생했습니다"; const val unauthorized="인증이 만료되었습니다"; const val forbidden="접근 권한이 없습니다"; const val notFound="요청한 정보를 찾을 수 없습니다"; const val conflict="이미 존재하는 데이터입니다"; const val rateLimited="요청이 너무 많습니다"; const val invalidEmail="유효한 이메일 형식이 아닙니다"; const val invalidPhone="전화번호 형식이 올바르지 않습니다"; const val weakPassword="비밀번호가 너무 약합니다"; const val requiredField="필수 입력 항목입니다" }
    object Success { const val saved="저장되었습니다"; const val deleted="삭제되었습니다"; const val updated="업데이트되었습니다"; const val completed="완료되었습니다"; const val sent="발송되었습니다" }
    object Confirmations { const val deleteTitle="삭제 확인"; const val deleteMessage="정말 삭제하시겠습니까?"; const val logoutTitle="로그아웃"; const val logoutMessage="로그아웃 하시겠습니까?"; const val discardChangesTitle="변경사항 취소"; const val discardChangesMessage="저장하지 않은 변경사항이 있습니다. 취소하시겠습니까?" }
}
