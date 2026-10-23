"""
@file generate_deps_report.py
@description
Génère un rapport Markdown analytique à partir d'un fichier de dépendances (.jsonl/.ndjson ou .json/.json.gz).
Inclut des tableaux par librairie, des camemberts Mermaid, et des sections détaillées.

@usage
python generate_deps_report.py --in ./out/dependencies.jsonl --out ./out/dependencies-report.md

@note
Cette version inclut des docstrings détaillées pour chaque fonction et des commentaires explicatifs dans le code.
Chaque paramètre est documenté et chaque étape clé est commentée.
"""

#!/usr/bin/env python3
# generate_deps_report.py
# Génère un rapport Markdown analytique à partir d'un fichier de dépendances
# (.jsonl/.ndjson ou .json/.json.gz), avec tableaux par librairie (buckets
# "version ≥ M.m" NON CUMULÉS) et camemberts Mermaid, pour :
# 1) les versions RÉSOLUES (lockfiles),
# 2) les versions DÉCLARÉES (declared_range nettoyé pour ne garder que la version).
# Inclut une section "Pré‑releases / RC utilisées" (agrégée + détail exhaustif).
#
# Colonnes attendues dans les items :
# org, repo, package_path, package_name, dependency, declared_range, resolved_version, lock_source, commit_sha_scanned
#
# Usage :
# python generate_deps_report.py --in ./out/dependencies.jsonl --out ./out/dependencies-report.md
# (désormais, --in accepte aussi .json et .json(.gz))
#
# Options clés :
# --libs "@repo/*,react,org.slf4j:slf4j-api"
# --libs-file ./libs.txt
# --orgs "org1,org2"
# --repos "org1/repoA,org2/repoB"
# --top 50
# --per-lib-limit 20
# --perlib-include-zero-line / --no-perlib-include-zero-line
# --perlib-include-zero-minors / --no-perlib-include-zero-minors
# --pie-max-slices 12
# --case-insensitive
# --title "Etat des dépendances - Oct 2025"
# --include-sections "overview,libraries,drift,prereleases,unresolved,repos,orgs,perlib"
# --json-items-key items   (si le .json est un objet dont la liste est sous cette clé)

import argparse
import datetime as dt
import json
import os
import re
import gzip
from pathlib import Path
from collections import Counter, defaultdict
from typing import Any, Dict, Iterable, List, Optional, Tuple, Set, Union

# -------- Args & helpers --------
def parse_args():
    ap = argparse.ArgumentParser(description="Generate analytical Markdown report from dependencies")
    ap.add_argument("--in", dest="in_path", required=True,
                    help="Path to dependencies (.jsonl/.ndjson or .json[.gz])")
    ap.add_argument("--out", dest="out_path", required=True, help="Path to output Markdown report")
    ap.add_argument("--libs", default="", help="Comma-separated glob patterns to include (match on 'dependency')")
    ap.add_argument("--libs-file", default="", help="File with one glob per line (# comments allowed)")
    ap.add_argument("--orgs", default="", help="Comma-separated list of orgs to include")
    ap.add_argument("--repos", default="", help="Comma-separated list of full repo names org/repo to include")
    ap.add_argument("--top", type=int, default=50, help="Max rows in main summary tables")
    ap.add_argument("--per-lib-limit", type=int, default=20, help="Max libraries in per-library details")
    # options per-lib buckets
    ap.add_argument("--perlib-include-zero-line", dest="perlib_zero_line", action="store_true", default=True,
                    help="Include 'version = 0' line (0.x aggregate)")
    ap.add_argument("--no-perlib-include-zero-line", dest="perlib_zero_line", action="store_false",
                    help="Do not include 'version = 0' line")
    ap.add_argument("--perlib-include-zero-minors", dest="perlib_zero_minors", action="store_true", default=True,
                    help="Include 'version ≥ 0.m' buckets for major 0")
    ap.add_argument("--no-perlib-include-zero-minors", dest="perlib_zero_minors", action="store_false",
                    help="Do not include 'version ≥ 0.m' buckets")
    ap.add_argument("--pie-max-slices", type=int, default=12,
                    help="Max slices in Mermaid pie; others grouped into 'Autres'")
    ap.add_argument("--case-insensitive", action="store_true", help="Case-insensitive matching for libs patterns")
    ap.add_argument("--title", default="", help="Report title (optional)")
    ap.add_argument("--include-sections",
                    default="overview,libraries,drift,prereleases,unresolved,repos,orgs,perlib,branches",
                    help="Comma-separated sections to include: overview,libraries,drift,prereleases,unresolved,repos,orgs,perlib,branches")
    ap.add_argument("--json-items-key", default="",
                    help="When --in is a .json object, key that contains the list (e.g. 'items')")
    return ap.parse_args()


def load_patterns(args) -> List[str]:
    pats = []
    if args.libs:
        pats += [p.strip() for p in args.libs.split(",") if p.strip()]
    if args.libs_file:
        with open(args.libs_file, "r", encoding="utf-8") as f:
            for line in f:
                s = line.strip()
                if s and not s.startswith("#"):
                    pats.append(s)
    return pats


def glob_to_regex(glob: str, flags=0):
    esc = re.escape(glob).replace(r"\*", ".*")
    return re.compile(r"^" + esc + r"$", flags)


def compile_matchers(patterns: List[str], ci: bool):
    if not patterns:
        return []
    flags = re.IGNORECASE if ci else 0
    return [glob_to_regex(p, flags) for p in patterns]


def matches_any(value: str, matchers) -> bool:
    if not matchers:
        return True
    if not isinstance(value, str) or not value:
        return False
    return any(m.fullmatch(value) for m in matchers)


def now_iso():
    return dt.datetime.now().astimezone()


def today_fr():
    return now_iso().strftime("%d/%m/%Y")


def sanitize_label(s: str) -> str:
    return s.replace('"', '\\"')

# -------- Semver helpers --------
SEMVER_RE = re.compile(r"^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$")
# Inclut alpha/beta/rc/preview/hc et SNAPSHOT
PRERELEASE_RE = re.compile(r"(?i)(?:-|\.)(alpha|beta|rc|preview|hc)|SNAPSHOT")


def semver_tuple(v: str) -> Optional[Tuple[int, int, int]]:
    if not isinstance(v, str):
        return None
    m = SEMVER_RE.match(v.strip())
    if not m:
        return None
    try:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    except Exception:
        return None


def semver_major(v: str) -> Optional[int]:
    t = semver_tuple(v)
    return t[0] if t else None


def is_prerelease(v: str) -> bool:
    if not isinstance(v, str):
        return False
    return bool(PRERELEASE_RE.search(v))

# -------- Declared-range parsing --------
# Extrait la première "version" rencontrée dans declared_range, en tolérant :
# - MAJ.MIN.PATCH
# - MAJ.MIN
# - MAJ.MIN.x
# Exemples:
# ^1.2.3 -> (1,2,3)
# ~1.4   -> (1,4,0)
# >=1.5 <2 -> (1,5,0) (prend la première version trouvée)
# 0.2.x -> (0,2,0)
# latest, *, workspace:* -> None (non parsées)
DECLARED_VER_RE = re.compile(r"(\d+)\.(\d+)(?:\.(\d+|x|X))?")


def declared_to_tuple(s: Optional[str]) -> Optional[Tuple[int, int, int]]:
    if not isinstance(s, str):
        return None
    m = DECLARED_VER_RE.search(s)
    if not m:
        return None
    maj = int(m.group(1))
    minor = int(m.group(2))
    g3 = m.group(3)
    if g3 is None or str(g3).lower() == 'x':
        patch = 0
    else:
        patch = int(g3)
    return (maj, minor, patch)

# -------- Load data (jsonl, ndjson, json, json.gz) --------

def _open_maybe_gzip(path: Union[str, Path], encoding: str = "utf-8"):
    p = Path(path)
    if p.suffix == ".gz":
        return gzip.open(p, "rt", encoding=encoding)
    return open(p, "r", encoding=encoding)


def _iter_jsonl(file_obj, allow_line_comments: bool = True, on_error: str = "log"):
    for ln, raw in enumerate(file_obj, start=1):
        line = raw.strip()
        if not line:
            continue
        if allow_line_comments and line.startswith("//"):
            continue
        if allow_line_comments and "//" in line:
            line = line.split("//", 1)[0].rstrip()
            if not line:
                continue
        try:
            yield ln, json.loads(line)
        except json.JSONDecodeError as e:
            if on_error == "raise":
                raise
            elif on_error == "log":
                print(f"[load_dependencies] JSONL error line {ln}: {e}")
            continue


def _resolve_items_from_json_doc(data: Any, items_key: Optional[str]) -> Iterable[Any]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        if items_key:
            val = data.get(items_key)
            return val if isinstance(val, list) else []
        for k in ("items", "rows", "data", "dependencies", "results", "list"):
            val = data.get(k)
            if isinstance(val, list):
                return val
    return []


def load_dependencies(path: Union[str, Path],
                      lib_matchers,
                      org_filter: Set[str],
                      repo_filter: Set[str],
                      *,
                      json_items_key: Optional[str] = None) -> List[Dict[str, Optional[str]]]:
    """
    Charge des dépendances depuis :
    - .jsonl / .ndjson : 1 objet par ligne
    - .json (.gz pris en charge) : tableau d'objets OU objet racine contenant une liste (clé configurable)
    """
    rows: List[Dict[str, Optional[str]]] = []
    p = Path(path)
    suffixes = [s.lower() for s in p.suffixes]  # ex: ['.json', '.gz']
    is_jsonl = any(s in (".jsonl", ".ndjson") for s in suffixes)
    is_json = (".json" in suffixes) and not is_jsonl

    def keep_obj(obj: Dict[str, Any]) -> Optional[Dict[str, Optional[str]]]:
        org = (obj.get("org") or "").strip()
        repo = (obj.get("repo") or "").strip()
        dep = obj.get("dependency")
        if org_filter and org not in org_filter:
            return None
        full = f"{org}/{repo}" if org and repo else (repo or "")
        if repo_filter and full not in repo_filter:
            return None
        if not matches_any(dep, lib_matchers):
            return None
        return {
            "org": org or "",
            "repo": repo or "",
            "package_path": (obj.get("package_path") or "").strip(),
            "package_name": (obj.get("package_name") or "").strip(),
            "dependency": dep or "",
            "declared_range": obj.get("declared_range", None),
            "declared_version": obj.get("declared_version", None),
            "resolved_version": obj.get("resolved_version", None),
            "lock_source": obj.get("lock_source", None),
            "default_branch": obj.get("default_branch", ""),
        }

    with _open_maybe_gzip(p) as f:
        if is_jsonl:
            for _ln, obj in _iter_jsonl(f):
                if not isinstance(obj, dict):
                    continue
                row = keep_obj(obj)
                if row:
                    rows.append(row)
        elif is_json:
            try:
                data = json.load(f)
            except json.JSONDecodeError as e:
                print(f"[load_dependencies] JSON error: {e}")
                return rows
            items = _resolve_items_from_json_doc(data, json_items_key)
            for obj in items:
                if not isinstance(obj, dict):
                    continue
                row = keep_obj(obj)
                if row:
                    rows.append(row)
        else:
            # Fallback inconnu : tenter JSONL (par compat)
            for _ln, obj in _iter_jsonl(f):
                if not isinstance(obj, dict):
                    continue
                row = keep_obj(obj)
                if row:
                    rows.append(row)
    return rows

# -------- Aggregations globales --------

def aggregate(rows: List[Dict], top_n: int):
    unique_libs = set()
    orgs = set()
    repos = set()
    packages = set()
    by_lib = {}
    by_org = {}
    unresolved_count = 0

    for r in rows:
        org = r["org"]
        repo = r["repo"]
        pkg_key = (org, repo, r["package_path"], r["package_name"])
        lib = r["dependency"]
        resv = r["resolved_version"]

        unique_libs.add(lib)
        if org:
            orgs.add(org)
        repos.add((org, repo))
        packages.add(pkg_key)
        if resv is None:
            unresolved_count += 1

        d = by_lib.setdefault(lib, {
            "repos": set(),
            "packages": set(),
            "versions": Counter(),
            "majors": set(),
            "unresolved": 0,
            "prerelease_any": False,
        })
        d["repos"].add((org, repo))
        d["packages"].add(pkg_key)
        d["versions"][resv or "(unresolved)"] += 1
        mj = semver_major(resv) if resv else None
        if mj is not None:
            d["majors"].add(mj)
        if resv is None:
            d["unresolved"] += 1
        if is_prerelease(resv or ""):
            d["prerelease_any"] = True

        o = by_org.setdefault(org, {
            "repos": set(),
            "packages": set(),
            "libs": set(),
            "rows": 0,
            "unresolved": 0,
            "lib_versions": defaultdict(set),
        })
        o["repos"].add((org, repo))
        o["packages"].add(pkg_key)
        o["libs"].add(lib)
        o["rows"] += 1
        if resv is None:
            o["unresolved"] += 1
        else:
            o["lib_versions"][lib].add(resv)

    total_rows = len(rows)
    stats = {
        "total_rows": total_rows,
        "unique_libs": len(unique_libs),
        "unique_orgs": len(orgs),
        "unique_repos": len(repos),
        "unique_packages": len(packages),
        "resolved_ratio": ((total_rows - unresolved_count) / total_rows) if total_rows else 0.0,
        "unresolved_count": unresolved_count,
    }

    lib_table = []
    for lib, d in by_lib.items():
        versions = d["versions"]
        most_common = None
        if versions:
            most_common = sorted(versions.items(), key=lambda kv: (-kv[1], str(kv[0])))[0][0]
        lib_table.append({
            "library": lib,
            "repos": len(d["repos"]),
            "packages": len(d["packages"]),
            "resolved_versions_count": len({v for v in versions.keys() if v != "(unresolved)"}),
            "most_common": most_common or "",
            "multi_major": len(d["majors"]) > 1,
            "prerelease": d["prerelease_any"],
            "unresolved_rows": d["unresolved"],
        })

    lib_table_sorted = sorted(lib_table, key=lambda x: (-x["repos"], -x["packages"], x["library"]))[:top_n]

    # dérives multi‑majors
    drift_libs = []
    for lib, d in by_lib.items():
        if len(d["majors"]) > 1:
            by_major = defaultdict(list)
            for v, cnt in d["versions"].items():
                mj = semver_major(v) if v and v != "(unresolved)" else None
                by_major[mj].append((v, cnt))
            major_lines = []
            for mj in sorted([m for m in by_major.keys() if m is not None]):
                versions_sorted = sorted(by_major[mj], key=lambda kv: (-kv[1], kv[0] or ""))
                sample = ", ".join([f"{ver} ({c})" for ver, c in versions_sorted[:5]])
                major_lines.append(f"**{mj}.x** → {sample}" if sample else f"**{mj}.x**")
            drift_libs.append({
                "library": lib,
                "majors": sorted([m for m in d["majors"] if m is not None]),
                "repos": len(d["repos"]),
                "versions_by_major_md": "; ".join(major_lines) if major_lines else "",
            })

    drift_libs_sorted = sorted(drift_libs, key=lambda x: (-len(x["majors"]), -x["repos"], x["library"]))[:top_n]

    # non résolu par repo
    unresolved_by_repo = Counter()
    total_by_repo = Counter()
    for r in rows:
        key = (r["org"], r["repo"])
        total_by_repo[key] += 1
        if r["resolved_version"] is None:
            unresolved_by_repo[key] += 1

    repos_unresolved_table = []
    for key, unr in unresolved_by_repo.most_common(top_n):
        tot = total_by_repo[key]
        pct = (unr / tot) if tot else 0
        repos_unresolved_table.append({
            "org": key[0], "repo": key[1], "unresolved": unr, "total": tot, "pct": pct
        })

    # --- Pré‑releases (agrégé + détaillé) ---
    prerelease_cnt = Counter()  # (lib, version) -> count
    prerelease_details = defaultdict(list)  # (lib, version) -> list of dicts
    for r in rows:
        v = r["resolved_version"]
        if v and is_prerelease(v):
            key = (r["dependency"], v)
            prerelease_cnt[key] += 1
            prerelease_details[key].append({
                "org": r["org"],
                "repo": r["repo"],
                "package_name": r.get("package_name", "") or "",
                "package_path": r.get("package_path", "") or "",
            })

    # agrégé (liste complète)
    prerelease_table = []
    for (lib, v), cnt in sorted(prerelease_cnt.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        prerelease_table.append({"library": lib, "version": v, "occurrences": cnt})

    # détails exhaustifs (tri lib, version, org, repo, package)
    prerelease_full_flat = []  # lignes à 5 colonnes : Org | Repo | Package | Librairie | Version
    for (lib, v) in sorted(prerelease_details.keys(), key=lambda k: (k[0], k[1])):
        items = sorted(prerelease_details[(lib, v)], key=lambda d: (d["org"], d["repo"], d["package_name"]))
        for it in items:
            prerelease_full_flat.append({
                "org": it["org"], "repo": it["repo"],
                "package_name": it.get("package_name") or "",
                "library": lib, "version": v
            })

    # org summary
    org_table = []
    for org, d in by_org.items():
        if not org:
            continue
        multi_major_libs = 0
        for lib, ver_set in d["lib_versions"].items():
            majors = set()
            for v in ver_set:
                mj = semver_major(v)
                if mj is not None:
                    majors.add(mj)
            if len(majors) > 1:
                multi_major_libs += 1
        unresolved_ratio = (d["unresolved"] / d["rows"]) if d["rows"] else 0
        org_table.append({
            "org": org,
            "repos": len(d["repos"]),
            "packages": len(d["packages"]),
            "libs": len(d["libs"]),
            "rows": d["rows"],
            "unresolved_ratio": unresolved_ratio,
            "multi_major_libs": multi_major_libs,
        })

    org_table_sorted = sorted(org_table, key=lambda x: (-x["repos"], -x["libs"], x["org"]))[:top_n]

    # --- Aggregation par branche par défaut ---
    by_branch = {}
    for r in rows:
        branch = r.get("default_branch", "") or "(inconnu)"
        b = by_branch.setdefault(branch, {
            "repos": set(),
            "packages": set(),
            "libs": set(),
            "rows": 0,
            "unresolved": 0
        })
        b["repos"].add((r["org"], r["repo"]))
        b["packages"].add((r["org"], r["repo"], r["package_path"], r["package_name"]))
        b["libs"].add(r["dependency"])
        b["rows"] += 1
        if r["resolved_version"] is None:
            b["unresolved"] += 1

    branch_table = []
    for branch, d in by_branch.items():
        unresolved_ratio = (d["unresolved"] / d["rows"]) if d["rows"] else 0
        branch_table.append({
            "branch": branch,
            "repos": len(d["repos"]),
            "packages": len(d["packages"]),
            "libs": len(d["libs"]),
            "rows": d["rows"],
            "unresolved_ratio": unresolved_ratio,
        })
    branch_table_sorted = sorted(branch_table, key=lambda x: (-x["repos"], -x["libs"], x["branch"]))[:top_n]


    return {
        "stats": stats,
        "lib_table": lib_table_sorted,
        "drift_libs": drift_libs_sorted,
        "repos_unresolved": repos_unresolved_table,
        "prerelease_table": prerelease_table,  # agrégé complet
        "prerelease_full_flat": prerelease_full_flat,  # détail exhaustif (flat)
        "org_table": org_table_sorted,
        "branch_table": branch_table_sorted,
        "rows": rows,
        "lib_order": [x["library"] for x in lib_table_sorted],
    }

# -------- Per-library helpers --------

def perlib_minor_buckets_resolved(lib: str, rows: List[Dict], include_major0_minors: bool):
    """Buckets non cumulés par (maj, min) pour RESOLVED."""
    versions = [r["resolved_version"] for r in rows if r["dependency"] == lib]
    unresolved = sum(1 for v in versions if v is None)
    triples = [semver_tuple(v) for v in versions if v is not None]
    triples = [t for t in triples if t is not None]
    v0_total = sum(1 for (maj, mi, pa) in triples if maj == 0)
    buckets = Counter()
    for (maj, mi, pa) in triples:
        if maj == 0 and not include_major0_minors:
            continue
        buckets[(maj, mi)] += 1
    return v0_total, unresolved, buckets


def perlib_minor_buckets_declared(lib: str, rows: List[Dict], include_major0_minors: bool):
    """Buckets non cumulés par (maj, min) pour DECLARED_RANGE (version extraite)."""
    decls = [r["declared_range"] for r in rows if r["dependency"] == lib]
    parsed = [declared_to_tuple(s) for s in decls]
    not_parsed = sum(1 for t in parsed if t is None)
    triples = [t for t in parsed if t is not None]
    v0_total = sum(1 for (maj, mi, pa) in triples if maj == 0)
    buckets = Counter()
    for (maj, mi, pa) in triples:
        if maj == 0 and not include_major0_minors:
            continue
        buckets[(maj, mi)] += 1
    return v0_total, not_parsed, buckets  # "not_parsed" ~ Non parsées


def render_mermaid_pie_for_lib(lib: str, buckets: Dict[Tuple[int, int], int], other_label: str,
                               other_count: int, pie_max_slices: int):
    """Bloc Mermaid pie showData par (maj.minor).x + 'other_label' si >0."""
    items = []
    for (maj, mi), cnt in sorted(buckets.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        if cnt <= 0:
            continue
        items.append((f"{maj}.{mi}.x", cnt))
    if other_count and other_count > 0:
        items.append((other_label, other_count))

    if len(items) > pie_max_slices:
        items_sorted = sorted(items, key=lambda kv: (kv[0] != other_label, -kv[1]))
        keep = items_sorted[:pie_max_slices - 1]
        keep_set = set(keep)
        others = 0
        for kv in items:
            if kv not in keep_set and kv[0] != other_label:
                others += kv[1]
        items = sorted(keep, key=lambda kv: (kv[0] == other_label, kv[0]))
        if others > 0:
            items.append(("Autres", others))

    lines = []
    lines.append("```mermaid")
    lines.append("pie showData")
    lines.append(f' title Répartition par version — {sanitize_label(lib)}')
    for label, count in items:
        lines.append(f' "{sanitize_label(label)}" : {count}')
    lines.append("```")
    return "\n".join(lines)


def render_table(headers: List[str], rows: List[List[str]]):
    out = []
    out.append("| " + " | ".join(headers) + " |")
    out.append("| " + " | ".join(["---"] * len(headers)) + " |")
    for r in rows:
        out.append("| " + " | ".join(r) + " |")
    return "\n".join(out)

# -------- Markdown rendering --------

def fmt_pct(p):
    return f"{p*100:.1f}%"


def render_report(
    data: Dict,
    title: str,
    sections: Set[str],
    per_lib_limit: int,
    perlib_zero_line: bool,
    perlib_zero_minors: bool,
    pie_max_slices: int
):
    stats = data["stats"]
    now = now_iso()
    today = now.strftime("%d/%m/%Y")
    h = []

    report_title = title or "Rapport analytique des dépendances"
    h.append(f"# {report_title}")
    h.append("")
    h.append(f"_Généré le {now.isoformat(timespec='seconds')}_")
    h.append("")

    if "overview" in sections:
        h.append("## Vue d’ensemble")
        h.append("")
        h.append(render_table(
            ["Métrique", "Valeur"],
            [
                ["Lignes (dépendances) analysées", f"{stats['total_rows']}`"[:-1]],  # safe stringify
                ["Librairies distinctes", f"{stats['unique_libs']}`"[:-1]],
                ["Organisations", f"{stats['unique_orgs']}`"[:-1]],
                ["Repositories", f"{stats['unique_repos']}`"[:-1]],
                ["Packages", f"{stats['unique_packages']}`"[:-1]],
                ["Taux de versions résolues", fmt_pct(stats["resolved_ratio"])],
                ["Lignes non résolues", f"{stats['unresolved_count']}`"[:-1]],
            ]
        ))
        h.append("")

    if "libraries" in sections:
        h.append("## Synthèse par librairie (Top N)")
        h.append("")
        rows = []
        for r in data["lib_table"]:
            rows.append([
                f"`{r['library']}`",
                str(r["repos"]),
                str(r["packages"]),
                str(r["resolved_versions_count"]),
                f"`{r['most_common']}`" if r["most_common"] else "",
                "✅" if r["multi_major"] else "—",
                "⚠️" if r["prerelease"] else "—",
                str(r["unresolved_rows"]),
            ])
        h.append(render_table(
            ["Librairie", "Repos", "Packages", "Nb versions résolues", "Version la plus utilisée", "Multi‑major", "Pré‑release", "Non résolues"],
            rows
        ))
        h.append("> **Lecture** : `Multi‑major` signale des usages simultanés de plusieurs versions majeures. `Pré‑release` indique qu’au moins une version alpha/beta/rc/snapshot est utilisée.")
        h.append("")

    if "drift" in sections:
        h.append("## Dérives (multi‑majors)")
        h.append("")
        drift = data["drift_libs"]
        if not drift:
            h.append("_Aucune librairie avec plusieurs versions majeures détectées._")
        else:
            rows = []
            for r in drift:
                rows.append([
                    f"`{r['library']}`",
                    ", ".join([f"{m}.x" for m in r["majors"]]),
                    str(r["repos"]),
                    r["versions_by_major_md"],
                ])
            h.append(render_table(
                ["Librairie", "Majors détectées", "Repos impactés", "Échantillon versions par major"],
                rows
            ))
            h.append("")

    if "prereleases" in sections:
        h.append("## Pré‑releases / RC utilisées")
        h.append("")
        pr = data.get("prerelease_table", [])
        pr_flat = data.get("prerelease_full_flat", [])
        # 1) Vue agrégée (lib, version, occurrences) — liste complète
        if not pr:
            h.append("_Aucune version pré‑release/RC/SNAPSHOT détectée._")
            h.append("")
        else:
            rows = []
            for r in pr:
                rows.append([f"`{r['library']}`", f"`{r['version']}`", str(r["occurrences"])])
            h.append("**Synthèse (agrégée)**")
            h.append("")
            h.append(render_table(["Librairie", "Version", "Occurrences"], rows))
            h.append("> **Attention** : éviter les pré‑releases en production. Bloquer via rulesets/CI si nécessaire.")
            h.append("")
        # 2) Détail exhaustif — format demandé : Org | Repo | Package | Librairie | Version
        if pr_flat:
            h.append("**Détail exhaustif**")
            h.append("")
            rows = []
            for item in pr_flat:
                rows.append([
                    f"`{item['org']}`",
                    f"`{item['repo']}`",
                    f"`{item.get('package_name','')}`",
                    f"`{item['library']}`",
                    f"`{item['version']}`",
                ])
            h.append(render_table(["Org", "Repo", "Package", "Librairie", "Version"], rows))
            h.append("")

    if "unresolved" in sections:
        h.append("## Résolutions manquantes (lockfiles absents ou non exploités)")
        h.append("")
        unr = data["repos_unresolved"]
        if not unr:
            h.append("_Pas de résolutions manquantes détectées._")
        else:
            rows = []
            for r in unr:
                rows.append([f"`{r['org']}`", f"`{r['repo']}`", str(r["unresolved"]), str(r["total"]), fmt_pct(r["pct"])])
            h.append(render_table(["Org", "Repo", "Non résolues", "Total", "% non résolues"], rows))
            h.append("> **Interprétation** : un taux élevé suggère l’absence de lockfiles commités (npm/yarn/pnpm) ou l’impossibilité d’inférer côté Maven/Gradle.")
            h.append("")

    if "orgs" in sections:
        h.append("## Vue par organisation (Top N)")
        h.append("")
        rows = []
        for r in data["org_table"]:
            rows.append([
                f"`{r['org']}`",
                str(r["repos"]),
                str(r["packages"]),
                str(r["libs"]),
                str(r["rows"]),
                fmt_pct(r["unresolved_ratio"]),
                str(r["multi_major_libs"]),
            ])
        if rows:
            h.append(render_table(
                ["Organisation", "Repos", "Packages", "Librairies", "Lignes", "% non résolues", "Libs multi‑major"],
                rows
            ))
        else:
            h.append("_Aucune organisation dans le périmètre filtré._")
        h.append("")

    
    if "branches" in sections:
        h.append("## Vue par branche par défaut (Top N)")
        h.append("")
        rows = []
        for r in data["branch_table"]:
            rows.append([
                f"`{r['branch']}`",
                str(r["repos"]),
                str(r["packages"]),
                str(r["libs"]),
                str(r["rows"]),
                fmt_pct(r["unresolved_ratio"]),
            ])
        if rows:
            h.append(render_table(["Branche", "Repos", "Packages", "Librairies", "Lignes", "% non résolues"], rows))
        else:
            h.append("_Aucune branche détectée._")
        h.append("")

    # ---- Détails par librairie ----
    if "perlib" in sections:
        h.append("## Détails par librairie")
        h.append("")
        rows_all = data["rows"]
        lib_order = data.get("lib_order") or sorted({r["dependency"] for r in rows_all})
        lib_order = lib_order[:per_lib_limit]
        date_hdr = today
        for lib in lib_order:
            h.append(f"### `{lib}`")
            # ---- (1) Vue RÉSOLUE ----
            v0_res, unresolved_res, buckets_res = perlib_minor_buckets_resolved(
                lib, rows_all, include_major0_minors=perlib_zero_minors
            )
            headers = ["Version", date_hdr]
            table_rows = []
            if perlib_zero_line:
                table_rows.append(["version = 0", str(v0_res)])
            for (maj, mi), count in sorted(buckets_res.items(), key=lambda kv: (kv[0][0], kv[0][1])):
                if maj == 0 and not perlib_zero_minors:
                    continue
                table_rows.append([f"version ≥ {maj}.{mi}", str(count)])
            if unresolved_res > 0:
                table_rows.append(["Non résolues", str(unresolved_res)])
            h.append("**Résolu (lockfiles)**")
            h.append("")
            h.append(render_table(headers, table_rows))
            h.append("")
            h.append(render_mermaid_pie_for_lib(lib, buckets_res, "Non résolues", unresolved_res, pie_max_slices))
            h.append("")
            # ---- (2) Vue DÉCLARÉE (declared_range nettoyé) ----
            v0_dec, not_parsed, buckets_dec = perlib_minor_buckets_declared(
                lib, rows_all, include_major0_minors=perlib_zero_minors
            )
            headers2 = ["Version (déclarée)", date_hdr]
            table_rows2 = []
            if perlib_zero_line:
                table_rows2.append(["version = 0", str(v0_dec)])
            for (maj, mi), count in sorted(buckets_dec.items(), key=lambda kv: (kv[0][0], kv[0][1])):
                if maj == 0 and not perlib_zero_minors:
                    continue
                table_rows2.append([f"version ≥ {maj}.{mi}", str(count)])
            if not_parsed > 0:
                table_rows2.append(["Non parsées", str(not_parsed)])
            h.append("**Déclaré (declared_range → version)**")
            h.append("")
            h.append(render_table(headers2, table_rows2))
            h.append("")
            h.append(render_mermaid_pie_for_lib(lib, buckets_dec, "Non parsées", not_parsed, pie_max_slices))
            h.append("")

        # Méthodologie & limites
        h.append("---")
        h.append("### Méthodologie & limites")
        h.append("")
        h.append("- **Buckets non cumulés** : chaque ligne `version ≥ M.m` compte les versions **M.m.x** (et seulement celles‑ci).")
        h.append("- **`version = 0`** : agrège toutes les **0.x** ; si les buckets `0.m` sont listés, ils sont **disjoints** entre eux mais recouvrent logiquement une partie de `0.x` (ligne de cadrage).")
        h.append("- **Déclaré (declared_range)** : on **extrait la première version** présente (ex. `^1.2`, `>=1.5 <2` ⇒ **1.2.0** / **1.5.0**). Les cas sans version (ex. `*`, `latest`, `workspace:*`) sont en **« Non parsées »**.")
        h.append("- **Pré‑releases** : détection des suffixes `-alpha`, `-beta`, `-rc`, `-preview`, `-hc` ou `SNAPSHOT`.")
        h.append("- **Mermaid pie** : tranches disjointes par minor (`M.m.x`) + une part « Non résolues » / « Non parsées ». Au‑delà de `--pie-max-slices`, les plus petites parts sont regroupées en « Autres ».")
        h.append("- **Versions résolues** : issues des lockfiles (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, `gradle/versions.lock` si présent).")
        h.append("- **Maven** : sans exécution locale (effective POM), les versions résolues sont souvent indisponibles.")
        h.append("")

    return "\n".join(h)

# -------- main --------

def main():
    args = parse_args()
    patterns = load_patterns(args)
    lib_matchers = compile_matchers(patterns, args.case_insensitive)
    org_filter = set([s.strip() for s in args.orgs.split(",") if s.strip()]) if args.orgs else set()
    repo_filter = set([s.strip() for s in args.repos.split(",") if s.strip()]) if args.repos else set()
    rows = load_dependencies(
        args.in_path,
        lib_matchers,
        org_filter,
        repo_filter,
        json_items_key=(args.json_items_key or None),
    )
    data = aggregate(rows, args.top)
    sections = set([s.strip() for s in args.include_sections.split(",") if s.strip()])
    md = render_report(
        data,
        args.title,
        sections,
        per_lib_limit=args.per_lib_limit,
        perlib_zero_line=args.perlib_zero_line,
        perlib_zero_minors=args.perlib_zero_minors,
        pie_max_slices=args.pie_max_slices
    )
    os.makedirs(os.path.dirname(os.path.abspath(args.out_path)) or ".", exist_ok=True)
    with open(args.out_path, "w", encoding="utf-8") as f:
        f.write(md)
    print(f"✅ Rapport généré → {args.out_path}")


if __name__ == "__main__":
    main()
