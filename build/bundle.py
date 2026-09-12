#!/usr/bin/env python3
"""
Inline everything into one double-clickable HTML file.

index.html loads its modules and data over HTTP, which browsers refuse to do
from a file:// URL. This flattens the import graph, the vendored three.js and
data/city.json into a single inline script, so wtc.html opens straight off
the disk with no server and no network.

Each module is wrapped in its own factory function rather than concatenated,
because three.js and OrbitControls both declare module-private names such as
`_ray`; sharing one scope is a redeclaration error.

    python3 build/bundle.py   ->   wtc.html
"""

import json
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# (path, specifiers other modules import it by). Order is load order.
MODULES = [
    ("vendor/three.module.js",             ["three"]),
    ("vendor/BufferGeometryUtils.js",      ["BufferGeometryUtils"]),
    ("vendor/OrbitControls.js",            ["OrbitControls"]),
    ("vendor/Sky.js",                      ["Sky"]),
    ("vendor/Pass.js",                     ["./Pass.js"]),
    ("vendor/CopyShader.js",               ["./CopyShader.js"]),
    ("vendor/LuminosityHighPassShader.js", ["./LuminosityHighPassShader.js"]),
    ("vendor/OutputShader.js",             ["./OutputShader.js"]),
    ("vendor/ShaderPass.js",               ["./ShaderPass.js"]),
    ("vendor/MaskPass.js",                 ["./MaskPass.js"]),
    ("vendor/EffectComposer.js",           ["EffectComposer"]),
    ("vendor/RenderPass.js",               ["RenderPass"]),
    ("vendor/UnrealBloomPass.js",          ["UnrealBloomPass"]),
    ("vendor/OutputPass.js",               ["OutputPass"]),
    ("src/geo.js",                         ["./geo.js"]),
    ("src/textures.js",                    ["./textures.js"]),
    ("src/details.js",                     ["./details.js"]),
    ("src/city.js",                        ["./city.js"]),
    ("src/wtc.js",                         ["./wtc.js"]),
    ("src/main.js",                        []),
]

RE_IMPORT_NS = re.compile(
    r"""import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]\s*;?""")
RE_IMPORT_NAMED = re.compile(
    r"""import\s*\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]\s*;?""")
RE_IMPORT_BARE = re.compile(r"""^\s*import\s*['"][^'"]+['"]\s*;?\s*$""", re.M)
RE_EXPORT_LIST = re.compile(r"""^[ \t]*export\s*\{([^}]*)\}\s*;?[ \t]*$""", re.M)
RE_EXPORT_DECL = re.compile(
    r"""^[ \t]*export\s+(?=(?:const|let|var|function|class|async)\b)""", re.M)
RE_DECL_NAME = re.compile(
    r"""^[ \t]*export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)""",
    re.M)


def read(rel):
    with open(os.path.join(ROOT, rel), encoding="utf-8") as f:
        return f.read()


def split_list(body):
    """Parse the inside of an import/export brace list into (local, exposed)."""
    out = []
    for part in body.replace("\n", " ").split(","):
        part = part.strip()
        if not part:
            continue
        if " as " in part:
            a, b = (p.strip() for p in part.split(" as ", 1))
            out.append((a, b))
        else:
            out.append((part, part))
    return out


def transform(src):
    """Rewrite one ES module into a factory body, and list what it exports."""
    exported = []          # (local name, exported name)

    for m in RE_DECL_NAME.finditer(src):
        exported.append((m.group(1), m.group(1)))
    for m in RE_EXPORT_LIST.finditer(src):
        exported.extend(split_list(m.group(1)))

    src = RE_IMPORT_NS.sub(
        lambda m: "const %s = __req(%s);" % (m.group(1), json.dumps(m.group(2))),
        src)

    def named(m):
        pairs = split_list(m.group(1))
        binds = ", ".join(a if a == b else "%s: %s" % (a, b) for a, b in pairs)
        return "const { %s } = __req(%s);" % (binds, json.dumps(m.group(2)))

    src = RE_IMPORT_NAMED.sub(named, src)
    src = RE_IMPORT_BARE.sub("", src)
    src = RE_EXPORT_LIST.sub("", src)
    src = RE_EXPORT_DECL.sub("", src)

    ret = ", ".join(
        b if a == b else "%s: %s" % (b, a) for a, b in dict.fromkeys(exported))
    return src, ret


RUNTIME = """
// Minimal module registry: each module is a factory evaluated once, on first
// request, so module-private names stay in their own scope.
const __mods = {}, __cache = {};
function __def(specs, fn) { for (const s of specs) __mods[s] = fn; }
function __req(spec) {
  if (spec in __cache) return __cache[spec];
  const fn = __mods[spec];
  if (!fn) throw new Error('unbundled module: ' + spec);
  return (__cache[spec] = fn());
}
"""


def main():
    html = read("index.html")
    city = json.loads(read("data/city.json"))

    parts = [RUNTIME]
    entry = None
    for rel, specs in MODULES:
        body, ret = transform(read(rel))
        if specs:
            parts.append(
                "__def(%s, function () {\n%s\nreturn { %s };\n});"
                % (json.dumps(specs), body, ret))
        else:
            entry = body          # main.js: run last, exports nothing
        print("  %-32s exports %d" % (rel, len(ret.split(",")) if ret else 0))

    parts.append("/* ---- entry ---- */\n" + entry)
    bundle = "\n".join(parts)

    payload = (
        '<script>\nwindow.__CITY__ = %s;\n</script>\n'
        '<script type="module">\n%s\n</script>'
        % (json.dumps(city, separators=(",", ":")), bundle)
    )
    out, n = re.subn(
        r'<script type="importmap">[\s\S]*?</script>\s*'
        r'<script type="module" src="\./src/main\.js"></script>',
        lambda _m: payload, html, count=1)
    if not n:
        raise SystemExit("could not find the script tags to replace in index.html")

    dest = os.path.join(ROOT, "wtc.html")
    with open(dest, "w", encoding="utf-8") as f:
        f.write(out)
    print("\nwrote wtc.html  (%.1f MB, %d buildings)"
          % (os.path.getsize(dest) / 1048576.0, len(city["buildings"])))


if __name__ == "__main__":
    main()
