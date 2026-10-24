import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button, Icon, Nav, NavItem } from './components/ui/index.ts';
import { AssistantsPanel } from './features/assistants/index.ts';
import { AudioAccessPanel } from './features/audio-access/index.ts';
import {
  FolderNav,
  MeetingsView,
  useMeetingList,
} from './features/meetings/index.ts';
import { ImportPanel } from './features/meeting-import/index.ts';
import { ModelsPanel } from './features/models/index.ts';
import { OnboardingGate } from './features/onboarding/index.ts';
import {
  MeetingRecordingActions,
  RecordButton,
  SuggestMeetingsSetting,
} from './features/recording/index.ts';
import { SettingsView } from './features/settings/index.ts';
import {
  SharedNotesView,
  PeoplePanel,
  TeamsPanel,
  useShareTargets,
} from './features/sharing/index.ts';
import {
  KeySetup,
  RecoveryPanel,
  SyncPanel,
  SyncStep,
} from './features/sync/index.ts';
import { useDialogOpen } from './lib/use-dialog-open.ts';
import './app.css';

type Page = 'meetings' | 'shared' | 'settings';

export function App() {
  useDialogOpen();
  return (
    <OnboardingGate
      RecoveryKey={KeySetup}
      SyncPlace={SyncStep}
      audio={<AudioAccessPanel />}
      speechModels={<ModelsPanel kind="speech" autoDownload />}
      summaryModels={<ModelsPanel kind="summary" />}
      importMeetings={<ImportPanel />}
    >
      <Shell />
    </OnboardingGate>
  );
}

function Shell() {
  const [page, setPage] = useState<Page>('meetings');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [meetingsHome, setMeetingsHome] = useState(0);
  const [folder, setFolder] = useState<string | null>(null);
  const [openNote, setOpenNote] = useState<{
    target: string;
    id: string;
  } | null>(null);
  const meetings = useMeetingList();
  const shareTargets = useShareTargets();
  const openSharedNote = useCallback((target: string, id: string) => {
    setOpenNote({ target, id });
    setPage('shared');
  }, []);

  const showFolder = useCallback((next: string | null) => {
    setFolder(next);
    if (next !== null) {
      setPage('meetings');
      setMeetingsHome((count) => count + 1);
    }
  }, []);

  const followRename = useCallback((from: string, to: string) => {
    setFolder((shown) => (shown === from ? to : shown));
  }, []);
  const main = useRef<HTMLElement>(null);
  const sidebarId = useId();

  useEffect(() => {
    main.current?.focus();
  }, [page]);

  return (
    <div className="app-shell" data-sidebar={sidebarOpen ? 'open' : 'closed'}>
      <aside className="app-shell__sidebar">
        <Button
          variant="outline"
          size="sm"
          className="app-shell__toggle"
          aria-label="Sidebar"
          title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          aria-expanded={sidebarOpen}
          aria-controls={sidebarId}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          {sidebarOpen && <Icon name="chevron-left" />}
          <Icon name="home" />
          {!sidebarOpen && <Icon name="chevron-right" />}
        </Button>
        <div id={sidebarId} className="app-shell__nav" hidden={!sidebarOpen}>
          <Nav aria-label="Main">
            <NavItem
              icon="list"
              current={page === 'meetings' && folder === null}
              onClick={() => {
                setPage('meetings');
                setFolder(null);
                setMeetingsHome((count) => count + 1);
              }}
            >
              Meetings
            </NavItem>
            <FolderNav
              meetings={meetings}
              current={page === 'meetings' ? folder : null}
              onSelect={showFolder}
              onRenamed={followRename}
            />
          </Nav>
          <Nav aria-label="App">
            <NavItem
              icon="document"
              current={page === 'shared'}
              onClick={() => {
                setOpenNote(null);
                setPage('shared');
              }}
            >
              Shared notes
            </NavItem>
            <NavItem
              icon="settings"
              current={page === 'settings'}
              onClick={() => setPage('settings')}
            >
              Settings
            </NavItem>
          </Nav>
        </div>
      </aside>
      <main ref={main} tabIndex={-1} className="app-shell__main">
        {page === 'meetings' ? (
          <MeetingsView
            meetings={meetings}
            homeSignal={meetingsHome}
            folder={folder}
            recordButton={<RecordButton />}
            meetingActions={(meeting) => (
              <MeetingRecordingActions
                meetingId={meeting.id}
                status={meeting.status}
              />
            )}
            shareTargets={shareTargets}
            onOpenSharedNote={openSharedNote}
          />
        ) : page === 'shared' ? (
          <SharedNotesView
            key={openNote ? `${openNote.target}:${openNote.id}` : ''}
            open={openNote}
          />
        ) : (
          <SettingsView
            audio={
              <>
                <AudioAccessPanel />
                <SuggestMeetingsSetting />
              </>
            }
            transcription={<ModelsPanel kind="speech" />}
            summaries={<ModelsPanel kind="summary" />}
            assistants={<AssistantsPanel />}
            sync={<SyncPanel />}
            people={<PeoplePanel />}
            teams={<TeamsPanel />}
            recovery={<RecoveryPanel />}
            import={<ImportPanel />}
          />
        )}
      </main>
    </div>
  );
}
