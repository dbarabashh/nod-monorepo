import { Badge, type BadgeVariant } from '../../../components/ui/index.ts';
import type { MeetingStatus } from '../types.ts';

const statusView: Record<
  MeetingStatus,
  { label: string; variant: BadgeVariant; dot: boolean } | null
> = {
  recording: { label: 'Recording', variant: 'danger', dot: true },
  processing: { label: 'Processing', variant: 'neutral', dot: false },
  ready: null,
};

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  const view = statusView[status];
  if (!view) {
    return null;
  }
  return (
    <Badge variant={view.variant} dot={view.dot}>
      {view.label}
    </Badge>
  );
}
