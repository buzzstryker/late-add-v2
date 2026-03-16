import React from 'react';

interface EmptyStateProps {
  message: string;
  action?: React.ReactNode;
}

export function EmptyState({ message, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p>{message}</p>
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}
