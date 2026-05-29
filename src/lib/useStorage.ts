// src/lib/useStorage.ts
// React hook: storage'ı okur, değişimlere abone olur, kısmi güncelleme yazar.

import { useCallback, useEffect, useState } from 'react';
import { StorageManager } from '../core/storage/StorageManager';
import type { StorageSchema } from '../types/index';

export function useStorage(): {
  data: StorageSchema | null;
  update: (patch: Partial<StorageSchema>) => Promise<void>;
} {
  const [data, setData] = useState<StorageSchema | null>(null);

  useEffect(() => {
    let alive = true;
    void StorageManager.getAll().then((d) => {
      if (alive) setData(d);
    });
    const off = StorageManager.onChange(() => {
      void StorageManager.getAll().then((d) => {
        if (alive) setData(d);
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, []);

  const update = useCallback(async (patch: Partial<StorageSchema>) => {
    await StorageManager.set(patch);
    // storage.onChange yerel state'i tazeler.
  }, []);

  return { data, update };
}
