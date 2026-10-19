import { useMemo, type ComponentProps } from 'react';
import { parseMarkdown, type Inline } from '../../../lib/markdown.ts';
import { cx } from '../cx.ts';

function Inlines({ inlines }: { inlines: Inline[] }) {
  return inlines.map((inline, index) => {
    if (inline.bold) {
      return <strong key={index}>{inline.text}</strong>;
    }
    if (inline.italic) {
      return <em key={index}>{inline.text}</em>;
    }
    return <span key={index}>{inline.text}</span>;
  });
}

type ProseProps = Omit<ComponentProps<'div'>, 'children'> & {
  markdown: string;
};

export function Prose({ markdown, className, ...props }: ProseProps) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);

  return (
    <div className={cx('ui-prose', className)} {...props}>
      {blocks.map((block, index) => {
        switch (block.type) {
          case 'heading':
            return <h4 key={index}>{block.text}</h4>;
          case 'paragraph':
            return (
              <p key={index}>
                <Inlines inlines={block.inlines} />
              </p>
            );
          case 'list': {
            const items = block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Inlines inlines={item} />
              </li>
            ));
            return block.ordered ? (
              <ol key={index}>{items}</ol>
            ) : (
              <ul key={index}>{items}</ul>
            );
          }
        }
      })}
    </div>
  );
}
