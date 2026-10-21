import { Link } from 'expo-router';
import { View } from 'react-native';
import { Button, EmptyState } from '../components/ui/index.ts';
import { themed, useScheme } from '../theme/index.ts';

const sheets = themed((colors) => ({
  screen: { flex: 1, justifyContent: 'center', backgroundColor: colors.bg },
}));

export default function MeetingsScreen() {
  return (
    <View style={sheets[useScheme()].screen}>
      <EmptyState
        icon="mic"
        title="No meetings yet"
        description="Meetings you record here or sync from your computer show up in this list."
      >
        {__DEV__ && (
          <>
            <Link href="/components" asChild>
              <Button variant="outline">Design system</Button>
            </Link>
            <Link href="/diagnostics" asChild>
              <Button variant="outline">Diagnostics</Button>
            </Link>
          </>
        )}
      </EmptyState>
    </View>
  );
}
