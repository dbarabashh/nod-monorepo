import { useEffect, useId, useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  Icon,
  InputGroup,
  List,
} from '../../components/ui/index.ts';
import { useAsync } from '../../lib/use-async.ts';
import { listMeetings } from './api.ts';
import { MeetingRow } from './components/meeting-row.tsx';
import { filterMeetings } from './lib/filter-meetings.ts';
import { groupByDay } from './lib/group-by-day.ts';
import './meetings.css';

export function MeetingsView() {
  const { state, retry } = useAsync(listMeetings);
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
          <Button variant="primary" disabled>
            <Icon name="mic" />
            New recording
          </Button>
        </div>
      </header>

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
            description="Recorded meetings and voice notes will appear here."
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
    </section>
  );
}
