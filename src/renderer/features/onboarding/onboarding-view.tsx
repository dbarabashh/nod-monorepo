import { useId, useRef, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Button } from '../../components/ui/index.ts';

type Step = {
  title: string;
  description: string;
};

const steps: Step[] = [
  {
    title: 'Allow audio access',
    description:
      'Conversations are captured on this computer, without a bot joining the call. Allow the microphone for your side and system audio for everyone else.',
  },
  {
    title: 'Download speech models',
    description:
      'Transcription runs on this device, so it needs a speech model stored locally. Nothing you say is sent anywhere to be transcribed. Downloads continue in the background.',
  },
];

type OnboardingViewProps = {
  audio: ReactNode;
  models: ReactNode;
  finish: 'idle' | 'saving' | 'failed';
  onFinish: () => void;
};

export function OnboardingView({
  audio,
  models,
  finish,
  onFinish,
}: OnboardingViewProps) {
  const [index, setIndex] = useState(0);
  const titleId = useId();
  const heading = useRef<HTMLHeadingElement>(null);

  function go(next: number) {
    flushSync(() => setIndex(next));
    heading.current?.focus();
  }

  const step = steps[index];
  const last = index === steps.length - 1;
  if (!step) {
    return null;
  }

  return (
    <main className="onboarding" aria-labelledby={titleId}>
      <div className="onboarding__content">
        <ol className="onboarding__steps" aria-label="Setup steps">
          {steps.map((item, position) => (
            <li
              key={item.title}
              className="onboarding__step"
              aria-current={position === index ? 'step' : undefined}
              data-done={position < index || undefined}
            >
              {item.title}
            </li>
          ))}
        </ol>

        <header className="onboarding__header">
          <h1
            id={titleId}
            ref={heading}
            tabIndex={-1}
            className="onboarding__title"
          >
            {step.title}
          </h1>
          <p className="onboarding__description">{step.description}</p>
        </header>

        <div className="onboarding__body">{index === 0 ? audio : models}</div>

        {finish === 'failed' && (
          <p className="onboarding__error" role="alert">
            Couldn't save your setup. Try again.
          </p>
        )}

        <footer className="onboarding__footer">
          {index > 0 ? (
            <Button variant="ghost" onClick={() => go(index - 1)}>
              Back
            </Button>
          ) : (
            <span className="onboarding__hint">
              You can change this later in Settings.
            </span>
          )}
          {last ? (
            <Button
              key="finish"
              variant="primary"
              disabled={finish === 'saving'}
              onClick={(event) => {
                // The second click of a double-click on Continue lands on this
                // button, which renders in the same spot.
                if (event.detail < 2) {
                  onFinish();
                }
              }}
            >
              Finish setup
            </Button>
          ) : (
            <Button
              key="continue"
              variant="primary"
              onClick={() => go(index + 1)}
            >
              Continue
            </Button>
          )}
        </footer>
      </div>
    </main>
  );
}
