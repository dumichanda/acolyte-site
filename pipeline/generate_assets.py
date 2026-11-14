"""Image asset library for the reports' Story style, generated with an image model on OpenRouter.

    python generate_assets.py --list                  # image models on OpenRouter with prices
    python generate_assets.py --limit 2               # generate the next 2 missing images (test)
    python generate_assets.py                         # generate every missing image in data/asset_library.csv

Images are saved as compressed JPEGs in web/public/assets/library/ with an index.json of tags, so the site and the
report exporter can pick a picture by tag (e.g. 'gauteng', 'prices-down'). Existing files are never regenerated.
Model: IMAGE_MODEL (default: the first Gemini image model OpenRouter lists). Needs OPENROUTER_API_KEY.
"""
import argparse
import base64
import csv
import io
import json
import os
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "web" / "public" / "assets" / "library"
API = "https://openrouter.ai/api/v1"
HOUSE_STYLE = (
    "Editorial illustration for a South African data-analytics brand. Clean, modern, slightly isometric flat style with "
    "soft depth and gentle shadows, like a premium explainer video. Palette: deep charcoal (#0C0C0E) and near-black navy, "
    "lime green accent (#C8F135), warm off-white, small touches of muted olive. South African settings, people and details "
    "where relevant (diverse South Africans, local architecture, local shops, rand). No text, no letters, no logos, no "
    "watermarks. Generous empty space on one side so a headline can be placed over it. 16:9 landscape.")


def headers() -> dict:
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        sys.exit("OPENROUTER_API_KEY is not set.")
    return {"Authorization": f"Bearer {key}", "HTTP-Referer": "https://dumichanda.github.io/acolyte-site/", "X-Title": "Acolyte"}


def image_models() -> list[dict]:
    r = requests.get(f"{API}/models", params={"output_modalities": "image"}, headers=headers(), timeout=60)
    r.raise_for_status()
    ms = [m for m in r.json().get("data", []) if "image" in ((m.get("architecture") or {}).get("output_modalities") or [])]
    return sorted(ms, key=lambda m: m["id"])


def pick_model() -> str:
    if os.environ.get("IMAGE_MODEL"):
        return os.environ["IMAGE_MODEL"]
    ms = [m["id"] for m in image_models()]
    pref = [m for m in ms if "gemini" in m and "image" in m] or ms
    if not pref:
        sys.exit("No image models are available on this OpenRouter key.")
    return pref[0]


def generate(model: str, prompt: str) -> tuple[bytes, float | None]:
    body = {"model": model, "modalities": ["image", "text"], "image_config": {"aspect_ratio": "16:9"},
            "messages": [{"role": "user", "content": f"{HOUSE_STYLE}\n\nCreate this image: {prompt}"}], "usage": {"include": True}}
    r = requests.post(f"{API}/chat/completions", json=body, headers=headers(), timeout=240)
    if r.status_code >= 400:
        raise RuntimeError(f"OpenRouter {r.status_code}: {r.text[:300]}")
    d = r.json()
    msg = (d.get("choices") or [{}])[0].get("message") or {}
    imgs = msg.get("images") or []
    if not imgs:
        raise RuntimeError(f"No image returned: {str(msg.get('content'))[:200]}")
    url = imgs[0]["image_url"]["url"]
    return base64.b64decode(url.split(",", 1)[1]), (d.get("usage") or {}).get("cost")


def to_jpeg(raw: bytes, width: int = 1600) -> bytes:
    from PIL import Image
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    if im.width > width:
        im = im.resize((width, round(im.height * width / im.width)))
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=82, optimize=True, progressive=True)
    return buf.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    if a.list:
        for m in image_models():
            p = m.get("pricing") or {}
            print(f"{m['id']:55} image≈${p.get('image', '?')}  in≈${p.get('prompt', '?')}/tok  out≈${p.get('completion', '?')}/tok")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    idx_path = OUT / "index.json"
    index = json.loads(idx_path.read_text()) if idx_path.exists() else {"images": []}
    have = {i["file"] for i in index["images"]}
    rows = list(csv.DictReader(open(ROOT / "data" / "asset_library.csv")))
    todo = [r for r in rows if r["file"] not in have or not (OUT / r["file"]).exists()]
    if a.limit:
        todo = todo[: a.limit]
    model = pick_model()
    print(f"Model: {model}. {len(todo)} image(s) to make.")
    spent = 0.0
    for r in todo:
        try:
            raw, cost = generate(model, r["prompt"])
        except Exception as e:
            print(f"  {r['file']}: FAILED {e}")
            continue
        (OUT / r["file"]).write_bytes(to_jpeg(raw))
        spent += cost or 0
        index["images"] = [i for i in index["images"] if i["file"] != r["file"]] + [
            {"file": r["file"], "tags": r["tags"].split(","), "prompt": r["prompt"], "model": model}]
        idx_path.write_text(json.dumps(index, indent=1))
        print(f"  {r['file']}: ok ({(OUT / r['file']).stat().st_size // 1024} KB, ${cost or 0:.3f})")
    print(f"Done. Spent about ${spent:.2f}.")


if __name__ == "__main__":
    main()
