import { PhraseForm } from './phrase-form.tsx';

type UnavailableProps = {
  error: string;
  onDone?: () => void;
};

export function Unavailable({ error, onDone }: UnavailableProps) {
  return (
    <div className="sync">
      <p className="sync__note" role="alert">
        Nod couldn’t read the recovery key saved on this device ({error}), so
        sync is paused. If your system keyring is locked, unlock it and restart
        Nod. Otherwise, enter your recovery phrase to replace the key.
      </p>
      <PhraseForm submitLabel="Replace with this phrase" onDone={onDone} />
    </div>
  );
}
