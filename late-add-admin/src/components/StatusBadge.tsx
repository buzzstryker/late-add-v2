import React from 'react';
import type { EventStatus } from '../types';

const LABELS: Record<string, string> = {
  processed: 'Processed',
  pending_attribution: 'Pending attribution',
  pending_player_mapping: 'Pending player mapping',
  validation_error: 'Validation error',
  duplicate_ignored: 'Duplicate / ignored',
};

const statusToClass = (s: string): string => {
  const key = s.replace(/\s+/g, '_').toLowerCase();
  if (key in LABELS || ['processed', 'pending_attribution', 'pending_player_mapping', 'validation_error', 'duplicate_ignored'].includes(key))
    return key;
  return 'processed';
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const cls = statusToClass(status);
  const label = LABELS[cls] ?? status;
  return <span className={`badge ${cls}`}>{label}</span>;
}
