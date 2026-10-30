import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { parseMarkdown, toMarkdown } from '../../../lib/markdown.ts';
import {
  blocksFromDom,
  blocksToDom,
  type NodeFactory,
} from '../../../lib/markdown-dom.ts';

const saveDelayMs = 2_000;

const shortcuts: Array<{ pattern: RegExp; apply: () => void }> = [
  {
    pattern: /^[-*][ \u00a0]/,
    apply: () => document.execCommand('insertUnorderedList'),
  },
  {
    pattern: /^1\.[ \u00a0]/,
    apply: () => document.execCommand('insertOrderedList'),
  },
  {
    pattern: /^#{1,3}[ \u00a0]/,
    apply: () => document.execCommand('formatBlock', false, 'h4'),
  },
];

const domNodes: NodeFactory<Node> = {
  element: (tag, children) => {
    const element = document.createElement(tag);
    element.append(...children);
    return element;
  },
  text: (value) => document.createTextNode(value),
};

function topBlock(root: HTMLElement, node: Node | null): Node | null {
  let current = node;
  while (current && current.parentNode !== root) {
    current = current.parentNode;
  }
  return current;
}

function applyShortcut(root: HTMLElement) {
  const selection = document.getSelection();
  const anchor = selection?.anchorNode;
  const block = topBlock(root, anchor ?? null);
  if (
    !selection ||
    !(anchor instanceof Text) ||
    block?.nodeName !== 'P' ||
    block.firstChild !== anchor
  ) {
    return;
  }
  const typed = anchor.data.slice(0, selection.anchorOffset);
  const shortcut = shortcuts.find(({ pattern }) => {
    const match = pattern.exec(typed);
    return match?.[0].length === typed.length;
  });
  if (!shortcut) {
    return;
  }
  anchor.data = anchor.data.slice(typed.length);
  selection.collapse(anchor, 0);
  shortcut.apply();
}

// Markdown shown as rich text and edited in place, saved a moment after
// typing stops and when focus leaves. Read-only shows the same text, for
// someone who may read but not change it. Saves run one at a time, each from
// the version the one before returned, and text from elsewhere waits until
// none is pending, so a save's version always matches the text it sends.
export function MarkdownEditor({
  markdown,
  version,
  label,
  readOnly = false,
  onSave,
}: {
  markdown: string;
  version: string;
  label: string;
  readOnly?: boolean;
  onSave: (markdown: string, version: string) => Promise<string>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const saved = useRef(markdown);
  const savedVersion = useRef(version);
  const saving = useRef<Promise<void>>(Promise.resolve());
  const waiting = useRef(0);
  const latest = useRef({ markdown, version });
  const arrivedWhileWaiting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dirty = useRef(false);
  const [failed, setFailed] = useState(false);

  function save(element: HTMLElement, allowEmpty: boolean) {
    clearTimeout(timer.current);
    timer.current = undefined;
    if (!dirty.current) {
      return;
    }
    const next = toMarkdown(blocksFromDom(element));
    if (next === '' && !allowEmpty) {
      return;
    }
    dirty.current = false;
    if (next === saved.current) {
      return;
    }
    saved.current = next;
    waiting.current += 1;
    let stored = false;
    saving.current = saving.current
      .then(() => onSave(next, savedVersion.current))
      .then(
        (made) => {
          savedVersion.current = made;
          stored = true;
          setFailed(false);
        },
        () => setFailed(true),
      )
      .finally(() => {
        waiting.current -= 1;
        // A failed save leaves its text on screen to be tried again.
        if (waiting.current === 0 && arrivedWhileWaiting.current && stored) {
          arrivedWhileWaiting.current = false;
          showLatest();
        }
      });
  }

  function showLatest() {
    const element = root.current;
    if (
      !element ||
      (element.hasChildNodes() &&
        (latest.current.markdown === saved.current ||
          element.contains(document.activeElement)))
    ) {
      return;
    }
    saved.current = latest.current.markdown;
    savedVersion.current = latest.current.version;
    element.replaceChildren(
      ...blocksToDom(parseMarkdown(latest.current.markdown), domNodes),
    );
  }

  useEffect(() => {
    latest.current = { markdown, version };
    if (waiting.current > 0) {
      arrivedWhileWaiting.current = true;
      return;
    }
    showLatest();
  }, [markdown, version]);

  useEffect(() => {
    const element = root.current;
    return () => {
      if (element) {
        save(element, false);
      }
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function paste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    document.execCommand(
      'insertText',
      false,
      event.clipboardData.getData('text/plain'),
    );
  }

  if (readOnly) {
    return (
      <div ref={root} className="ui-prose" aria-label={label} data-selectable />
    );
  }

  return (
    <>
      <div
        ref={root}
        className="ui-prose ui-editable"
        // Rich text needs an editable element; a textarea holds plain text only.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="textbox"
        tabIndex={0}
        aria-multiline="true"
        aria-label={label}
        contentEditable
        suppressContentEditableWarning
        data-selectable
        onFocus={() =>
          document.execCommand('defaultParagraphSeparator', false, 'p')
        }
        onInput={(event) => {
          const element = event.currentTarget;
          applyShortcut(element);
          dirty.current = true;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => save(element, false), saveDelayMs);
        }}
        onBlur={(event) => save(event.currentTarget, true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.currentTarget.blur();
          }
        }}
        onPaste={paste}
      />
      {failed && (
        <p className="ui-editable__error" role="alert">
          Your changes couldn’t be saved. Keep editing to try again.
        </p>
      )}
    </>
  );
}
