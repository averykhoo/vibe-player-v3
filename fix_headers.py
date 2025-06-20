#!/usr/bin/env python3
import os
import re
from pathlib import Path

# --- Configuration: Define comment styles and file extensions ---
COMMENT_STYLES = {
    ".svelte": ("<!--", "-->"),
    ".html": ("<!--", "-->"),
    ".ts": ("//", ""),
    ".js": ("//", ""),
    ".mjs": ("//", ""),
    ".css": ("/*", "*/"),
    ".yml": ("#", ""),
    ".yaml": ("#", ""),
    ".gitignore": ("#", ""),
    ".npmrc": ("#", ""),
    ".prettierrc": ("//", ""),
    ".txt": ("#", ""),
}

# Regex to find a header comment at the START of the file (after optional whitespace)
# that looks suspiciously like a file path. It will match:
# - A single-line comment: // path/to/file.js
# - A block comment: /* path/to/file.css */
# - An HTML comment: <!-- path/to/file.html -->
# It is specifically looking for path-like characters (/, \, .) to avoid
# removing legitimate, non-path comments.
HEADER_REGEX = re.compile(
    r"^\s*(?:"
    r"<!--\s*[\w\-\./\\_ ]+\s*-->|"
    r"/\*\s*[\w\-\./\\_ ]+\s*\*/|"
    r"(?://|#)\s*[\w\-\./\\_ ]+$"
    r")\s*",
    re.MULTILINE
)


def format_header(file_path_str, style):
    """Formats the header comment string based on the given style."""
    start, end = style
    path_display = file_path_str.replace(os.sep, '/')

    if end:
        return f"{start} {path_display} {end}"
    else:
        return f"{start} {path_display}"


def get_proposed_changes(file_path):
    """
    Scans a file and determines if a change is needed.
    Returns the proposed new content if a change is required, otherwise None.
    """
    file_ext = file_path.suffix
    if file_ext not in COMMENT_STYLES:
        return None, None

    style = COMMENT_STYLES[file_ext]
    relative_path_str = str(file_path.relative_to(Path.cwd()))
    correct_header = format_header(relative_path_str, style)

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            original_content = f.read()
    except Exception:
        return None, None

    if not original_content.strip():
        # Skip empty or whitespace-only files
        return None, None

    # Does the correct header already exist at the top? If so, we're done.
    if original_content.startswith(correct_header):
        return None, None

    # Try to find and remove an old, incorrect header at the top of the file.
    match = HEADER_REGEX.match(original_content)

    action = ""
    content_to_prepend = original_content

    if match:
        # An old, incorrect header was found and will be replaced.
        action = "UPDATED"
        # Get the content *after* the matched header.
        content_to_prepend = original_content[match.end():]
    else:
        # No suspicious header was found, so we're adding a new one.
        action = "ADDED"

    # **MODIFICATION:** Add the header followed by ONE newline, then the rest of the content.
    # .lstrip() removes any leading whitespace/newlines from the old content, ensuring
    # there is exactly one newline after our header.
    new_content = f"{correct_header}\n{content_to_prepend.lstrip()}"

    return action, new_content


def main():
    """Main function to find target directories, scan them, and apply changes upon confirmation."""

    project_root = Path.cwd()
    # Find all directories starting with 'vibe-player-' and the '.github' directory
    target_dirs = [p for p in project_root.glob('vibe-player-*') if p.is_dir()]
    github_dir = project_root / ".github"
    if github_dir.is_dir():
        target_dirs.append(github_dir)

    if not target_dirs:
        print("No 'vibe-player-*' or '.github' directories found. Exiting.")
        return

    print("Found target directories to scan:")
    for d in sorted(target_dirs):  # Sort for consistent output
        print(f"- {d.name}")
    print("-" * 30)

    # --- Scan Phase ---
    changes_to_make = []
    for target_path in sorted(target_dirs):
        for root, _, files in os.walk(target_path):
            for filename in files:
                # Exclude package-lock.json from being processed
                if filename == 'package-lock.json':
                    continue

                file_path = Path(root) / filename
                action, new_content = get_proposed_changes(file_path)
                if action and new_content:
                    changes_to_make.append((action, file_path, new_content))

    # --- Report and Confirmation Phase ---
    if not changes_to_make:
        print("All file headers appear correct. No changes needed.")
        return

    print("The following changes will be made:")
    # Sort the changes for a clean, deterministic report
    changes_to_make.sort(key=lambda x: x[1])
    for action, file_path, _ in changes_to_make:
        relative_path = file_path.relative_to(project_root)
        print(f"  - {action}: {relative_path}")

    # print("-" * 30)
    # try:
    #     confirm = input(f"Apply these {len(changes_to_make)} changes? (y/N): ")
    # except KeyboardInterrupt:
    #     print("\nOperation cancelled by user.")
    #     return
    confirm = 'y'

    # --- Write Phase ---
    if confirm.lower() == 'y':
        print("Applying changes...")
        written_count = 0
        for _, file_path, new_content in changes_to_make:
            try:
                with open(file_path, 'w', encoding='utf-8', newline='\n') as f:
                    f.write(new_content)
                written_count += 1
            except Exception as e:
                print(f"ERROR: Could not write to {file_path}: {e}")
        print(f"\nSuccessfully wrote changes to {written_count} file(s).")
    else:
        print("Aborted. No files were changed.")


if __name__ == "__main__":
    main()