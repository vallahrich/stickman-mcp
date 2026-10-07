"""Inventory a local PPTX without Office, external fetching, or source mutation."""
import argparse
import hashlib
import json
import math
import posixpath
import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

NS = {
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}
MIMES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
         ".svg": "image/svg+xml", ".mp4": "video/mp4", ".gif": "image/gif"}


def package_target(part, target):
    if "\\" in target or target.startswith("/") or ":" in target:
        raise ValueError(f"Unsafe package relationship: {target}")
    result = posixpath.normpath(posixpath.join(posixpath.dirname(part), target))
    if result == ".." or result.startswith("../"):
        raise ValueError(f"Relationship escapes the package: {target}")
    return result


def paragraphs(root):
    result = []
    for paragraph in root.findall(".//a:p", NS):
        pieces = []
        for element in paragraph.iter():
            if element.tag == f"{{{NS['a']}}}t":
                pieces.append(element.text or "")
            elif element.tag == f"{{{NS['a']}}}br":
                pieces.append("\n")
        text = "".join(pieces)
        if text.strip():
            result.append(text)
    return result


def matrix_point(matrix, x, y):
    a, b, c, d, e, f = matrix
    return [a * x + c * y + e, b * x + d * y + f]


def multiply(left, right):
    a, b, c, d, e, f = left
    g, h, i, j, k, l = right
    return [a*g+c*h, b*g+d*h, a*i+c*j, b*i+d*j, a*k+c*l+e, b*k+d*l+f]


def transform_values(xfrm):
    if xfrm is None:
        return None
    values = {"attributes": dict(xfrm.attrib)}
    for child in xfrm:
        values[child.tag.split("}")[-1]] = {k: int(v) for k, v in child.attrib.items()}
    return values


def shape_transform(shape):
    found = shape.find("p:spPr/a:xfrm", NS)
    return found if found is not None else shape.find("p:xfrm", NS)


def placeholder(shape):
    for path in ["p:nvSpPr/p:nvPr/p:ph", "p:nvPicPr/p:nvPr/p:ph", "p:nvGraphicFramePr/p:nvPr/p:ph"]:
        found = shape.find(path, NS)
        if found is not None:
            return dict(found.attrib)
    return None


def inherited_transform(shape, layers):
    own = shape_transform(shape)
    if own is not None:
        return own, "slide"
    ph = placeholder(shape)
    if ph:
        for part, root in layers:
            candidates = root.findall(".//p:sp", NS) + root.findall(".//p:pic", NS)
            for candidate in candidates:
                other = placeholder(candidate)
                if not other:
                    continue
                match = other.get("idx", "0") == ph.get("idx", "0") if "idx" in ph else other.get("type") == ph.get("type")
                xf = shape_transform(candidate)
                if match and xf is not None:
                    return xf, part
    return None, None


def bounds(xfrm, parent):
    if xfrm is None:
        return None
    values = transform_values(xfrm)
    off, extent = values.get("off"), values.get("ext")
    if not off or not extent:
        return None
    x, y, w, h = off["x"], off["y"], extent["cx"], extent["cy"]
    angle = math.radians(int(xfrm.attrib.get("rot", "0")) / 60000)
    cx, cy = x + w / 2, y + h / 2
    points = []
    for px, py in [(x, y), (x+w, y), (x+w, y+h), (x, y+h)]:
        dx, dy = px-cx, py-cy
        points.append(matrix_point(parent, cx+dx*math.cos(angle)-dy*math.sin(angle), cy+dx*math.sin(angle)+dy*math.cos(angle)))
    xs, ys = zip(*points)
    return {"x": min(xs), "y": min(ys), "width": max(xs)-min(xs), "height": max(ys)-min(ys)}


def group_matrix(group):
    xf = group.find("p:grpSpPr/a:xfrm", NS)
    v = transform_values(xf)
    if not v or not all(k in v for k in ["off", "ext", "chOff", "chExt"]):
        raise ValueError("Group is missing its coordinate transform")
    sx = v["ext"]["cx"] / v["chExt"]["cx"]
    sy = v["ext"]["cy"] / v["chExt"]["cy"]
    x, y = v["off"]["x"], v["off"]["y"]
    matrix = [sx, 0, 0, sy, x-sx*v["chOff"]["x"], y-sy*v["chOff"]["y"]]
    angle = math.radians(int(xf.attrib.get("rot", "0")) / 60000)
    cx, cy = x+v["ext"]["cx"]/2, y+v["ext"]["cy"]/2
    fx = -1 if xf.attrib.get("flipH") == "1" else 1
    fy = -1 if xf.attrib.get("flipV") == "1" else 1
    a, b, c, d = math.cos(angle)*fx, math.sin(angle)*fx, -math.sin(angle)*fy, math.cos(angle)*fy
    return multiply([a, b, c, d, cx-a*cx-c*cy, cy-b*cx-d*cy], matrix)


def sanitize_svg(data):
    root = ET.fromstring(data)
    if root.tag.split("}")[-1] != "svg":
        raise ValueError("SVG asset has no SVG root")
    for parent in list(root.iter()):
        for child in list(parent):
            if child.tag.split("}")[-1] in {"script", "foreignObject"}:
                parent.remove(child)
            elif child.tag.split("}")[-1] == "style":
                text = child.text or ""
                if "@import" in text.lower() or re.search(r"url\(\s*['\"]?(?!#)", text, re.I):
                    parent.remove(child)
        for key, value in list(parent.attrib.items()):
            name = key.split("}")[-1].lower()
            if name.startswith("on") or (name in {"href", "src"} and not value.startswith(("#", "data:image/"))):
                del parent.attrib[key]
            elif "url(" in value.lower() and "url(#" not in value.lower():
                del parent.attrib[key]
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def inventory(source, output):
    output.mkdir(parents=True, exist_ok=True)
    asset_dir = output / "assets"
    asset_dir.mkdir(exist_ok=True)
    with ZipFile(source) as package:
        names = set(package.namelist())
        if sum(info.file_size for info in package.infolist()) > 1024 * 1024 * 1024:
            raise ValueError("Package exceeds the 1 GiB uncompressed safety limit")
        if any("vbaProject" in name for name in names):
            raise ValueError("Macro-bearing documents are not supported")

        def xml(part):
            return ET.fromstring(package.read(part))

        def relationships(part):
            relpart = posixpath.join(posixpath.dirname(part), "_rels", posixpath.basename(part)+".rels")
            result = {}
            if relpart in names:
                for rel in xml(relpart):
                    item = dict(rel.attrib)
                    item["external"] = item.get("TargetMode") == "External"
                    item["part"] = None if item["external"] else package_target(part, item["Target"])
                    result[item["Id"]] = item
            return result

        assets = {}
        for name in sorted(names):
            if not name.startswith("ppt/media/"):
                continue
            extension = Path(name).suffix.lower()
            if extension not in MIMES:
                raise ValueError(f"Unsupported presentation media: {name}")
            data = package.read(name)
            original_hash = hashlib.sha256(data).hexdigest()
            if extension == ".svg":
                data = sanitize_svg(data)
            target = asset_dir / posixpath.basename(name)
            target.write_bytes(data)
            assets[name] = {"path": f"assets/{target.name}", "mime": MIMES[extension],
                            "bytes": len(data), "sourceSha256": original_hash,
                            "sha256": hashlib.sha256(data).hexdigest()}

        presentation = xml("ppt/presentation.xml")
        links = relationships("ppt/presentation.xml")
        dimensions = presentation.find("p:sldSz", NS).attrib
        slides = []
        for number, slide_id in enumerate(presentation.findall("p:sldIdLst/p:sldId", NS), 1):
            part = links[slide_id.attrib[f"{{{NS['r']}}}id"]]["part"]
            root, rels = xml(part), relationships(part)
            if any(r["external"] and not r["Type"].endswith("/hyperlink") for r in rels.values()):
                raise ValueError(f"Slide {number} contains externally linked media or unsupported external relationships")
            layers = []
            layout = next((r["part"] for r in rels.values() if r["Type"].endswith("/slideLayout")), None)
            if layout:
                layers.append((layout, xml(layout)))
                master = next((r["part"] for r in relationships(layout).values() if r["Type"].endswith("/slideMaster")), None)
                if master:
                    layers.append((master, xml(master)))
            shapes = []

            def visit(container, matrix):
                for shape in container:
                    kind = shape.tag.split("}")[-1]
                    if kind == "grpSp":
                        visit(shape, multiply(matrix, group_matrix(shape)))
                        continue
                    if kind not in {"sp", "pic", "graphicFrame", "cxnSp"}:
                        continue
                    identity = next((el.attrib for el in shape.iter() if el.tag.endswith("}cNvPr")), {})
                    xf, origin = inherited_transform(shape, layers)
                    media = []
                    for el in shape.iter():
                        if el.tag.split("}")[-1] not in {"blip", "svgBlip", "videoFile", "media"}:
                            continue
                        for attr in ["embed", "link"]:
                            rel = rels.get(el.attrib.get(f"{{{NS['r']}}}{attr}", ""))
                            if rel and not rel["external"] and rel["part"] in assets and rel["part"] not in media:
                                media.append(rel["part"])
                    crop = shape.find(".//a:srcRect", NS)
                    shapes.append({"kind": kind, "id": identity.get("id"), "name": identity.get("name"),
                                   "description": identity.get("descr", ""), "text": paragraphs(shape),
                                   "placeholder": placeholder(shape), "transform": transform_values(xf),
                                   "transformSource": origin, "groupMatrix": matrix, "bounds": bounds(xf, matrix),
                                   "crop": dict(crop.attrib) if crop is not None else None, "media": media})

            visit(root.find("p:cSld/p:spTree", NS), [1, 0, 0, 1, 0, 0])
            notes = []
            note_part = next((r["part"] for r in rels.values() if r["Type"].endswith("/notesSlide")), None)
            if note_part:
                for shape in xml(note_part).findall(".//p:sp", NS):
                    ph = placeholder(shape)
                    if ph and ph.get("type") == "body":
                        notes.extend(paragraphs(shape))
            slides.append({"number": number, "part": part, "hidden": root.attrib.get("show") == "0",
                           "text": paragraphs(root), "notes": notes, "shapes": shapes,
                           "media": list(dict.fromkeys(m for s in shapes for m in s["media"])),
                           "links": [r["Target"] for r in rels.values() if r["external"]],
                           "sourceTiming": root.find("p:timing", NS) is not None})
        manifest = {"version": 1, "sourceName": source.name,
                    "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
                    "canvasEmu": {"width": int(dimensions["cx"]), "height": int(dimensions["cy"])},
                    "assets": assets, "slides": slides}
        (output / "source.json").write_text(json.dumps(manifest, ensure_ascii=True, indent=2)+"\n", encoding="utf-8")
        return manifest


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repository = Path(__file__).resolve().parents[2]
    if args.output.resolve().is_relative_to(repository):
        parser.error("Source-derived output must be outside the repository")
    manifest = inventory(args.source, args.output)
    print(json.dumps({"slides": len(manifest["slides"]), "assets": len(manifest["assets"]),
                      "videos": sum(a["mime"] == "video/mp4" for a in manifest["assets"].values()),
                      "output": str(args.output.resolve())}))
