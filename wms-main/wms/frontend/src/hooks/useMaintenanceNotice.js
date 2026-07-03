import { useState, useEffect, useCallback } from 'react';
import { getSettings } from '../services/api';

export function isMaintenanceNoticeEnabled(settings) {
  const v = settings?.maintenance_notice_enabled;
  return v === '1' || v === 'true' || v === true;
}

export function useMaintenanceNotice() {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const { data } = await getSettings();
      setEnabled(isMaintenanceNoticeEnabled(data));
    } catch {
      setEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { enabled, loading, refresh, setEnabled };
}
