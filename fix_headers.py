# fix_headers.py
#!/usr/bin/env python3
import os
import re
from pathlib import Path

# This script requires the 'pathspec' library to correctly handle .gitignore files.
# Install it using: pip install pathspec
try:
    import pathspec
except ImportError:
    print("Error: The 'pathspec' library is required.")
    print("Please install it using: pip install pathspec")
    exit(1)

# --- Configuration: Define comment styles and file extensions ---
COMMENT_STYLES = {
    ".aiignore": ("#", ""),
    ".css": ("/*", "*/"),
    ".gitignore": ("#", ""),
    ".html": ("<!--", "-->"),
    ".js": ("//", ""),
    ".llmignore": ("#", ""),
    ".md": ("[//]: # (", ")"),
    ".mjs": ("//", ""),
    ".npmrc": ("#", ""),
    # ".prettierrc": ("//", ""),
    ".svelte": ("<!--", "-->"),
    ".ts": ("//", ""),
    ".txt": ("#", ""),
    ".yaml": ("#", ""),
    ".yml": ("#", ""),
}


def build_header_regex(styles):
    """
    Dynamically builds a regular expression to find header comments based on
    the provided comment styles dictionary.
    """
    path_like_content = r"[\w\-\./\\_ ]+"
    block_patterns = []
    line_starters = []
    unique_styles = set(styles.values())

    for start, end in unique_styles:
        escaped_start = re.escape(start)
        if end:
            escaped_end = re.escape(end)
            pattern = rf"{escaped_start}\s*{path_like_content}\s*{escaped_end}"
            block_patterns.append(pattern)
        else:
            line_starters.append(escaped_start)

    all_patterns = list(block_patterns)
    if line_starters:
        line_group = "|".join(line_starters)
        line_pattern = rf"(?:{line_group})\s*{path_like_content}$"
        all_patterns.append(line_pattern)

    combined_patterns = "|".join(all_patterns)
    final_regex_str = rf"^\s*(?:{combined_patterns})\s*"
    return re.compile(final_regex_str, re.MULTILINE)


# --- Dynamically Generated Regex ---
HEADER_REGEX = build_header_regex(COMMENT_STYLES)


class IgnoreChecker:
    """
    A helper class to check if a file should be ignored based on hierarchical
    .gitignore files. Logic is adapted from the provided reference script.
    """

    def __init__(self, root_path: Path):
        self.root = root_path.resolve()
        self._specs_cache = {}

    def _load_spec_for_dir(self, directory: Path) -> pathspec.PathSpec | None:
        """Loads .gitignore from a single directory."""
        if directory in self._specs_cache:
            return self._specs_cache[directory]

        ignore_file = directory / ".gitignore"
        spec = None
        if ignore_file.is_file():
            try:
                with ignore_file.open('r', encoding='utf-8', errors='ignore') as f:
                    spec = pathspec.PathSpec.from_lines('gitwildmatch', f)
            except Exception as e:
                print(f"Warning: Could not read or parse {ignore_file}: {e}")

        self._specs_cache[directory] = spec
        return spec

    def is_ignored(self, file_path: Path) -> bool:
        """
        Checks if a file path is ignored by any .gitignore file from its
        directory up to the root. Rules in deeper directories take precedence.
        """
        absolute_path = file_path.resolve()

        # Always ignore anything inside the .git directory
        if ".git" in absolute_path.parts:
            return True

        # Walk up from the file's directory to the root
        current_dir = absolute_path.parent
        while current_dir >= self.root:
            spec = self._load_spec_for_dir(current_dir)
            if spec:
                # Pathspec needs the path relative to the .gitignore file's location
                path_relative_to_spec = absolute_path.relative_to(current_dir)
                if spec.match_file(path_relative_to_spec):
                    # A match at a deeper level is definitive.
                    return True

            if current_dir == self.root:
                break
            current_dir = current_dir.parent

        return False


def format_header(file_path_str, style):
    """Formats the header comment string based on the given style."""
    start, end = style
    path_display = file_path_str.replace(os.sep, '/')

    if end:
        return f"{start} {path_display} {end}"
    else:
        return f"{start} {path_display}"


def get_proposed_changes(file_path, project_root):
    """
    Scans a file and determines if a change is needed.
    Returns the proposed new content if a change is required, otherwise None.
    """
    file_ext = file_path.suffix
    if file_ext not in COMMENT_STYLES:
        return None, None

    style = COMMENT_STYLES[file_ext]
    relative_path_str = str(file_path.relative_to(project_root))
    correct_header = format_header(relative_path_str, style)

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            original_content = f.read()
    except Exception:
        return None, None

    if not original_content.strip():
        return None, None

    if original_content.startswith(correct_header):
        return None, None

    match = HEADER_REGEX.match(original_content)
    action = ""
    content_to_prepend = original_content

    if match:
        action = "UPDATED"
        content_to_prepend = original_content[match.end():]
    else:
        action = "ADDED"

    new_content = f"{correct_header}\n{content_to_prepend.lstrip()}"
    return action, new_content


def main():
    """
    Main function to recursively scan the current directory, respect .gitignore,
    find files needing header changes, and apply them upon confirmation.
    """
    project_root = Path.cwd()
    ignore_checker = IgnoreChecker(project_root)

    print(f"Scanning directory: {project_root}")
    print("Applying .gitignore rules...")
    print("-" * 30)

    # --- Scan Phase ---
    changes_to_make = []
    # os.walk is generally efficient for full directory traversal
    for root, _, files in os.walk(project_root, topdown=True):
        root_path = Path(root)

        for filename in files:
            file_path = root_path / filename

            # >>> The crucial new step: check if the file is ignored <<<
            if ignore_checker.is_ignored(file_path):
                continue

            # Exclude the script file itself from being processed
            if file_path.samefile(Path(__file__)):
                continue

            action, new_content = get_proposed_changes(file_path, project_root)
            if action and new_content:
                changes_to_make.append((action, file_path, new_content))

    # --- Report and Confirmation Phase ---
    if not changes_to_make:
        print("All file headers appear correct. No changes needed.")
        return

    print("The following changes will be made:")
    changes_to_make.sort(key=lambda x: x[1])
    for action, file_path, _ in changes_to_make:
        relative_path = file_path.relative_to(project_root)
        print(f"  - {action}: {relative_path}")

    print("-" * 30)
    # try:
    #     # Re-enabled confirmation for safety, can be hardcoded to 'y' for automation.
    #     confirm = input(f"Apply these {len(changes_to_make)} changes? (y/N): ")
    # except KeyboardInterrupt:
    #     print("\nOperation cancelled by user.")
    #     return
    confirm = 'y'  # skip confirmation, you can always git reset

    # --- Write Phase ---
    if confirm.lower() == 'y':
        print("Applying changes...")
        written_count = 0
        for _, file_path, new_content in changes_to_make:
            try:
                # Use newline='\n' to ensure consistent line endings (LF)
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