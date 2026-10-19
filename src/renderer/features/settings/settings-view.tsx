import { useId, type ReactNode } from 'react';
import './settings.css';

type SettingsViewProps = {
  audio: ReactNode;
  speechModels: ReactNode;
  summaryModels: ReactNode;
};

export function SettingsView({
  audio,
  speechModels,
  summaryModels,
}: SettingsViewProps) {
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
        <section
          className="settings__section"
          aria-labelledby={`${idPrefix}-models`}
        >
          <h2 id={`${idPrefix}-models`} className="settings__section-title">
            Speech models
          </h2>
          <p className="settings__section-hint">
            Models are stored on this device and transcribe without a network
            connection.
          </p>
          {speechModels}
        </section>
        <section
          className="settings__section"
          aria-labelledby={`${idPrefix}-summary`}
        >
          <h2 id={`${idPrefix}-summary`} className="settings__section-title">
            Summary model
          </h2>
          <p className="settings__section-hint">
            Writes a summary when a meeting is finished, without sending the
            transcript anywhere.
          </p>
          {summaryModels}
        </section>
      </div>
    </section>
  );
}
