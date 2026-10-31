---
title: Presigned, multipart and resumable uploads
author: MOZGII, Inc.
lang: en
---

# Presigned, multipart and resumable uploads

Server and storage setup for uploads that bypass your API: presigned S3 PUT and POST policies, bucket CORS, S3 multipart with presigned parts, Uppy 6 with `@uppy/aws-s3` and `@uppy/tus`, and tus servers. Sources: AWS S3 documentation (presigned URLs, POST policy, multipart upload, CORS), the tus protocol 1.0 specification, the tus-js-client and Uppy 6 documentation and type definitions.

## Presigned PUT URL on the server

The server signs a URL for one key, one content type and a short expiry. The content type only counts if it is really signed, and by default it isn't: `getSignedUrl` in the AWS SDK for JavaScript v3 (`@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`) signs just `host`, so a client can send any `Content-Type` and walk past your allowlist. Pass `signableHeaders` to bind it. The client's default checksum setting also adds `x-amz-checksum-crc32=AAAAAA==`, the CRC32 of an empty body, to the URL; `requestChecksumCalculation: 'WHEN_REQUIRED'` leaves it out. In a route handler:

```ts
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'

const s3 = new S3Client({ region: process.env.AWS_REGION, requestChecksumCalculation: 'WHEN_REQUIRED' })
const MAX = 2 * 1024 ** 3
const ALLOWED = new Set(['image/png', 'image/jpeg', 'application/pdf', 'video/mp4'])

export async function createUpload(user: { id: string }, input: { name: string; size: number; type: string }) {
  if (!ALLOWED.has(input.type)) throw new HttpError(415, 'Type not allowed')
  if (input.size > MAX) throw new HttpError(413, 'Too large')
  const key = `uploads/${user.id}/${randomUUID()}`
  const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: process.env.BUCKET, Key: key, ContentType: input.type }), {
    expiresIn: 300,
    signableHeaders: new Set(['content-type']),         // without this the URL signs only host
  })
  const uploadId = await db.upload.create({ key, userId: user.id, expectedSize: input.size, status: 'pending' })
  return { uploadId, url, headers: { 'Content-Type': input.type } }
}
```

Prove the binding on a real URL: `X-Amz-SignedHeaders` must read `content-type;host`, and a PUT with a different `Content-Type` must fail with 403 `SignatureDoesNotMatch`. A presigned PUT cannot limit the body size: the client could upload more than it declared. Check the real size with a `HeadObject` request in the completion step and delete objects that do not match, or use a POST policy.

## POST policy uploads with a size limit

A presigned POST signs a policy with conditions S3 enforces, including `content-length-range`. The browser sends `multipart/form-data` with the policy fields first and the file last. `@aws-sdk/s3-presigned-post`'s `createPresignedPost` builds the URL and fields:

```ts
const { url, fields } = await createPresignedPost(s3, {
  Bucket: process.env.BUCKET!, Key: key, Expires: 300,
  Conditions: [['content-length-range', 1, MAX], ['eq', '$Content-Type', input.type]],
  Fields: { 'Content-Type': input.type },
})
```

## Bucket CORS for browser uploads

The browser preflights the cross-origin PUT or POST. The bucket must allow your origin, the method and the headers you send, and expose `ETag` so multipart can read part ETags:

```json
[{
  "AllowedOrigins": ["https://app.example.com"],
  "AllowedMethods": ["PUT", "POST"],
  "AllowedHeaders": ["Content-Type", "Content-MD5", "x-amz-*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3000
}]
```

Never use `"AllowedOrigins": ["*"]` on a bucket that accepts writes. Cloudflare R2, Google Cloud Storage and Azure Blob Storage have equivalent CORS settings with different formats.

## S3 multipart uploads with presigned parts

Multipart splits a file into parts of 5 MiB or more (up to 10,000 parts), uploads them in parallel, and completes with the list of part numbers and ETags. A failed part is retried alone. The server presigns `CreateMultipartUpload`, each `UploadPart`, and `CompleteMultipartUpload`; it also needs `AbortMultipartUpload` for cancellation, and a bucket lifecycle rule that aborts incomplete multipart uploads after a day, or abandoned parts are billed forever.

## Uppy 6 with @uppy/aws-s3

Uppy 6's S3 plugin decides per file between a single PUT and multipart (multipart above 100 MB by default) and asks your function to presign each request:

```ts
import Uppy from '@uppy/core'
import AwsS3 from '@uppy/aws-s3'

const uppy = new Uppy({ restrictions: { maxFileSize: 2 * 1024 ** 3, allowedFileTypes: ['image/*', '.pdf'] } })
  .use(AwsS3, {
    shouldUseMultipart: (file) => (file.size ?? 0) > 100 * 1024 * 1024,
    signRequest: async (request) => {
      // request.method and request.key always; uploadId and partNumber for multipart parts
      const res = await fetch('/api/s3/sign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })
      if (!res.ok) throw new Error(`Signing failed: HTTP ${res.status}`)
      return res.json()          // { url, headers?, key?, fields? }
    },
  })
```

The server endpoint must authorize every request it signs: check that the key belongs to the user, and refuse `DELETE` or other methods the user should not perform. Instead of `signRequest`, the plugin also accepts `companionEndpoint` (Uppy's Companion server) or `getCredentials` with temporary STS credentials.

## Uppy 6 in React with headless hooks

`@uppy/react` 6 provides a context and hooks, so you can build your own UI on Uppy's queue:

```tsx
import { UppyContextProvider, useUppyState } from '@uppy/react'

import Uppy from '@uppy/core'
import Tus from '@uppy/tus'
import { useEffect, useState } from 'react'

export function Uploader() {
  const [uppy, setUppy] = useState<Uppy | null>(null)
  useEffect(() => {
    const instance = new Uppy().use(Tus, { endpoint: '/files/' })
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the effect owns the instance, so only it can hand it over
    setUppy(instance)
    return () => instance.destroy()
  }, [])
  if (!uppy) return <p role="status">Preparing uploads…</p>
  return <UppyContextProvider uppy={uppy}><MyUploader uppy={uppy} /></UppyContextProvider>
}

function MyUploader({ uppy }: { uppy: Uppy }) {
  const total = useUppyState(uppy, (s) => s.totalProgress)
  const files = useUppyState(uppy, (s) => Object.values(s.files))
  return <p>{files.length} file(s), {total}%</p>
}
```

Create the Uppy instance inside the effect that destroys it. `uppy.destroy()` removes every plugin for good, so an instance kept in lazy `useState` and destroyed in a cleanup comes back dead from Strict Mode's mount, cleanup, mount cycle: the state still holds it, with no uploader attached.

## The tus protocol and servers

tus is an open HTTP protocol for resumable uploads: the client creates an upload (`POST`), sends chunks (`PATCH` with `Upload-Offset`), and after an interruption asks the server for the current offset (`HEAD`) and continues. Servers: `tusd` (Go, the reference server, stores to disk, S3, GCS or Azure), `@tus/server` for Node.js, and hosted services. Protect the tus endpoint with the same authentication as your API and hook its completion event to register the file.

## tus-js-client options that matter

| Option | Use |
|---|---|
| `endpoint` | the server's creation URL |
| `chunkSize` | set when a proxy limits request size; leave unset otherwise for one long request |
| `retryDelays` | backoff delays in milliseconds; `null` disables retries |
| `metadata` | file name and type sent in `Upload-Metadata` |
| `storeFingerprintForResuming` | keep the fingerprint in `localStorage` (default on) |
| `removeFingerprintOnSuccess` | clean up after success so storage does not grow |
| `onShouldRetry` | refuse to retry on 4xx authorization errors |
| `parallelUploads` | split one file into parallel uploads, if the server supports the concatenation extension |

`findPreviousUploads()` returns earlier uploads of the same file; pass one to `resumeFromPreviousUpload()` before `start()`.

## Completing an upload on the server

Whatever the transport, the upload is not usable until the server confirms it:

1. Verify the object exists and its size matches what was declared.
2. Sniff the content type from the first bytes; compare with the allowed list.
3. Scan for malware before the file is shared with others.
4. For images, re-encode server-side to strip metadata and neutralize crafted files.
5. Mark the record ready and only then show it to other users.
