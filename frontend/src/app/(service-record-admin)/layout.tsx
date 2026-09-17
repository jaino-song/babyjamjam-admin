export default function ServiceRecordAdminLayout({
    children,
}: Readonly<{ children: React.ReactNode }>) {
    return (
        <main data-component="desktop_service-record-admin_shell" data-slot="shell">
            {children}
        </main>
    );
}
