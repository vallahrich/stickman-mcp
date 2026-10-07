"""Package source-page images and complete in-slide animations."""
import json
import re
import sys
from pathlib import Path
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.util import Inches, Pt

demo = Path(sys.argv[1])
repo = Path(__file__).resolve().parents[2]
manifest = json.loads((demo / "source-pages.json").read_text(encoding="utf-8"))
comparison = json.loads((demo / "comparison.json").read_text(encoding="utf-8"))
css = (repo / "site" / "styles.css").read_text(encoding="utf-8")

def color(name):
    return RGBColor.from_string(re.search(rf"--cp-{name}:\s*#([a-f\d]+);", css, re.I)[1])

def text(slide, value, x, y, w, h, size, palette="text", bold=False):
    shape = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    frame = shape.text_frame
    frame.word_wrap = True
    frame.margin_left = frame.margin_right = frame.margin_top = frame.margin_bottom = 0
    frame.text = value
    for paragraph in frame.paragraphs:
        paragraph.font.name = "Segoe UI"
        paragraph.font.size = Pt(size)
        paragraph.font.bold = bold
        paragraph.font.color.rgb = color(palette)
        paragraph.space_after = Pt(0)
        paragraph.line_spacing = 1.0

original, enhanced = Presentation(), Presentation()
original.slide_width, original.slide_height = Inches(10), Inches(5.625)
enhanced.slide_width, enhanced.slide_height = Inches(13.333333), Inches(7.5)
for deck in (original, enhanced):
    deck.core_properties.author = "Stickman MCP; source: Cherilyn Pascoe / NIST"
    deck.core_properties.subject = "Historical February 2023 NIST briefing; independent demonstration"
    deck.core_properties.title = "NIST original-source excerpt" if deck is original else "NIST ideas with in-slide Stickman animation"

for index, page in enumerate(manifest["pages"]):
    image = demo / Path(page["image"]).name
    base = original.slides.add_slide(original.slide_layouts[6])
    base.shapes.add_picture(str(image), 0, 0, width=original.slide_width, height=original.slide_height)
    base.notes_slide.notes_text_frame.text = f"Original PDF page {page['page']}, rasterized intact. Cherilyn Pascoe, NIST, February 28, 2023. Historical pre-release briefing.\n{page['text']}"
    slide = enhanced.slides.add_slide(enhanced.slide_layouts[6])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = color("bg")
    actor = slide.shapes.add_picture(str(demo / f"in-slide-{page['page']}.gif"), 0, 0, width=enhanced.slide_width, height=enhanced.slide_height)
    actor._element.nvPicPr.cNvPr.set("descr", "Animated slide: stickman traverses the content, points and reveals cards or timeline milestones. Plays in PowerPoint Slide Show.")
    slide.notes_slide.notes_text_frame.text = f"Source: https://csrc.nist.gov/presentations/2023/nist-cybersecurity-framework-csf-20\nOriginal PDF page {page['page']}. Modification: source ideas summarized and relaid out, with a stickman travelling inside the slide and timed content reveals. Not a sidebar presenter. The GIF packages the complete animation for reliable Slide Show playback, not individually editable PowerPoint objects. Source authoring is reproducible from deck-scenes.mjs. Static renderers may show the first frame. Historical pre-release briefing, not current CSF guidance.\nSource SHA-256: {manifest['sha256']}\nFull original source-page text:\n{page['text']}"
original.save(demo / "nist-original.pptx")
enhanced.save(demo / "nist-with-stickman.pptx")
print(json.dumps({"presentations": 2, "slidesEach": len(manifest["pages"])}))
