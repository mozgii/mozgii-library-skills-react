---
name: react-file-uploads
description: Builds file uploads in React that survive real networks and real users - accessible drop zones with react-dropzone and a file input fallback, client-side checks that guide but never replace server validation, image previews with object URLs, per-file progress with XMLHttpRequest, cancel and retry, upload queues with limited concurrency, presigned direct-to-storage uploads (S3 PUT, POST policy, multipart), and resumable uploads with tus-js-client or Uppy 6. Use when adding an upload field, a drag and drop area, avatar or document uploads, uploading large videos, showing upload progress, uploading straight to S3, R2 or GCS, or when uploads fail on slow connections, time out through the API server, or leak memory with previews.
metadata:
  tags:
  - react
  - file-upload
  - react-dropzone
  - presigned-url
  - s3
  - tus
  - uppy
  - progress
---

# React file uploads

A file upload has four parts: picking files (input, drop, paste), checking them, sending them with progress and a way to cancel, and confirming them on the server. Small files can go through your API; large ones should go straight to object storage with a presigned URL, and very large or unreliable ones need resumable uploads. The server always re-validates: anything the browser checks, a user can bypass.

## Step 0: read the installed upload libraries

The options and the hook API depend on the majors installed:

```bash
node -p "['react','react-dropzone','@uppy/core','@uppy/react','@uppy/tus','@uppy/aws-s3','tus-js-client'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

Written against (October 2026): `react-dropzone` 20.1.4, `@uppy/core` 6.3.0, `@uppy/react` 6.1.0, `@uppy/tus` 6.0.0, `@uppy/aws-s3` 6.3.0, `tus-js-client` 4.3.1. `react-dropzone` 20 accepts pasted files by default (`noPaste` turns it off) and supports async validators. `@uppy/react` 6 has headless hooks (`useDropzone`, `useFileInput`, `useUppyState`) besides the prebuilt Dashboard.

## Decision table: how to send the file

| File and network | Send it with | Why the others lose |
|---|---|---|
| Small (under ~10 MB), needs server processing at once | `multipart/form-data` POST to your API | a presigned flow adds round trips for no gain |
| Any size, stored as-is in S3, R2, GCS or Azure | presigned PUT (or POST policy) straight to the bucket | proxying through the API doubles bandwidth and hits request timeouts |
| Over ~100 MB to S3-compatible storage | S3 multipart with presigned part URLs (Uppy's `@uppy/aws-s3`) | a single PUT restarts from zero on any failure |
| Large files on unreliable networks, resume after reload | tus protocol (`tus-js-client` or Uppy with `@uppy/tus`) and a tus server | multipart cannot resume across a page reload without your own bookkeeping |
| Many sources (camera, URL, cloud drives), full UI | Uppy 6 with plugins | you would rebuild the same queue and UI |

## Decision table: how the user picks files

| Need | Use | Note |
|---|---|---|
| One field in a form | `<input type="file">` with a label | native, accessible, works everywhere |
| A drop area plus a button | `react-dropzone`'s `useDropzone` | handles drag state, paste, `accept`, size and count limits |
| Drops anywhere on a page section | native `dragover`/`drop` handlers | see the `react-drag-and-drop` skill |
| Full upload UI with providers | Uppy Dashboard or its headless hooks | heavier dependency |

## Accessible drop zones with react-dropzone

`useDropzone` returns props for the root element and the hidden input; the root is focusable and opens the file dialog on Enter or Space. Always show a visible button too:

```tsx
import { useDropzone, type FileRejection } from 'react-dropzone'

const { getRootProps, getInputProps, isDragActive, isDragReject, open } = useDropzone({
  accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'application/pdf': ['.pdf'] },
  maxSize: 20 * 1024 * 1024,
  maxFiles: 10,
  noClick: true,                      // the explicit button below opens the dialog
  onDrop: (accepted: File[], rejected: FileRejection[]) => { enqueue(accepted); report(rejected) },
})
<div {...getRootProps({ 'aria-label': 'Upload files: drop here or choose' })} data-active={isDragActive || undefined} data-reject={isDragReject || undefined}>
  <input {...getInputProps()} />
  <p>{isDragActive ? 'Drop to upload' : 'Drag files here, paste them, or'}</p>
  <button type="button" onClick={open}>Choose files</button>
</div>
```

- Rejections carry codes (`file-invalid-type`, `file-too-large`, `file-too-small`, `too-many-files`); turn each into a sentence the user can act on ("report.exe is not a PNG, JPEG or PDF").
- `accept` filters by MIME type and extension, which come from the file name: treat it as a hint. The server checks the real content.
- During a drag the browser hides file names, so `isDragReject` covers only type and count; size and custom checks run after the drop.

## Client-side checks guide, server checks decide

Check early to save the user a wasted upload, but repeat every check on the server:

| Check | Browser | Server |
|---|---|---|
| Type | `accept`, or read the first bytes (magic number) with `file.slice(0, 12).arrayBuffer()` | sniff the content; never trust `Content-Type` or the extension |
| Size | `file.size` against the limit | enforce the limit in the presigned policy or the upload endpoint |
| Image dimensions | `createImageBitmap(file)` | re-encode images to strip metadata and payloads |
| Malware | none | scan before the file is shared or served |
| Name | display only | generate the storage key yourself; never use the user's file name as a path |

## Image previews with object URLs

`URL.createObjectURL(file)` gives an instant local preview without reading the file into memory. Revoke the URL when the preview unmounts, or every preview leaks until the page closes:

```tsx
function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  return url ? <img src={url} alt={`Preview of ${file.name}`} width={96} height={96} style={{ objectFit: 'cover' }} /> : null
}
```

## Upload progress with XMLHttpRequest

`fetch` cannot report upload progress in most browsers. `XMLHttpRequest` can, through `xhr.upload.onprogress`, and `xhr.abort()` cancels:

```ts
export function putWithProgress(url: string, file: File, onProgress: (fraction: number) => void, signal: AbortSignal, headers: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v)
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total) }
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed: HTTP ${xhr.status}`)))
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'))
    signal.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(file)
  })
}
```

Throttle progress updates to the screen (React batches them, but a 2 GB upload fires thousands of events); update an external store per file or round to whole percent before setting state.

## Presigned direct-to-storage uploads

The browser asks your API for a short-lived signed URL, uploads straight to the bucket, then tells your API the upload finished. Your API never handles the bytes:

1. `POST /api/uploads` with name, size and type; the server checks the user's quota and permissions, chooses the object key, and returns `{ uploadId, url, headers }` signed for that key, content type and a few minutes.
2. The browser `PUT`s the file to `url` with exactly the signed headers.
3. `POST /api/uploads/:id/complete`; the server checks the object exists with the expected size (a HEAD request), scans it, and marks it ready.

The bucket needs a CORS rule allowing `PUT` from your origin with the signed headers, and `ExposeHeaders: ["ETag"]` for multipart. A POST policy can enforce `content-length-range`, which a presigned PUT cannot. Server code, CORS, multipart and Uppy setups: [resumable-and-presigned-uploads.md](references/resumable-and-presigned-uploads.md).

## Resumable uploads with tus

The tus protocol uploads in chunks and resumes from the last confirmed byte, even after a reload. `tus-js-client` stores a fingerprint of each upload in `localStorage` so a new session can find it:

```ts
import { Upload } from 'tus-js-client'

const upload = new Upload(file, {
  endpoint: '/files/',
  retryDelays: [0, 1000, 3000, 10000, 20000],
  chunkSize: 8 * 1024 * 1024,
  metadata: { filename: file.name, filetype: file.type },
  removeFingerprintOnSuccess: true,
  onProgress: (sent, total) => setProgress(sent / total),
  onError: (err) => setError(err.message),
  onSuccess: () => setDone(true),
})
const previous = await upload.findPreviousUploads()
if (previous[0]) upload.resumeFromPreviousUpload(previous[0])
upload.start()          // upload.abort() pauses; start() again resumes
```

## Worked example: an upload queue with progress, cancel and retry

A queue that takes dropped, pasted or chosen files, uploads up to three at a time to presigned URLs, and shows progress, errors, cancel and retry per file:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { putWithProgress } from './put-with-progress'

type Item = { id: string; file: File; progress: number; status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled'; error?: string | undefined }
const MAX_PARALLEL = 3

async function presign(file: File, signal: AbortSignal) {
  const res = await fetch('/api/uploads', { method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: file.name, size: file.size, type: file.type }) })
  if (res.status === 413) throw new Error('File is larger than your plan allows.')
  if (!res.ok) throw new Error(`Could not start upload (HTTP ${res.status}).`)
  return (await res.json()) as { uploadId: string; url: string; headers: Record<string, string> }
}

export function UploadQueue() {
  const [items, setItems] = useState<Item[]>([])
  const [notice, setNotice] = useState('')
  const controllers = useRef(new Map<string, AbortController>())
  const patch = (id: string, p: Partial<Item>) => setItems((all) => all.map((i) => (i.id === id ? { ...i, ...p } : i)))

  const run = useCallback(async (item: Item) => {
    const ctrl = new AbortController()
    controllers.current.set(item.id, ctrl)
    patch(item.id, { status: 'uploading', progress: 0, error: undefined })
    try {
      const { uploadId, url, headers } = await presign(item.file, ctrl.signal)
      let last = 0
      await putWithProgress(url, item.file, (f) => { const pct = Math.floor(f * 100); if (pct !== last) { last = pct; patch(item.id, { progress: pct }) } }, ctrl.signal, headers)
      const done = await fetch(`/api/uploads/${uploadId}/complete`, { method: 'POST', signal: ctrl.signal })
      if (!done.ok) throw new Error('The server could not confirm the upload.')
      patch(item.id, { status: 'done', progress: 100 })
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === 'AbortError'
      patch(item.id, cancelled ? { status: 'cancelled' } : { status: 'error', error: e instanceof Error ? e.message : 'Upload failed.' })
    } finally {
      controllers.current.delete(item.id)
    }
  }, [])

  useEffect(() => {                                    // start queued items while slots are free
    const active = items.filter((i) => i.status === 'uploading').length
    items.filter((i) => i.status === 'queued' && !controllers.current.has(i.id))
      .slice(0, Math.max(0, MAX_PARALLEL - active)).forEach((i) => void run(i))
  }, [items, run])
  useEffect(() => () => controllers.current.forEach((c) => c.abort()), [])

  const onDrop = (accepted: File[], rejected: FileRejection[]) => {
    setItems((all) => [...all, ...accepted.map((file) => ({ id: crypto.randomUUID(), file, progress: 0, status: 'queued' as const }))])
    setNotice(rejected.length ? rejected.map((r) => `${r.file.name}: ${r.errors[0]?.message ?? 'rejected'}`).join('. ') : `${accepted.length} file(s) added.`)
  }
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({ onDrop, maxSize: 2 * 1024 ** 3, noClick: true })

  return (
    <section aria-labelledby="up-title">
      <h2 id="up-title">Upload files</h2>
      <div {...getRootProps({ className: isDragActive ? 'dropzone dropzone-active' : 'dropzone' })}>
        <input {...getInputProps()} />
        <p>Drag files here or paste them.</p>
        <button type="button" onClick={open}>Choose files</button>
      </div>
      <p role="status" aria-live="polite">{notice}</p>
      {items.length === 0 ? <p>No files yet.</p> : (
        <ul>
          {items.map((i) => (
            <li key={i.id}>
              <span>{i.file.name}</span>{' '}
              {i.status === 'uploading' && <progress max={100} value={i.progress} aria-label={`Uploading ${i.file.name}`}>{i.progress}%</progress>}
              {i.status === 'queued' && <span>Waiting…</span>}
              {i.status === 'done' && <span>Uploaded</span>}
              {i.status === 'cancelled' && <span>Cancelled</span>}
              {i.status === 'error' && <span role="alert">{i.error}</span>}
              {i.status === 'uploading' && <button type="button" onClick={() => controllers.current.get(i.id)?.abort()}>Cancel</button>}
              {(i.status === 'error' || i.status === 'cancelled') && <button type="button" onClick={() => patch(i.id, { status: 'queued' })}>Retry</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

The queue runs at most three uploads, re-renders only on whole-percent changes, aborts everything on unmount, and keeps failed files in the list with their reason and a retry.

## Verify file uploads

- Throttle to "Slow 3G": progress moves smoothly, Cancel stops the request (network panel shows it cancelled), Retry restarts it.
- Upload a renamed `.exe` as `.png`: the server rejects it although the browser accepted it.
- Replay a presigned PUT with a different `Content-Type`: storage answers 403 `SignatureDoesNotMatch`, because the type is signed.
- Upload a file one byte over the limit: the presign request is refused with a clear message.
- Add and remove 200 previews: memory in the DevTools Memory panel returns to its baseline (object URLs revoked).
- Keyboard only: focus the drop area, press Enter, pick files; screen readers announce the added count and errors.
- For tus: start a large upload, reload the page, start again; it resumes from the last chunk.

## Gotchas and anti-patterns in file uploads

Each gotcha names the symptom, its cause and the fix.

1. **Uploads over a few minutes fail with 504.** Cause: files proxied through an API with a request timeout. Fix: presigned direct uploads, or multipart and tus for large files.
2. **The presigned PUT fails with 403 SignatureDoesNotMatch.** Cause: the browser sent a different `Content-Type` or extra headers than were signed. Fix: send exactly the headers the server signed.
3. **CORS error on the PUT to the bucket.** Cause: no bucket CORS rule for your origin and method. Fix: allow `PUT` from the origin with the signed headers; expose `ETag`.
4. **Memory grows with every preview.** Cause: object URLs never revoked. Fix: revoke in the effect cleanup.
5. **Progress jumps from 0 to 100.** Cause: `fetch` has no upload progress, or the file is tiny. Fix: use `XMLHttpRequest` for progress.
6. **A malicious file passed the check.** Cause: validation only in the browser by extension or `accept`. Fix: sniff content, enforce size and scan on the server.
7. **Files overwrite each other in the bucket.** Cause: the user's file name used as the key. Fix: the server generates keys (`uploads/<user>/<uuid>`).
8. **Users on touch devices cannot add files.** Cause: a drop-only area. Fix: always include a visible "Choose files" button.
9. **A PNG-only upload accepts an HTML file.** Cause: SDK v3's `getSignedUrl` leaves `content-type` out of the signature, so the type the server allowed is not enforced. Fix: pass `signableHeaders: new Set(['content-type'])` and check that `X-Amz-SignedHeaders` reads `content-type;host`.

## Pre-merge checklist for file uploads

1. A visible button and a file input exist beside any drop area; the area is keyboard operable.
2. Client checks give clear messages; the server repeats type, size and content checks.
3. Large files go direct to storage or through multipart or tus; nothing large is proxied.
4. Each file shows progress, can be cancelled and retried; errors stay visible with a reason.
5. Previews revoke their object URLs; queued uploads abort on unmount.
6. Presigned URLs sign the content type; the server confirms each upload (size, existence, scan) before using it.
7. Tested on a throttled network, with a forged file and at the size limit.

See also: react-drag-and-drop, react-forms, react-security, react-data-fetching.
