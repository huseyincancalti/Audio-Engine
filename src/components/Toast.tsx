// src/components/Toast.tsx
// 5 saniyelik undo toast + success varyantı.

import { useEffect } from 'react';

export interface ToastData {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  variant?: 'default' | 'success';
  duration?: number;
}

interface Props extends ToastData {
  onDismiss: () => void;
}

export function Toast({ message, actionLabel, onAction, onDismiss, variant = 'default', duration = 5000 }: Props) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(id);
  }, [message, duration, onDismiss]);

  return (
    <div className={`ae-toast ae-toast--${variant}`} role="status">
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
