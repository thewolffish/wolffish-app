import { Select, type SelectOption } from '@components/core/Select'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type WhisperModel = {
  id: string
  size: string
  speed: string
  description: string
}

const MODELS: WhisperModel[] = [
  { id: 'tiny', size: '~75 MB', speed: 'Fastest', description: 'Quick previews of long audio' },
  { id: 'base', size: '~150 MB', speed: 'Fast', description: 'Default for most transcription' },
  { id: 'small', size: '~500 MB', speed: 'Moderate', description: 'Better accuracy when it matters' },
  { id: 'medium', size: '~1.5 GB', speed: 'Slow', description: 'High-stakes transcription' },
  { id: 'large', size: '~3 GB', speed: 'Very slow', description: 'Research-grade accuracy' }
]

const FORMATS = ['MP3', 'WAV', 'M4A', 'OGG', 'FLAC', 'WEBM', 'AAC']
const DEFAULT_MODEL = 'base'

export function SpeechToTextPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [model, setModel] = useState(DEFAULT_MODEL)

  // Load the persisted default once on mount; persist on every
  // change so the cerebellum plugin (which re-reads config.json
  // before every transcribe call) picks up new selections without
  // a restart.
  useEffect(() => {
    let cancelled = false
    void window.api.stt.getConfig().then((cfg) => {
      if (cancelled) return
      if (cfg.defaultModel) setModel(cfg.defaultModel)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onModelChange = (next: string): void => {
    setModel(next)
    void window.api.stt.setConfig({ defaultModel: next })
  }

  const modelOptions: SelectOption<string>[] = useMemo(
    () =>
      MODELS.map((m) => ({
        value: m.id,
        label: `${m.id} — ${m.size} (${m.speed.toLowerCase()})`
      })),
    []
  )

  const selectedModel = MODELS.find((m) => m.id === model) ?? MODELS[1]

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.stt.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.stt.subtitle')}
          </p>
        </header>

        <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
          <div className="flex flex-col gap-1">
            <span className="text-muted text-xs font-medium uppercase tracking-wider">
              {t('settings.services.engine')}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-fg text-sm font-medium">OpenAI Whisper</span>
              <span className="bg-border/60 text-muted rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                {t('settings.services.stt.local')}
              </span>
            </div>
            <p className="text-muted text-xs">{t('settings.services.stt.engineDescription')}</p>
          </div>

          <div className="border-border/60 border-t" />

          <div className="flex flex-col gap-2">
            <Select<string>
              label={t('settings.services.stt.model')}
              value={model}
              options={modelOptions}
              onChange={onModelChange}
            />
            <p className="text-muted text-xs">{selectedModel.description}</p>
          </div>

          <div className="border-border/60 border-t" />

          <div className="flex flex-col gap-1">
            <span className="text-muted text-sm font-medium">
              {t('settings.services.stt.language')}
            </span>
            <p className="text-muted text-xs">{t('settings.services.stt.languageDescription')}</p>
          </div>
        </section>

        <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
          <h2 className="text-fg text-sm font-medium">{t('settings.services.stt.modelsTitle')}</h2>
          <div className="divide-border/40 divide-y">
            {MODELS.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
              >
                <div className="flex flex-col">
                  <span className="text-fg text-sm font-medium capitalize">{m.id}</span>
                  <span className="text-muted text-xs">{m.description}</span>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-fg text-xs">{m.size}</span>
                  <span className="text-muted text-xs">{m.speed}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="border-border/60 mt-2 border-t pt-3">
            <h2 className="text-fg text-sm font-medium">
              {t('settings.services.stt.formatsTitle')}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {FORMATS.map((f) => (
                <span
                  key={f}
                  className="bg-border/40 text-muted rounded-md px-2 py-0.5 text-xs font-medium"
                >
                  {f}
                </span>
              ))}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
