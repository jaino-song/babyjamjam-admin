export interface ListEmptyStateProps {
  message: string;
  name?: string;
}

export function ListEmptyState({ message, name }: ListEmptyStateProps) {
  return (
    <div
      data-component={name}
      className="text-center py-12 text-v3-text-muted text-[0.85rem]"
    >
      {message}
    </div>
  );
}
