import SwiftUI

struct ContractCreationView: View {
    @State private var clientId = ""
    @State private var employeeId = ""
    @State private var startDate = ""
    @State private var endDate = ""
    @State private var serviceType = ""
    @State private var amount = ""
    @State private var clientIdError: String?
    @State private var startDateError: String?
    @State private var endDateError: String?
    @State private var serviceTypeError: String?
    @State private var isSubmitting = false

    var onNavigateBack: () -> Void = {}

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Button(action: onNavigateBack) { Image(systemName: "chevron.left").font(.title3) }
                        .accessibilityIdentifier("contract-creation-back")
                    Text("계약 생성").font(.appHeading2).fontWeight(.bold).accessibilityIdentifier("contract-creation-title")
                }

                VStack(spacing: 12) {
                    AppFormField(label: "고객 ID *", text: $clientId, error: clientIdError, identifier: "contract-creation-client-id")
                    AppFormField(label: "직원 ID", text: $employeeId, identifier: "contract-creation-employee-id")
                    AppFormField(label: "시작일 (YYYY-MM-DD) *", text: $startDate, error: startDateError, identifier: "contract-creation-start-date")
                    AppFormField(label: "종료일 (YYYY-MM-DD) *", text: $endDate, error: endDateError, identifier: "contract-creation-end-date")
                    AppFormField(label: "서비스 유형 *", text: $serviceType, error: serviceTypeError, identifier: "contract-creation-service-type")
                    AppFormField(label: "금액", text: $amount, keyboardType: .numberPad, identifier: "contract-creation-amount")
                }
                .padding(16)
                .background(Color.appCard)
                .cornerRadius(CGFloat(AppTheme.Radius.lg))
                .shadow(color: .black.opacity(0.05), radius: 4, y: 2)

                Button(action: {
                    clientIdError = clientId.isEmpty ? "고객 ID를 입력해 주세요" : nil
                    startDateError = startDate.isEmpty ? "시작일을 입력해 주세요" : nil
                    endDateError = endDate.isEmpty ? "종료일을 입력해 주세요" : nil
                    serviceTypeError = serviceType.isEmpty ? "서비스 유형을 입력해 주세요" : nil
                    guard clientIdError == nil && startDateError == nil && endDateError == nil && serviceTypeError == nil else { return }
                    isSubmitting = true
                }) {
                    HStack {
                        if isSubmitting { ProgressView().tint(.white) }
                        else { Text("계약 생성").fontWeight(.semibold) }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                .buttonStyle(.borderedProminent)
                .tint(.appPrimary)
                .disabled(isSubmitting)
                .accessibilityIdentifier("contract-creation-submit")
            }
            .padding(16)
        }
        .accessibilityIdentifier("contract-creation-screen")
    }
}
