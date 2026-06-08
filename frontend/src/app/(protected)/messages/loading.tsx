const LOADING_ITEMS = Array.from({ length: 5 }, (_, index) => index);

function LoadingBlock({ className }: { className: string }) {
    return <span aria-hidden="true" className={className} />;
}

export default function Loading() {
    return (
        <div
            aria-label="메시지 화면을 불러오는 중"
            data-component="messages-loading"
            className="flex h-full min-h-0 w-full flex-1 flex-col"
        >
            <div
                data-component="messages-loading-grid"
                className="grid h-full min-h-0 flex-1 gap-4 lg:grid-cols-[400px_minmax(0,1fr)]"
            >
                <section
                    data-component="messages-loading-list-panel"
                    className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-white shadow-v3"
                >
                    <div data-component="messages-loading-list-header" className="shrink-0 p-6 pb-0">
                        <LoadingBlock className="mb-4 block h-7 w-32 rounded-[10px] bg-v3-surface" />
                        <LoadingBlock className="block h-4 w-52 rounded-[8px] bg-v3-surface" />
                        <div
                            data-component="messages-loading-list-controls"
                            className="mt-6 flex min-h-[52px] items-center justify-between"
                        >
                            <div data-component="messages-loading-filter-placeholders" className="flex gap-3">
                                <LoadingBlock className="block h-6 w-12 rounded-[8px] bg-v3-primary-light" />
                                <LoadingBlock className="block h-6 w-12 rounded-[8px] bg-v3-surface" />
                                <LoadingBlock className="block h-6 w-12 rounded-[8px] bg-v3-surface" />
                            </div>
                            <LoadingBlock className="block h-8 w-8 rounded-full bg-v3-surface" />
                        </div>
                    </div>
                    <div
                        data-component="messages-loading-list-content"
                        className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden px-6 pt-3 pb-6"
                    >
                        {LOADING_ITEMS.map((item) => (
                            <div
                                key={item}
                                data-component="messages-loading-list-item"
                                className="rounded-[20px] border border-v3-border bg-white p-4"
                            >
                                <div data-component="messages-loading-list-item-body" className="flex items-center gap-4">
                                    <LoadingBlock className="block h-12 w-12 rounded-[16px] bg-v3-surface" />
                                    <div data-component="messages-loading-list-item-copy" className="min-w-0 flex-1 space-y-3">
                                        <LoadingBlock className="block h-4 w-2/5 rounded-[8px] bg-v3-surface" />
                                        <LoadingBlock className="block h-4 w-3/4 rounded-[8px] bg-v3-surface" />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                <section
                    data-component="messages-loading-detail-panel"
                    className="hidden h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-white shadow-v3 lg:flex"
                >
                    <div data-component="messages-loading-detail-header" className="shrink-0 p-6">
                        <div data-component="messages-loading-detail-title-row" className="flex items-center gap-4">
                            <LoadingBlock className="block h-14 w-14 rounded-[18px] bg-v3-primary-light" />
                            <div data-component="messages-loading-detail-title-copy" className="min-w-0 flex-1 space-y-3">
                                <LoadingBlock className="block h-6 w-40 rounded-[10px] bg-v3-surface" />
                                <LoadingBlock className="block h-4 w-72 max-w-full rounded-[8px] bg-v3-surface" />
                            </div>
                        </div>
                        <div data-component="messages-loading-detail-tabs" className="mt-6 flex gap-6 border-b border-v3-border pb-3">
                            <LoadingBlock className="block h-5 w-14 rounded-[8px] bg-v3-primary-light" />
                            <LoadingBlock className="block h-5 w-14 rounded-[8px] bg-v3-surface" />
                        </div>
                    </div>
                    <div data-component="messages-loading-detail-content" className="min-h-0 flex-1 overflow-hidden px-6 pb-6">
                        <div data-component="messages-loading-message-card" className="rounded-[24px] border border-v3-border bg-white p-6">
                            <div data-component="messages-loading-message-card-header" className="mb-6 flex items-center justify-between">
                                <div data-component="messages-loading-message-card-copy" className="space-y-3">
                                    <LoadingBlock className="block h-5 w-24 rounded-[8px] bg-v3-surface" />
                                    <LoadingBlock className="block h-4 w-56 rounded-[8px] bg-v3-surface" />
                                </div>
                                <LoadingBlock className="block h-10 w-20 rounded-full bg-v3-surface" />
                            </div>
                            <div data-component="messages-loading-message-lines" className="space-y-4 rounded-[18px] border border-v3-border p-5">
                                <LoadingBlock className="block h-4 w-3/5 rounded-[8px] bg-v3-surface" />
                                <LoadingBlock className="block h-4 w-full rounded-[8px] bg-v3-surface" />
                                <LoadingBlock className="block h-4 w-5/6 rounded-[8px] bg-v3-surface" />
                                <LoadingBlock className="block h-4 w-4/5 rounded-[8px] bg-v3-surface" />
                                <LoadingBlock className="block h-4 w-2/3 rounded-[8px] bg-v3-surface" />
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>
    );
}
