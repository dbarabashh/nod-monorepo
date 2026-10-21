import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import {
  Badge,
  Button,
  Card,
  CardActions,
  CardBody,
  CardHeading,
  CardMedia,
  CardMeta,
  CardText,
  CardTitle,
  Checkbox,
  EmptyState,
  Field,
  Input,
  List,
  ListRow,
  Progress,
  Tabs,
  Text,
  type ButtonVariant,
} from '../../components/ui/index.ts';
import { radius, space, themed, useScheme } from '../../theme/index.ts';

const variants: ButtonVariant[] = [
  'default',
  'primary',
  'danger',
  'outline',
  'ghost',
];

const meetings = [
  { id: 'a', title: 'Weekly planning', meta: 'Today, 10:00 · 42 min' },
  { id: 'b', title: 'Design review', meta: 'Yesterday, 15:30 · 1 h 05 min' },
  { id: 'c', title: 'Interview debrief', meta: 'Mon, 12:00 · 18 min' },
];

const sheets = themed((colors) => ({
  screen: { backgroundColor: colors.bg },
  content: { gap: space[8], padding: space[4], paddingBottom: space[12] },
  section: { gap: space[3] },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2] },
  surface: {
    gap: space[3],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
  },
}));

function Section({ title, children }: { title: string; children: ReactNode }) {
  const styles = sheets[useScheme()];
  return (
    <View style={styles.section}>
      <Text
        variant="sm"
        tone="muted"
        weight="medium"
        accessibilityRole="header"
      >
        {title}
      </Text>
      {children}
    </View>
  );
}

export function ShowcaseView() {
  const styles = sheets[useScheme()];
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(['a']));
  const [title, setTitle] = useState('');

  const toggle = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Section title="Text">
        <Text variant="xl">Meetings</Text>
        <Text variant="lg" weight="semibold">
          Weekly planning
        </Text>
        <Text>Body text for summaries and settings.</Text>
        <Text variant="sm" tone="muted">
          Small muted text for hints and timestamps.
        </Text>
      </Section>

      <Section title="Buttons">
        {variants.map((variant) => (
          <View key={variant} style={styles.row}>
            <Button variant={variant} size="sm">
              Small
            </Button>
            <Button variant={variant}>{variant}</Button>
            <Button variant={variant} size="lg" icon="mic">
              Record
            </Button>
          </View>
        ))}
        <View style={styles.row}>
          <Button disabled>Disabled</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="outline" disabled>
            Disabled
          </Button>
          <Button icon="more" accessibilityLabel="More options" />
          <Button
            variant="ghost"
            size="sm"
            icon="close"
            accessibilityLabel="Close"
          />
        </View>
      </Section>

      <Section title="Badges">
        <View style={styles.row}>
          <Badge>Draft</Badge>
          <Badge variant="accent" dot>
            Syncing
          </Badge>
          <Badge variant="success" dot>
            Synced
          </Badge>
          <Badge variant="warning" dot>
            Offline
          </Badge>
          <Badge variant="danger" dot>
            Recording
          </Badge>
        </View>
      </Section>

      <Section title="Fields">
        <View style={styles.surface}>
          <Field label="Title" hint="Shown in the list of meetings.">
            <Input
              value={title}
              onChangeText={setTitle}
              placeholder="Untitled meeting"
            />
          </Field>
          <Field label="Relay address" error="Use an https:// address.">
            <Input defaultValue="http://relay.example" autoCapitalize="none" />
          </Field>
          <Field label="Notes">
            <Input multiline placeholder="Anything to remember" />
          </Field>
          <Field label="Device name">
            <Input defaultValue="This phone" editable={false} />
          </Field>
        </View>
      </Section>

      <Section title="Checkboxes">
        <View style={styles.row}>
          <Checkbox label="Unchecked" checked={false} onChange={() => {}} />
          <Checkbox label="Checked" checked onChange={() => {}} />
          <Checkbox
            label="Partly checked"
            checked={false}
            mixed
            onChange={() => {}}
          />
          <Checkbox
            label="Disabled"
            checked={false}
            disabled
            onChange={() => {}}
          />
          <Checkbox label="Disabled" checked disabled onChange={() => {}} />
        </View>
      </Section>

      <Section title="List">
        <List>
          {meetings.map((meeting) => (
            <ListRow
              key={meeting.id}
              title={meeting.title}
              meta={meeting.meta}
              selected={meeting.id === 'b'}
              leading={
                <Checkbox
                  label={`Select ${meeting.title}`}
                  checked={picked.has(meeting.id)}
                  onChange={(on) => toggle(meeting.id, on)}
                />
              }
              trailing={
                meeting.id === 'a' ? (
                  <Badge variant="success" dot>
                    Synced
                  </Badge>
                ) : undefined
              }
              onPress={() => {}}
            />
          ))}
        </List>
      </Section>

      <Section title="Card">
        <Card>
          <CardMedia icon="sync" />
          <CardBody>
            <CardHeading>
              <CardTitle>Sync with your computer</CardTitle>
              <Badge variant="warning">Not paired</Badge>
            </CardHeading>
            <CardText>
              Scan the code shown in Nod on your computer. Meetings travel end
              to end encrypted.
            </CardText>
            <CardMeta>Last synced: never</CardMeta>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <CardTitle>Speech model</CardTitle>
            <CardMeta variant="strong">312 MB of 640 MB</CardMeta>
            <Progress value={312 / 640} label="Downloading speech model" />
            <CardActions>
              <Button size="sm" variant="ghost">
                Cancel
              </Button>
            </CardActions>
          </CardBody>
        </Card>
      </Section>

      <Section title="Tabs">
        <Tabs
          tabs={[
            { value: 'summary', label: 'Summary' },
            { value: 'transcript', label: 'Transcript' },
          ]}
          value={tab}
          onChange={setTab}
        />
        <Text tone="muted">
          {tab === 'summary'
            ? 'The summary goes here.'
            : 'The transcript goes here.'}
        </Text>
      </Section>

      <Section title="Empty state">
        <View style={styles.surface}>
          <EmptyState
            icon="mic"
            title="No meetings yet"
            description="Meetings you record here or sync from your computer show up in this list."
          >
            <Button variant="primary" icon="mic">
              New recording
            </Button>
          </EmptyState>
        </View>
      </Section>
    </ScrollView>
  );
}
