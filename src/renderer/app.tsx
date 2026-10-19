import { Nav, NavItem } from './components/ui/index.ts';
import { MeetingsView } from './features/meetings/index.ts';
import './app.css';

export function App() {
  return (
    <div className="app-shell">
      <aside className="app-shell__sidebar">
        <Nav aria-label="Main">
          <NavItem icon="list" current>
            Meetings
          </NavItem>
          <NavItem icon="calendar" disabled>
            Calendar
          </NavItem>
        </Nav>
        <Nav aria-label="App" className="app-shell__sidebar-footer">
          <NavItem icon="settings" disabled>
            Settings
          </NavItem>
        </Nav>
      </aside>
      <main className="app-shell__main">
        <MeetingsView />
      </main>
    </div>
  );
}
