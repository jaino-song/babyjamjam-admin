import SwiftUI

struct ChatView: View {
    @State private var messages: [(id: String, role: String, content: String)] = []
    @State private var inputText = ""
    @State private var isSending = false
    @State private var isLoading = false

    var body: some View {
        VStack(spacing: 0) {
            Text("AI 채팅")
                .font(.appHeading2)
                .fontWeight(.bold)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(16)
                .accessibilityIdentifier("chat-title")

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(messages, id: \.id) { msg in
                            HStack {
                                if msg.role == "user" { Spacer() }
                                Text(msg.content)
                                    .font(.appBody)
                                    .padding(12)
                                    .foregroundColor(msg.role == "user" ? .white : .primary)
                                    .background(msg.role == "user" ? Color.appPrimary : Color(.systemGray6))
                                    .cornerRadius(16)
                                    .frame(maxWidth: 280, alignment: msg.role == "user" ? .trailing : .leading)
                                    .accessibilityIdentifier("chat-message-\(msg.id)")
                                if msg.role != "user" { Spacer() }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                }
            }

            Divider()

            HStack(spacing: 8) {
                TextField("메시지를 입력하세요...", text: $inputText)
                    .textFieldStyle(.roundedBorder)
                    .disabled(isSending)
                    .accessibilityIdentifier("chat-input")

                Button(action: {
                    guard !inputText.trimmingCharacters(in: .whitespaces).isEmpty else { return }
                    isSending = true
                    // TODO: Call ViewModel sendMessage
                    inputText = ""
                }) {
                    if isSending {
                        ProgressView()
                            .frame(width: 24, height: 24)
                    } else {
                        Image(systemName: "paperplane.fill")
                            .foregroundColor(inputText.isEmpty ? .gray : .appPrimary)
                    }
                }
                .disabled(isSending || inputText.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityIdentifier("chat-send-button")
            }
            .padding(16)
        }
        .accessibilityIdentifier("chat-screen")
    }
}
