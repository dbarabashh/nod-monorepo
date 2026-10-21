export function StartNotice({ notice }: { notice: string | null }) {
  return notice ? <output className="start-notice">{notice}</output> : null;
}
