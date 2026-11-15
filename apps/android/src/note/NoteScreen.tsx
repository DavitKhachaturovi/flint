/**
 * A note on the phone (MOB-07, R-A2): the header, the editor (a web view, NoteEditorDom) and the
 * native keyboard bar, which shows while the keyboard is up. R-A2 opens one note, "Keyboard test",
 * kept in the app's own storage; A1 brings the real Flint folder (04 §8).
 */
import { File, Paths } from 'expo-file-system';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { color } from '../theme';
import NoteEditorDom, { type NoteEditorHandle } from './NoteEditorDom';

const NOTE_NAME = 'Keyboard test';
const START = `---\nflint: 1\nid: kbtest\nmode: note\n---\n# Keyboard test\n\nType here with your keyboard. Try a checklist:\n\n- [ ] First thing\n- [ ] Second thing\n\n1. One\n2. Two\n\n**Bold**, *italic* and \`code\`.\n`;

function noteFile(): File {
  return new File(Paths.document, `${NOTE_NAME}.md`);
}

/**
 * The note's header (`flint`, `id`, `mode`) stays out of the editor, as on the desktop; it goes back
 * in front of the text when saved. R-A2 only: A1 reads notes with core's parser (04 §4).
 */
const HEADER = new RegExp('^\\uFEFF?---\\r?\\n[\\s\\S]*?\\r?\\n---\\r?\\n');

function splitHeader(text: string): { readonly head: string; readonly body: string } {
  const head = HEADER.exec(text)?.[0] ?? '';
  return { head, body: text.slice(head.length) };
}

/** The keyboard bar's buttons (D-165 Q3, mockup 14): label and the editor command they run. */
const BAR: readonly { readonly label: string; readonly command: string; readonly a11y: string }[] =
  [
    { label: '[ ]', command: 'task', a11y: 'Checklist' },
    { label: '•', command: 'bullet', a11y: 'Bulleted list' },
    { label: '1.', command: 'number', a11y: 'Numbered list' },
    { label: '→', command: 'indent', a11y: 'Indent' },
    { label: '←', command: 'outdent', a11y: 'Outdent' },
    { label: 'H', command: 'h2', a11y: 'Heading' },
    { label: 'B', command: 'bold', a11y: 'Bold' },
    { label: 'Undo', command: 'undo', a11y: 'Undo' },
    { label: 'Redo', command: 'redo', a11y: 'Redo' },
  ];

export function NoteScreen(props: { readonly onBack: () => void }): ReactElement {
  const editor = useRef<NoteEditorHandle>(null);
  const [note, setNote] = useState<{ readonly head: string; readonly body: string } | null>(null);
  const [keyboard, setKeyboard] = useState(false);

  useEffect(() => {
    const file = noteFile();
    if (!file.exists) {
      file.create();
      file.writeSync(START);
    }
    setNote(splitHeader(file.textSync()));
    const shown = Keyboard.addListener('keyboardDidShow', () => setKeyboard(true));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboard(false));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const save = (next: string): Promise<void> => {
    // R-A2 only: a plain write; A1's storage writes atomically (DATA-01, 04 §8).
    noteFile().writeSync((note?.head ?? '') + next);
    return Promise.resolve();
  };

  return (
    <KeyboardAvoidingView style={styles.screen} behavior="padding">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={props.onBack}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      </View>
      <View style={styles.editor}>
        {note !== null && (
          <NoteEditorDom
            ref={editor}
            text={note.body}
            onChange={save}
            dom={{ style: { flex: 1, backgroundColor: color.groundWindow } }}
          />
        )}
      </View>
      {keyboard && (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="always"
          style={styles.bar}
          contentContainerStyle={styles.barContent}
          accessibilityRole="toolbar"
          accessibilityLabel="Formatting"
        >
          {BAR.map((button) => (
            <Pressable
              key={button.command}
              accessibilityRole="button"
              accessibilityLabel={button.a11y}
              onPress={() => editor.current?.run(button.command)}
              style={({ pressed }) => [styles.barButton, pressed && styles.barButtonOn]}
            >
              <Text style={styles.barLabel}>{button.label}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.groundWindow },
  header: { paddingHorizontal: 16, paddingTop: 8 },
  back: { fontSize: 15, color: color.textSecondary, paddingVertical: 10 },
  editor: { flex: 1 },
  bar: {
    flexGrow: 0,
    height: 58,
    backgroundColor: color.groundCard,
    borderTopWidth: 1,
    borderTopColor: color.edgeCard,
  },
  barContent: { alignItems: 'center', paddingHorizontal: 6, gap: 2 },
  barButton: {
    minWidth: 44,
    height: 44,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  barButtonOn: { backgroundColor: color.groundTile },
  barLabel: { fontSize: 16, color: color.textBody, fontWeight: '600' },
});
