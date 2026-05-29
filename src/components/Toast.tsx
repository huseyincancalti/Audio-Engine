// src/components/Toast.tsx
// 5 saniyelik undo toast'ı — ARCHITECTURE bölüm 10.6.

import { useEffect } from 'react';

export interface ToastData {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface Props extends ToastData {
  onDismiss: () => void;
  duration?: number;
}

export function Toast({ message, actionLabel, onAction, onDismiss, duration = 5000 }: Props) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(id);
  }, [message, duration, onDismiss]);

  return (
    <div className="ae-toast" role="status">
      <span>{message}</span>
      {actionLabel && (
        <button
          className="ae-toast-undo"
          onClick={() => {
            onAction?.();
            onDismiss();
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
