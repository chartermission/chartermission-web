# Translation (English, French, Arabic)

The member site is written in English. French and Arabic come from two dictionaries keyed by the
English sentence: `dict/fr.ts` and `dict/ar.ts`.

## How text gets translated

- **Plain interface text needs no code.** `tsconfig.json` sets `"jsxImportSource": "@/i18n/jsx"`.
  That JSX runtime is React's own plus one step: when a text child, or a `placeholder`, `title`,
  `alt` or `aria-label`, is a sentence the dictionaries know, it is printed in the page language
  (`jsx/adapt.ts`, `auto.tsx`). Text handed as children to components such as `<Link>` is
  covered the same way.
- **Sentences with a name or number** call the translator themselves:
  `useT()` in client components, `await getT()` in server components, or
  `<T vars={{ name }}>{"Hello {name}"}</T>` in JSX. `{count}` picks plural forms.
- **Country and chapter names** from the API ("Nigeria", "Kenya Chapter", "UK Diaspora Chapter")
  are recognised and printed using the browser's own country names (`places.ts`). That
  includes names inside sentence variables, plus a few phrases the API composes
  ("Trending in …", "Also works in …").
- **What members write is never translated.** Rich text and markdown use React's runtime
  (`/** @jsxImportSource react */`); wrap anything else in `<NoTranslate>`.
- **Dates and numbers** use `useIntlTag()` / `getIntlTag()` (`fr-FR`, `ar-u-nu-latn`, `en-GB`).

## Adding or changing text

1. Write the English in the component as usual.
2. Add the sentence and its translation to `dict/fr.ts` and `dict/ar.ts` (same key in both).
   For `{count}` sentences use `{ one, other }`. Add the English singular to `dict/en.ts`.
3. If a sentence changes in English, change its key in both dictionaries too, or it falls
   back to English.

## Things to keep in mind

- A client hook (`useT`, `useIntlTag`) can't be called from a server component. Helpers that
  server pages call (`deadlineChip`, `followersLabel`…) live in plain modules with no
  `"use client"`, and take `t` / `intl` as arguments.
- Country names that differ between Node and browsers are pinned in `places.ts` so the
  server-rendered page and the browser agree.
- Error messages from the API, emails and the admin console are still English only.
