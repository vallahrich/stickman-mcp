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
| `run` | rework | W1 | run cycle needs another pass |
| `stop` | user-approved | done |  |
| `run-start` | user-approved | W1 | 9/10 |
| `walk-start` | rework | W1 | 7/10: too sporty |
| `walk-stop` | user-approved | W1 | 8/10 |
| `turn-around` | user-approved | W1 | 8/10 |
| `step-up` | rework | W1 | 7/10: foot passes through step |
| `crouch` | user-approved | W1 | 8/10 |
| `sit-down` | user-approved | W1 | 8/10 |
| `stand-up` | user-approved | W1 | 8/10 |
| `open-door` | rework | W1 | 2/10: needs hinged door |
| `jog` | planned | W4 |  |
| `walk-backwards` | draft | W4 |  |
| `walk-turn` | draft | W4 |  |
| `turn-90` | draft | W4 |  |
| `sidestep` | draft | W4 |  |
| `sneak` | draft | W4 |  |
| `stairs-up` | planned | W4 |  |
| `stairs-down` | draft | W4 |  |
| `seated-idle` | planned | W4 |  |
| `kneel-down` | planned | W9 |  |
| `kneel-up` | planned | W9 |  |
| `sit-floor` | planned | W9 |  |
| `lie-down` | planned | W9 |  |
| `get-up` | planned | W9 |  |

### Gestures & emotions (19)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `wave` | rework | W1 | 6/10: must use right arm toward viewer |
| `point` | user-approved | done |  |
| `nod` | planned | W3 |  |
| `head-shake` | planned | W3 |  |
| `thumbs-up` | planned | W3 |  |
| `beckon` | planned | W3 |  |
| `stop-hand` | planned | W3 |  |
| `clap` | in progress | W3 |  |
| `bow` | user-approved | W3 | 8/10 |
| `shrug` | in progress | W3 |  |
| `think` | user-approved | W3 | 8/10 |
| `look-around` | rework | W3 | 7/10: add binoculars |
| `cheer` | rework | W2 | 6/10: arms weird |
| `fist-pump` | planned | W9 |  |
| `scratch-head` | planned | W9 |  |
| `arms-crossed` | planned | W9 |  |
| `facepalm` | planned | W9 |  |
| `surprised` | planned | W9 |  |
| `sad-slump` | planned | W9 |  |

### Presentation (14)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `present` | in progress | W2 |  |
| `present-card` | user-approved | W2 | 8/10 |
| `reveal` | in progress | W2 |  |
| `write-board` | rework | W2 | 6/10: must write text |
| `tap-element` | rework | W2 | 7/10: no extra finger |
| `idea` | rework | W2 | 7/10: bulb needs work |
| `pull-banner` | in progress | W2 |  |
| `swipe-next` | candidate | W2 | 8/10 earlier; no auto-advance |
| `walk-on` | planned | W5 |  |
| `walk-off` | planned | W5 |  |
| `enter-door` | planned | W5 | appear through a door on the next slide |
| `exit-door` | planned | W5 | leave the slide through a door |
| `hold-sign` | planned | W5 |  |
| `inspect-magnifier` | planned | W5 |  |

### IT (9)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `type-at-desk` | candidate | W2 | 9/10 earlier; bigger monitor |
| `open-laptop` | planned | W6 |  |
| `video-call` | planned | W6 |  |
| `phone-call` | planned | W6 |  |
| `plug-cable` | planned | W6 |  |
| `rack-server` | planned | W6 | slide a server out of a rack |
| `drag-window` | planned | W6 | grab and move a UI window on the slide |
| `tablet-tap` | planned | W6 |  |
| `frustrated-pc` | planned | W6 |  |

### Work & objects (12)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `push` | candidate | W7 |  |
| `pull` | draft | W7 |  |
| `push-walk` | draft | W7 |  |
| `pick-up` | draft | W7 |  |
| `put-down` | draft | W7 |  |
| `lift-carry` | draft | W7 |  |
| `throw` | draft | W7 |  |
| `catch` | planned | W7 |  |
| `hand-over` | planned | W7 |  |
| `drag-object` | planned | W7 |  |
| `check-watch` | planned | W7 |  |
| `write-notes` | planned | W7 |  |

### Sport & action (19)

| Motion | Status | Wave | Note |
| --- | --- | --- | --- |
| `jump` | user-approved | done |  |
| `hop` | draft | W8 |  |
| `kick` | candidate | W8 |  |
| `long-jump` | draft | W8 |  |
| `hurdle` | draft | W8 |  |
| `vault` | draft | W8 |  |
| `skip` | planned | W8 |  |
| `punch` | planned | W8 |  |
| `dodge` | planned | W8 |  |
| `roll` | draft | W8 |  |
| `trip` | draft | W8 |  |
| `balance` | draft | W8 |  |
| `dance` | draft | W8 |  |
| `climb-ladder` | candidate | W10 |  |
| `climb-down` | draft | W10 |  |
| `climb-ledge` | draft | W10 |  |
| `hang-swing` | draft | W10 |  |
| `crawl` | draft | W10 |  |
| `fall-get-up` | draft | W10 |  |

## Totals

- user-approved: 14
- rework: 10
- planned: 41
- draft: 25
- in progress: 5
- candidate: 5
- **total: 100**
