'use client';

import { useCallback, useState } from 'react';
import type { HealthState } from '@/components/status-pill';

/** Shared system-health state for the header pill. */
export function useHealth() {
  const [health, setHealth] = useState<HealthState>({
    status: 'checking',
    detail: 'Checking system status',
  });

  const loadHealth = useCallback(async () => {
    setHealth({ status: 'checking', detail: 'Checking system status' });
    try {
      const res = await fetch('/api/health');
      setHealth(await res.json());
    } catch {
      setHealth({ status: 'error', detail: 'Could not reach the app server' });
    }
  }, []);

  return { health, loadHealth };
}
