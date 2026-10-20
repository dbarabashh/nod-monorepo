import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Button,
  EmptyState,
  Icon,
  InputGroup,
  List,
} from '../../components/ui/index.ts';
import { MeetingDetail } from './components/meeting-detail.tsx';
import { MeetingRow } from './components/meeting-row.tsx';
import { filterMeetings } from './lib/filter-meetings.ts';
import { groupByDay } from './lib/group-by-day.ts';
import type { Meeting } from './types.ts';
import type { MeetingList } from './use-meeting-list.ts';
import './meetings.css';

type MeetingsViewProps = {
  meetings: MeetingList;
  homeSignal: number;
  folder: string | null;
  recordButton: ReactNode;
  meetingActions: (meeting: Meeting) => ReactNode;
};

export function MeetingsView({
  meetings,
  homeSignal,
  folder,
  recordButton,
  meetingActions,
}: MeetingsViewProps) {
  const { state, retry } = meetings;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const list = useRef<HTMLElement>(null);
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

  useEffect(() => {
    setSelectedId(null);
  }, [homeSignal]);

  useEffect(() => {
    if (
      selectedId !== null &&
      state.status === 'ready' &&
      !state.value.some((meeting) => meeting.id === selectedId)
    ) {
      setReturnTo(selectedId);
      setSelectedId(null);
    }
  }, [selectedId, state]);

  useEffect(() => {
    if (selectedId === null && document.activeElement === document.body) {
      list.current?.focus();
    }
  }, [state, selectedId]);

  useEffect(() => {
    if (selectedId === null && returnTo !== null) {
      const row = list.current?.querySelector<HTMLElement>(
        `[data-meeting-id="${CSS.escape(returnTo)}"]`,
      );
      (row ?? list.current)?.focus();
      setReturnTo(null);
    }
  }, [selectedId, returnTo]);

  const selected =
    state.status === 'ready'
      ? state.value.find((meeting) => meeting.id === selectedId)
      : undefined;

  const folders = useMemo(
    () => meetings.folders.map((folder) => folder.name),
    [meetings.folders],
  );

  const groups = useMemo(() => {
    if (state.status !== 'ready') {
      return [];
    }
    const shown =
      folder === null
        ? state.value
        : state.value.filter((meeting) => meeting.folder === folder);
    return groupByDay(filterMeetings(shown, query), now, navigator.language);
  }, [state, query, now, folder]);

  if (selected) {
    return (
      <MeetingDetail
        key={selected.id}
        meeting={selected}
        folders={folders}
        now={now}
        actions={meetingActions(selected)}
        onBack={() => {
          setReturnTo(selected.id);
          setSelectedId(null);
        }}
      />
    );
  }

  return (
    <section
      ref={list}
      tabIndex={-1}
      className="meetings"
      aria-labelledby={`${idPrefix}-title`}
    >
      <header className="meetings__header">
        {folder === null ? (
          <h1 id={`${idPrefix}-title`} className="visually-hidden">
            Meetings
          </h1>
        ) : (
          <h1 id={`${idPrefix}-title`} className="meetings__title">
            <Icon name="folder" />
            <span className="meetings__title-name">{folder}</span>
          </h1>
        )}
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

      <div className="meetings__body" data-scroll>
        <div className="meetings__column">
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
                    folders={folders}
                    onSelect={setSelectedId}
                  />
                ))}
              </List>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}
