import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import type { MeetingDetail } from '../../../../shared/ipc.ts';
import { Button, Icon, InputGroup } from '../../../components/ui/index.ts';
import {
  findInTranscript,
  type TranscriptMatch,
} from '../lib/find-in-transcript.ts';

const matchHighlight = 'transcript-match';
const currentHighlight = 'transcript-match-current';

export function TranscriptSearch({
  lines,
  list,
}: {
  lines: MeetingDetail['transcript'];
  list: RefObject<HTMLOListElement | null>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState(0);
  const matches = useMemo(() => findInTranscript(lines, query), [lines, query]);
  const current = matches.length === 0 ? -1 : position % matches.length;
  const painted = useRef<Painted | null>(null);
  const [repaints, setRepaints] = useState(0);

  useEffect(() => {
    const root = list.current;
    if (!root) {
      return;
    }
    // Reverting an edit replaces a line's text node without changing its
    // text, which leaves the highlight ranges on the detached node.
    const observer = new MutationObserver(() => setRepaints((n) => n + 1));
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [list]);

  useEffect(() => {
    function focusSearch(event: globalThis.KeyboardEvent) {
      const mod =
        document.documentElement.dataset.platform === 'darwin'
          ? event.metaKey
          : event.ctrlKey;
      if (
        mod &&
        !event.altKey &&
        !event.shiftKey &&
        !event.isComposing &&
        !event.defaultPrevented &&
        event.code === 'KeyF'
      ) {
        event.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    }
    document.addEventListener('keydown', focusSearch);
    return () => document.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    const root = list.current;
    if (!root || matches.length === 0) {
      return;
    }
    const texts = lineTexts(root);
    const ranges = matches.map((match) =>
      rangeOf(texts.get(match.lineId), match),
    );
    const others = new Highlight(...ranges.filter((range) => range !== null));
    const active = new Highlight();
    CSS.highlights.set(matchHighlight, others);
    CSS.highlights.set(currentHighlight, active);
    painted.current = { ranges, others, active };
    return () => {
      painted.current = null;
      CSS.highlights.delete(matchHighlight);
      CSS.highlights.delete(currentHighlight);
    };
  }, [list, matches, repaints]);

  useEffect(() => {
    const range = painted.current?.ranges[current];
    const { others, active } = painted.current ?? {};
    if (!range || !others || !active) {
      return;
    }
    others.delete(range);
    active.add(range);
    return () => {
      active.delete(range);
      others.add(range);
    };
  }, [matches, current, repaints]);

  const reveal = useEffectEvent((index: number) => {
    const lineId = matches[index]?.lineId;
    const root = list.current;
    if (lineId === undefined || !root) {
      return;
    }
    root
      .querySelector(`[data-line-id="${CSS.escape(lineId)}"]`)
      ?.closest('li')
      ?.scrollIntoView({ block: 'nearest' });
  });

  useEffect(() => reveal(current), [query, current]);

  function step(by: number) {
    if (matches.length > 0) {
      setPosition((current + by + matches.length) % matches.length);
    }
  }

  function keys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  }

  const searching = query.trim() !== '';

  return (
    <search className="transcript-search">
      <InputGroup
        ref={input}
        icon="search"
        type="search"
        placeholder="Find in transcript"
        aria-label="Find in transcript"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setPosition(0);
        }}
        onKeyDown={keys}
        className="transcript-search__input"
      />
      <span className="transcript-search__count" aria-live="polite">
        {!searching
          ? ''
          : matches.length === 0
            ? 'No matches'
            : `${current + 1} of ${matches.length}`}
      </span>
      {searching && (
        <>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Previous match"
            title="Previous match"
            disabled={matches.length === 0}
            onClick={() => step(-1)}
          >
            <Icon name="chevron-up" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Next match"
            title="Next match"
            disabled={matches.length === 0}
            onClick={() => step(1)}
          >
            <Icon name="chevron-down" />
          </Button>
        </>
      )}
    </search>
  );
}

type Painted = {
  ranges: (Range | null)[];
  others: Highlight;
  active: Highlight;
};

function lineTexts(root: HTMLElement): Map<string, Node | null> {
  const texts = new Map<string, Node | null>();
  for (const element of root.querySelectorAll<HTMLElement>('[data-line-id]')) {
    if (element.dataset.lineId !== undefined) {
      texts.set(element.dataset.lineId, element.firstChild);
    }
  }
  return texts;
}

function rangeOf(
  text: Node | null | undefined,
  match: TranscriptMatch,
): Range | null {
  if (!(text instanceof Text) || text.length < match.end) {
    return null;
  }
  const range = new Range();
  range.setStart(text, match.start);
  range.setEnd(text, match.end);
  return range;
}
