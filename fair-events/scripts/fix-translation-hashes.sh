#!/bin/bash
# Fix translation JSON file hashes to match built file paths
# WordPress uses MD5 of the relative file path, not file contents

# Define the mappings: source_file -> build_file
declare -A mappings=(
    ["src/Admin/settings/SettingsApp.js"]="build/admin/settings/index.js"
    ["src/blocks/events-list/components/EditComponent.js"]="build/blocks/events-list/editor.js"
    ["src/blocks/event-dates/components/EditComponent.js"]="build/blocks/event-dates/editor.js"
)

# Calculate MD5 hash of a string
calculate_hash() {
    echo -n "$1" | md5sum | awk '{print $1}'
}

# Process each language
for lang in de_DE es_ES fr_FR pl_PL; do
    echo "Processing language: $lang"

    # Process each mapping
    for source in "${!mappings[@]}"; do
        build="${mappings[$source]}"

        # Calculate hashes
        source_hash=$(calculate_hash "$source")
        build_hash=$(calculate_hash "$build")

        source_file="build/languages/fair-events-${lang}-${source_hash}.json"
        target_file="build/languages/fair-events-${lang}-${build_hash}.json"

        # Copy if source exists and target doesn't exist
        if [ -f "$source_file" ]; then
            cp "$source_file" "$target_file"
            echo "  Created: $target_file (from $source_file)"
        fi
    done
done

echo "Translation hash fix complete!"
