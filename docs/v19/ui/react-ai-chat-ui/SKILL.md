---
name: react-ai-chat-ui
description: Builds chat interfaces for large language models in React with the AI SDK 7 (useChat from @ai-sdk/react 4) - the chat transport and status values, streaming replies rendered from message parts, stop, retry and regenerate, error and empty states, tool calls with their input, output and approval states, a server route with streamText, instructions and isStepCount, safe Markdown and code highlighting for partial streams with react-markdown or Streamdown, auto-scroll that respects the reader, accessible announcements, persistence, and keeping API keys and side effects on the server. Use when building an AI assistant, a chat with an LLM, streaming completions, tool-calling or agent UIs, when replies flicker or stutter while streaming, Markdown breaks mid-stream, Stop does not stop, or when upgrading useChat from an older AI SDK.
metadata:
  tags:
  - react
  - ai
  - llm
  - chat
  - ai-sdk
  - usechat
  - streaming
  - markdown
  - tool-calling
---

# React AI chat UI

An AI chat UI sends the conversation to a server route, which calls a model and streams the reply back as typed message parts: text, reasoning, tool calls, sources, files. The client renders parts as they arrive, lets the user stop, retry and edit, and shows tool calls honestly, including ones that wait for approval. The AI SDK's `useChat` handles the stream protocol and state; you design the states and keep keys and side effects on the server. This skill was checked against the AI SDK 7 type definitions; its API differs substantially from versions 3 and 4.

## Step 0: read the installed AI SDK versions

`useChat`'s API changed in every major, so read the versions before writing code:

```bash
node -p "['ai','@ai-sdk/react','@ai-sdk/anthropic','@ai-sdk/openai','react-markdown','remark-gfm','streamdown','shiki','zod'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `ai` 7.0.159, `@ai-sdk/react` 4.0.163, `react-markdown` 10.1.0, `streamdown` 2.7.1, `shiki` 4.5.0. In AI SDK 7: packages are ESM-only; `useChat` takes a `transport` and returns `sendMessage`, `regenerate`, `stop`, `status`; there is no `input` state or `handleSubmit`; the server option `system` is deprecated in favour of `instructions`; `stepCountIs` is renamed `isStepCount` (the old name remains an alias); `result.toUIMessageStreamResponse()` still works but is deprecated in favour of `createUIMessageStreamResponse({ stream: toUIMessageStream({ stream: result.stream }) })`; stream `onFinish` callbacks are renamed `onEnd`. If the project is on AI SDK 4 or 5, read its own docs: the code below does not apply.

## Decision table: how to build the chat

| Need | Use | Why the others lose |
|---|---|---|
| Chat with streaming, tools, approvals, resume | AI SDK `useChat` with `DefaultChatTransport` | a hand-written fetch reader must re-implement the part protocol, tool states and stop |
| One-shot completion (summarize this, rewrite that) | `useCompletion`, or a plain streamed `fetch` | chat state is overhead for a single prompt |
| Streamed structured data (a form filled by the model) | `useObject` with a schema | parsing partial JSON by hand breaks on every chunk |
| A provider's own SDK only, no AI SDK | `fetch` + `ReadableStream` reader + your own state machine | fine for a demo; you rebuild what `useChat` already does |

## Decision table: rendering streamed Markdown

| Renderer | Pick when | Loses when |
|---|---|---|
| Streamdown 2 | the text streams token by token: it closes unterminated code fences, emphasis and links while streaming, highlights code, and has link safety | you need full control of every element's markup |
| `react-markdown` 10 + `remark-gfm` | completed messages, or you memoize finished blocks | unterminated fences flash as plain text while streaming |
| Raw HTML from the model | never | the model's output is untrusted input: an XSS vector |

## The useChat hook in AI SDK 7

`useChat` keeps the messages and the request status, and talks to the server through a transport:

```tsx
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

const { messages, sendMessage, status, stop, regenerate, error, clearError, setMessages, addToolOutput, addToolApprovalResponse } =
  useChat({ transport: new DefaultChatTransport({ api: '/api/chat' }), throttle: 50 })
```

| `status` | Means | Show |
|---|---|---|
| `'submitted'` | request sent, no token yet | a "thinking" indicator, the Stop button |
| `'streaming'` | parts are arriving | the growing reply, the Stop button |
| `'ready'` | idle | the Send button; Regenerate on the last reply |
| `'error'` | the request failed | the error with Retry; keep the user's message |

- `sendMessage({ text })` appends a user message and starts the request; `sendMessage({ text, files })` attaches files.
- `stop()` aborts the stream and keeps the partial reply; `regenerate()` replaces the last assistant reply.
- `throttle` (milliseconds) batches re-renders while streaming; 30 to 60 keeps long replies smooth.
- Keep the input text in your own `useState`: the hook no longer manages it.
- Headers and body per request: pass `headers` and `body` to `DefaultChatTransport`, or `prepareSendMessagesRequest` to shape the request.

## Messages are made of parts

Each `UIMessage` has an `id`, a `role` and `parts`. Render by part type, not by concatenating text:

| Part `type` | Contains |
|---|---|
| `'text'` | `text`, the visible reply (may arrive in pieces) |
| `'reasoning'` | the model's reasoning text, when the provider streams it; show collapsed |
| `` `tool-${name}` `` | a typed tool call: `toolCallId`, `state`, `input`, `output` or `errorText`, `approval` |
| `'dynamic-tool'` | a tool not known at compile time (for example from MCP), with `toolName` |
| `'source-url'`, `'source-document'` | citations to show as links |
| `'file'` | a file or image with `mediaType` and `url` |
| `` `data-${name}` `` | custom data parts your server streams (progress, status) |
| `'step-start'` | a boundary between model steps; render a divider or nothing |

## Tool calls and their states

A tool part moves through states; each needs its own UI:

| `state` | Show |
|---|---|
| `'input-streaming'` | "Preparing search…", the partial `input` |
| `'input-available'` | "Searching for “{input.query}”…" |
| `'approval-requested'` | what the tool will do, with Approve and Deny buttons calling `addToolApprovalResponse({ id: part.approval.id, approved })` |
| `'approval-responded'` | "Approved, running…" or "Denied" |
| `'output-available'` | the result, rendered as a card, not raw JSON |
| `'output-error'` | `errorText` and what the model will do next |
| `'output-denied'` | "You declined this action" |

Mark tools with side effects (sending email, deleting, paying) with `needsApproval` on the server so the model cannot run them unattended. An approval response only updates the message; the request continues when `useChat` has `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` (both from `ai`), or when you call `sendMessage()` yourself. Client-side tools (reading the user's location, asking a question) run in `onToolCall`, and you report the result with `addToolOutput({ tool, toolCallId, output })`.

## The server route with streamText

The server route validates the incoming messages, converts them for the model, streams the reply and returns the UI message stream. It is the only place that holds the API key:

```ts
// app/api/chat/route.ts (or any handler that receives a Request and returns a Response)
import { streamText, convertToModelMessages, createUIMessageStreamResponse, toUIMessageStream, isStepCount, tool, validateUIMessages, type UIMessage } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { z } from 'zod'

const tools = {
  searchDocs: tool({
    description: 'Search the product documentation',
    inputSchema: z.object({ query: z.string().min(2).max(200) }),
    execute: async ({ query }) => searchIndex(query, { limit: 5 }),        // returns [{ title, url, snippet }]
  }),
  createTicket: tool({
    description: 'Open a support ticket for the signed-in user',
    inputSchema: z.object({ title: z.string().max(120), body: z.string().max(4000) }),
    needsApproval: true,                                                     // the user must approve first
    execute: async (input) => tickets.create(input),
  }),
}

export async function POST(req: Request) {
  const user = await requireUser(req)                                         // 401 when signed out
  await rateLimit(user.id)                                                    // 429 when over quota
  const { messages } = (await req.json()) as { messages: unknown }
  const uiMessages = await validateUIMessages<UIMessage>({ messages })        // rejects malformed history
  const result = streamText({
    model: anthropic(process.env.CHAT_MODEL!),
    instructions: 'You are the support assistant for Acme. Answer from the docs; say when you do not know.',
    messages: await convertToModelMessages(uiMessages),
    tools,
    stopWhen: isStepCount(5),                                                 // allow tool call, then answer
    abortSignal: req.signal,                                                  // the client's Stop cancels the model call
  })
  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      originalMessages: uiMessages,
      onError: (e) => { log.error('chat stream failed', e); return 'The assistant failed to answer. Try again.' },   // never leak internals
      onEnd: async ({ messages }) => { await chats.save(user.id, messages) },
    }),
  })
}
```

`convertToModelMessages` is async in AI SDK 7. Never trust a `system` message sent by the client; the default rejects system messages inside `messages`.

## Safe Markdown and code highlighting

Model output is untrusted. Render Markdown without raw HTML, and control links and images:

```tsx
import { Streamdown } from 'streamdown'

<Streamdown isAnimating={isStreamingThisMessage} parseIncompleteMarkdown>{part.text}</Streamdown>
```

- With `react-markdown`, never add `rehype-raw`; links get `rel="noopener noreferrer"` and open external URLs in a new tab; block `javascript:` URLs (React 19.3 blocks them in `href` too).
- Highlight code lazily: load `shiki` with `import()` on the first code block, and highlight only completed blocks, or let Streamdown do it.
- Give code blocks a Copy button with an accessible label and a "Copied" status message.

## Auto-scroll that respects the reader

Follow the stream only while the reader is at the bottom; if they scroll up to read, stop following and show a "Jump to latest" button. Long chats that need virtualization use TanStack Virtual's `anchorTo: 'end'` and `followOnAppend` (see the `react-virtual-lists` skill); short chats can use an `IntersectionObserver` on a sentinel element at the end of the list.

## Worked example: a chat panel with streaming, stop, retry and tools

A complete chat panel: empty state, streamed Markdown, tool cards with approval, Stop and Retry, errors that keep the user's text, and announcements for screen readers:

```tsx
import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses, type UIMessage } from 'ai'
import { Streamdown } from 'streamdown'

type DocHit = { title: string; url: string; snippet: string }

export function ChatPanel({ initialMessages = [] }: { initialMessages?: UIMessage[] }) {
  const [input, setInput] = useState('')
  const { messages, sendMessage, status, stop, regenerate, error, clearError, addToolApprovalResponse } = useChat({
    messages: initialMessages,
    transport: new DefaultChatTransport({ api: '/api/chat' }),
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,   // continue after Approve or Cancel
    throttle: 50,
  })
  const busy = status === 'submitted' || status === 'streaming'

  function submit(e?: FormEvent) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    void sendMessage({ text })
    setInput('')
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit() }
  }

  return (
    <section aria-labelledby="chat-title" className="chat">
      <h2 id="chat-title">Assistant</h2>
      <div className="chat-log" aria-busy={busy}>
        {messages.length === 0 && <p className="muted">Ask about billing, setup or your account. Answers cite the docs.</p>}
        {messages.map((m, mi) => (
          <article key={m.id} aria-label={m.role === 'user' ? 'You' : 'Assistant'} className={`msg msg-${m.role}`}>
            {m.parts.map((part, i) => {
              const key = `${m.id}-${i}`
              switch (part.type) {
                case 'text':
                  return m.role === 'user' ? <p key={key}>{part.text}</p>
                    : <Streamdown key={key} isAnimating={busy && mi === messages.length - 1} parseIncompleteMarkdown>{part.text}</Streamdown>
                case 'reasoning':
                  return <details key={key}><summary>Reasoning</summary><p>{part.text}</p></details>
                case 'tool-searchDocs':
                  if (part.state === 'output-available') {
                    const hits = part.output as DocHit[]
                    return <ul key={key} aria-label="Sources">{hits.map((h) => <li key={h.url}><a href={h.url} rel="noopener noreferrer" target="_blank">{h.title}</a></li>)}</ul>
                  }
                  if (part.state === 'output-error') return <p key={key} role="alert">Search failed: {part.errorText}</p>
                  return <p key={key} className="muted">Searching the docs…</p>
                case 'tool-createTicket':
                  if (part.state === 'approval-requested') {
                    const draft = part.input as { title: string }
                    return (
                      <div key={key} role="group" aria-label="Approval needed" className="tool-card">
                        <p>Open a support ticket “{draft.title}”?</p>
                        <button type="button" onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: true })}>Open ticket</button>
                        <button type="button" onClick={() => addToolApprovalResponse({ id: part.approval.id, approved: false, reason: 'User declined' })}>Cancel</button>
                      </div>
                    )
                  }
                  if (part.state === 'output-available') return <p key={key}>Ticket opened.</p>
                  if (part.state === 'output-denied') return <p key={key} className="muted">You declined to open a ticket.</p>
                  if (part.state === 'output-error') return <p key={key} role="alert">The ticket could not be opened: {part.errorText}</p>
                  return <p key={key} className="muted">Preparing the ticket…</p>
                default:
                  return null
              }
            })}
          </article>
        ))}
        {status === 'submitted' && <p className="muted" aria-hidden>Thinking…</p>}
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {status === 'submitted' ? 'Assistant is thinking' : status === 'streaming' ? 'Assistant is replying' : status === 'ready' && messages.length > 0 ? 'Reply finished' : ''}
      </p>
      {error && (
        <div role="alert" className="chat-error">
          <p>The reply failed. Your message was kept.</p>
          <button type="button" onClick={() => { clearError(); void regenerate() }}>Retry</button>
        </div>
      )}

      <form onSubmit={submit} className="chat-form">
        <label htmlFor="chat-input" className="sr-only">Message</label>
        <textarea id="chat-input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKeyDown}
          rows={2} maxLength={4000} placeholder="Ask a question" aria-describedby="chat-hint" />
        <span id="chat-hint" className="sr-only">Enter sends, Shift+Enter adds a line</span>
        {busy
          ? <button type="button" onClick={() => void stop()}>Stop</button>
          : <button type="submit" disabled={!input.trim()}>Send</button>}
        {!busy && messages.at(-1)?.role === 'assistant' && <button type="button" onClick={() => void regenerate()}>Regenerate</button>}
      </form>
    </section>
  )
}
```

The status line announces "replying" and "finished" once each instead of reading every token; Enter respects IME composition; Stop keeps the partial reply; a failed request keeps the history and offers Retry. Typed tool parts (instead of the casts above) come from `InferUITools<typeof tools>`: [ai-chat-recipes.md](references/ai-chat-recipes.md) shows that, persistence, resumable streams, file attachments and editing a sent message.

## Verify the chat UI

- Throttle to "Slow 4G": the thinking state shows, tokens stream smoothly, Stop ends the request (network panel shows it cancelled) and the partial reply stays.
- Kill the server mid-stream: the error appears with Retry; Retry regenerates without losing earlier messages.
- Ask for code and a table: Markdown renders while streaming, with no flash of raw fences.
- Ask the model to output `<img src=x onerror=alert(1)>` and a `javascript:` link: nothing executes.
- Trigger the approval tool: nothing happens until Approve; Cancel shows the denied state.
- Screen reader: replies are announced once when finished; focus stays in the input after sending.
- `curl` the route without a session: 401; with a forged `system` message in the history: rejected.

## Gotchas and anti-patterns in AI chat UIs

Each gotcha names the symptom, its cause and the fix.

1. **`input`, `handleInputChange` or `handleSubmit` is undefined.** Cause: code written for AI SDK 4. Fix: own the input state and call `sendMessage({ text })`.
2. **The reply arrives all at once.** Cause: a proxy buffers the stream, or the route returns a non-streaming response. Fix: return the UI message stream response (its headers disable buffering) and turn off compression or buffering for the route.
3. **The page stutters on long replies.** Cause: a re-render and a Markdown parse per token. Fix: `throttle: 50`, Streamdown or memoized finished blocks.
4. **Stop does not stop billing.** Cause: the server ignores the abort. Fix: pass `abortSignal: req.signal` to `streamText`.
5. **The model ran a destructive tool unasked.** Cause: side-effect tools without approval. Fix: `needsApproval: true` and an approval UI; authorize the action on the server.
6. **A script runs from the model's reply.** Cause: rendering HTML (`rehype-raw`, `dangerouslySetInnerHTML`). Fix: Markdown without raw HTML; sanitize if HTML is unavoidable.
7. **The API key is in the bundle.** Cause: calling the provider from the browser. Fix: call models only from the server route.
8. **The view jumps to the bottom while the user reads.** Cause: scrolling on every update. Fix: follow only while pinned to the end; offer "Jump to latest".
9. **Screen readers read every token.** Cause: `aria-live` on the message list. Fix: a separate status line announcing start and finish.
10. **Approve does nothing; the tool never runs.** Cause: no automatic resend after the approval response. Fix: `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` in `useChat`.

## Pre-merge checklist for an AI chat UI

1. The installed AI SDK major matches the code (transport, `sendMessage`, `status`).
2. Every `status` has UI: thinking, streaming with Stop, ready with Regenerate, error with Retry.
3. Parts are rendered by type; tools show every state; side-effect tools require approval.
4. Markdown renders safely while streaming; no raw HTML; links are safe.
5. The server authenticates, rate-limits, validates messages, passes the abort signal and hides error details.
6. Auto-scroll follows only when pinned; announcements are once per reply.
7. Conversations are saved on the server in `onEnd`, not in `localStorage` alone.

See also: react-virtual-lists, react-realtime, react-security, react-forms, react-server-components.
