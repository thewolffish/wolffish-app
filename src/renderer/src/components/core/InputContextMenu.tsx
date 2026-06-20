import { ContextMenuPopup, type ContextMenuEntry } from '@components/core/ContextMenu'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Position = { x: number; y: number }
type Translate = (key: string) => string

// Input types that hold editable text. Non-text controls (checkbox, file,
// button, range, color, date…) are intentionally excluded — a copy/paste menu
// makes no sense there.
const TEXT_INPUT_TYPES = new Set([
  '',
  'text',
  'search',
  'url',
  'tel',
  'password',
  'email',
  'number'
])

type Field =
  | { kind: 'value'; el: HTMLInputElement | HTMLTextAreaElement; editable: boolean }
  | { kind: 'contenteditable'; el: HTMLElement; editable: boolean }

/** Resolve the editable field under the event target, or null if there isn't one. */
function resolveField(target: EventTarget | null): Field | null {
  if (!(target instanceof Element)) return null
  if (target instanceof HTMLTextAreaElement) {
    return { kind: 'value', el: target, editable: !target.disabled && !target.readOnly }
  }
  if (target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)) {
    return { kind: 'value', el: target, editable: !target.disabled && !target.readOnly }
  }
  const ce = target.closest<HTMLElement>('[contenteditable]')
  if (ce) {
    return {
      kind: 'contenteditable',
      el: ce,
      editable: ce.getAttribute('contenteditable') !== 'false'
    }
  }
  return null
}

/**
 * Selection range for inputs/textareas, or null when the control doesn't expose
 * one (e.g. number/email inputs return null and may throw on access).
 */
function readRange(
  el: HTMLInputElement | HTMLTextAreaElement
): { start: number; end: number } | null {
  try {
    const { selectionStart, selectionEnd } = el
    if (selectionStart === null || selectionEnd === null) return null
    return { start: selectionStart, end: selectionEnd }
  } catch {
    return null
  }
}

/**
 * Set a value the way React expects for controlled inputs: write through the
 * native prototype setter (bypassing React's instance-level value tracker) and
 * dispatch a bubbling 'input' event so the owning component's onChange fires and
 * its state stays in sync. Plain uncontrolled inputs are updated all the same.
 */
function setValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

function valueItems(
  el: HTMLInputElement | HTMLTextAreaElement,
  editable: boolean,
  t: Translate
): ContextMenuEntry[] {
  const range = readRange(el)
  const hasSelection = range ? range.start !== range.end : false
  return [
    {
      label: t('common.contextMenu.selectAll'),
      action: () => {
        el.focus()
        el.select()
      },
      disabled: !el.value
    },
    {
      label: t('common.contextMenu.copy'),
      action: () => {
        const text = hasSelection && range ? el.value.slice(range.start, range.end) : el.value
        void navigator.clipboard.writeText(text)
      },
      disabled: !el.value
    },
    {
      label: t('common.contextMenu.paste'),
      action: async () => {
        const text = await navigator.clipboard.readText()
        if (!text) return
        el.focus()
        const r = readRange(el)
        if (r) {
          setValue(el, el.value.slice(0, r.start) + text + el.value.slice(r.end))
          const caret = r.start + text.length
          el.setSelectionRange(caret, caret)
        } else {
          setValue(el, text)
        }
      },
      disabled: !editable
    },
    { separator: true as const },
    {
      label: t('common.contextMenu.clear'),
      action: () => {
        el.focus()
        setValue(el, '')
      },
      disabled: !editable || !el.value
    }
  ]
}

function contentEditableItems(
  el: HTMLElement,
  editable: boolean,
  t: Translate
): ContextMenuEntry[] {
  const content = el.textContent ?? ''
  return [
    {
      label: t('common.contextMenu.selectAll'),
      action: () => {
        el.focus()
        document.execCommand('selectAll')
      },
      disabled: !content
    },
    {
      label: t('common.contextMenu.copy'),
      action: () => {
        const selected = window.getSelection()?.toString()
        void navigator.clipboard.writeText(selected || content)
      },
      disabled: !content
    },
    {
      label: t('common.contextMenu.paste'),
      action: async () => {
        const text = await navigator.clipboard.readText()
        if (!text) return
        el.focus()
        document.execCommand('insertText', false, text)
      },
      disabled: !editable
    },
    { separator: true as const },
    {
      label: t('common.contextMenu.clear'),
      action: () => {
        el.focus()
        document.execCommand('selectAll')
        document.execCommand('delete')
      },
      disabled: !editable || !content
    }
  ]
}

/**
 * App-wide right-click menu (Select all / Copy / Paste / Clear) for every text
 * input, textarea and contenteditable surface. Mounted once at the root: a single
 * delegated listener covers fields anywhere in the tree without per-field wiring.
 *
 * Components that render their own context menu call preventDefault first (e.g.
 * the chat composer), so this defers to them via the defaultPrevented guard.
 */
export function InputContextMenu(): React.JSX.Element | null {
  const { t } = useTranslation()
  const [state, setState] = useState<{ position: Position; items: ContextMenuEntry[] } | null>(null)
  const close = useCallback(() => setState(null), [])

  useEffect(() => {
    const onContextMenu = (e: MouseEvent): void => {
      if (e.defaultPrevented) return
      const field = resolveField(e.target)
      if (!field) return
      const items =
        field.kind === 'value'
          ? valueItems(field.el, field.editable, t)
          : contentEditableItems(field.el, field.editable, t)
      e.preventDefault()
      setState({ position: { x: e.clientX, y: e.clientY }, items })
    }
    document.addEventListener('contextmenu', onContextMenu)
    return () => document.removeEventListener('contextmenu', onContextMenu)
  }, [t])

  if (!state) return null
  return <ContextMenuPopup items={state.items} position={state.position} onClose={close} />
}
