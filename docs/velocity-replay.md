# Velocity replay

The velocity replay command evaluates aggregate one-second chat traces through the same `VelocityEngine` used by the extension:

```powershell
npm run replay:velocity -- fixtures/velocity-replay.example.json
```

The command reports detector alerts, label recall, unmatched alert count, false alerts per covered channel-hour, median detection latency, and the controls needed to compare runs. It does not tune thresholds or modify the trace.

## Temporal contract

For a detector decision at time `T`, only buckets at or before `T` are passed to `VelocityEngine`. Labels are read only after every alert has been generated and are used exclusively for scoring.

- Use `phase: "development"` for trace and harness development.
- Use earlier `validation` traces to select thresholds or detector variants.
- Lock the implementation and controls before running `test` traces.
- Do not use test results to select another detector and continue reporting the same test result as final.
- Keep `datasetVersion`, sensitivity, cooldown, label window, bucket coverage, and cohort definitions identical when comparing detectors unless that field is the explicit treatment.

The regression suite verifies that adding future labels cannot alter alert output and that missing or reordered buckets are rejected.

## Trace format

Every second in the recorded interval must have exactly one chronological bucket. A quiet connected second uses `messageCount: 0` and `covered: true`; a second without EventSub coverage uses `messageCount: 0` and `covered: false`. Omitting seconds is invalid because the replay cannot safely infer quiet chat versus missing data.

```json
{
  "version": 1,
  "traceId": "channel-session-2026-07-10",
  "datasetVersion": "large-chat-v1",
  "phase": "validation",
  "channelLogin": "example",
  "sensitivity": "high",
  "cooldownSeconds": 600,
  "labelMatchWindowMs": 60000,
  "buckets": [
    {
      "startedAt": 0,
      "messageCount": 3,
      "chatterTokens": ["session-a", "session-b"],
      "covered": true
    },
    {
      "startedAt": 1000,
      "messageCount": 0,
      "covered": true
    }
  ],
  "labels": [{ "at": 0, "kind": "manual-moment" }]
}
```

Fields:

- `startedAt` is an epoch millisecond aligned to a one-second boundary. Relative timelines beginning at zero are also valid.
- `messageCount` is the total chat messages in that second.
- `chatterTokens` is optional. When present, it contains unique, session-scoped pseudonyms for chatters active in the bucket. Tokens may repeat across buckets so distinct participation can be reconstructed across multi-second windows.
- `covered` explicitly states whether EventSub chat coverage was available.
- `labels` may come from manual moment marks or clip-based weak labels. Labels are never detector inputs.
- `labelMatchWindowMs` defines the post-label interval in which the first unmatched alert counts as a detection.

## Privacy

Replay files must not contain Twitch access tokens, raw chatter IDs, chatter logins, message IDs, or message text. Generate random session-scoped chatter tokens and discard the token mapping. Treat aggregate traces as sensitive local research data because channel activity and labels can still reveal viewing behavior.

The extension does not generate or export replay traces automatically. Adding an opt-in capture/export workflow would be a separate privacy-sensitive product decision.
