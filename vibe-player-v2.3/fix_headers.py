#!/usr/bin/env python3
import os
import re
import argparse
from pathlib import Path

# --- Configuration: Define comment styles and file extensions ---
# This makes the script easily extendable to other file types.
COMMENT_STYLES = {
    ".svelte": ("<!--", "-->"),
    ".html": ("<!--", "-->"),
    ".ts": ("//", ""),
    ".js": ("//", ""),
    ".mjs": ("//", ""),
    ".css": ("/*", "*/"),
    ".yml": ("#", ""),
    ".yaml": ("#", ""),
}

# Regex to find a header comment that looks like a file path.
# It looks for the comment syntax at the start of the file, containing "vibe-player".
# This keyword helps avoid removing legitimate header comments that are not file paths.
HEADER_REGEX = re.compile(
    r"^(?:"
    r"<!--\s*.*?vibe-player-v2.*?\s*-->|"  # HTML/Svelte style
    r"/\*\s*.*?vibe-player-v2.*?\s*\*/|"  # CSS/Multi-line JS style
    r"//\s*.*?vibe-player-v2.*?$|"  # Single-line JS/TS style
    r"#\s*.*?vibe-player-v2.*?$"  # YAML/Shell style
    r")\s*",
    re.MULTILINE | re.DOTALL
)


def format_header(file_path_str, style):
    """Formats the header comment string based on the given style."""
    start, end = style
    # Ensure consistent forward slashes for the path display
    path_display = file_path_str.replace(os.sep, '/')

    if end:  # For block comments like <!-- --> or /* */
        return f"{start} {path_display} {end}"
    else:  # For line comments like // or #
        return f"{start} {path_display}"


def process_file(file_path, dry_run=False):
    """
    Processes a single file:
    1. Determines the correct header format.
    2. Removes any old, incorrect header.
    3. Adds a new, correct header if one was missing or incorrect.
    4. Writes back to the file if changes were made (and not in dry-run mode).
    """
    file_ext = file_path.suffix
    if file_ext not in COMMENT_STYLES:
        # print(f"SKIPPING (unsupported extension): {file_path}")
        return

    style = COMMENT_STYLES[file_ext]
    correct_header = format_header(str(file_path), style)

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            original_content = f.read()
    except Exception as e:
        print(f"ERROR: Could not read {file_path}: {e}")
        return

    # Check if a header already exists and remove it if it matches our regex
    # This is "smarter" than just checking the first line, as it handles whitespace
    # and different comment styles.
    content_without_header = HEADER_REGEX.sub("", original_content)

    is_update = len(original_content) != len(content_without_header)

    # Add the new, correct header. lstrip() removes leading whitespace/newlines
    # from the old content, ensuring clean formatting.
    new_content = f"{correct_header}\n\n{content_without_header.lstrip()}"

    if new_content.strip() == original_content.strip():
        # No meaningful change was made
        return

    action = "UPDATED" if is_update else "ADDED"
    print(f"{action}: {file_path}")

    if not dry_run:
        try:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
        except Exception as e:
            print(f"ERROR: Could not write to {file_path}: {e}")


def main():
    """Main function to parse arguments and start processing."""
    parser = argparse.ArgumentParser(
        description="A script to add or correct file path headers in source files.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "target_directory",
        help="The directory to scan for source files (e.g., 'vibe-player-v2.3')."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan files and report what would be changed, but don't modify any files."
    )
    args = parser.parse_args()

    target_path = Path(args.target_directory)
    if not target_path.is_dir():
        print(f"ERROR: The specified directory does not exist: {target_path}")
        return

    print(f"Scanning directory: {target_path}")
    if args.dry_run:
        print("--- DRY RUN MODE: No files will be modified. ---")

    # Walk through all files and directories
    for root, _, files in os.walk(target_path):
        for filename in files:
            file_path = Path(root) / filename
            process_file(file_path, args.dry_run)

    print("\nScan complete.")
    if args.dry_run:
        print("--- Reminder: This was a dry run. No files were changed. ---")


if __name__ == "__main__":
    main()