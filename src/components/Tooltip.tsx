// src/components/Tooltip.tsx
// Hover ipucu. children verilmezse küçük "i" ikonu gösterir.

import type { ReactNode } from 'react';

export function Tooltip({ label, children }: { label: string; children?: ReactNode }) {
  return (
    <span className="ae-tip" tabIndex={0}>
      {children ?? <span className="ae-tip-i">i</span>}
      <span className="ae-tip-bubble" role="tooltip">
        {label}
      </span>
    </span>
  );
}
