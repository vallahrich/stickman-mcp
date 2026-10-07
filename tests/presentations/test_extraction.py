import importlib.util
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from zipfile import ZipFile

MODULE_PATH = Path(__file__).resolve().parents[2] / "scripts" / "presentations" / "extract-pptx.py"
spec = importlib.util.spec_from_file_location("extract_pptx", MODULE_PATH)
extract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extract)
P = extract.NS["p"]
A = extract.NS["a"]
R = extract.NS["r"]
RELS = "http://schemas.openxmlformats.org/package/2006/relationships"


class ExtractionTests(unittest.TestCase):
    def test_relationships_do_not_escape_package(self):
        self.assertEqual(extract.package_target("ppt/slides/slide1.xml", "../media/image.png"), "ppt/media/image.png")
        for unsafe in ["../../../outside", "/absolute", r"..\outside", "file:outside"]:
            with self.assertRaises(ValueError):
                extract.package_target("ppt/slides/slide1.xml", unsafe)

    def test_svg_does_not_keep_active_or_remote_content(self):
        cleaned = extract.sanitize_svg(b'<svg xmlns="http://www.w3.org/2000/svg" onload="run()"><script>run()</script><style>@import "https://example.invalid/style";</style><image href="https://example.invalid/picture"/><path fill="url(#local)" d="M0 0L1 1"/></svg>').decode()
        self.assertNotIn("onload", cleaned)
        self.assertNotIn("script", cleaned)
        self.assertNotIn("example.invalid", cleaned)
        self.assertIn("url(#local)", cleaned)

    def test_notes_media_placeholders_and_grouped_coordinates(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "fixture.pptx"
            with ZipFile(source, "w") as package:
                package.writestr("ppt/presentation.xml", f'<p:presentation xmlns:p="{P}" xmlns:r="{R}"><p:sldIdLst><p:sldId id="1" r:id="s1"/></p:sldIdLst><p:sldSz cx="1280" cy="720"/></p:presentation>')
                package.writestr("ppt/_rels/presentation.xml.rels", f'<Relationships xmlns="{RELS}"><Relationship Id="s1" Type="{R}/slide" Target="slides/slide1.xml"/></Relationships>')
                package.writestr("ppt/slides/slide1.xml", f'''<p:sld xmlns:p="{P}" xmlns:a="{A}" xmlns:r="{R}"><p:cSld><p:spTree>
                  <p:sp><p:nvSpPr><p:cNvPr id="1" name="Title"/><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Keep this title</a:t></a:r></a:p></p:txBody></p:sp>
                  <p:grpSp><p:grpSpPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="400" cy="200"/><a:chOff x="0" y="0"/><a:chExt cx="200" cy="100"/></a:xfrm></p:grpSpPr>
                    <p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture"/></p:nvPicPr><p:blipFill><a:blip r:embed="image"/><a:srcRect t="500"/></p:blipFill><p:spPr><a:xfrm><a:off x="10" y="20"/><a:ext cx="50" cy="25"/></a:xfrm></p:spPr></p:pic>
                  </p:grpSp></p:spTree></p:cSld></p:sld>''')
                package.writestr("ppt/slides/_rels/slide1.xml.rels", f'<Relationships xmlns="{RELS}"><Relationship Id="layout" Type="{R}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="notes" Type="{R}/notesSlide" Target="../notesSlides/notesSlide1.xml"/><Relationship Id="image" Type="{R}/image" Target="../media/image1.png"/></Relationships>')
                package.writestr("ppt/slideLayouts/slideLayout1.xml", f'<p:sldLayout xmlns:p="{P}" xmlns:a="{A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="60" y="40"/><a:ext cx="900" cy="100"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>')
                package.writestr("ppt/notesSlides/notesSlide1.xml", f'<p:notes xmlns:p="{P}" xmlns:a="{A}"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="body"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Exact note</a:t></a:r><a:br/><a:r><a:t>Second line</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>')
                package.writestr("ppt/media/image1.png", b"test asset")
            manifest = extract.inventory(source, root / "output")
            slide = manifest["slides"][0]
            self.assertEqual(slide["notes"], ["Exact note\nSecond line"])
            self.assertEqual(slide["shapes"][0]["bounds"], {"x": 60, "y": 40, "width": 900, "height": 100})
            self.assertEqual(slide["shapes"][0]["transformSource"], "ppt/slideLayouts/slideLayout1.xml")
            self.assertEqual(slide["shapes"][1]["bounds"], {"x": 120, "y": 240, "width": 100, "height": 50})
            self.assertEqual(slide["shapes"][1]["crop"], {"t": "500"})
            self.assertEqual(slide["media"], ["ppt/media/image1.png"])
            self.assertEqual((root / "output" / "assets" / "image1.png").read_bytes(), b"test asset")
            self.assertEqual(json.loads((root / "output" / "source.json").read_text())["slides"][0]["text"], ["Keep this title"])


if __name__ == "__main__":
    unittest.main()
