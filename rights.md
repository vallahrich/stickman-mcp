# Rights and distribution boundaries

Evidence accessed 2026-10-09. This records source statements, not legal
certification or a blanket ownership sign-off.

## Original work

The Stickman engine, geometric rig, authored key-pose specifications and
vector props are covered by LICENSE (MIT). A mechanical or `user-approved`
status is an animation review, not an independent rights determination.

## CMU motion data (not MIT)

https://mocap.cs.cmu.edu/ states: “This dataset of motions is free for all uses”
and “You may include this data in commercially-sold products, but you may not
resell this data directly, even in converted form.”
https://mocap.cs.cmu.edu/faqs.php states: “The motion capture data may be copied,
modified, or redistributed without permission.”

Required acknowledgment, retained in NOTICE:

> The data used in this project was obtained from mocap.cs.cmu.edu. The
> database was created with funding from NSF EIA-0196217.

Compact derived runtime fixtures are included as part of the animation
product, not offered for standalone dataset resale. No raw BVH ships.
Do not label this data MIT or invent an SPDX identifier for CMU's terms.

## Conversion provenance

Existing source records identify the una-dinosauria/cmu-mocap BVH mirror and
the Bruce Hahne / cgspeed conversion.
https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/README.md
identifies the mirror as a copy of Bruce Hahne's conversion.
https://raw.githubusercontent.com/una-dinosauria/cmu-mocap/master/READMEFIRST.txt
(dated 2010-06-26) states under USAGE RIGHTS:

> CMU places no restrictions on the use of the original dataset, and I
> (Bruce) place no additional restrictions on the use of this particular
> BVH conversion.

Accessed 2026-10-09. The current CMU restriction against direct dataset resale,
including converted forms, still applies; the older conversion statement does
not erase it. The current conversion index is
https://sites.google.com/a/cgspeed.com/cgspeed/motion-capture (the old direct
Google page is no longer available). No converter or mirror code is included.

## Dependencies

The release inventory reads installed dependency manifests and identifies
their separate licenses. @modelcontextprotocol/sdk uses MIT;
@resvg/resvg-js and its platform bindings use MPL-2.0; ffmpeg-static's package
uses GPL-3.0-or-later. Dependencies are installed separately by npm, not
vendored into our tarball/site. A downloaded FFmpeg binary has build-specific
license/source obligations if redistributed. Media output does not embed
the encoder binary or rasterizer.

## Excluded presentation integration

The external dynamic presentation renderer has no established distribution
grant here. Its JavaScript, rendered decks and review screenshots do not
ship. The release cloud example uses only this repository's own choreography,
diagrams, Stickman renderer and independently authored static playback shell.
The private review presentation is left untouched.

## Remaining owner review

Confirm final-file content/ownership, retained notices, intended public
destination and immutable artifact hashes. Local preparation does not grant
publication approval and does not audit excluded Git history.
