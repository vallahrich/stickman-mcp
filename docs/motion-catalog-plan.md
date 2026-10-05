# Motion catalog plan: the 100 most-used motions

The goal is a catalog of the 100 motions people reach for most often when animating a stickman: everyday locomotion, posture changes, gestures, object handling and presentation beats. Every motion uses the same rig and conventions so motions can be chained into continuous scenes.

## Quality gate

A motion ships (`user-approved`) only when all of these hold:

1. Automated gates pass: no backward knees or hyperextended elbows, limb stretch within 4 %, no ground penetration, no joint pops (14 units/frame), no foot sliding.
2. Every key frame has been reviewed by eye before the user sees it.
3. The user rates it **8/10 or higher**. Anything lower goes back for rework with the user's notes.

Statuses: `planned` (no spec yet), `draft` (spec from mocap reference, not yet authored), `candidate` (authored key poses, awaiting user rating), `user-approved`, `rejected`.

## Process

- Work in waves of about 10 motions. Each motion is authored in parallel in its own spec file (`motions/specs/<id>.json`).
- Specs for `planned` motions are created when their wave starts.
- Build and preview one motion: `npm run motions:build -- --only <id>` and `npm run motions:shots -- --only <id> --strip`.
- The user rates each wave; motions under 8/10 are reworked inside the next wave.
- Chain-critical motions come first, because chaining (run → stop → walk to chair → sit → type → stand → walk → run) needs matching start and end poses.
- After the catalog is approved, the **combine phase** adds world-space chaining with pose blending at segment boundaries, so the same figure travels across slides.

## Waves

- **W1 Chain-critical & most used:** `wave`, `sit-down`, `stand-up`, `turn-around`, `run-start`, `walk-start`, `walk-stop`, `crouch`, `step-up`, `open-door`
- **W2 Presentation polish:** `type-at-desk`, `present-card`, `reveal`, `write-board`, `tap-element`, `idea`, `pull-banner`, `swipe-next`, `present`, `cheer`
- **W3 Everyday gestures:** `nod`, `head-shake`, `thumbs-up`, `beckon`, `stop-hand`, `clap`, `bow`, `shrug`, `think`, `look-around`
- **W4 Locomotion variety:** `jog`, `walk-backwards`, `walk-turn`, `turn-90`, `sidestep`, `sneak`, `tiptoe`, `stairs-up`, `stairs-down`, `march`
- **W5 Objects:** `push`, `pull`, `push-walk`, `pick-up`, `put-down`, `lift-carry`, `throw`, `catch`, `hand-over`, `drag-object`
- **W6 Postures & emotions:** `seated-idle`, `kneel-down`, `kneel-up`, `sit-floor`, `lie-down`, `get-up`, `sad-slump`, `surprised`, `angry-stomp`, `facepalm`
- **W7 Presentation II & small gestures:** `walk-on`, `walk-off`, `open-laptop`, `hold-sign`, `inspect-magnifier`, `phone-call`, `drink`, `check-watch`, `scratch-head`, `arms-crossed`
- **W8 Athletic:** `hop`, `kick`, `long-jump`, `hurdle`, `vault`, `skip`, `jumping-jack`, `punch`, `dodge`, `fist-pump`
- **W9 Environment & acrobatic:** `climb-ladder`, `climb-down`, `climb-ledge`, `hang-swing`, `balance`, `crawl`, `roll`, `fall-get-up`, `trip`, `dance`
- **W10 Remaining & rework:** `hands-on-hips`, `salute`, `laugh`, `static-pose`

Already approved (no wave): `idle`, `walk`, `run`, `stop`, `point`, `jump`.

## Catalog

### Locomotion (20)

| Motion | Status | Wave |
| --- | --- | --- |
| `idle` | user-approved | done |
| `walk` | user-approved | done |
| `run` | user-approved | done |
| `stop` | user-approved | done |
| `run-start` | draft | W1 |
| `jog` | planned | W4 |
| `walk-start` | planned | W1 |
| `walk-stop` | planned | W1 |
| `walk-backwards` | draft | W4 |
| `walk-turn` | draft | W4 |
| `turn-90` | draft | W4 |
| `turn-around` | candidate | W1 |
| `sidestep` | draft | W4 |
| `sneak` | draft | W4 |
| `tiptoe` | planned | W4 |
| `march` | planned | W4 |
| `skip` | planned | W8 |
| `stairs-up` | planned | W4 |
| `stairs-down` | draft | W4 |
| `step-up` | candidate | W1 |

### Postures & transitions (10)

| Motion | Status | Wave |
| --- | --- | --- |
| `crouch` | candidate | W1 |
| `sit-down` | candidate | W1 |
| `stand-up` | candidate | W1 |
| `seated-idle` | planned | W6 |
| `kneel-down` | planned | W6 |
| `kneel-up` | planned | W6 |
| `sit-floor` | planned | W6 |
| `lie-down` | planned | W6 |
| `get-up` | planned | W6 |
| `fall-get-up` | draft | W9 |

### Gestures (20)

| Motion | Status | Wave |
| --- | --- | --- |
| `wave` | candidate | W1 |
| `point` | user-approved | done |
| `nod` | planned | W3 |
| `head-shake` | planned | W3 |
| `thumbs-up` | planned | W3 |
| `beckon` | planned | W3 |
| `stop-hand` | planned | W3 |
| `clap` | draft | W3 |
| `bow` | draft | W3 |
| `shrug` | draft | W3 |
| `think` | draft | W3 |
| `look-around` | draft | W3 |
| `fist-pump` | planned | W8 |
| `check-watch` | planned | W7 |
| `scratch-head` | planned | W7 |
| `arms-crossed` | planned | W7 |
| `hands-on-hips` | planned | W10 |
| `salute` | planned | W10 |
| `facepalm` | planned | W6 |
| `laugh` | planned | W10 |

### Emotions (5)

| Motion | Status | Wave |
| --- | --- | --- |
| `cheer` | candidate | W2 |
| `sad-slump` | planned | W6 |
| `surprised` | planned | W6 |
| `angry-stomp` | planned | W6 |
| `dance` | draft | W9 |

### Object interaction (13)

| Motion | Status | Wave |
| --- | --- | --- |
| `push` | candidate | W5 |
| `pull` | draft | W5 |
| `push-walk` | draft | W5 |
| `pick-up` | draft | W5 |
| `put-down` | draft | W5 |
| `lift-carry` | draft | W5 |
| `throw` | draft | W5 |
| `catch` | planned | W5 |
| `hand-over` | planned | W5 |
| `drag-object` | planned | W5 |
| `open-door` | draft | W1 |
| `drink` | planned | W7 |
| `phone-call` | planned | W7 |

### Presentation (14)

| Motion | Status | Wave |
| --- | --- | --- |
| `present` | draft | W2 |
| `present-card` | candidate | W2 |
| `reveal` | candidate | W2 |
| `write-board` | candidate | W2 |
| `tap-element` | candidate | W2 |
| `idea` | candidate | W2 |
| `pull-banner` | candidate | W2 |
| `swipe-next` | candidate | W2 |
| `type-at-desk` | candidate | W2 |
| `walk-on` | planned | W7 |
| `walk-off` | planned | W7 |
| `open-laptop` | planned | W7 |
| `hold-sign` | planned | W7 |
| `inspect-magnifier` | planned | W7 |

### Athletic (12)

| Motion | Status | Wave |
| --- | --- | --- |
| `jump` | user-approved | done |
| `hop` | draft | W8 |
| `kick` | candidate | W8 |
| `long-jump` | draft | W8 |
| `hurdle` | draft | W8 |
| `vault` | draft | W8 |
| `jumping-jack` | planned | W8 |
| `punch` | planned | W8 |
| `dodge` | planned | W8 |
| `roll` | draft | W9 |
| `trip` | draft | W9 |
| `balance` | draft | W9 |

### Environment (6)

| Motion | Status | Wave |
| --- | --- | --- |
| `climb-ladder` | candidate | W9 |
| `climb-down` | draft | W9 |
| `climb-ledge` | draft | W9 |
| `hang-swing` | draft | W9 |
| `crawl` | draft | W9 |
| `static-pose` | rejected | W10 |

## Totals

- user-approved: 6
- draft: 33
- planned: 42
- candidate: 18
- rejected: 1
- **total: 100**
