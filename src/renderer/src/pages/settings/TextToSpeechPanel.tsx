import { Select, type SelectOption } from '@components/core/select/Select'
import { cn } from '@lib/utils/cn/cn'
import { PauseIcon, PlayIcon } from 'hugeicons-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Voice = {
  id: string
  label: string
  lang: string
  gender: 'female' | 'male'
}

const VOICES: Voice[] = [
  { id: 'en-US-AriaNeural', label: 'Aria', lang: 'English (US)', gender: 'female' },
  { id: 'en-US-JennyNeural', label: 'Jenny', lang: 'English (US)', gender: 'female' },
  { id: 'en-GB-SoniaNeural', label: 'Sonia', lang: 'English (UK)', gender: 'female' },
  { id: 'ar-SA-ZariyahNeural', label: 'Zariyah', lang: 'Arabic', gender: 'female' },
  { id: 'fr-FR-DeniseNeural', label: 'Denise', lang: 'French', gender: 'female' },
  { id: 'de-DE-KatjaNeural', label: 'Katja', lang: 'German', gender: 'female' },
  { id: 'es-ES-ElviraNeural', label: 'Elvira', lang: 'Spanish', gender: 'female' },
  { id: 'ja-JP-NanamiNeural', label: 'Nanami', lang: 'Japanese', gender: 'female' },
  { id: 'zh-CN-XiaoxiaoNeural', label: 'Xiaoxiao', lang: 'Chinese', gender: 'female' },
  { id: 'en-US-GuyNeural', label: 'Guy', lang: 'English (US)', gender: 'male' },
  { id: 'en-GB-RyanNeural', label: 'Ryan', lang: 'English (UK)', gender: 'male' },
  { id: 'ar-SA-HamedNeural', label: 'Hamed', lang: 'Arabic', gender: 'male' }
]

type Speed = { value: string; label: string; rate: number }

const SPEEDS: Speed[] = [
  { value: '-50%', label: 'Slow (−50%)', rate: 0.5 },
  { value: '+0%', label: 'Normal', rate: 1 },
  { value: '+50%', label: 'Fast (+50%)', rate: 1.5 },
  { value: '+100%', label: 'Very fast (+100%)', rate: 2 }
]

const DEFAULT_VOICE = VOICES[0].id
const DEFAULT_SPEED = '+0%'

export function TextToSpeechPanel(): React.JSX.Element {
  const { t } = useTranslation()
  const [voice, setVoice] = useState(DEFAULT_VOICE)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [previewing, setPreviewing] = useState(false)
  const utterRef = useRef<SpeechSynthesisUtterance | null>(null)

  // Hydrate from config.json on mount; persist on every change so
  // the cerebellum plugin (which re-reads config before every
  // voice_generate / voice_respond call) picks up the user's
  // selection without a restart.
  useEffect(() => {
    let cancelled = false
    void window.api.tts.getConfig().then((cfg) => {
      if (cancelled) return
      if (cfg.defaultVoice) setVoice(cfg.defaultVoice)
      if (cfg.defaultSpeed) setSpeed(cfg.defaultSpeed)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const onVoiceChange = (next: string): void => {
    setVoice(next)
    void window.api.tts.setConfig({ defaultVoice: next })
  }
  const onSpeedChange = (next: string): void => {
    setSpeed(next)
    void window.api.tts.setConfig({ defaultSpeed: next })
  }

  const voiceOptions: SelectOption<string>[] = useMemo(
    () =>
      VOICES.map((v) => ({
        value: v.id,
        label: `${v.label} — ${v.lang} (${v.gender})`
      })),
    []
  )

  const speedOptions: SelectOption<string>[] = useMemo(
    () => SPEEDS.map((s) => ({ value: s.value, label: s.label })),
    []
  )

  const selectedVoice = VOICES.find((v) => v.id === voice) ?? VOICES[0]

  const stopPreview = useCallback(() => {
    window.speechSynthesis.cancel()
    utterRef.current = null
    setPreviewing(false)
  }, [])

  const togglePreview = useCallback(() => {
    if (previewing) {
      stopPreview()
      return
    }

    const sampleTexts: Record<string, string> = {
      en: 'Hello! This is a preview of how this voice sounds.',
      ar: 'مرحباً! هذه معاينة لصوت هذا المتحدث.',
      fr: 'Bonjour ! Ceci est un aperçu de cette voix.',
      de: 'Hallo! Dies ist eine Vorschau dieser Stimme.',
      es: '¡Hola! Esta es una vista previa de esta voz.',
      ja: 'こんにちは！この音声のプレビューです。',
      zh: '你好！这是此语音的预览。'
    }

    const langPrefix = selectedVoice.id.split('-')[0]
    const text = sampleTexts[langPrefix] ?? sampleTexts.en

    const utter = new SpeechSynthesisUtterance(text)
    utter.lang = selectedVoice.id.replace(/Neural$/, '').split('-').slice(0, 2).join('-')
    const speedEntry = SPEEDS.find((s) => s.value === speed)
    utter.rate = speedEntry?.rate ?? 1

    utter.onend = () => setPreviewing(false)
    utter.onerror = () => setPreviewing(false)

    utterRef.current = utter
    setPreviewing(true)
    window.speechSynthesis.speak(utter)
  }, [previewing, selectedVoice, speed, stopPreview])

  return (
    <div className="flex min-h-full w-full items-start justify-center px-6 py-10">
      <div className="flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-fg text-2xl font-semibold tracking-tight">
            {t('settings.services.tts.title')}
          </h1>
          <p className="text-muted text-sm leading-relaxed">
            {t('settings.services.tts.subtitle')}
          </p>
        </header>

        <section className="bg-surface border-border flex flex-col gap-5 rounded-2xl border p-6">
          <div className="flex flex-col gap-1">
            <span className="text-muted text-xs font-medium uppercase tracking-wider">
              {t('settings.services.engine')}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-fg text-sm font-medium">Microsoft Edge TTS</span>
              <span className="bg-border/60 text-muted rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                {t('settings.services.tts.free')}
              </span>
              <span className="bg-border/60 text-muted rounded-md px-1.5 py-0.5 text-[10px] font-medium">
                MP3
              </span>
            </div>
            <p className="text-muted text-xs">{t('settings.services.tts.engineDescription')}</p>
          </div>

          <div className="border-border/60 border-t" />

          <div className="flex flex-col gap-3">
            <Select<string>
              label={t('settings.services.tts.voice')}
              value={voice}
              options={voiceOptions}
              onChange={onVoiceChange}
            />

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={togglePreview}
                className={cn(
                  'flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-full',
                  'bg-primary text-primary-fg hover:brightness-110',
                  'focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg'
                )}
              >
                {previewing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
              </button>
              <span className="text-muted text-xs">{t('settings.services.tts.previewHint')}</span>
            </div>
          </div>

          <div className="border-border/60 border-t" />

          <Select<string>
            label={t('settings.services.tts.speed')}
            value={speed}
            options={speedOptions}
            onChange={onSpeedChange}
          />
        </section>

        <section className="bg-surface border-border flex flex-col gap-3 rounded-2xl border p-6">
          <h2 className="text-fg text-sm font-medium">{t('settings.services.tts.voicesTitle')}</h2>
          <div className="divide-border/40 divide-y">
            {VOICES.map((v) => (
              <div key={v.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                <div className="flex flex-col">
                  <span className="text-fg text-sm">{v.label}</span>
                  <span className="text-muted text-xs">{v.lang}</span>
                </div>
                <span className="text-muted text-xs capitalize">{v.gender}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
