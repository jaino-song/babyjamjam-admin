import SwiftUI

struct FileListView: View {
    @State private var isLoading = true
    @State private var files: [(id: String, name: String, mimeType: String?)] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("파일 관리")
                .font(.appHeading2)
                .fontWeight(.bold)
                .accessibilityIdentifier("file-list-title")

            if isLoading {
                LoadingView()
            } else if files.isEmpty {
                EmptyView_(message: "파일이 없습니다")
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(files, id: \.id) { file in
                            HStack(spacing: 12) {
                                Image(systemName: "doc.fill")
                                    .foregroundColor(.appPrimary)
                                    .font(.title3)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(file.name)
                                        .font(.appBodyLarge)
                                        .fontWeight(.medium)
                                    if let mime = file.mimeType {
                                        Text(mime)
                                            .font(.appCaption)
                                            .foregroundColor(.appMuted)
                                    }
                                }
                                Spacer()
                                Image(systemName: "arrow.down.circle")
                                    .foregroundColor(.appMuted)
                            }
                            .padding(16)
                            .background(Color(.systemBackground))
                            .cornerRadius(12)
                            .shadow(color: .black.opacity(0.05), radius: 2, y: 1)
                            .accessibilityIdentifier("file-item-\(file.id)")
                        }
                    }
                }
            }
        }
        .padding(16)
        .accessibilityIdentifier("file-list-screen")
    }
}
