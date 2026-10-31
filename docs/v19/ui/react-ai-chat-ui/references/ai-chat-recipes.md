---
title: AI chat recipes with the AI SDK 7
author: MOZGII, Inc.
lang: en
---

# AI chat recipes with the AI SDK 7

Recipes for chat features beyond the basic panel: typed tool parts, saving and loading conversations, sending only the last message, resuming a stream after a reload, client-side tools, file attachments, editing a sent message, and streaming custom data parts. Checked against the type definitions of `ai` 7.0.159 and `@ai-sdk/react` 4.0.163; names differ in older majors.

## Typed messages and tool parts with InferUITools

Declare the tool set once on the server and derive the client's message type from it, so `part.input` and `part.output` are typed for each `tool-<name>` part instead of cast:

```ts
// shared/chat-types.ts (imported by the server route and the client)
import type { InferUITools, UIDataTypes, UIMessage } from 'ai'
import type { tools } from '../server/chat-tools'          // type-only import: no server code reaches the client
export type ChatTools = InferUITools<typeof tools>
export type ChatMessage = UIMessage<{ createdAt: number }, UIDataTypes, ChatTools>
```

```tsx
const { messages } = useChat<ChatMessage>({ transport: new DefaultChatTransport({ api: '/api/chat' }) })
// in the part switch: case 'tool-searchDocs': part.output is now the tool's return type when state is 'output-available'
```

The `METADATA` type parameter describes `message.metadata`, which the server can attach with `messageMetadata` in `toUIMessageStream`.

## Saving and loading conversations

Store messages on the server, keyed by a chat id, and load them when the page opens:

1. Create a chat id on the server (`POST /api/chats` returns `{ id }`) and navigate to `/chat/:id`.
2. Load stored messages in the route loader or a query and pass them to `useChat({ id, messages })`.
3. Save in the server route's `onEnd` callback of `toUIMessageStream`, which receives the full `messages` list including the new reply.
4. Validate stored messages with `validateUIMessages` when loading them back, since tool schemas may have changed since they were saved.

Pass `generateMessageId: createIdGenerator({ prefix: 'msg', size: 16 })` in `toUIMessageStream` so assistant message ids are created on the server and stay stable across reloads.

## Send only the last message to the server

By default the transport sends the whole history on every request. When the server stores the conversation, send only the new message and the chat id, and let the server load the rest:

```ts
new DefaultChatTransport({
  api: '/api/chat',
  prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
    body: { id, trigger, messageId, message: messages.at(-1) },
  }),
})
```

On the server, load the stored messages for `id`, append `message` (or, for `trigger: 'regenerate-message'`, drop the last assistant reply), validate, and continue as usual. This shrinks requests and stops clients from rewriting history.

## Resume a stream after a reload or network drop

With `useChat({ resume: true })`, the hook calls the transport's `reconnectToStream` on mount and continues an unfinished reply. The server must keep producing the stream after the client disconnects and offer a GET endpoint that replays it. A common setup stores the stream in Redis with the `resumable-stream` package and records the active stream id per chat. Resumption conflicts with Stop (an aborted request looks like a disconnect), so decide which one the product needs; `stop()` then has to cancel the server-side generation through a separate request.

## Client-side tools with onToolCall and addToolOutput

A tool without `execute` on the server is executed by the client: the model asks, `onToolCall` runs in the browser, and you return the result:

```tsx
const chat = useChat<ChatMessage>({
  transport: new DefaultChatTransport({ api: '/api/chat' }),
  sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,     // continue once every client tool has output
  async onToolCall({ toolCall }) {
    if (toolCall.dynamic) return
    if (toolCall.toolName === 'getLocalTime') {
      void chat.addToolOutput({ tool: 'getLocalTime', toolCallId: toolCall.toolCallId, output: { iso: new Date().toISOString(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone } })
    }
  },
})
```

Do not `await` `addToolOutput` inside `onToolCall`; it can deadlock the chat's job queue. Tools that need the user (a confirmation, a choice) render a UI in the tool part and call `addToolOutput` from the button's handler; report failures with `state: 'output-error'` and `errorText`.

## File and image attachments

`sendMessage` accepts files as a `FileList` from an input or as file parts; the transport sends them as data URLs inside the message, so keep them small or upload first and send URLs:

```tsx
const [files, setFiles] = useState<FileList | undefined>()
<input type="file" accept="image/*,application/pdf" multiple onChange={(e) => setFiles(e.target.files ?? undefined)} />
// on submit
void sendMessage({ text: input, files }); setFiles(undefined)
```

Render `file` parts as thumbnails for images (`part.mediaType.startsWith('image/')`) and as links otherwise. For large files, upload to storage with a presigned URL and send `{ type: 'file', mediaType, url }` parts.

## Editing a sent message

To let the user edit an earlier message and re-ask, replace that message and drop everything after it, then send:

```ts
function editMessage(messageId: string, newText: string) {
  void sendMessage({ text: newText, messageId })     // replaces the message with this id and regenerates from there
}
```

Show edited messages as edited, and warn that later replies will be replaced.

## Streaming custom data parts from the server

Status, progress or citations that are not model text can stream as typed `data-*` parts with `createUIMessageStream`:

```ts
const stream = createUIMessageStream<ChatMessage>({
  execute: async ({ writer }) => {
    writer.write({ type: 'data-status', id: 'status', data: { step: 'searching' } })   // same id updates in place
    const result = streamText({ model, instructions, messages: await convertToModelMessages(uiMessages) })
    writer.merge(toUIMessageStream({ stream: result.stream }))
  },
  onError: () => 'Something went wrong.',
})
return createUIMessageStreamResponse({ stream })
```

On the client, render `part.type === 'data-status'`, or receive transient data in `useChat`'s `onData` callback without storing it in the message.

## Model choice and limits on the server

Keep the model id in configuration, not in client code. Set `maxOutputTokens`, a request timeout (`timeout`), and `maxRetries` on `streamText`; cap the history length you send to the model (summarize or drop old turns) to control cost and context size; and log token usage from the stream's end event per user for quotas.
