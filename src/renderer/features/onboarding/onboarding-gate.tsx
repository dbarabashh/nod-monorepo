import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Button, EmptyState } from '../../components/ui/index.ts';
import { completeOnboarding, getAppState } from './api.ts';
import { OnboardingView } from './onboarding-view.tsx';
import './onboarding.css';

type GateState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'onboarding'; finish: 'idle' | 'saving' | 'failed' }
  | { status: 'done' };

type OnboardingGateProps = {
  RecoveryKey: ComponentType<{ onDone: () => void }>;
  audio: ReactNode;
  speechModels: ReactNode;
  summaryModels: ReactNode;
  children: ReactNode;
};

export function OnboardingGate({
  RecoveryKey,
  audio,
  speechModels,
  summaryModels,
  children,
}: OnboardingGateProps) {
  const [state, setState] = useState<GateState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getAppState().then(
      (appState) =>
        active &&
        setState(
          appState.onboardingCompleted
            ? { status: 'done' }
            : { status: 'onboarding', finish: 'idle' },
        ),
      () => active && setState({ status: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  function finish() {
    setState({ status: 'onboarding', finish: 'saving' });
    completeOnboarding().then(
      () => setState({ status: 'done' }),
      () => setState({ status: 'onboarding', finish: 'failed' }),
    );
  }

  switch (state.status) {
    case 'loading':
      return null;
    case 'error':
      return (
        <main className="onboarding">
          <EmptyState
            icon="settings"
            title="Couldn't load the app state"
            action={
              <Button
                onClick={() => {
                  setState({ status: 'loading' });
                  setAttempt((count) => count + 1);
                }}
              >
                Try again
              </Button>
            }
          />
        </main>
      );
    case 'onboarding':
      return (
        <OnboardingView
          RecoveryKey={RecoveryKey}
          audio={audio}
          speechModels={speechModels}
          summaryModels={summaryModels}
          finish={state.finish}
          onFinish={finish}
        />
      );
    case 'done':
      return children;
  }
}
