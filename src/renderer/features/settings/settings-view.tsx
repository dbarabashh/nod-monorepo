import { useId, type ReactNode } from 'react';
import './settings.css';

type SettingsViewProps = {
  audio: ReactNode;
};

export function SettingsView({ audio }: SettingsViewProps) {
  const idPrefix = useId();

  return (
    <section className="settings" aria-labelledby={`${idPrefix}-title`}>
      <header className="settings__header">
        <h1 id={`${idPrefix}-title`} className="settings__title">
          Settings
        </h1>
      </header>
      <div className="settings__body" data-scroll>
        <section
          className="settings__section"
          aria-labelledby={`${idPrefix}-audio`}
        >
          <h2 id={`${idPrefix}-audio`} className="settings__section-title">
            Audio
          </h2>
          <p className="settings__section-hint">
            Audio is processed on this device as it plays and is never saved.
          </p>
          {audio}
        </section>
      </div>
    </section>
  );
}
