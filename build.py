#!/usr/bin/env python3
"""
Briefcase Build Script for Apple Music History Converter

This script provides a simple interface for building the application
across different platforms using Briefcase.
"""

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


def _get_builtin_key_env():
    return {
        "team_id": os.getenv("APPLE_MUSIC_TEAM_ID"),
        "key_id": os.getenv("APPLE_MUSIC_KEY_ID"),
        "key_path": os.getenv("APPLE_MUSIC_P8_PATH"),
    }


def _stage_builtin_key():
    config = _get_builtin_key_env()
    if not config["team_id"] or not config["key_id"] or not config["key_path"]:
        print("[!] Apple Music built-in key not set (APPLE_MUSIC_TEAM_ID/KEY_ID/P8_PATH missing)")
        return None

    key_source = Path(config["key_path"])
    if not key_source.exists():
        print(f"[!] Apple Music key file not found: {key_source}")
        return None

    resources_dir = Path("src/apple_music_history_converter/resources")
    resources_dir.mkdir(parents=True, exist_ok=True)

    key_dest = resources_dir / "apple_music_key.p8"
    json_dest = resources_dir / "apple_music_key.json"

    if key_dest.exists() or json_dest.exists():
        print("[!] Built-in key resources already exist; leaving them unchanged.")
        return {"cleanup": False}

    shutil.copyfile(key_source, key_dest)
    json_dest.write_text(
        (
            "{\n"
            f"  \"team_id\": \"{config['team_id']}\",\n"
            f"  \"key_id\": \"{config['key_id']}\"\n"
            "}\n"
        ),
        encoding="utf-8",
    )

    print("[OK] Staged built-in Apple Music key resources")
    return {"cleanup": True, "paths": [key_dest, json_dest]}


def _cleanup_builtin_key(context):
    if not context or not context.get("cleanup"):
        return
    for path in context.get("paths", []):
        try:
            if path.exists():
                path.unlink()
        except Exception as e:
            print(f"[!] Failed to remove built-in key resource {path}: {e}")


def run_command(command, description, use_builtin_key=False):
    """Run a command and handle errors."""
    print(f"\n{'='*60}")
    print(f"🔨 {description}")
    print(f"{'='*60}")

    key_context = _stage_builtin_key() if use_builtin_key else None
    try:
        result = subprocess.run(command, shell=True, check=True, capture_output=False)
        print(f"[OK] {description} completed successfully!")
        return True
    except subprocess.CalledProcessError as e:
        print(f"[X] {description} failed with exit code {e.returncode}")
        return False
    finally:
        if use_builtin_key:
            _cleanup_builtin_key(key_context)


def build_dev():
    """Run the application in development mode."""
    return run_command("briefcase dev", "Running application in development mode")


def build_create():
    """Create the application bundle."""
    return run_command("briefcase create", "Creating application bundle", use_builtin_key=True)


def build_build():
    """Build the application."""
    return run_command("briefcase build", "Building application", use_builtin_key=True)


def build_run():
    """Run the built application."""
    return run_command("briefcase run", "Running built application")


def build_package():
    """Package the application for distribution."""
    return run_command("briefcase package", "Packaging application for distribution", use_builtin_key=True)


def build_all():
    """Complete build pipeline: create, build, and package."""
    print("[>] Starting complete build pipeline...")
    key_context = _stage_builtin_key()
    
    steps = [
        ("briefcase create", "Create"),
        ("briefcase build", "Build"),
        ("briefcase package", "Package")
    ]
    
    for command, step_name in steps:
        if not run_command(command, f"{step_name} application bundle"):
            print(f"\n[X] Build pipeline failed at {step_name} step")
            _cleanup_builtin_key(key_context)
            return False
    
    _cleanup_builtin_key(key_context)
    print("\n[YAY] Complete build pipeline finished successfully!")
    return True


def clean():
    """Clean build artifacts."""
    return run_command("rm -rf build dist", "Cleaning build artifacts")


def main():
    parser = argparse.ArgumentParser(description="Build Apple Music History Converter")
    parser.add_argument("command", choices=[
        "dev", "create", "build", "run", "package", "all", "clean"
    ], help="Build command to execute")
    
    args = parser.parse_args()
    
    # Check if we're in the right directory
    if not Path("pyproject.toml").exists():
        print("[X] Error: pyproject.toml not found. Please run this script from the project root.")
        sys.exit(1)
    
    commands = {
        "dev": build_dev,
        "create": build_create,
        "build": build_build,
        "run": build_run,
        "package": build_package,
        "all": build_all,
        "clean": clean
    }
    
    success = commands[args.command]()
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
