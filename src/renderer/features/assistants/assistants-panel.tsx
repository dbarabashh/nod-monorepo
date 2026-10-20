import { useEffect, useId, useRef, useState } from 'react';
import {
  mcpActivityLimit,
  mcpNameMaxLength,
  type McpActivity,
  type McpConnection,
  type McpScope,
  type McpState,
} from '../../../shared/ipc.ts';
import {
  Button,
  Field,
  Icon,
  Input,
  List,
  ListRow,
} from '../../components/ui/index.ts';
import { useAction } from '../../lib/use-action.ts';
import { useAsync } from '../../lib/use-async.ts';
import { useCopyStatus, type CopyStatus } from '../../lib/use-copy-status.ts';
import {
  addMcpClient,
  copyMcpSetup,
  getMcpState,
  onMcpChanged,
  revokeMcpClient,
  setMcpEnabled,
} from './api.ts';
import { setupText } from './lib/setup.ts';
import './assistants.css';

const scopeLabels: Record<McpScope, string> = {
  summaries: 'Summaries',
  transcripts: 'Transcripts',
};

const copyText: Record<CopyStatus, string> = {
  idle: '',
  copied: 'Copied',
  failed: 'Couldn’t copy',
};

const statusText: Record<McpState['status'], (url: string) => string> = {
  running: (url) => `On, at ${url}`,
  failed: () => 'On, but not running',
  off: () => 'Off',
};

const toolLabels: Record<string, string> = {
  list_meetings: 'Listed meetings',
  list_folders: 'Listed folders',
  search_meetings: 'Searched meetings',
  get_meeting: 'Opened a meeting',
};

const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function AssistantsPanel() {
  const { state, retry } = useAsync(getMcpState, onMcpChanged);
  const { busy, error, run } = useAction();
  const [connection, setConnection] = useState<McpConnection | null>(null);
  const [showingLog, setShowingLog] = useState(false);
  const logRow = useRef<HTMLButtonElement>(null);
  const returning = useRef(false);
  const idPrefix = useId();

  useEffect(() => {
    if (!showingLog && returning.current) {
      returning.current = false;
      logRow.current?.focus();
    }
  }, [showingLog]);

  if (state.status === 'error') {
    return (
      <div className="assistants__section">
        <p className="assistants__error" role="alert">
          The settings for AI assistants couldn’t be loaded.
        </p>
        <div>
          <Button onClick={retry}>Try again</Button>
        </div>
      </div>
    );
  }
  if (state.status !== 'ready') {
    return null;
  }
  const mcp = state.value;

  if (showingLog) {
    return (
      <ActivityLog
        activity={mcp.activity}
        onBack={() => {
          returning.current = true;
          setShowingLog(false);
        }}
      />
    );
  }

  return (
    <div className="assistants">
      <section className="assistants__section" aria-label="Connection">
        <p className="assistants__note">
          Assistants that speak MCP (Claude Desktop, Qwen Chat, Kimi Code, LM
          Studio and others) can search and read your meetings through Nod while
          it is open. They connect only from this computer, each with its own
          key, and can only read. A cloud assistant sends what it reads to its
          company; one that runs on this computer keeps it here.
        </p>
        <div className="assistants__status">
          <span role="status">{statusText[mcp.status](mcp.url)}</span>
          <div className="assistants__actions">
            {mcp.status === 'failed' && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => run(() => setMcpEnabled(true))}
              >
                Try again
              </Button>
            )}
            <Button
              variant={mcp.enabled ? 'outline' : 'primary'}
              size="sm"
              disabled={busy}
              onClick={() => run(() => setMcpEnabled(!mcp.enabled))}
            >
              {mcp.enabled ? 'Turn off' : 'Turn on'}
            </Button>
          </div>
        </div>
        {mcp.problem && (
          <p className="assistants__error" role="status">
            {mcp.problem}
          </p>
        )}
        {error && (
          <p className="assistants__error" role="alert">
            {error}
          </p>
        )}
      </section>

      {connection ? (
        <Setup
          mcp={mcp}
          connection={connection}
          onDone={() => setConnection(null)}
        />
      ) : (
        <ConnectForm onConnected={setConnection} />
      )}

      {mcp.clients.length > 0 && (
        <section
          className="assistants__section"
          aria-labelledby={`${idPrefix}-connected`}
        >
          <h3 id={`${idPrefix}-connected`} className="assistants__title">
            Connected assistants
          </h3>
          <ul className="assistants__list">
            {mcp.clients.map((client) => (
              <li key={client.id} className="assistants__client">
                <div className="assistants__client-info">
                  <span className="assistants__client-name">{client.name}</span>
                  <span className="assistants__meta">
                    Names and dates
                    {client.scopes.map(
                      (scope) => `, ${scopeLabels[scope].toLowerCase()}`,
                    )}
                    {' · '}
                    {client.revoking
                      ? 'Disconnected, but that couldn’t be saved yet'
                      : client.lastUsedAt === null
                        ? 'Not used yet'
                        : `Last read ${timeFormat.format(client.lastUsedAt)}`}
                  </span>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => run(() => revokeMcpClient(client.id))}
                >
                  {client.revoking ? 'Try again' : 'Disconnect'}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section
        className="assistants__section"
        aria-labelledby={`${idPrefix}-log`}
      >
        <h3 id={`${idPrefix}-log`} className="assistants__title">
          What assistants read
        </h3>
        <List>
          <ListRow
            ref={logRow}
            className="assistants__log-row"
            trailing={<Icon name="chevron-right" />}
            onClick={() => setShowingLog(true)}
          >
            <span className="assistants__client-info assistants__grow">
              <span className="assistants__client-name">Activity log</span>
              <span className="assistants__meta">
                {logSummary(mcp.activity.length)}
              </span>
            </span>
          </ListRow>
        </List>
      </section>

      <p className="assistants__note">
        ChatGPT connects only to addresses on the internet, which Nod doesn’t
        offer: your meetings never pass through a server that can read them.
      </p>
    </div>
  );
}

function logSummary(count: number): string {
  if (count === 0) {
    return 'Nothing read since Nod opened';
  }
  return count === 1
    ? '1 read since Nod opened'
    : `${count} reads since Nod opened`;
}

function ActivityLog({
  activity,
  onBack,
}: {
  activity: McpActivity[];
  onBack: () => void;
}) {
  const page = useRef<HTMLElement>(null);
  const titleId = useId();

  useEffect(() => {
    page.current?.focus();
  }, []);

  return (
    <section
      ref={page}
      tabIndex={-1}
      className="assistants__section assistants__log"
      aria-labelledby={titleId}
    >
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <Icon name="chevron-left" />
          AI assistants
        </Button>
      </div>
      <h3 id={titleId} className="assistants__title">
        Activity log
      </h3>
      <p className="assistants__note">
        What connected assistants asked Nod for, newest first. Only the last{' '}
        {mcpActivityLimit} reads are kept, and only until Nod closes.
      </p>
      {activity.length === 0 ? (
        <p className="assistants__meta">Nothing read since Nod opened.</p>
      ) : (
        <ul className="assistants__list">
          {activity.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className="assistants__entry">
              <span className="assistants__entry-head">
                <span className="assistants__client-name">{entry.client}</span>
                <span className="assistants__meta">
                  {timeFormat.format(entry.at)}
                </span>
              </span>
              <span className="assistants__meta">
                {toolLabels[entry.tool] ?? entry.tool}
                {entry.meetings.length > 0 && `: ${entry.meetings.join(', ')}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ConnectForm({
  onConnected,
}: {
  onConnected: (connection: McpConnection) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<McpScope[]>(['summaries']);
  const { busy, error, run } = useAction();

  return (
    <form
      className="assistants__section"
      aria-label="Connect an assistant"
      onSubmit={(event) => {
        event.preventDefault();
        run(async () => {
          const connection = await addMcpClient(name, scopes);
          setName('');
          onConnected(connection);
        });
      }}
    >
      <h3 className="assistants__title">Connect an assistant</h3>
      <Field label="Name" error={error ?? undefined}>
        {(control) => (
          <Input
            {...control}
            value={name}
            maxLength={mcpNameMaxLength}
            placeholder="Claude Desktop"
            required
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <fieldset className="assistants__scopes">
        <legend className="assistants__meta">
          It can always see meeting names, dates and folders. It may also read:
        </legend>
        {(['summaries', 'transcripts'] satisfies McpScope[]).map((scope) => (
          <label key={scope} className="assistants__scope">
            <input
              type="checkbox"
              checked={scopes.includes(scope)}
              onChange={(event) =>
                setScopes((current) =>
                  event.target.checked
                    ? [...current, scope]
                    : current.filter((item) => item !== scope),
                )
              }
            />
            {scopeLabels[scope]}
          </label>
        ))}
      </fieldset>
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || name.trim() === ''}
        >
          Connect
        </Button>
      </div>
    </form>
  );
}

function Setup({
  mcp,
  connection,
  onDone,
}: {
  mcp: McpState;
  connection: McpConnection;
  onDone: () => void;
}) {
  return (
    <section
      className="assistants__section"
      aria-label={`Set up ${connection.client.name}`}
    >
      <h3 className="assistants__title">Set up {connection.client.name}</h3>
      <p className="assistants__note">
        Add one of these to the assistant’s MCP settings. The key is shown only
        now; connect again if you lose it. A copy leaves the clipboard after a
        minute.
      </p>
      {mcp.setupNote && <p className="assistants__note">{mcp.setupNote}</p>}
      <Snippet
        title="Apps that start a program (Claude Desktop, Qwen Chat, LM Studio)"
        text={setupText('program', mcp, connection.key)}
      />
      <Snippet
        title="Tools that connect to an address (Kimi Code, editors)"
        text={setupText('address', mcp, connection.key)}
      />
      <div>
        <Button onClick={onDone}>Done</Button>
      </div>
    </section>
  );
}

function Snippet({ title, text }: { title: string; text: string }) {
  const { status, copy } = useCopyStatus(() => copyMcpSetup(text));
  return (
    <figure className="assistants__snippet">
      <figcaption className="assistants__meta">{title}</figcaption>
      <pre className="assistants__code" data-selectable>
        {text}
      </pre>
      <div className="assistants__copy">
        <Button size="sm" onClick={copy}>
          Copy
        </Button>
        <span className="assistants__meta" aria-live="polite">
          {copyText[status]}
        </span>
      </div>
    </figure>
  );
}
