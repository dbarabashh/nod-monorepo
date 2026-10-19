import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  Button,
  EmptyState,
  InputGroup,
  List,
} from '../../components/ui/index.ts';
import { useAsync } from '../../lib/use-async.ts';
import { listMeetings, onMeetingsChanged } from './api.ts';
import { MeetingDetail } from './components/meeting-detail.tsx';
import { MeetingRow } from './components/meeting-row.tsx';
import { filterMeetings } from './lib/filter-meetings.ts';
import { groupByDay } from './lib/group-by-day.ts';
import type { Meeting } from './types.ts';
import './meetings.css';

type MeetingsViewProps = {
  recordButton: ReactNode;
  meetingActions: (meeting: Meeting) => ReactNode;
};

export function MeetingsView({
  recordButton,
  meetingActions,
}: MeetingsViewProps) {
  const { state, retry } = useAsync(listMeetings, onMeetingsChanged);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const idPrefix = useId();

  useEffect(() => {
    const timer = setInterval(() => {
      setNow((previous) => {
        const current = new Date();
        return current.toDateString() === previous.toDateString()
          ? previous
          : current;
      });
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  const selected =
    state.status === 'ready'
      ? state.value.find((meeting) => meeting.id === selectedId)
      : undefined;

  const groups = useMemo(() => {
    if (state.status !== 'ready') {
      return [];
    }
    return groupByDay(
      filterMeetings(state.value, query),
      now,
      navigator.language,
    );
  }, [state, query, now]);

  return (
    <section className="meetings" aria-labelledby={`${idPrefix}-title`}>
      <header className="meetings__header">
        <div className="meetings__heading">
          <h1 id={`${idPrefix}-title`} className="meetings__title">
            Meetings
          </h1>
          {state.status === 'ready' && (
            <span className="meetings__count">{state.value.length}</span>
          )}
        </div>
        <div className="meetings__actions">
          <InputGroup
            icon="search"
            type="search"
            placeholder="Search meetings"
            aria-label="Search meetings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="meetings__search"
          />
          {recordButton}
        </div>
      </header>

      <div className="meetings__content">
        <div className="meetings__body" data-scroll>
          {state.status === 'loading' && (
            <p className="meetings__status">Loading meetings…</p>
          )}
          {state.status === 'error' && (
            <EmptyState
              icon="list"
              title="Couldn't load meetings"
              action={<Button onClick={retry}>Try again</Button>}
            />
          )}
          {state.status === 'ready' && state.value.length === 0 && (
            <EmptyState
              icon="mic"
              title="No meetings yet"
              description="Start a recording to capture your first conversation."
            />
          )}
          {state.status === 'ready' &&
            state.value.length > 0 &&
            groups.length === 0 && (
              <EmptyState
                icon="search"
                title="No matches"
                description={`Nothing matches “${query.trim()}”.`}
              />
            )}
          {groups.map((group, index) => (
            <section
              key={group.label}
              className="meetings__group"
              aria-labelledby={`${idPrefix}-${index}`}
            >
              <h2 id={`${idPrefix}-${index}`} className="meetings__group-title">
                {group.label}
              </h2>
              <List>
                {group.meetings.map((meeting) => (
                  <MeetingRow
                    key={meeting.id}
                    meeting={meeting}
                    selected={meeting.id === selectedId}
                    onSelect={setSelectedId}
                  />
                ))}
              </List>
            </section>
          ))}
        </div>
        {selected && (
          <MeetingDetail
            meeting={selected}
            actions={meetingActions(selected)}
          />
        )}
      </div>
    </section>
  );
}
