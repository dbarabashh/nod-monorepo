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

export function SummaryEditor({
  markdown,
  onSave,
}: {
  markdown: string;
  onSave: (markdown: string) => Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null);
  const saved = useRef(markdown);
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
    onSave(next).then(
      () => setFailed(false),
      () => setFailed(true),
    );
  }

  useEffect(() => {
    const element = root.current;
    if (!element) {
      return;
    }
    const userIsEditing = element.contains(document.activeElement);
    if (
      element.hasChildNodes() &&
      (markdown === saved.current || userIsEditing)
    ) {
      return;
    }
    saved.current = markdown;
    element.replaceChildren(...blocksToDom(parseMarkdown(markdown), domNodes));
  }, [markdown]);

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
        aria-label="Summary"
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
        <p className="meeting-detail__note" role="alert">
          Your changes couldn’t be saved. Keep editing to try again.
        </p>
      )}
    </>
  );
}
