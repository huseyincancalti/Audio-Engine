// src/components/EmptyState.tsx
// Boş durum kartı: dashed border + yönlendirici mesaj + buton — ARCHITECTURE bölüm 10.4.

export function EmptyState({
  title,
  desc,
  actionLabel,
  onAction,
}: {
  title: string;
  desc: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      <p className="empty-desc">{desc}</p>
      {actionLabel && (
        <button type="button" className="btn btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
