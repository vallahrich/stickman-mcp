"""Rasterize complete source pages; never reconstruct or rewrite their content."""
import argparse
import hashlib
import json
import shutil
from pathlib import Path
import fitz

parser = argparse.ArgumentParser()
parser.add_argument("source")
parser.add_argument("output")
parser.add_argument("--pages", default="1,2,4,5")
args = parser.parse_args()
source, output = Path(args.source), Path(args.output)
output.mkdir(parents=True, exist_ok=True)
pages = []
with fitz.open(source) as doc:
    for number in (int(n) for n in args.pages.split(",")):
        if number < 1 or number > len(doc):
            raise ValueError(f"Source page {number} is missing")
        page = doc[number - 1]
        image = output / f"source-{number}.png"
        page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(image)
        text = page.get_text()
        pages.append({"page": number, "title": text.splitlines()[0], "image": f"demo/{image.name}", "text": text, "width": page.rect.width, "height": page.rect.height})
shutil.copyfile(source, output / "nist-original.pdf")
manifest = {"sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "pages": pages, "renderer": f"PyMuPDF {fitz.VersionBind}"}
(output / "source-pages.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(json.dumps({"pages": len(pages), "sha256": manifest["sha256"]}))
