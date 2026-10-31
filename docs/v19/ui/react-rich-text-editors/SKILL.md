---
name: react-rich-text-editors
description: Builds rich text editors in React with Tiptap 3 or Lexical - choosing between them and a plain Markdown textarea, editor setup that does not re-render the app on every keystroke, accessible formatting toolbars driven by useEditorState, links, mentions with a suggestion popup, placeholders and character limits, storing JSON rather than HTML, sanitizing HTML on output, autosave with a visible status, and collaborative editing with Yjs, Hocuspocus or y-websocket and remote carets. Use when adding a comment box with formatting, a document or note editor, mentions or slash commands, real-time co-editing, when the editor lags as the document grows, SSR shows a hydration error, undo breaks under collaboration, or pasted content brings unsafe HTML.
metadata:
  tags:
  - react
  - rich-text
  - editor
  - tiptap
  - lexical
  - yjs
  - collaboration
  - mentions
---

# React rich text editors

A rich text editor keeps a structured document (a tree of nodes and marks), renders it into a `contenteditable` element, and turns key presses and pastes into transactions on that tree. Tiptap (built on ProseMirror) and Lexical (from Meta) both do this well; neither should be fed or read as an HTML string on every keystroke. This skill covers choosing one, wiring it into React without slow re-renders, an accessible toolbar, mentions, saving, and collaboration with Yjs.

## Step 0: read the installed editor packages

Both editors changed APIs recently (Tiptap 3, Lexical's extension API), so read the versions first:

```bash
node -p "['@tiptap/react','@tiptap/core','@tiptap/starter-kit','@tiptap/extensions','@tiptap/extension-mention','@tiptap/extension-collaboration','lexical','@lexical/react','yjs','@hocuspocus/provider','y-websocket'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `@tiptap/react` 3.32.2 (all `@tiptap/*` packages share one version: keep them identical), `lexical` and `@lexical/react` 0.53.0 (0.53 removed the `*ImportExtension` extensions deprecated in 0.52, and the type arguments on `getParent<T>()`, `getChildren<T>()`, `$getNodeByKey<T>()` and the rest of that family: drop the argument and narrow with a guard such as `$isListItemNode`), `yjs` 13.6.33, `@hocuspocus/provider` 4.8.0, `y-websocket` 3.1.0. In Tiptap 3, `StarterKit` includes Link, Underline, ListKeymap and TrailingNode, its history extension is `undoRedo`, Placeholder and CharacterCount moved to `@tiptap/extensions`, and menus import from `@tiptap/react/menus`.

## Decision table: which editor

| Need | Pick | Why the others lose |
|---|---|---|
| Comments or descriptions with bold, lists and links; Markdown-savvy users | a `<textarea>` with Markdown and a preview | no editor bundle, perfect accessibility; rich editors are overkill |
| A document or note editor with a large extension ecosystem, collaboration, mentions, tables | Tiptap 3 | mature extensions, simple React hooks, first-class Yjs support |
| An editor inside a product that needs fine control of rendering, very large documents, React-rendered decorator nodes | Lexical | lean core, React-first, strong performance; fewer ready-made extensions |
| A block editor like Notion out of the box | a block editor built on these (for example BlockNote on Tiptap) | building blocks, drag handles and slash menus from scratch takes months |

## Store JSON, render HTML only on output

Persist the editor's own JSON (`editor.getJSON()` in Tiptap, `editor.getEditorState().toJSON()` in Lexical), not HTML:

- JSON round-trips without loss and validates against a schema; HTML depends on parsing rules and browser quirks.
- Rendering stored content elsewhere (emails, search snippets) uses the editor's own server-side renderer (`generateHTML` in `@tiptap/html`, Lexical's `$generateHtmlFromNodes` with a headless editor).
- Any HTML you render outside the editor goes through a sanitizer (DOMPurify) first, because pasted content and imported documents can carry scripts.
- Keep a `schemaVersion` beside the JSON so later migrations know what they read.

## Tiptap 3 setup without slow re-renders

`useEditor` creates the editor once. Since Tiptap 3 it does not re-render the component on every transaction; read the state your UI needs with `useEditorState` and a selector, so only the toolbar re-renders when the selection changes:

```tsx
import { useEditor, EditorContent, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder, CharacterCount } from '@tiptap/extensions'

const editor = useEditor({
  extensions: [
    StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, autolink: true, protocols: ['https', 'mailto'] } }),
    Placeholder.configure({ placeholder: 'Write a description…' }),
    CharacterCount.configure({ limit: 10_000 }),
  ],
  content: initialJson,
  immediatelyRender: false,                 // required under server rendering; harmless in a SPA
  editorProps: { attributes: { 'aria-label': 'Description', class: 'prose' } },
})
const state = useEditorState({
  editor,
  selector: ({ editor: e }) => ({
    bold: e?.isActive('bold') ?? false, italic: e?.isActive('italic') ?? false,
    h2: e?.isActive('heading', { level: 2 }) ?? false, bullet: e?.isActive('bulletList') ?? false,
    canUndo: e?.can().undo() ?? false, chars: e?.storage.characterCount.characters() ?? 0,
  }),
})
```

- With `immediatelyRender: false`, `editor` is `null` on the first render: render a placeholder of the same height.
- Changing `content` after creation does nothing; call `editor.commands.setContent(json, { emitUpdate: false })` when loading a different document, or remount with a `key`.
- Do not store the editor's JSON in React state on every `onUpdate`: debounce saves instead.

## An accessible formatting toolbar

A formatting toolbar is one Tab stop (`role="toolbar"` with an `aria-label`), with arrow keys moving between buttons (roving `tabIndex`). Toggle buttons expose `aria-pressed`, and every icon button has a label and a keyboard shortcut hint (`aria-keyshortcuts="Control+B"`). Commands use `editor.chain().focus().toggleBold().run()` so focus returns to the text. Keep the editor itself labelled (`aria-label` or `aria-labelledby` on the `contenteditable`), and announce autosave status through a polite live region.

## Links in rich text

Allow only safe protocols (`https`, `mailto`), add `rel="noopener noreferrer nofollow"` to rendered links, and edit links through a small dialog or popover with a real `<input type="url">`, not `window.prompt`. Tiptap 3's Link extension (inside `StarterKit`) takes `protocols`, `autolink`, `openOnClick` and `isAllowedUri` to reject unsafe URLs on paste.

## Mentions with a suggestion popup

Tiptap's Mention extension shows a suggestion list when the user types a trigger character (`@`) and inserts a node with an `id` and a `label`. Fetch suggestions from the server with the query, show at most about eight, and handle the keyboard in `onKeyDown`:

```tsx
import Mention from '@tiptap/extension-mention'

Mention.configure({
  HTMLAttributes: { class: 'mention' },
  renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
  suggestion: {
    char: '@',
    items: async ({ query }) => (await searchPeople(query)).slice(0, 8),     // [{ id, label }]
    render: () => mentionPopupRenderer(),                                    // onStart, onUpdate, onKeyDown, onExit
  },
})
```

The popup is a listbox (`role="listbox"`, options with `aria-selected`), positioned at `props.clientRect()` with Floating UI; Tiptap 3 no longer bundles tippy.js. Lexical builds the same with `LexicalTypeaheadMenuPlugin` and `useBasicTypeaheadTriggerMatch('@', { minLength: 0 })`. Full popup code: [collaboration-and-lexical.md](references/collaboration-and-lexical.md).

## Collaborative editing with Yjs

Yjs is a CRDT: every client edits a shared document and changes merge without conflicts. The editor binds to a Yjs document, a provider syncs it over WebSocket, and awareness carries cursors and names. Create the document and provider inside the effect that destroys them, because `provider.destroy()` is final and Strict Mode runs every mount's cleanup once in development:

```tsx
import { useEffect, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { getCollabToken } from './collab-token'

type Me = { name: string; color: string }
type Session = { ydoc: Y.Doc; provider: HocuspocusProvider }

export function CollaborativeEditor({ docId, me }: { docId: string; me: Me }) {
  const [session, setSession] = useState<Session | null>(null)
  useEffect(() => {
    const ydoc = new Y.Doc()
    const provider = new HocuspocusProvider({ url: 'wss://collab.example.com', name: `doc:${docId}`, document: ydoc, token: getCollabToken })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the effect owns the provider, so only it can hand it over
    setSession({ ydoc, provider })
    return () => { provider.destroy(); ydoc.destroy() }
  }, [docId])
  return session ? <SharedEditor session={session} me={me} /> : <div className="min-h-40" role="status">Connecting…</div>
}

function SharedEditor({ session: { ydoc, provider }, me }: { session: Session; me: Me }) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ undoRedo: false }),          // Yjs has its own undo manager
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({ provider, user: { name: me.name, color: me.color } }),
    ],
    immediatelyRender: false,
  }, [ydoc, provider])                                    // a new session needs a new editor
  return <EditorContent editor={editor} />
}
```

- Turn off the editor's own history (`undoRedo: false`): two undo stacks corrupt each other.
- Do not pass `content` with collaboration; the server loads the document into Yjs, or one client seeds it once.
- Persist Yjs updates on the server (Hocuspocus extensions, or y-websocket with a persistence layer), and authorize the connection with a short-lived token per document.

## Worked example: a Tiptap editor with toolbar, autosave and every state

A description editor with an accessible toolbar, a character limit, debounced autosave with a visible status, and loading, error and empty states:

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type JSONContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { CharacterCount, Placeholder } from '@tiptap/extensions'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const LIMIT = 10_000

export function DescriptionEditor({ docId, initial, onSave }: {
  docId: string; initial: JSONContent | null; onSave: (json: JSONContent) => Promise<void>
}) {
  const [save, setSave] = useState<SaveState>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const pending = useRef<(() => void) | null>(null)      // the save the debounce is still holding back
  const flush = useCallback(() => {
    clearTimeout(timer.current)
    pending.current?.()
    pending.current = null
  }, [])
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] }, link: { openOnClick: false, protocols: ['https', 'mailto'] } }),
      Placeholder.configure({ placeholder: 'Describe the project.' }),
      CharacterCount.configure({ limit: LIMIT }),
    ],
    content: initial ?? undefined,
    immediatelyRender: false,
    editorProps: { attributes: { 'aria-label': 'Project description', 'aria-multiline': 'true', class: 'prose min-h-40 p-3' } },
    onUpdate: ({ editor: e }) => {
      const doc = e.state.doc                            // immutable, so it can still be read after the editor is gone
      pending.current = () => {
        setSave('saving')
        onSave(doc.toJSON() as JSONContent).then(() => setSave('saved'), () => setSave('error'))
      }
      setSave('idle')
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, 800)
    },
  }, [docId])
  useEffect(() => flush, [docId, flush])                 // leaving the document saves what the timer still holds

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive('bold') ?? false, italic: e?.isActive('italic') ?? false,
      h2: e?.isActive('heading', { level: 2 }) ?? false, list: e?.isActive('bulletList') ?? false,
      canUndo: e?.can().undo() ?? false, canRedo: e?.can().redo() ?? false,
      chars: e?.storage.characterCount.characters() ?? 0, empty: e?.isEmpty ?? true,
    }),
  })

  if (!editor || !s) return <div className="min-h-40 rounded border p-3" role="status">Loading editor…</div>

  const buttons = [
    { label: 'Bold', pressed: s.bold, keys: 'Control+B', run: () => editor.chain().focus().toggleBold().run() },
    { label: 'Italic', pressed: s.italic, keys: 'Control+I', run: () => editor.chain().focus().toggleItalic().run() },
    { label: 'Heading', pressed: s.h2, keys: undefined, run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: 'Bulleted list', pressed: s.list, keys: 'Control+Shift+8', run: () => editor.chain().focus().toggleBulletList().run() },
  ]
  return (
    <div className="editor">
      <Toolbar label="Formatting">
        {buttons.map((b) => (
          <button key={b.label} type="button" aria-pressed={b.pressed} aria-keyshortcuts={b.keys} onClick={b.run}>{b.label}</button>
        ))}
        <button type="button" onClick={() => editor.chain().focus().undo().run()} disabled={!s.canUndo} aria-keyshortcuts="Control+Z">Undo</button>
        <button type="button" onClick={() => editor.chain().focus().redo().run()} disabled={!s.canRedo} aria-keyshortcuts="Control+Shift+Z">Redo</button>
      </Toolbar>
      <EditorContent editor={editor} />
      <div className="editor-footer">
        <span aria-live="polite">
          {save === 'saving' ? 'Saving…' : save === 'saved' ? 'All changes saved' : ''}
        </span>
        {save === 'error' && (
          <span role="alert">Not saved. <button type="button" onClick={() => editor && void onSave(editor.getJSON()).then(() => setSave('saved'), () => setSave('error'))}>Retry</button></span>
        )}
        <span className={s.chars > LIMIT * 0.9 ? 'text-danger' : 'muted'}>{s.chars} / {LIMIT}</span>
        {s.empty && <span className="sr-only">The description is empty.</span>}
      </div>
    </div>
  )
}

// Roving tabIndex: only the active button has tabIndex 0, so the toolbar is one Tab stop; arrows, Home and End move.
function Toolbar({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const active = useRef<HTMLButtonElement | null>(null)
  const enabled = () => [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]

  function sync() {
    const items = enabled()
    if (!active.current || !items.includes(active.current)) active.current = items[0] ?? null   // e.g. Undo just got disabled
    ref.current?.querySelectorAll('button').forEach((b) => { b.tabIndex = b === active.current ? 0 : -1 })
  }
  useLayoutEffect(sync)                                       // after every render: buttons may be enabled or disabled

  function onFocus(e: FocusEvent<HTMLDivElement>) {
    if (e.target instanceof HTMLButtonElement) { active.current = e.target; sync() }
  }
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return
    const items = enabled()
    const i = active.current ? items.indexOf(active.current) : 0
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
    items[next]?.focus(); e.preventDefault()                  // focus fires onFocus, which moves tabIndex 0
  }
  // oxlint-disable-next-line jsx-a11y/interactive-supports-focus -- the buttons are the Tab stop; their focus and key events bubble here
  return <div ref={ref} role="toolbar" aria-label={label} aria-orientation="horizontal" onFocus={onFocus} onKeyDown={onKeyDown}>{children}</div>
}
```

Passing `[docId]` as `useEditor`'s dependencies recreates the editor when the document changes. Saves are debounced, and the effect's cleanup flushes a waiting save, so typing and navigating away within 800 ms loses nothing: a bare `clearTimeout` on unmount would throw that text away. Failed saves stay visible with Retry, and the counter warns near the limit.

## Verify the editor

- Type in a 50-page document with the React Profiler on: only the toolbar and footer re-render, not the page.
- Keyboard only: Tab reaches the toolbar once (exactly one toolbar button has `tabIndex` 0), Left and Right arrows move inside it and wrap, Home and End jump to the first and last enabled button, Shift+Tab from the text returns to the button used last, Tab reaches the text; shortcuts work; a screen reader announces the editor's name and the toggle states.
- Paste from a web page and from Word: no scripts, no inline event handlers, no foreign styles in the saved JSON.
- Disconnect the network while typing: the status shows the error with Retry; nothing typed is lost.
- Type a word and navigate away at once: the network panel shows the save, and reopening the document shows the word.
- Collaboration under `<StrictMode>` in development: the provider connects and stays connected.
- Collaboration: two browsers edit the same paragraph at once; both converge; carets show names; undo undoes only your own changes.
- Server-render the page: no hydration warning (`immediatelyRender: false`).

## Gotchas and anti-patterns in rich text editors

Each gotcha names the symptom, its cause and the fix.

1. **Typing lags as the document grows.** Cause: re-rendering the app on each transaction, or `setState(editor.getHTML())` in `onUpdate`. Fix: `useEditorState` selectors and debounced saves.
2. **Hydration mismatch with Tiptap under SSR.** Cause: the editor rendered on the server. Fix: `immediatelyRender: false` and a same-size placeholder.
3. **The editor ignores new `content`.** Cause: `content` is read only on creation. Fix: `setContent` or remount with a `key`.
4. **Undo jumps or corrupts text under collaboration.** Cause: the editor's history running beside Yjs. Fix: `StarterKit.configure({ undoRedo: false })`.
5. **Every paragraph appears twice when two users open a new document.** Cause: both clients seeded initial content. Fix: seed on the server, or let exactly one client bootstrap (Lexical's `shouldBootstrap` on one client only).
6. **A pasted link runs JavaScript.** Cause: links with `javascript:` URLs allowed. Fix: restrict `protocols` and validate with `isAllowedUri`.
7. **Two Tiptap versions break with "Duplicate extension names" or schema errors.** Cause: mismatched `@tiptap/*` versions. Fix: install every `@tiptap/*` package at the same exact version.
8. **Saved HTML shows scripts elsewhere.** Cause: rendering stored HTML without sanitizing. Fix: store JSON; sanitize any HTML output with DOMPurify.
9. **Collaboration never syncs in development, yet works in production.** Cause: a provider held in lazy `useState` and destroyed in a cleanup: Strict Mode's mount, cleanup, mount leaves the state holding a dead provider. Fix: create it inside the effect that destroys it.
10. **The last few words vanish after leaving the page.** Cause: unmount clears the debounce timer and drops the save it was holding. Fix: flush the pending save in the cleanup.

## Pre-merge checklist for rich text editors

1. The editor type fits the job; a textarea was considered.
2. Content is stored as JSON with a schema version; HTML output is sanitized.
3. UI state comes from `useEditorState` (Tiptap) or listeners (Lexical); no state copy per keystroke.
4. The toolbar is one Tab stop with labelled toggle buttons; the editor has an accessible name.
5. Links are limited to safe protocols; pasted content is clean.
6. Autosave is debounced, flushes on unmount, shows its status and recovers from errors.
7. With collaboration: provider created in the effect that destroys it, editor history off, server persistence and per-document authorization in place.

See also: react-realtime, react-security, react-forms, react-accessibility, react-overlays-and-feedback.
