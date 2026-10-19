import { useEffect, useRef, useState } from 'react';
import { Nav, NavItem } from './components/ui/index.ts';
import { AudioAccessPanel } from './features/audio-access/index.ts';
import { MeetingsView } from './features/meetings/index.ts';
import { ModelsPanel } from './features/models/index.ts';
import { OnboardingGate } from './features/onboarding/index.ts';
import { SettingsView } from './features/settings/index.ts';
import './app.css';

type Page = 'meetings' | 'settings';

export function App() {
  return (
    <OnboardingGate audio={<AudioAccessPanel />} models={<ModelsPanel />}>
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
          <NavItem icon="calendar" disabled>
            Calendar
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
          <MeetingsView />
        ) : (
          <SettingsView audio={<AudioAccessPanel />} models={<ModelsPanel />} />
        )}
      </main>
    </div>
  );
}
