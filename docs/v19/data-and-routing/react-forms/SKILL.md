---
name: react-forms
description: Builds React forms that validate, submit and report errors well - React 19 form Actions with useActionState, useFormStatus and useOptimistic, React Hook Form 7 with Zod 4 through @hookform/resolvers 6, schema-shared validation, server errors mapped to fields, field arrays, accessible labels and error messages, and when TanStack Form fits. Use when building any form, sign-up or settings page, choosing between native actions and a form library, wiring Zod validation, showing server errors, adding dynamic rows, or when inputs lag, reset unexpectedly or switch between controlled and uncontrolled.
metadata:
  tags:
  - react
  - forms
  - actions
  - useactionstate
  - react-hook-form
  - zod
  - validation
  - accessibility
---

# React forms

A good form shows each error next to its field, keeps what the user typed, stops double submits, and works with a keyboard and a screen reader. React 19 handles small forms natively with Actions; larger forms with many fields, dependent validation or dynamic rows use React Hook Form. This skill covers React 19.3, `react-hook-form` 7.91, `@hookform/resolvers` 6.0 and `zod` 4.6.

## Step 0: read the installed form libraries

The installed versions of React Hook Form, `@hookform/resolvers` and Zod decide which APIs work, because resolver and schema majors must match:

```bash
node -p "['react','react-hook-form','@hookform/resolvers','zod','@tanstack/react-form'].map(p=>{for(const f of [p+'/package.json','./node_modules/'+p+'/package.json'])try{return p+' '+require(f).version}catch{}return p+' missing'}).join('\n')"
```

`@hookform/resolvers` 6 changed only the Effect resolver (now Effect 4); the Zod resolver works with Zod 3 and 4. React Hook Form 8 is in beta; this skill targets 7.

## Choose native Actions or a form library

Choosing between native React 19 form Actions and a form library depends on the form's size and behaviour:

| The form | Use | Why the alternatives lose |
|---|---|---|
| A few fields, validate on submit, one server call | React 19 `<form action>` with `useActionState` | a form library adds a dependency and a mental model for three fields |
| Validation while typing, many fields, dependent fields, dynamic rows, wizards | React Hook Form with a Zod schema | native Actions re-render and reset the whole form and have no field-level state or field arrays |
| Deeply typed field-level validation, framework-agnostic form logic | TanStack Form (`@tanstack/react-form` 1.x) | React Hook Form's types are looser around nested and dynamic field paths |
| A single input that saves on blur | a fetcher or mutation, no form library (`react-router-data-mode`, `react-data-fetching`) | a `<form>` with submit and reset semantics is the wrong model for one field |
| File selection and upload with progress | a dedicated upload flow (`react-file-uploads`) | form libraries keep values, not upload progress, retries or chunking |

## React 19 form Actions with useActionState

An Action is a function passed to `<form action>`; React calls it with the `FormData` on submit, tracks pending state, and resets uncontrolled fields after it succeeds. `useActionState` adds the result of the last submission:

```tsx
import { useActionState } from 'react'
import { z } from 'zod'

const Signup = z.object({ email: z.email('Enter a valid email'), name: z.string().min(2, 'At least 2 characters') })
type State = { errors?: Partial<Record<'email' | 'name' | 'form', string | undefined>>; values?: { email: string; name: string } }

async function signupAction(_prev: State, formData: FormData): Promise<State> {
  const values = { email: String(formData.get('email') ?? ''), name: String(formData.get('name') ?? '') }
  const parsed = Signup.safeParse(values)
  if (!parsed.success) {
    const f = z.flattenError(parsed.error).fieldErrors
    return { values, errors: { email: f.email?.[0], name: f.name?.[0] } }
  }
  try {
    const res = await fetch('/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.data) })
    if (res.status === 409) return { values, errors: { email: 'This email is already registered' } }
    if (!res.ok) return { values, errors: { form: 'Could not sign up. Try again.' } }
    return {}
  } catch {                                           // a network failure stays in the form, away from the error boundary
    return { values, errors: { form: 'Could not reach the server. Check your connection and try again.' } }
  }
}

export function SignupForm() {
  const [state, action, pending] = useActionState(signupAction, {})
  return (
    <form action={action} noValidate>
      <Field name="email" label="Email" type="email" defaultValue={state.values?.email} error={state.errors?.email} />
      <Field name="name" label="Name" defaultValue={state.values?.name} error={state.errors?.name} />
      {state.errors?.form && <p role="alert">{state.errors.form}</p>}
      <button disabled={pending}>{pending ? 'Signing up…' : 'Sign up'}</button>
    </form>
  )
}
```

- The form resets after a successful Action. Returning `values` and passing them as `defaultValue` keeps input after a failed one.
- `pending` is true from submit until the Action returns, which blocks double submits.
- From React 19.3 `onReset` fires when React resets the form after an Action, and `submit` events carry `submitter`, so a form with two buttons (`name="intent"` on each) can tell them apart.
- An error thrown (not returned) from the Action goes to the nearest error boundary; return expected errors as state.

## useFormStatus for submit buttons

`useFormStatus` (from `react-dom`) reads the pending state of the enclosing `<form>`, so a shared submit button needs no props:

```tsx
import { useFormStatus } from 'react-dom'

export function SubmitButton({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus()
  return <button type="submit" disabled={pending} aria-disabled={pending}>{pending ? 'Saving…' : children}</button>
}
```

It must render inside the `<form>`; called in the component that renders the form, it always reports not pending.

## useOptimistic for instant feedback

`useOptimistic` shows a value immediately while an Action runs and falls back to the real state when it ends:

```tsx
import { useOptimistic, useState } from 'react'

function Messages({ messages, send }: { messages: Message[]; send: (text: string) => Promise<void> }) {
  const [shown, addOptimistic] = useOptimistic(messages, (cur, text: string) => [...cur, { id: `tmp-${cur.length}`, text, sending: true }])
  const [failed, setFailed] = useState('')
  async function formAction(formData: FormData) {
    const text = String(formData.get('text'))
    setFailed('')
    addOptimistic(text)
    try {
      await send(text)                                // parent updates `messages` on success
    } catch {
      setFailed(`Could not send "${text}". Try again.`)   // the optimistic row goes away when the Action ends
    }
  }
  return (
    <>
      <ul>{shown.map((m) => <li key={m.id} aria-busy={m.sending}>{m.text}</li>)}</ul>
      {failed && <p role="alert">{failed}</p>}
      <form action={formAction}><input name="text" aria-label="Message" /><SubmitButton>Send</SubmitButton></form>
    </>
  )
}
```

Call the optimistic setter inside an Action or `startTransition`; outside one, React warns and the value never shows.

## React Hook Form with a Zod schema

React Hook Form keeps field values in refs and re-renders only what subscribes, so large forms stay fast. The Zod resolver validates with a schema and infers the types:

```bash
npm i react-hook-form @hookform/resolvers zod
```

```tsx
// src/features/profile/ProfileForm.tsx
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { HttpError } from '@/shared/lib/http'
import { Field } from '@/shared/ui/Field'

// A blank number input gives '' (or NaN with valueAsNumber); coercing '' gives 0, so map both to undefined first.
const blankToUndefined = (v: string | number | undefined) => (v === '' || Number.isNaN(v) ? undefined : v)

const Profile = z.object({
  displayName: z.string().trim().min(2, 'At least 2 characters'),
  email: z.email('Enter a valid email'),
  age: z.preprocess(blankToUndefined, z.coerce.number<number>().int().min(13, 'You must be 13 or older').optional()),
})
export type ProfileInput = z.input<typeof Profile>
export type ProfileOutput = z.output<typeof Profile>

export function ProfileForm({ initial, save }: { initial: ProfileInput; save: (v: ProfileOutput) => Promise<void> }) {
  const { register, handleSubmit, setError, formState: { errors, isSubmitting } } =
    useForm<ProfileInput, unknown, ProfileOutput>({ resolver: zodResolver(Profile), defaultValues: initial, mode: 'onTouched' })

  const onSubmit = handleSubmit(async (values) => {
    try { await save(values) }
    catch (e) {
      if (e instanceof HttpError && e.status === 409) setError('email', { message: 'This email is taken' })
      else setError('root.server', { message: 'Could not save. Try again.' })
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <Field label="Display name" error={errors.displayName?.message} {...register('displayName')} />
      <Field label="Email" type="email" error={errors.email?.message} {...register('email')} />
      <Field label="Age" type="number" error={errors.age?.message} {...register('age')} />
      {errors.root?.server && <p role="alert">{errors.root.server.message}</p>}
      <button type="submit" disabled={isSubmitting}>Save</button>
    </form>
  )
}
```

- `HttpError` is the error class the app's fetch wrapper throws on a non-2xx response, with the HTTP `status` on it; use whatever your client throws.
- `mode: 'onTouched'` validates a field after the user leaves it, then on every change; it avoids errors while typing for the first time.
- `useForm<Input, Context, Output>` keeps the raw input type (strings from inputs) apart from the parsed output (numbers, trimmed strings).
- An optional number field needs `z.preprocess`: `z.coerce.number()` turns a blank field's `''` into `0`, so `.min(13).optional()` fails and `save` never runs. Annotating the preprocessor's parameter (`v: string | number | undefined`) keeps `z.input` precise instead of `unknown`.
- Map server errors to fields with `setError`; `root.*` keys hold form-level errors.
- More: field arrays, controlled third-party inputs, wizards, dependent fields and React Compiler notes in [react-hook-form.md](references/react-hook-form.md).

## Accessible form fields

An accessible field has a visible label tied to the input, an error linked with `aria-describedby`, and `aria-invalid` when wrong. Build it once and reuse it:

```tsx
import { useId, type ComponentProps } from 'react'

type FieldProps = { label: string; error?: string | undefined; hint?: string | undefined } & ComponentProps<'input'>

export function Field({ label, error, hint, ref, ...input }: FieldProps) {
  const id = useId()
  const describedBy = [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} ref={ref} aria-invalid={!!error} aria-describedby={describedBy} {...input} />
      {hint && <p id={`${id}-hint`} className="hint">{hint}</p>}
      {error && <p id={`${id}-error`} className="error">{error}</p>}
    </div>
  )
}
```

- After a failed submit, move focus to the first invalid field (React Hook Form does this with `shouldFocusError`, on by default).
- Placeholders are not labels; they vanish when typing and have poor contrast.
- Mark required fields in the label text, not only with colour or an asterisk.
- `noValidate` on the form turns off browser bubbles so your messages show consistently; keep `type="email"` and `autoComplete` for keyboards and autofill.

## Share one schema between client and server

One Zod schema in a shared module validates on the client for fast feedback and on the server for safety. The server must validate again: anything the client checks can be bypassed.

```ts
// shared/schemas/profile.ts
export const Profile = z.object({ displayName: z.string().trim().min(2), email: z.email() })
export type Profile = z.infer<typeof Profile>
```

Zod 4 notes: string formats are top-level (`z.email()`, `z.url()`, `z.uuid()`); `z.flattenError(err)` and `z.treeifyError(err)` replace the `.flatten()` and `.format()` methods; `z.coerce` input types are `unknown`, so give the output type (`z.coerce.number<number>()`) when a form library needs a precise input type; `z.coerce.number()` turns `''` into `0`, so wrap an optional number in `z.preprocess` that maps `''` to `undefined`.

## TanStack Form as an alternative

TanStack Form 1.x is a headless, strongly typed form library with field-level and form-level validators and Standard Schema support (Zod, Valibot, ArkType). Its render-prop `form.Field` API keeps re-renders per field. Choose it when you want validation logic typed end to end or shared across React and other frameworks; React Hook Form has the larger ecosystem of examples and UI-kit integrations.

## Worked example: an edit screen that loads, validates, saves and confirms

A worked example around `ProfileForm`: the screen loads the profile (pending and error states), renders the form with server defaults, keys it by the record's version so a save resets it to the saved values, and confirms success through a live region that is already mounted:

```tsx
// src/features/profile/EditProfileScreen.tsx
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { http } from '@/shared/lib/http'
import { profileQueries, type Profile } from './api'
import { ProfileForm, type ProfileOutput } from './ProfileForm'

export function EditProfileScreen({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const profile = useQuery(profileQueries.detail(userId))
  const [message, setMessage] = useState('')

  if (profile.isPending) return <p role="status">Loading your profile…</p>
  if (profile.isError) {
    return <div role="alert"><p>Your profile could not be loaded.</p><button type="button" onClick={() => void profile.refetch()}>Try again</button></div>
  }

  async function save(values: ProfileOutput) {
    setMessage('')
    const updated = await http<Profile>(`/api/users/${encodeURIComponent(userId)}`, { method: 'PATCH', body: JSON.stringify(values) })
    queryClient.setQueryData(profileQueries.detail(userId).queryKey, updated)    // ProfileForm maps a thrown HttpError to fields
    setMessage('Profile saved.')
  }

  const { displayName, email, age } = profile.data
  return (
    <section aria-labelledby="profile-title">
      <h1 id="profile-title">Profile</h1>
      <p role="status">{message}</p>
      <ProfileForm key={profile.data.updatedAt} initial={{ displayName, email, age }} save={save} />
    </section>
  )
}
```

- The `key` remounts the form when the server copy changes, so the fields show what was saved; a failed save keeps what the user typed.
- `save` throws on failure, and `ProfileForm` turns a 409 into an email error and anything else into the form-level alert.

## Verify a React form

A form is proven by driving it like a user: submit it empty, fix one field, hit a server error, then succeed with the optional age left blank, then try an age that is too low, with every message reachable by role. Run:

```bash
npx tsc -b && npx oxlint --deny-warnings        # react/incompatible-library warns on watch() the compiler skips
npx vitest run src/features/profile
```

```tsx
test('validates, maps a server error and saves', async () => {
  const user = userEvent.setup()
  const save = vi.fn().mockRejectedValueOnce(new HttpError(409, 'Conflict')).mockResolvedValueOnce(undefined)
  render(<ProfileForm initial={{ displayName: '', email: '' }} save={save} />)
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(screen.getByLabelText('Display name')).toHaveAttribute('aria-invalid', 'true')
  expect(screen.getByLabelText('Display name')).toHaveFocus()                       // shouldFocusError
  await user.type(screen.getByLabelText('Display name'), 'Ada')
  await user.type(screen.getByLabelText('Email'), 'ada@example.com')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('This email is taken')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2))
  expect(save).toHaveBeenLastCalledWith({ displayName: 'Ada', email: 'ada@example.com', age: undefined })   // blank age saves
})

test('an optional age is checked only when filled in', async () => {
  const user = userEvent.setup()
  const save = vi.fn().mockResolvedValue(undefined)
  render(<ProfileForm initial={{ displayName: 'Ada', email: 'ada@example.com' }} save={save} />)
  await user.type(screen.getByLabelText('Age'), '12')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('You must be 13 or older')).toBeInTheDocument()
  expect(save).not.toHaveBeenCalled()
  await user.clear(screen.getByLabelText('Age'))
  await user.type(screen.getByLabelText('Age'), '36')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ displayName: 'Ada', email: 'ada@example.com', age: 36 }))
})
```

- Keyboard pass: Tab through every field, submit with Enter, and hear each error with a screen reader.
- Network tab: one request per submit, even when Save is double-clicked.
- The server rejects the same invalid payload with a 400 when sent directly (`curl -X PATCH` with a bad email); client validation alone proves nothing.

## Pre-merge checklist for a React form

Check each point before merging a form.

1. Tool chosen by form size: Actions for small, React Hook Form or TanStack Form for large.
2. One schema validates on the client and again on the server.
3. Every input has a visible `<label>`, `aria-invalid` and an error linked with `aria-describedby`.
4. Errors appear next to fields; form-level errors in a `role="alert"` region.
5. Submit disabled while pending; double submits impossible.
6. Server errors mapped back to fields (`setError` or returned state).
7. Input kept after a failed submit; reset only after success.
8. Focus moves to the first invalid field after a failed submit.
9. Tested with keyboard only and with a screen reader label check (`react-accessibility`).

## Gotchas and anti-patterns in React forms

Each entry gives the symptom you see, its cause and the fix.

1. **Fields clear after a failed native Action.** Cause: React resets uncontrolled forms after the Action resolves. Fix: return the submitted values and use them as `defaultValue`, or reset only on success with a form library.
2. **`useFormStatus` never reports pending.** Cause: called in the component that renders `<form>`. Fix: call it in a child inside the form.
3. **`A component is changing an uncontrolled input to be controlled`.** Cause: `value` starts `undefined`. Fix: complete `defaultValues` in `useForm`, or use `defaultValue`.
4. **Number field arrives as a string, or a blank optional number blocks Save.** Symptom: `"36"` reaches the server, or an empty Age field shows "You must be 13 or older" (or "expected number, received NaN") and `save` is never called. Cause: inputs always give strings; `z.coerce.number()` turns a blank `''` into `0`, and `register('age', { valueAsNumber: true })` turns it into `NaN`. Fix: `z.preprocess((v) => (v === '' || Number.isNaN(v) ? undefined : v), z.coerce.number<number>().optional())`, which works with either register style.
5. **The React Compiler skips a form component.** Cause: `useForm()`'s `watch` returns a value the compiler cannot memoize (the `incompatible-library` lint warns). Fix: read changing values with `useWatch({ control, name })` in a small child component.
6. **Resolver types do not match the form.** Cause: the input type of a coerced or transformed schema differs from its output. Fix: `useForm<z.input<typeof S>, unknown, z.output<typeof S>>`.
7. **Every keystroke re-renders the whole form.** Cause: `watch()` at the top of a large form, or controlled inputs in a big parent. Fix: `useWatch` in the component that needs the value; keep inputs registered (uncontrolled).
8. **Anti-pattern: a Save button disabled until the form is valid.** Symptom: users cannot tell why they cannot submit, and screen readers skip the disabled button. Cause: validity used as the disabled condition. Fix: keep Save enabled; on submit, show the errors and focus the first one.
9. **Anti-pattern: validating only in the browser.** Symptom: invalid records appear in the database from scripts or old clients. Cause: client checks are a convenience. Fix: the same schema runs on the server.

## See also

- `react-file-uploads`: file inputs, drag and drop, upload progress, resumable uploads.
- `react-accessibility`, `react-data-fetching` (mutations), `react-error-handling` (expected versus unexpected errors).
