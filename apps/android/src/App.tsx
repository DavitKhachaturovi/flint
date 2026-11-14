/**
 * Flint for Android (D-165, docs/02 §13, mockup 14). A0: the bottom bar with Today, Inbox and
 * Lists, and Settings → Sync connecting to Google Drive and showing the desktop's Flint folder
 * (R-A1, docs/06 §7). The screens fill in from A1.
 */
import Constants from 'expo-constants';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { checkDriveFolder, DriveProblem, type DriveFolderCheck } from './drive';
import { color, radius, size } from './theme';

type Tab = 'today' | 'inbox' | 'lists';
type Screen = { readonly tab: Tab } | { readonly settings: true };

const DRIVE_FOLDER =
  (Constants.expoConfig?.extra?.['driveFolder'] as string | undefined) ?? 'Flint (development)';

export function App(): ReactElement {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <Main />
    </SafeAreaProvider>
  );
}

function Main(): ReactElement {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState<Screen>({ tab: 'today' });
  const tab = 'tab' in screen ? screen.tab : 'lists';
  return (
    <View style={[styles.window, { paddingTop: insets.top }]}>
      <View style={styles.content}>
        {'settings' in screen ? (
          <Settings onBack={() => setScreen({ tab: 'lists' })} />
        ) : tab === 'today' ? (
          <Empty title="Today" line="Pinned tasks and reminders arrive here in A1." />
        ) : tab === 'inbox' ? (
          <Empty title="Inbox" line="Captured tasks arrive here in A1." />
        ) : (
          <ListsScreen onSettings={() => setScreen({ settings: true })} />
        )}
      </View>
      <View style={[styles.navbar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
        <TabButton label="Today" on={tab === 'today'} onPress={() => setScreen({ tab: 'today' })} />
        <TabButton label="Inbox" on={tab === 'inbox'} onPress={() => setScreen({ tab: 'inbox' })} />
        <TabButton label="Lists" on={tab === 'lists'} onPress={() => setScreen({ tab: 'lists' })} />
      </View>
    </View>
  );
}

function TabButton(props: {
  readonly label: string;
  readonly on: boolean;
  readonly onPress: () => void;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: props.on }}
      onPress={props.onPress}
      style={styles.tab}
    >
      <View style={[styles.pill, props.on && styles.pillOn]} />
      <Text style={[styles.tabLabel, props.on && styles.tabLabelOn]}>{props.label}</Text>
    </Pressable>
  );
}

function Empty(props: { readonly title: string; readonly line: string }): ReactElement {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>{props.title}</Text>
      <Text style={styles.muted}>{props.line}</Text>
    </View>
  );
}

function ListsScreen(props: { readonly onSettings: () => void }): ReactElement {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Lists</Text>
      <Text style={styles.muted}>Your lists and notes arrive here in A1.</Text>
      <View style={styles.grow} />
      <Button label="Settings" onPress={props.onSettings} />
    </View>
  );
}

type Check =
  | { readonly state: 'idle' }
  | { readonly state: 'working' }
  | { readonly state: 'done'; readonly result: DriveFolderCheck }
  | { readonly state: 'failed'; readonly message: string };

/** Settings → Sync (MOB-12, MOB-13); in A0 it connects and shows the desktop's folder (R-A1). */
function Settings(props: { readonly onBack: () => void }): ReactElement {
  const [check, setCheck] = useState<Check>({ state: 'idle' });
  const connect = (): void => {
    setCheck({ state: 'working' });
    checkDriveFolder(DRIVE_FOLDER, true)
      .then((result) => setCheck({ state: 'done', result }))
      .catch((error: unknown) =>
        setCheck({
          state: 'failed',
          message:
            error instanceof DriveProblem
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error),
        }),
      );
  };
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={props.onBack}>
        <Text style={styles.back}>Back</Text>
      </Pressable>
      <Text style={styles.title}>Settings</Text>
      <Text style={styles.label}>SYNC</Text>
      <Card>
        <Text style={styles.body}>Google Drive</Text>
        <Text style={styles.muted}>
          {check.state === 'done'
            ? `Connected as ${check.result.email}`
            : check.state === 'working'
              ? 'Waiting for Google…'
              : check.state === 'failed'
                ? `Couldn't connect to Google Drive (${check.message}).`
                : `Keep chosen lists and notes in step with your PCs, through your own Drive. Folder: My Drive › ${DRIVE_FOLDER}.`}
        </Text>
        {check.state !== 'working' && (
          <Button
            label={check.state === 'done' ? 'Check again' : 'Connect Google Drive'}
            onPress={connect}
            primary={check.state !== 'done'}
          />
        )}
      </Card>
      {check.state === 'done' && (
        <Card>
          <Text style={styles.body}>
            {check.result.folder
              ? `My Drive › ${check.result.folder.name}`
              : `No "${DRIVE_FOLDER}" folder this app can see`}
          </Text>
          {check.result.folder ? (
            <FolderContents result={check.result} />
          ) : (
            <Text style={styles.muted}>
              Either the PC hasn't synced to this folder yet, or Google keeps the PC's files and
              this app's apart (R-A1 failed: docs/06 §7).
            </Text>
          )}
        </Card>
      )}
    </ScrollView>
  );
}

function FolderContents(props: { readonly result: DriveFolderCheck }): ReactElement {
  const { lists, bookkeeping } = props.result;
  return (
    <>
      <Text style={styles.muted}>
        {lists.length === 1 ? '1 list or note' : `${lists.length} lists and notes`} from your PC
        {bookkeeping.length > 0 ? `; sync's files: ${bookkeeping.join(', ')}` : ''}
      </Text>
      {lists.map((name) => (
        <Text key={name} style={styles.item}>
          {name}
        </Text>
      ))}
    </>
  );
}

function Card(props: { readonly children: ReactNode }): ReactElement {
  return <View style={styles.card}>{props.children}</View>;
}

function Button(props: {
  readonly label: string;
  readonly onPress: () => void;
  readonly primary?: boolean;
}): ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        props.primary && styles.buttonPrimary,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonLabel, props.primary && styles.buttonLabelPrimary]}>
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  window: { flex: 1, backgroundColor: color.groundWindow },
  content: { flex: 1 },
  page: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 26, paddingBottom: 24, gap: 12 },
  grow: { flex: 1 },
  title: {
    fontSize: size.title,
    fontWeight: '700',
    letterSpacing: -0.7,
    color: color.textHighlight,
  },
  label: { fontSize: size.label, letterSpacing: 0.84, color: color.textMuted, marginTop: 8 },
  body: { fontSize: size.body, color: color.textBody },
  muted: { fontSize: 14, lineHeight: 20, color: color.textMuted },
  item: { fontSize: 15, color: color.textBody, paddingVertical: 6 },
  back: { fontSize: 15, color: color.textSecondary, paddingVertical: 10 },
  card: {
    backgroundColor: color.groundCard,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: color.edgeCard,
    padding: 16,
    gap: 10,
  },
  button: {
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    backgroundColor: color.groundTile,
    borderWidth: 1,
    borderColor: color.edgeChip,
  },
  buttonPrimary: { backgroundColor: color.strongBg, borderColor: color.strongBg },
  pressed: { opacity: 0.8 },
  buttonLabel: { fontSize: 15, color: color.textPrimary },
  buttonLabelPrimary: { color: color.strongFg, fontWeight: '600' },
  navbar: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: color.groundSidebar,
    borderTopWidth: 1,
    borderTopColor: color.edgeDivider,
    paddingTop: 12,
  },
  tab: { alignItems: 'center', gap: 4, width: 96, minHeight: 56 },
  pill: { width: 60, height: 32, borderRadius: 16 },
  pillOn: { backgroundColor: color.strongBg },
  tabLabel: { fontSize: 12.5, color: color.textSecondary },
  tabLabelOn: { color: color.textHighlight, fontWeight: '500' },
});
