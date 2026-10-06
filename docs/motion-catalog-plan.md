# Motion catalog plan: the 100 most-used motions

The goal is a catalog of the 100 motions people reach for most often when animating a stickman. They are grouped the way users look for them: **Basic**, **Gestures & emotions**, **Presentation**, **IT**, **Work & objects** and **Sport & action**. Every motion uses the same rig and conventions, so motions can be chained into continuous scenes.

## Quality gate

A motion ships (`user-approved`) only when all of these hold:

1. Automated gates pass: no backward knees or hyperextended elbows, limb stretch within 4 %, no ground penetration, no joint pops (14 units/frame), no foot sliding.
2. Every key frame has been reviewed by eye before the user sees it.
3. The user rates it **8/10 or higher**. Anything lower goes to `rework` with the user's notes.

Statuses: `planned` (no spec yet), `draft` (spec from mocap reference, not yet authored), `in progress` (an authoring agent is working on it), `candidate` (authored, awaiting user rating), `rework` (rated under 8, being fixed), `user-approved`.

## Process

- Work in waves of about 10 motions. Each motion is authored in parallel by its own agent in its own spec file (`motions/specs/<id>.json`).
- Build and preview one motion: `npm run motions:build -- --only <id>` and `npm run motions:shots -- --only <id> --strip`.
- The user rates each wave; motions under 8/10 are reworked while the next wave is authored.
- Chain-critical motions come first, because chaining (run → stop → walk to chair → sit → type → stand → walk → run) needs matching start and end poses.
- After the catalog is approved, the **combine phase** adds world-space chaining with pose blending at segment boundaries, so the same figure travels across slides (including leaving through a door and appearing through a door on the next slide).

## Waves

- **W1 Chain-critical & most used:** `run`, `run-start`, `walk-start`, `walk-stop`, `turn-around`, `step-up`, `crouch`, `sit-down`, `stand-up`, `open-door`, `wave`
- **W2 Presentation polish:** `cheer`, `present`, `present-card`, `reveal`, `write-board`, `tap-element`, `idea`, `pull-banner`, `swipe-next`, `type-at-desk`
- **W3 Everyday gestures:** `nod`, `head-shake`, `thumbs-up`, `beckon`, `stop-hand`, `clap`, `bow`, `shrug`, `think`, `look-around`
- **W4 More basic movement:** `jog`, `walk-backwards`, `walk-turn`, `turn-90`, `sidestep`, `sneak`, `stairs-up`, `stairs-down`, `seated-idle`
- **W5 Presentation II: entrances and props:** `walk-on`, `walk-off`, `enter-door`, `exit-door`, `hold-sign`, `inspect-magnifier`
- **W6 IT motions:** `open-laptop`, `video-call`, `phone-call`, `plug-cable`, `rack-server`, `drag-window`, `tablet-tap`, `frustrated-pc`
- **W7 Work & objects:** `push`, `pull`, `push-walk`, `pick-up`, `put-down`, `lift-carry`, `throw`, `catch`, `hand-over`, `drag-object`, `check-watch`, `write-notes`
- **W8 Sport:** `hop`, `kick`, `long-jump`, `hurdle`, `vault`, `skip`, `punch`, `dodge`, `roll`, `trip`, `balance`, `dance`
- **W9 Postures, gestures & emotions II:** `kneel-down`, `kneel-up`, `sit-floor`, `lie-down`, `get-up`, `fist-pump`, `scratch-head`, `arms-crossed`, `facepalm`, `surprised`, `sad-slump`
- **W10 Climbing & acrobatic:** `climb-ladder`, `climb-down`, `climb-ledge`, `hang-swing`, `crawl`, `fall-get-up`

Already approved before the catalog: `idle`, `walk`, `stop`, `point`, `jump`.

## Groups

### Basic (moving & postures) (27)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `idle` | user-approved | done |  |
| `walk` | user-approved | done |  |
| `run` | rework | W1 | still reads as hopping; deeper rework later |
| `stop` | user-approved | done |  |
| `run-start` | user-approved | W1 | 9/10 |
| `walk-start` | user-approved | W1 | batch 4: approved |
| `walk-stop` | user-approved | W1 | 8/10 |
| `turn-around` | user-approved | W1 | 8/10 |
| `step-up` | user-approved | W1 | approved |
| `crouch` | user-approved | W1 | 8/10 |
| `sit-down` | user-approved | W1 | 8/10 |
| `stand-up` | user-approved | W1 | 8/10 |
| `open-door` | user-approved | W1 | batch 10 re-review: 9/10 approved (occlusion) |
| `jog` | user-approved | W4 | batch 12: 8/10 approved |
| `walk-backwards` | user-approved | W4 | user 8+ |
| `walk-turn` | user-approved | W4 | batch 11: 8/10 approved |
| `turn-90` | user-approved | W4 | batch 5: 9/10 approved |
| `sidestep` | user-approved | W4 | user 8+ |
| `sneak` | user-approved | W4 | batch 4: approved |
| `stairs-up` | user-approved | W4 | batch 5: 8/10 approved |
| `stairs-down` | user-approved | W4 | user 8+ |
| `seated-idle` | candidate | W4 | wave 14: review; relaxed seated loop |
| `kneel-down` | user-approved | W9 | batch 6: 9/10 approved |
| `kneel-up` | user-approved | W9 | batch 6: 8/10 approved |
| `sit-floor` | user-approved | W9 | user 8+ |
| `lie-down` | candidate | W9 | wave 14: review; controlled kneel, sit and supported side recline |
| `get-up` | user-approved | W9 | user 8+ |

### Gestures & emotions (19)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `wave` | user-approved | W1 | batch 5: 9/10 approved |
| `point` | user-approved | done |  |
| `nod` | user-approved | W3 | batch 4: approved |
| `head-shake` | user-approved | W3 | batch 8: 8/10 approved |
| `thumbs-up` | user-approved | W3 | batch 9: 8/10 approved |
| `beckon` | user-approved | W3 | batch 4: approved |
| `stop-hand` | user-approved | W3 | batch 10: 8/10 approved |
| `clap` | user-approved | W3 | batch 4: approved |
| `bow` | user-approved | W3 | 8/10 |
| `shrug` | user-approved | W3 | batch 4: approved |
| `think` | user-approved | W3 | 8/10 |
| `look-around` | user-approved | W3 | batch 10: 8/10 approved (binoculars) |
| `cheer` | user-approved | W2 | batch 5: 9/10 approved |
| `fist-pump` | user-approved | W9 | batch 6: 8/10 approved |
| `scratch-head` | user-approved | W9 | batch 6: 9/10 approved |
| `arms-crossed` | user-approved | W9 | batch 6: 9/10 approved |
| `facepalm` | user-approved | W9 | batch 6: 8/10 approved |
| `surprised` | user-approved | W9 | user 8+ |
| `sad-slump` | user-approved | W9 | user 8+ |

### Presentation (14)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `present` | user-approved | W2 | approved |
| `present-card` | user-approved | W2 | 8/10 |
| `reveal` | user-approved | W2 | user 8+ |
| `write-board` | user-approved | W2 | user 8+ |
| `tap-element` | user-approved | W2 | approved |
| `idea` | user-approved | W2 | approved; bulb to be yellow |
| `pull-banner` | user-approved | W2 | batch 10: all four directions approved (left/right = box pulls) 8/10 |
| `swipe-next` | user-approved | W2 | batch 5: 9/10 approved |
| `walk-on` | user-approved | W5 | re-review: 8/10 approved; upright gait and fixed stance |
| `walk-off` | user-approved | W5 | re-review: 8/10 approved; upright gait and fixed stance |
| `enter-door` | planned | W5 | appear through a door on the next slide |
| `exit-door` | planned | W5 | leave the slide through a door |
| `hold-sign` | user-approved | W5 | batch 13: 9/10 approved |
| `inspect-magnifier` | planned | W5 |  |

### IT (9)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `type-at-desk` | user-approved | W2 | batch 5: 9/10 approved (polish: still body) |
| `open-laptop` | planned | W6 |  |
| `video-call` | planned | W6 |  |
| `phone-call` | user-approved | W6 | batch 13: 9/10 approved |
| `plug-cable` | planned | W6 |  |
| `rack-server` | planned | W6 | slide a server out of a rack |
| `drag-window` | planned | W6 | grab and move a UI window on the slide |
| `tablet-tap` | planned | W6 |  |
| `frustrated-pc` | planned | W6 |  |

### Work & objects (12)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `push` | candidate | W7 |  |
| `pull` | user-approved | W7 | batch 4: approved |
| `push-walk` | draft | W7 |  |
| `pick-up` | user-approved | W7 | batch 11: 8/10 approved |
| `put-down` | user-approved | W7 | batch 11: 8/10 approved |
| `lift-carry` | rework | W7 | batch 11 re-review: 6/10; weird wiggling, stabilize carry |
| `throw` | user-approved | W7 | throw-ball 8/10 approved; basketball-shot 9/10 approved |
| `catch` | planned | W7 |  |
| `hand-over` | planned | W7 |  |
| `drag-object` | planned | W7 |  |
| `check-watch` | user-approved | W7 | batch 8: 8/10 approved |
| `write-notes` | planned | W7 |  |

### Sport & action (19)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `jump` | user-approved | done |  |
| `hop` | user-approved | W8 | batch 6: 9/10 approved |
| `kick` | candidate | W8 | re-review: brisk 1.3s approach and faster strike; previous 6/10 |
| `long-jump` | user-approved | W8 | batch 11: 8/10 approved |
| `hurdle` | user-approved | W8 | batch 10: 8/10 approved |
| `vault` | user-approved | W8 | batch 13: 8/10 approved |
| `skip` | user-approved | W8 | user 8+ |
| `punch` | user-approved | W8 | batch 9: 9/10 approved (gloves) |
| `dodge` | user-approved | W8 | user 8+ |
| `roll` | draft | W8 |  |
| `trip` | draft | W8 |  |
| `balance` | candidate | W8 | wave 14: review; one-leg balance and recovery |
| `dance` | draft | W8 |  |
| `climb-ladder` | candidate | W10 |  |
| `climb-down` | draft | W10 |  |
| `climb-ledge` | draft | W10 |  |
| `hang-swing` | draft | W10 |  |
| `crawl` | user-approved | W10 | re-review: 9/10 approved; articulated gait and locked stance contacts |
| `fall-get-up` | user-approved | W10 | re-review: 9/10 approved; supported palm-to-knee-to-foot recovery |

## Totals

- user-approved: 71
- rework: 2
- candidate: 6
- planned: 14
- draft: 7
- **total: 100**
