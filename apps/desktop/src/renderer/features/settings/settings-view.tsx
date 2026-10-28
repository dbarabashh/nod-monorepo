import { useId, useState, type ReactNode } from 'react';
import { Nav, NavItem, type IconName } from '../../components/ui/index.ts';
import './settings.css';

type PageId =
  | 'audio'
  | 'transcription'
  | 'summaries'
  | 'assistants'
  | 'sync'
  | 'people'
  | 'teams'
  | 'recovery'
  | 'import'
  | 'updates';

type Page = {
  id: PageId;
  label: string;
  icon: IconName;
  description: string;
};

const groups: Array<{ label: string; pages: Page[] }> = [
  {
    label: 'Recording',
    pages: [
      {
        id: 'audio',
        label: 'Audio',
        icon: 'mic',
        description:
          'Audio is processed on this device as it plays and is never saved.',
      },
      {
        id: 'transcription',
        label: 'Transcription',
        icon: 'transcript',
        description:
          'Speech models are stored on this device and transcribe without a network connection.',
      },
    ],
  },
  {
    label: 'Notes',
    pages: [
      {
        id: 'summaries',
        label: 'Summaries',
        icon: 'summary',
        description:
          'A summary is written when a meeting is finished, without sending the transcript anywhere.',
      },
    ],
  },
  {
    label: 'Connections',
    pages: [
      {
        id: 'assistants',
        label: 'AI assistants',
        icon: 'summary',
        description:
          'Let assistants on this computer search and read your meetings, with the parts you allow.',
      },
    ],
  },
  {
    label: 'Sharing',
    pages: [
      {
        id: 'people',
        label: 'People',
        icon: 'person',
        description:
          'Share a meeting’s title and summary with one person. You add each other’s identity card, and only the two of you can read what you share.',
      },
      {
        id: 'teams',
        label: 'Teams',
        icon: 'people',
        description:
          'A shared notebook for a group on a relay. Each member has a role, owners and admins decide who is in, and only members can read its notes.',
      },
    ],
  },
  {
    label: 'Data',
    pages: [
      {
        id: 'sync',
        label: 'Sync',
        icon: 'sync',
        description:
          'Keep meetings the same on all your devices. They travel encrypted, and the folder or relay they pass through can’t read them.',
      },
      {
        id: 'recovery',
        label: 'Recovery phrase',
        icon: 'key',
        description:
          'Twenty-four words that bring your synced meetings back on a new device if you lose all the others.',
      },
      {
        id: 'import',
        label: 'Import from Nod',
        icon: 'download',
        description:
          'Move your meetings from the previous Nod app to this one: titles, summaries and transcripts.',
      },
    ],
  },
  {
    label: 'App',
    pages: [
      {
        id: 'updates',
        label: 'Updates',
        icon: 'download',
        description:
          'New versions of Nod, and whether it looks for them on its own.',
      },
    ],
  },
];

type SettingsViewProps = Record<PageId, ReactNode>;

export function SettingsView(content: SettingsViewProps) {
  const idPrefix = useId();
  const [selected, setSelected] = useState<PageId>('audio');
  const page =
    groups
      .flatMap((group) => group.pages)
      .find((item) => item.id === selected) ?? groups[0]?.pages[0];

  return (
    <div className="settings">
      <aside className="settings__menu" aria-label="Settings">
        <h1 className="settings__menu-title">Settings</h1>
        {groups.map((group) => (
          <section
            key={group.label}
            className="settings__group"
            aria-labelledby={`${idPrefix}-${group.label}`}
          >
            <h2
              id={`${idPrefix}-${group.label}`}
              className="settings__group-label"
            >
              {group.label}
            </h2>
            <Nav aria-labelledby={`${idPrefix}-${group.label}`}>
              {group.pages.map((item) => (
                <NavItem
                  key={item.id}
                  icon={item.icon}
                  current={item.id === selected}
                  onClick={() => setSelected(item.id)}
                >
                  {item.label}
                </NavItem>
              ))}
            </Nav>
          </section>
        ))}
      </aside>
      {page && (
        <section
          className="settings__page"
          aria-labelledby={`${idPrefix}-page`}
          data-scroll
        >
          <div className="settings__page-body">
            <header className="settings__page-header">
              <h2 id={`${idPrefix}-page`} className="settings__page-title">
                {page.label}
              </h2>
              <p className="settings__page-description">{page.description}</p>
            </header>
            {content[page.id]}
          </div>
        </section>
      )}
    </div>
  );
}
