#!/usr/bin/env python3
"""
gather_raw_context.py – Lightweight data extractor for project-context-init.

Extracts raw repository data and outputs it as structured JSON to stdout.
This script handles ONLY data gathering (IO-heavy work) so the LLM agent
can focus on reasoning and writing the AGENTS.md file.

Usage:
    python3 ~/.agents/skills/project-context-init/scripts/gather_raw_context.py
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Any


# ── Constants ────────────────────────────────────────────────────────────────

IGNORE_DIRS = {
    ".git", "node_modules", ".next", "dist", "build", "coverage",
    "__pycache__", ".turbo", ".cache", ".vercel", ".output", ".venv",
    "venv", "env", ".tox", ".mypy_cache", ".pytest_cache", "target",
    ".gradle", ".idea", ".vscode", ".agents", ".gemini",
}

DEPENDENCY_FILES = [
    "package.json", "pom.xml", "build.gradle", "build.gradle.kts",
    "requirements.txt", "pyproject.toml", "setup.py", "setup.cfg",
    "go.mod", "Cargo.toml", "Gemfile", "composer.json",
    "mix.exs", "build.sbt", "Makefile", "CMakeLists.txt",
]

CONFIG_FILES = [
    "tsconfig.json", "jsconfig.json",
    ".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.yml", "eslint.config.mjs", "eslint.config.js",
    ".prettierrc", ".prettierrc.json", "prettier.config.js", "prettier.config.mjs",
    "tailwind.config.ts", "tailwind.config.js",
    "postcss.config.js", "postcss.config.mjs",
    "next.config.ts", "next.config.js", "next.config.mjs",
    "vite.config.ts", "vite.config.js",
    "vitest.config.ts", "vitest.config.js",
    "jest.config.ts", "jest.config.js", "jest.config.json",
    "webpack.config.js",
    "babel.config.js", ".babelrc",
    "Dockerfile", "docker-compose.yml", "docker-compose.yaml",
    ".dockerignore",
    "vercel.json", "netlify.toml", "fly.toml",
    ".github/workflows", ".gitlab-ci.yml",
    "Procfile", "serverless.yml",
    "sst.config.ts",
    "CONTRIBUTING.md", "CODEOWNERS", "LICENSE",
    ".editorconfig",
]

ENV_FILES = [
    ".env.example", ".env.template", ".env.sample", ".env.local",
    ".env.development", ".env.production",
]


# ── Helpers ──────────────────────────────────────────────────────────────────

def find_project_root() -> Path:
    """Walk upward from cwd looking for common project markers."""
    cwd = Path.cwd()
    markers = ("package.json", ".git", "pyproject.toml", "Cargo.toml",
               "go.mod", "pom.xml", "build.gradle", "Gemfile", "composer.json")
    for p in [cwd, *cwd.parents]:
        if any((p / marker).exists() for marker in markers):
            return p
    return cwd


def read_text_safe(path: Path, max_lines: int = 200) -> str:
    """Read a text file safely, returning at most max_lines."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        return "\n".join(lines[:max_lines])
    except Exception:
        return ""


def read_json_safe(path: Path) -> dict:
    """Read a JSON file safely."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


# ── Extractors ───────────────────────────────────────────────────────────────

def extract_directory_tree(root: Path, max_depth: int = 2) -> list[str]:
    """
    Build a simplified directory tree up to max_depth.
    Returns a flat list of strings like: "dir_name/ (N files)"
    """
    tree = []

    def _scan(directory: Path, depth: int, prefix: str):
        if depth > max_depth:
            return
        try:
            entries = sorted(directory.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        except PermissionError:
            return

        dirs = [e for e in entries if e.is_dir() and e.name not in IGNORE_DIRS and not e.name.startswith(".")]
        files = [e for e in entries if e.is_file() and not e.name.startswith(".")]

        for d in dirs:
            try:
                child_count = sum(1 for _ in d.rglob("*") if _.is_file())
            except Exception:
                child_count = 0
            tree.append(f"{prefix}{d.name}/ ({child_count} files)")
            _scan(d, depth + 1, prefix + "  ")

        if depth == 0:
            notable_files = [f.name for f in files if f.suffix in (
                ".ts", ".js", ".py", ".json", ".mjs", ".cjs", ".toml",
                ".yaml", ".yml", ".md", ".xml", ".gradle",
            )]
            if notable_files:
                tree.append(f"{prefix}[root files]: {', '.join(notable_files[:20])}")

    _scan(root, 0, "")
    return tree


def extract_dependencies(root: Path) -> dict[str, Any]:
    """Extract dependency information from various package managers."""
    deps = {}

    # ── npm / Node.js
    pkg_path = root / "package.json"
    if pkg_path.exists():
        pkg = read_json_safe(pkg_path)
        deps["npm"] = {
            "name": pkg.get("name", ""),
            "description": pkg.get("description", ""),
            "version": pkg.get("version", ""),
            "dependencies": list(pkg.get("dependencies", {}).keys()),
            "devDependencies": list(pkg.get("devDependencies", {}).keys()),
            "scripts": pkg.get("scripts", {}),
        }

    # ── Python (pyproject.toml)
    pyproject = root / "pyproject.toml"
    if pyproject.exists():
        deps["python_pyproject"] = read_text_safe(pyproject, max_lines=100)

    # ── Python (requirements.txt)
    reqs = root / "requirements.txt"
    if reqs.exists():
        deps["python_requirements"] = read_text_safe(reqs, max_lines=100)

    # ── Go
    gomod = root / "go.mod"
    if gomod.exists():
        deps["go"] = read_text_safe(gomod, max_lines=50)

    # ── Rust
    cargo = root / "Cargo.toml"
    if cargo.exists():
        deps["rust"] = read_text_safe(cargo, max_lines=80)

    # ── Java (Maven)
    pom = root / "pom.xml"
    if pom.exists():
        deps["java_maven"] = read_text_safe(pom, max_lines=100)

    # ── Java (Gradle)
    gradle = root / "build.gradle"
    if not gradle.exists():
        gradle = root / "build.gradle.kts"
    if gradle.exists():
        deps["java_gradle"] = read_text_safe(gradle, max_lines=80)

    # ── Ruby
    gemfile = root / "Gemfile"
    if gemfile.exists():
        deps["ruby"] = read_text_safe(gemfile, max_lines=60)

    # ── PHP
    composer = root / "composer.json"
    if composer.exists():
        deps["php"] = read_text_safe(composer, max_lines=80)

    # ── Makefile (build system)
    makefile = root / "Makefile"
    if makefile.exists():
        deps["makefile_targets"] = extract_makefile_targets(makefile)

    return deps


def extract_makefile_targets(makefile: Path) -> list[str]:
    """Extract target names from a Makefile."""
    targets = []
    try:
        for line in makefile.read_text(encoding="utf-8").splitlines():
            match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_-]*):', line)
            if match:
                targets.append(match.group(1))
    except Exception:
        pass
    return targets


def extract_readme(root: Path) -> str:
    """Read README.md content (first 200 lines)."""
    for name in ("README.md", "readme.md", "README.rst", "README"):
        readme = root / name
        if readme.exists():
            return read_text_safe(readme, max_lines=200)
    return ""


def extract_gitignore(root: Path) -> str:
    """Read .gitignore contents."""
    gitignore = root / ".gitignore"
    if gitignore.exists():
        return read_text_safe(gitignore, max_lines=100)
    return ""


def extract_existing_agents_md(root: Path) -> str:
    """Read existing AGENTS.md if present."""
    agents_md = root / "AGENTS.md"
    if agents_md.exists():
        return agents_md.read_text(encoding="utf-8")
    return ""


def detect_config_files(root: Path) -> list[str]:
    """Check which config files exist in the project root."""
    found = []
    for cf in CONFIG_FILES:
        path = root / cf
        if path.exists():
            found.append(cf)
    return found


def extract_env_vars(root: Path) -> dict[str, list[str]]:
    """Extract environment variable names from env template files."""
    result = {}
    for env_file in ENV_FILES:
        path = root / env_file
        if path.exists():
            vars_found = []
            try:
                for line in path.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if line and not line.startswith("#") and "=" in line:
                        var_name = line.split("=", 1)[0].strip()
                        vars_found.append(var_name)
            except Exception:
                pass
            if vars_found:
                result[env_file] = vars_found
    return result


def discover_skills() -> dict[str, list[dict[str, str]]]:
    """Discover available skills from global and local directories."""
    skills = {"global": [], "local": []}

    # Global skills
    global_path = Path("~/.agents/skills").expanduser()
    if global_path.exists():
        for skill_dir in sorted(global_path.iterdir()):
            if skill_dir.is_dir():
                skill_md = skill_dir / "SKILL.md"
                if skill_md.exists():
                    info = _parse_skill_frontmatter(skill_md)
                    if info:
                        skills["global"].append(info)

    # Local skills
    local_path = Path(".agents/skills")
    if local_path.exists():
        for skill_dir in sorted(local_path.iterdir()):
            if skill_dir.is_dir():
                skill_md = skill_dir / "SKILL.md"
                if skill_md.exists():
                    info = _parse_skill_frontmatter(skill_md)
                    if info:
                        skills["local"].append(info)

    return skills


def _parse_skill_frontmatter(skill_md_path: Path) -> dict[str, str] | None:
    """Extract name and description from a SKILL.md YAML frontmatter."""
    try:
        content = skill_md_path.read_text(encoding="utf-8")
        fm_match = re.search(r"^---\s*(.*?)\s*---", content, re.MULTILINE | re.DOTALL)
        if not fm_match:
            return None

        fm = fm_match.group(1)
        name_match = re.search(r"^\s*name:\s*(.*)", fm, re.MULTILINE)
        desc_match = re.search(r"^\s*description:\s*(.*)", fm, re.MULTILINE)

        name = name_match.group(1).strip().strip("'\"") if name_match else skill_md_path.parent.name
        desc = desc_match.group(1).strip().strip("'\"") if desc_match else ""

        return {"name": name, "description": desc}
    except Exception:
        return None


def detect_contributing_docs(root: Path) -> dict[str, bool]:
    """Check for standard community/governance files."""
    return {
        "CONTRIBUTING.md": (root / "CONTRIBUTING.md").exists(),
        "CODEOWNERS": (root / "CODEOWNERS").exists() or (root / ".github" / "CODEOWNERS").exists(),
        "LICENSE": (root / "LICENSE").exists() or (root / "LICENSE.md").exists(),
        "CODE_OF_CONDUCT.md": (root / "CODE_OF_CONDUCT.md").exists(),
        "SECURITY.md": (root / "SECURITY.md").exists(),
    }


# ── Main ─────────────────────────────────────────────────────────────────────

def gather_context() -> dict[str, Any]:
    """Main function: gather all raw context and return as dict."""
    root = find_project_root()

    context = {
        "project_root": str(root),
        "project_name": root.name,
        "structure": extract_directory_tree(root),
        "dependencies": extract_dependencies(root),
        "readme": extract_readme(root),
        "gitignore": extract_gitignore(root),
        "existing_agents_md": extract_existing_agents_md(root),
        "config_files": detect_config_files(root),
        "env_vars": extract_env_vars(root),
        "skills": discover_skills(),
        "community_docs": detect_contributing_docs(root),
    }

    return context


def main():
    context = gather_context()
    print(json.dumps(context, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
