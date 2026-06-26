---
name: ask
description: Ask the user a multiple-choice question with an interactive in-app card — pause for their decision, then continue with the option they pick or the custom instructions they type.
triggers:
  - ask the user
  - ask me
  - which option
  - which one
  - let me choose
  - give me options
  - which do you prefer
  - up to you
  - your call
  - clarify
  - confirm with me
  - quiz me
  - test me
  - multiple choice
tools:
  - name: ask_user
    description: Pose a multiple-choice question to the user and wait for their answer. Renders a numbered card in the chat; the user clicks an option or writes their own instructions, then your loop resumes with their choice.
    parameters:
      question:
        type: string
        description: The question or decision to put to the user. One clear line, e.g. "Which database should I use?".
      details:
        type: string
        required: false
        description: Optional extra context shown under the question — why you're asking, or what each choice affects.
      options:
        type: array
        description: 'The choices to offer, in display order. Give 2–5 focused, distinct options. Each item is an object with a required "label" (the choice text shown) and an optional "description" (a short clarifying line under it).'
        items:
          type: object
          properties:
            label:
              type: string
              description: The choice text shown to the user, e.g. "Use PostgreSQL".
            description:
              type: string
              description: Optional short clarifying line shown under the label.
          required:
            - label
      allow_other:
        type: boolean
        required: false
        description: Whether to show the free-text "something else" escape hatch so the user can type their own instructions instead of picking a listed option. Defaults to true; set false only when the listed options are genuinely exhaustive.
      other_label:
        type: string
        required: false
        description: Optional custom title for the free-text option (defaults to a localized "Something else").
      other_description:
        type: string
        required: false
        description: Optional custom hint for the free-text option (defaults to a localized "Tell wolffish exactly what to do instead").
---

# Ask the user

`ask_user` is how you put a decision back to the user **with concrete choices**
instead of guessing or asking in plain prose. It pauses your turn, shows an
interactive card in the chat — the question, your numbered options each with a
title and a short description, and (unless you turn it off) a free-text box for
the user to write their own instructions — and resumes your loop the moment
they answer. Whatever they choose comes back to you as the tool result, so you
just continue from there.

## When to use it

Reach for `ask_user` when **the next step depends on a choice only the user can
make, and you can frame that choice as a few discrete options**:

- A real fork in the work: which approach, which file, which format, which of
  several candidates to act on.
- Disambiguating a vague request before you spend effort down one path.
- Confirming a consequential direction when there's more than a yes/no at stake.
- Quizzing or prepping the user — pose a question with answer choices and react
  to what they pick.

## When NOT to use it

- **Don't** use it for things you can decide yourself from context, the files,
  or sensible defaults. Asking when you should just act is friction.
- **Don't** use it for a plain open-ended question with no natural options —
  just ask in your normal reply.
- **Don't** stack it: ask one focused question, act on the answer, and only ask
  again if a genuinely new decision appears.

## How to call it

- `question` — one clear line.
- `options` — 2–5 items, each `{ label, description? }`. Keep labels short and
  the choices genuinely distinct. Order them the way you'd recommend.
- `details` — optional context shown under the question.
- `allow_other` — leave it on (default) so the user can always override with
  their own instructions; only set `false` when your options are exhaustive.

```
ask_user({
  question: "Which database should I set up?",
  details: "This is for a single-user desktop app, so it'll run locally.",
  options: [
    { label: "SQLite", description: "Zero-config, file-based — simplest for local single-user." },
    { label: "PostgreSQL", description: "Heavier, but room to grow into multi-user later." }
  ]
})
```

## What you get back

The tool result tells you exactly what happened:

- **A listed option** → "The user selected option N: …" — proceed with that
  choice.
- **Their own instructions** → "The user … instead instructed: …" — follow what
  they wrote; it overrides your options.
- **Dismissed / stopped** → they didn't answer (the run was stopped). Don't
  re-ask in a loop; fall back to a sensible default or your plain reply.

After you act on the answer, just keep going — don't re-announce the question.
