import {
  useId,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
import { Button } from '../../components/ui/index.ts';

type Step = {
  title: string;
  description: string;
};

const steps: Step[] = [
  {
    title: 'Your recovery phrase',
    description:
      'Your meetings stay on your devices, encrypted. Twenty-four words are the key to them: enter the same words on each of your devices to sync them, or on a new one if you lose this one.',
  },
  {
    title: 'Allow audio access',
    description:
      'Conversations are captured on this computer, without a bot joining the call. Allow the microphone for your side and system audio for everyone else.',
  },
  {
    title: 'Download models',
    description:
      'Transcripts and summaries are made on this device, so they need models stored locally. Nothing you say is sent anywhere. Downloads continue in the background.',
  },
];

type OnboardingViewProps = {
  RecoveryKey: ComponentType<{ onDone: () => void }>;
  audio: ReactNode;
  speechModels: ReactNode;
  summaryModels: ReactNode;
  finish: 'idle' | 'saving' | 'failed';
  onFinish: () => void;
};

export function OnboardingView({
  RecoveryKey,
  audio,
  speechModels,
  summaryModels,
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

        <div className="onboarding__body">
          {index === 0 ? (
            <RecoveryKey onDone={() => go(1)} />
          ) : index === 1 ? (
            audio
          ) : (
            <>
              <h2 className="onboarding__subtitle">Speech</h2>
              {speechModels}
              <h2 className="onboarding__subtitle">Summary</h2>
              {summaryModels}
            </>
          )}
        </div>

        {finish === 'failed' && (
          <p className="onboarding__error" role="alert">
            Couldn't save your setup. Try again.
          </p>
        )}

        <footer className="onboarding__footer">
          {index > 1 ? (
            <Button variant="ghost" onClick={() => go(index - 1)}>
              Back
            </Button>
          ) : (
            <span className="onboarding__hint">
              You can change this later in Settings.
            </span>
          )}
          {index === 0 ? null : last ? (
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
