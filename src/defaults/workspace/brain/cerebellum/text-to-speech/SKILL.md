---
name: text-to-speech
description: Generate voice memos from text using neural TTS. Convert any text to spoken audio, respond with voice memos, or create voice summaries.
triggers:
  - voice
  - speak
  - say
  - audio
  - read aloud
  - voice memo
  - tts
  - text to speech
  - say this
  - read this
  - talk
  - narrate
  - spoken
tools:
  - name: voice_generate
    description: Convert text to a voice memo (MP3). Returns the file path of the generated audio. The voice memo appears as an attachment alongside the text response.
    parameters:
      text:
        type: string
        description: The text to convert to speech
      voice:
        type: string
        required: false
        description: "Voice name (default: en-US-AriaNeural). Options: en-US-AriaNeural (female), en-US-GuyNeural (male), ar-SA-HamedNeural (Arabic male), ar-SA-ZariyahNeural (Arabic female). Run edge-tts --list-voices for all options."
      speed:
        type: string
        required: false
        description: "Speech rate (default: +0%). Options: -50% (slow), +0% (normal), +50% (fast), +100% (very fast)"
  - name: voice_respond
    description: Respond to the user entirely as a voice memo. The voice IS the response — do not also send the same text as a regular message. Include only a brief label like "Voice memo" so something appears while audio loads.
    parameters:
      text:
        type: string
        description: The full response text to speak
      voice:
        type: string
        required: false
        description: "Voice name (default: en-US-AriaNeural)"
      speed:
        type: string
        required: false
        description: "Speech rate (default: +0%)"
  - name: voice_list
    description: List all voice memo files in the workspace voice directory with their timestamps and sizes.
    parameters: {}
danger_patterns: []
confirm_patterns: []
requires: []
---

# Voice

## Interface

- Tools: `voice_generate`, `voice_respond`, `voice_list`
- Engine: Microsoft Edge TTS (free, neural voices, no API key)
- Output: MP3 files stored in the workspace voice directory

## When to use each tool

- **"convert this to a voice memo"**, **"read this aloud"**, **"say this"** → `voice_generate` with the specified text. The voice memo attaches below your text response.
- **"respond in voice"**, **"reply with audio"**, **"voice memo only"**, **"answer in audio"** → `voice_respond` with your full response. Do NOT also send the text as a regular message — the voice IS the response. Write only a brief label like "Voice memo" as your text output.
- **"summarize the last response as a voice memo"** → Take your most recent response, condense it into spoken form, and use `voice_respond`.
- **"from now on reply with voice memos"** → Use `voice_respond` for all subsequent responses until told otherwise.
- **"list my voice memos"** → `voice_list` to show all generated voice files.

## Available voices

| Voice | Language | Gender |
|---|---|---|
| en-US-AriaNeural | English (US) | Female |
| en-US-GuyNeural | English (US) | Male |
| en-US-JennyNeural | English (US) | Female |
| en-GB-SoniaNeural | English (UK) | Female |
| en-GB-RyanNeural | English (UK) | Male |
| ar-SA-HamedNeural | Arabic (SA) | Male |
| ar-SA-ZariyahNeural | Arabic (SA) | Female |
| fr-FR-DeniseNeural | French | Female |
| de-DE-KatjaNeural | German | Female |
| es-ES-ElviraNeural | Spanish | Female |
| ja-JP-NanamiNeural | Japanese | Female |
| zh-CN-XiaoxiaoNeural | Chinese | Female |

If the user asks for a voice not listed, run `edge-tts --list-voices` via shell to see all available voices.

## Speed options

- `-50%` — slow
- `+0%` — normal (default)
- `+50%` — fast
- `+100%` — very fast

## Rules

- Always pass text that reads naturally when spoken. Strip markdown formatting, code blocks, and special characters before sending to TTS.
- For long texts (2000+ words), the engine handles them in one pass. No chunking needed.
- Voice files are stored in the workspace and persist across sessions.
