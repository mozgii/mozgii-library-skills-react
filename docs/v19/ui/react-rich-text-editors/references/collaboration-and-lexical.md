---
title: Mentions, Lexical setup and collaborative editing
author: MOZGII, Inc.
lang: en
---

# Mentions, Lexical setup and collaborative editing

Longer recipes for rich text editors: a mention popup for Tiptap 3, a Lexical editor with the classic composer and plugins, Lexical collaboration, Yjs servers and persistence, and safe HTML import and export. Checked against the type definitions of `@tiptap/*` 3.32.2, `@lexical/react` 0.53.0 and `@hocuspocus/provider` 4.8.0.

## A mention popup renderer for Tiptap 3

Tiptap's suggestion utility calls `render()` once per suggestion session and then the lifecycle callbacks. This renderer mounts a React listbox with `ReactRenderer` and positions it with Floating UI's DOM package:

```tsx
import { ReactRenderer } from '@tiptap/react'
import type { SuggestionKeyDownProps, SuggestionProps } from '@tiptap/suggestion'
import { computePosition, flip, offset, shift } from '@floating-ui/dom'
import { useImperativeHandle, useState } from 'react'

type Person = { id: string; label: string }
type ListHandle = { onKeyDown: (p: SuggestionKeyDownProps) => boolean }

const MentionList = ({ items, command, ref }: { items: Person[]; command: (p: Person) => void; ref?: React.Ref<ListHandle> }) => {
  const [active, setActive] = useState(0)
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowDown') { setActive((i) => (i + 1) % Math.max(items.length, 1)); return true }
      if (event.key === 'ArrowUp') { setActive((i) => (i - 1 + items.length) % Math.max(items.length, 1)); return true }
      if (event.key === 'Enter' && items[active]) { command(items[active]); return true }
      return false
    },
  }), [items, active, command])
  if (items.length === 0) return <div className="mention-popup" role="status">No people found</div>
  return (
    <div className="mention-popup" role="listbox" aria-label="People">
      {items.map((p, i) => (
        <div key={p.id} role="option" tabIndex={-1} aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); command(p) }}>{p.label}</div>
      ))}
    </div>
  )
}

export function mentionPopupRenderer() {
  let renderer: ReactRenderer<ListHandle> | null = null
  const place = (props: SuggestionProps<Person>) => {
    const rect = props.clientRect?.()
    const el = renderer?.element as HTMLElement | undefined
    if (!rect || !el) return
    void computePosition({ getBoundingClientRect: () => rect }, el, { placement: 'bottom-start', strategy: 'fixed', middleware: [offset(4), flip(), shift({ padding: 8 })] })
      .then(({ x, y }) => Object.assign(el.style, { position: 'fixed', left: `${x}px`, top: `${y}px` }))
  }
  return {
    onStart: (props: SuggestionProps<Person>) => {
      renderer = new ReactRenderer(MentionList, { props, editor: props.editor })
      document.body.appendChild(renderer.element)
      place(props)
    },
    onUpdate: (props: SuggestionProps<Person>) => { renderer?.updateProps(props); place(props) },
    onKeyDown: (props: SuggestionKeyDownProps) => {
      if (props.event.key === 'Escape') { renderer?.destroy(); renderer?.element.remove(); renderer = null; return true }
      return renderer?.ref?.onKeyDown(props) ?? false
    },
    onExit: () => { renderer?.destroy(); renderer?.element.remove(); renderer = null },
  }
}
```

In React 19, `ref` is a regular prop, so the list component needs no `forwardRef`. Keep the editor's `aria-activedescendant` pointed at the active option if screen readers must hear the selection while focus stays in the text.

## A Lexical editor with the classic composer

Lexical's React API is a composer with plugins. The classic setup:

```tsx
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListItemNode, ListNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'

const initialConfig = {
  namespace: 'description',
  theme: { paragraph: 'mb-2', heading: { h2: 'text-xl font-semibold' }, text: { bold: 'font-bold', italic: 'italic' } },
  nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode],
  editorState: savedJson ?? undefined,                  // a JSON string from editorState.toJSON()
  onError: (error: Error) => { reportError(error) },    // do not swallow: Lexical errors mean a broken state
}

export function LexicalEditor({ onSave }: { onSave: (json: string) => void }) {
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <Toolbar />
      <RichTextPlugin
        contentEditable={<ContentEditable className="prose min-h-40 p-3" aria-label="Project description" />}
        placeholder={<div className="placeholder">Describe the project…</div>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin validateUrl={(url) => /^(https:|mailto:)/.test(url)} />
      <OnChangePlugin ignoreSelectionChange onChange={(state) => debouncedSave(() => onSave(JSON.stringify(state.toJSON())))} />
    </LexicalComposer>
  )
}
```

Toolbar buttons read state inside `editor.registerUpdateListener` or `editor.read()`, and run commands with `editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')`. Lexical 0.52 and later also have an extension API (`defineExtension` and `LexicalExtensionComposer`) that bundles nodes, config and behaviour; new projects can start there, existing plugin-based editors keep working.

## Lexical collaboration with Yjs

Lexical binds to Yjs through `CollaborationPlugin` from `@lexical/react/LexicalCollaborationPlugin`. The editor below reuses `initialConfig` from the classic composer above, with `editorState: null` because Yjs provides the content:

```tsx
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { CollaborationPlugin } from '@lexical/react/LexicalCollaborationPlugin'
import type { Provider } from '@lexical/yjs'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

type Me = { name: string; color: string }

export function CollaborativeEditor({ docId, me }: { docId: string; me: Me }) {
  return (
    <LexicalComposer initialConfig={{ ...initialConfig, editorState: null }}>   {/* null: Yjs provides the content */}
      <RichTextPlugin contentEditable={<ContentEditable aria-label="Project description" />} ErrorBoundary={LexicalErrorBoundary} />
      <CollaborationPlugin
        id={docId}
        providerFactory={(id, yjsDocMap) => {
          const doc = new Y.Doc(); yjsDocMap.set(id, doc)
          // y-websocket's awareness type is not the one @lexical/yjs declares, so the provider needs a cast
          return new WebsocketProvider('wss://collab.example.com', id, doc, { connect: false }) as unknown as Provider
        }}
        shouldBootstrap={false}                     // seed new documents on the server, never from several clients
        username={me.name}
        cursorColor={me.color}
      />
    </LexicalComposer>
  )
}
```

`Provider` in `@lexical/yjs` types its `awareness` states as Lexical's `UserState` (cursor `anchorPos` and `focusPos`, `color`, `focusing`, `name`, `awarenessData`), while `WebsocketProvider.awareness` is the `Awareness` class from `y-protocols`, whose `getLocalState()` and `getStates()` return plain `{ [x: string]: any }` records. The objects work together at runtime (the plugin writes those fields itself), but TypeScript 7 rejects the provider without a cast (TS2322, "`awareness.getLocalState()` are incompatible") and rejects a direct `as Provider` (TS2352, "neither type sufficiently overlaps"), so the cast goes through `unknown`. Keep it at this one line, and leave `connect: false`: the plugin connects the provider itself.

Remove `HistoryPlugin` when collaborating: the plugin brings a Yjs-aware undo manager. The type docs warn that `shouldBootstrap: true` on more than one client duplicates the initial paragraph.

## Yjs servers and persistence

Three common ways to run the sync server:

| Server | Notes |
|---|---|
| Hocuspocus 4 (`@hocuspocus/server`) | hooks for authentication (`onAuthenticate`), loading and storing documents (the Database extension), Redis for scaling, webhooks |
| y-websocket 3 server | minimal; add persistence (for example LevelDB) and your own auth in front |
| Hosted (Liveblocks, Tiptap Cloud, PartyKit) | no servers to run; vendor pricing and data location |

Store the Yjs update binary (`Y.encodeStateAsUpdate(doc)`) as the source of truth, and also derive the editor JSON for search and previews on the server. Authorize each connection per document with a short-lived token (the Hocuspocus provider's `token` option takes a function), and check write permission on the server, not in the editor.

## Safe HTML import and export

Pasting and importing HTML pass through the editor's schema, which drops unknown nodes and attributes; that is the first filter, not a sanitizer for output. Rules:

- Export with the editor's own serializer (`generateHTML(json, extensions)` from `@tiptap/html`, or Lexical's `$generateHtmlFromNodes`) on the server.
- Sanitize exported HTML with DOMPurify before inserting it anywhere with `dangerouslySetInnerHTML` or sending it in email.
- Restrict link protocols on import (`isAllowedUri` in Tiptap, `validateUrl` in Lexical's LinkPlugin).
- Strip images from untrusted pastes, or proxy them, so the editor does not load tracking pixels from arbitrary hosts.

## Markdown input and output

Users often expect Markdown shortcuts (`## ` for a heading, `- ` for a list): Tiptap's StarterKit input rules and Lexical's `MarkdownShortcutPlugin` provide them. For importing and exporting Markdown files, use the editor's Markdown package (`@lexical/markdown` transformers, or a Tiptap Markdown extension) rather than converting through HTML.
