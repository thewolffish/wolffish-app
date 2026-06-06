---
name: ffmpeg
description: FFmpeg multimedia framework for video/audio processing
triggers:
  - ffmpeg
  - video
  - audio
  - convert
  - transcode
  - compress
  - encode
  - decode
  - mp4
  - mkv
  - avi
  - mov
  - webm
  - mp3
  - wav
  - aac
  - flac
  - ogg
  - trim
  - cut
  - clip
  - merge video
  - concat
  - resize video
  - scale
  - bitrate
  - codec
  - h264
  - h265
  - hevc
  - gif
  - thumbnail
  - extract audio
  - extract frame
  - subtitle
  - watermark
  - rotate
  - crop
  - filter
  - resolution
  - fps
  - frame rate
  - media
  - multimedia
  - screen recording
  - stream
  - mux
  - demux
  - remux
  - container
  - format
  - aspect ratio
  - 4k
  - 1080p
  - 720p
  - 480p
  - hdr
  - sdr
  - slow motion
  - speed up
  - time lapse
  - reverse video
  - loop video
  - loop gif
  - animated gif
  - video to gif
  - gif to video
  - audio to video
  - add music
  - background music
  - volume
  - normalize audio
  - noise reduction
  - fade in
  - fade out
  - crossfade
  - overlay
  - picture in picture
  - pip
  - split screen
  - side by side
  - green screen
  - chroma key
  - stabilize
  - denoise
  - sharpen
  - blur
  - vignette
  - color correction
  - brightness
  - contrast
  - saturation
  - convert video
  - convert audio
  - compress video
  - reduce video size
  - make smaller
requires:
  - package-manager
packages:
  brew: ffmpeg
  winget_id: Gyan.FFmpeg
  apt: ffmpeg
  dnf: ffmpeg
tools:
  - name: ffmpeg_check
    description: Check if ffmpeg is installed
    parameters: {}
  - name: ffmpeg_install
    description: Install ffmpeg via the system package manager
    parameters: {}
  - name: ffmpeg_run
    description: Run an ffmpeg command
    parameters:
      args:
        type: string
        description: ffmpeg arguments (everything after 'ffmpeg')
confirm_patterns:
  - pattern: "ffmpeg_install"
    reason: Installing ffmpeg
---

# FFmpeg

## Usage

Use `ffmpeg_check` to verify ffmpeg is installed before running commands.
If not installed, call `ffmpeg_install` (requires user approval).

Use `ffmpeg_run` with the arguments you'd pass after `ffmpeg` on the command line.
For example, to compress a video:

```
args: "-i input.mp4 -crf 28 -preset medium output.mp4"
```

## Common patterns

- **Compress video:** `-i input.mp4 -crf 28 -preset medium output.mp4`
- **Extract audio:** `-i input.mp4 -vn -acodec copy output.aac`
- **Convert format:** `-i input.avi -c:v libx264 -c:a aac output.mp4`
- **Resize video:** `-i input.mp4 -vf scale=1280:720 output.mp4`
- **Get info:** `-i input.mp4` (prints metadata to stderr)
