import { useEffect, useRef, useState } from 'react';
import { Nav, NavItem } from './components/ui/index.ts';
import { AudioAccessPanel } from './features/audio-access/index.ts';
import { MeetingsView } from './features/meetings/index.ts';
import { ModelsPanel } from './features/models/index.ts';
import { OnboardingGate } from './features/onboarding/index.ts';
import {
  MeetingRecordingActions,
  RecordButton,
} from './features/recording/index.ts';
import { SettingsView } from './features/settings/index.ts';
import {
  KeySetup,
  RecoveryPanel,
  SyncPanel,
  SyncStep,
} from './features/sync/index.ts';
import './app.css';

type Page = 'meetings' | 'settings';

export function App() {
  return (
    <OnboardingGate
      RecoveryKey={KeySetup}
      SyncPlace={SyncStep}
      audio={<AudioAccessPanel />}
      speechModels={<ModelsPanel kind="speech" />}
      summaryModels={<ModelsPanel kind="summary" />}
    >
      <Shell />
    </OnboardingGate>
  );
}

function Shell() {
  const [page, setPage] = useState<Page>('meetings');
  const main = useRef<HTMLElement>(null);

  useEffect(() => {
    main.current?.focus();
  }, [page]);

  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <Nav aria-label="Main">
          <NavItem
            icon="list"
            current={page === 'meetings'}
            onClick={() => setPage('meetings')}
          >
            Meetings
          </NavItem>
        </Nav>
        <Nav aria-label="App" className="app-shell__sidebar-footer">
          <NavItem
            icon="settings"
            current={page === 'settings'}
            onClick={() => setPage('settings')}
          >
            Settings
          </NavItem>
        </Nav>
      </aside>
      <main ref={main} tabIndex={-1} className="app-shell__main">
        {page === 'meetings' ? (
          <MeetingsView
            recordButton={<RecordButton />}
            meetingActions={(meeting) => (
              <MeetingRecordingActions
                meetingId={meeting.id}
                status={meeting.status}
              />
            )}
          />
        ) : (
          <SettingsView
            audio={<AudioAccessPanel />}
            transcription={<ModelsPanel kind="speech" />}
            summaries={<ModelsPanel kind="summary" />}
            sync={<SyncPanel />}
            recovery={<RecoveryPanel />}
          />
        )}
      </main>
    </div>
  );
}
