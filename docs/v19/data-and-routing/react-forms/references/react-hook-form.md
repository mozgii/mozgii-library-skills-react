---
title: React Hook Form recipes
author: MOZGII, Inc.
lang: en
---

# React Hook Form recipes

Patterns for React Hook Form 7.91 beyond a flat form: dynamic rows, controlled UI-kit inputs, values that depend on other fields, multi-step wizards, resetting after load, and testing. The schema examples use Zod 4 with `@hookform/resolvers` 6.

## Contents

This page, React Hook Form recipes, has these sections.

1. Dynamic rows with useFieldArray
2. Controlled third-party inputs with Controller
3. Dependent fields with useWatch
4. Loading defaults from the server
5. Multi-step wizard with one schema per step
6. Splitting a large form with FormProvider
7. React Hook Form and the React Compiler
8. Testing a React Hook Form form

## Dynamic rows with useFieldArray

`useFieldArray` manages a list of field groups (invoice lines, phone numbers). Use the generated `field.id` as the key, never the index:

```tsx
import { useFieldArray, useForm } from 'react-hook-form'

const Invoice = z.object({
  lines: z.array(z.object({ description: z.string().min(1, 'Required'), qty: z.coerce.number<number>().int().min(1) })).min(1, 'Add at least one line'),
})

function InvoiceForm() {
  const { control, register, handleSubmit, formState: { errors } } = useForm<z.input<typeof Invoice>, unknown, z.output<typeof Invoice>>({
    resolver: zodResolver(Invoice), defaultValues: { lines: [{ description: '', qty: 1 }] },
  })
  const { fields, append, remove } = useFieldArray({ control, name: 'lines' })
  return (
    <form onSubmit={handleSubmit(save)}>
      {fields.map((field, i) => (
        <fieldset key={field.id}>
          <legend>Line {i + 1}</legend>
          <Field label="Description" error={errors.lines?.[i]?.description?.message} {...register(`lines.${i}.description`)} />
          <Field label="Quantity" type="number" error={errors.lines?.[i]?.qty?.message} {...register(`lines.${i}.qty`)} />
          <button type="button" onClick={() => remove(i)} aria-label={`Remove line ${i + 1}`}>Remove</button>
        </fieldset>
      ))}
      {errors.lines?.root && <p role="alert">{errors.lines.root.message}</p>}
      <button type="button" onClick={() => append({ description: '', qty: 1 })}>Add line</button>
      <button type="submit">Save</button>
    </form>
  )
}
```

Array-level errors (`min(1)`) land on `errors.lines.root`. Version 7.81 also added a `<FieldArray control name render>` component for the same job in JSX form.

## Controlled third-party inputs with Controller

Inputs that do not expose a native `ref` and `onChange` (date pickers, selects from UI kits, rich text) connect through `Controller`:

```tsx
import { Controller } from 'react-hook-form'

<Controller
  control={control}
  name="dueDate"
  render={({ field, fieldState }) => (
    <DatePicker label="Due date" value={field.value} onChange={field.onChange} onBlur={field.onBlur} inputRef={field.ref} errorMessage={fieldState.error?.message} />
  )}
/>
```

Pass `field.ref` to the focusable element so focus-on-error works.

## Dependent fields with useWatch

`useWatch` subscribes one component to chosen fields, so only that component re-renders when they change. Put it in a small child, not at the top of the form:

```tsx
function ShippingCost({ control }: { control: Control<OrderInput> }) {
  const [country, express] = useWatch({ control, name: ['country', 'express'] })
  return <output>{formatMoney(shippingFor(country, express))}</output>
}
```

Cross-field validation (end date after start date) belongs in the schema with `.refine` or `.superRefine` and a `path`, so the error lands on the right field.

## Loading defaults from the server

Loading form defaults from the server needs care, because `defaultValues` are read once. To fill a form after data loads, either render the form only when data exists, or pass `values`, which updates the form when the prop changes:

```tsx
const { data } = useQuery(profileQueries.me())
const form = useForm<ProfileInput>({ resolver: zodResolver(Profile), values: data, resetOptions: { keepDirtyValues: true } })
```

`keepDirtyValues` keeps what the user already edited when fresh data arrives. After a successful save, call `reset(savedValues)` so `isDirty` becomes false.

## Multi-step wizard with one schema per step

A wizard validates each step on Next and the whole object on submit. Keep one form instance across steps so values persist, and validate the current step's fields with `trigger`:

```tsx
const steps = [
  { title: 'Account', fields: ['email', 'password'] as const },
  { title: 'Profile', fields: ['displayName', 'country'] as const },
]

async function next() {
  const ok = await trigger(steps[step].fields, { shouldFocus: true })
  if (ok) setStep((s) => s + 1)
}
```

`trigger(names, { shouldTouch: true })` (7.87+) marks validated fields as touched so `mode: 'onTouched'` shows their errors. Put the step in the URL (`?step=2`) when users should be able to come back to it.

## Splitting a large form with FormProvider

`FormProvider` puts the form methods in context, so section components call `useFormContext()` instead of receiving `register` and `control` as props:

```tsx
const methods = useForm<Settings>({ resolver: zodResolver(SettingsSchema) })
<FormProvider {...methods}>
  <form onSubmit={methods.handleSubmit(save)}>
    <NotificationsSection />
    <PrivacySection />
  </form>
</FormProvider>

function PrivacySection() {
  const { register } = useFormContext<Settings>()
  return <Checkbox label="Public profile" {...register('privacy.public')} />
}
```

## React Hook Form and the React Compiler

The React Compiler knows that `useForm()` returns a `watch` function it cannot memoize, and the `incompatible-library` lint rule warns where it is used. Components that call `watch()` are compiled without memoization or skipped. Prefer `useWatch` and `getValues` in handlers; React Hook Form 8 (in beta) improves compiler compatibility.

## Testing a React Hook Form form

Test through the UI: type with `userEvent`, submit, assert messages by role and that the save function received parsed values:

```tsx
test('shows field errors and submits parsed values', async () => {
  const user = userEvent.setup()
  const save = vi.fn().mockResolvedValue(undefined)
  render(<ProfileForm initial={{ displayName: '', email: '' }} save={save} />)

  await user.click(screen.getByRole('button', { name: 'Save' }))
  expect(await screen.findByText('At least 2 characters')).toBeInTheDocument()
  expect(screen.getByLabelText('Display name')).toHaveAttribute('aria-invalid', 'true')

  await user.type(screen.getByLabelText('Display name'), 'Ada')
  await user.type(screen.getByLabelText('Email'), 'ada@example.com')
  await user.type(screen.getByLabelText('Age'), '36')
  await user.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith({ displayName: 'Ada', email: 'ada@example.com', age: 36 }))
})
```
