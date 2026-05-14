# Heartbeat

Wolffish's autonomic schedule. Each `##` heading defines a scheduled job.
The brainstem parses headings on startup, registers cron jobs, and routes
the body text through the full agent pipeline when the job fires.

The body under each heading is the instruction — plain text, no markdown
bullets needed. The agent receives it as a user message and decides what
tools to call. Heartbeat jobs auto-approve tool calls that would normally
need confirmation. Each job creates a sealed conversation visible in history.

Memory compaction (daily and weekly) is configured separately in
Settings > Hippocampus > Compaction and is not part of this file.

---


<!--
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXAMPLES — Uncomment any heading + body block to activate it.
All times are 24-hour format and use the system's local timezone.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━


── STARTUP ────────────────────────────────────────────────────────────
Runs once when the brainstem initializes. No cron — fires immediately
on startup then never again until the next restart.

## Startup

Check all connected integrations (Telegram, WhatsApp, email) and
report any that failed to initialize. Summarize status in a short
memo to memory.


── EVERY (MINUTES) ────────────────────────────────────────────────────
Runs on a repeating interval of N minutes.
Format: Every (<number>m)

## Every (5m)

Check all of my emails inboxes for new messages. If any arrived in the last 5
minutes, triage them by urgency and draft replies for anything
marked critical.

## Every (15m)

Poll the deployment pipeline. If any stage is stuck or failed,
summarize the failure and notify me.


── EVERY (HOURS) ──────────────────────────────────────────────────────
Runs on a repeating interval of N hours.
Format: Every (<number>h)

## Every (2h)

Scan open pull requests for stale reviews. If any PR has been
waiting for review longer than 24 hours, bump the reviewer with
a polite reminder.

## Every (6h)

Check system resource usage (CPU, memory, disk). If any metric
exceeds 85%, log a warning and suggest cleanup actions.


── HOURLY ─────────────────────────────────────────────────────────────
Runs once per hour at the specified minute mark.
Format: Hourly (<mm>)    — colon is optional.

## Hourly (00)

Fetch the latest news headlines relevant to my industry and save
a brief digest to today's daily log.

## Hourly (30)

Check my calendar for any meetings starting in the next 30 minutes.
If one exists, prepare a brief with attendee context and agenda.


── DAILY / NIGHTLY ────────────────────────────────────────────────────
Runs once per day at the specified time. "Daily" and "Nightly" are
interchangeable — both map to the same schedule kind.
Format: Daily (<HH>:<MM>) or Nightly (<HH>:<MM>)

## Daily (08:00)

Good morning routine. Summarize overnight messages, list today's
calendar events, and highlight the top 3 priorities from my task
list.

## Daily (13:00)

Midday checkpoint. Review progress on today's priorities. If any
task is blocked, suggest next steps or escalation paths.

## Nightly (23:00)

End-of-day wrap-up. Compile what was accomplished today, what
rolled over, and draft tomorrow's priority list. Save to the
daily log.


── WEEKDAY ────────────────────────────────────────────────────────────
Runs Monday through Friday at the specified time. Does not fire
on Saturday or Sunday.
Format: Weekday (<HH>:<MM>)

## Weekday (09:00)

Standup prep. Summarize what I did yesterday, what's planned for
today, and list any blockers. Format as a standup update ready
to paste.

## Weekday (17:00)

End-of-workday review. Check if any Slack threads or emails need
a response before I sign off. Flag anything urgent.


── WEEKLY ─────────────────────────────────────────────────────────────
Runs once per week on the specified day and time.
Format: Weekly (<DayName> <HH>:<MM>)
Days: Sunday, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday
(case-insensitive)

## Weekly (Monday 09:30)

Weekly planning. Review the backlog, identify the top priorities
for this week, and draft a plan broken into daily goals.

## Weekly (Friday 16:00)

Weekly retrospective. Summarize what shipped this week, what
slipped, and any lessons learned. Save to the weekly log.

## Weekly (Sunday 20:00)

Prepare for the week ahead. Review next week's calendar for
conflicts, check deadlines, and pre-read materials for Monday
meetings.


── MONTHLY ────────────────────────────────────────────────────────────
Runs once per month on the specified day at the specified time.
Format: Monthly (<DD> <HH>:<MM>)    — DD is day of month (1–31).

## Monthly (1 09:00)

First of the month review. Compile last month's metrics —
tasks completed, messages handled, response times. Generate
a one-page summary and save to the monthly archive.

## Monthly (15 10:00)

Mid-month checkpoint. Review progress against monthly goals.
If any goal is at risk, suggest corrective actions or scope
adjustments.


── CRON (RAW EXPRESSION) ──────────────────────────────────────────────
For advanced scheduling not covered above. Uses standard 5-field
cron syntax: <minute> <hour> <day-of-month> <month> <day-of-week>
Format: Cron (<expression>)

## Cron (0 9 * * 1,3,5)

Run on Monday, Wednesday, and Friday at 09:00. Check competitor
updates and summarize any notable changes in their public
offerings.

## Cron (0 */4 * * *)

Run every 4 hours (at :00). Health-check all active background
processes and long-running jobs. Restart any that have stalled.

## Cron (30 8 1-7 * 1)

Run at 08:30 on the first Monday of every month (day 1–7 AND
Monday). Generate the monthly team report and prepare it for
review.

## Cron (0 12 * * 0)

Run at noon every Sunday. Archive completed tasks from the past
week and clean up stale drafts older than 7 days.

-->
