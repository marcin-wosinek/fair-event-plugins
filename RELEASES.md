# Release Management with Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for independent versioning and releasing of each plugin (fair-payment, fair-calendar-button, fair-schedule).

## 🎯 Overview

Each plugin is versioned independently using semantic versioning:
- `fair-payment@1.2.3`
- `fair-calendar-button@2.0.1`
- `fair-schedule@1.1.0`

Changes are tracked per-plugin and releases can be made for individual plugins or multiple plugins simultaneously.

## 📝 Workflow

### 1. Making Changes

When you make changes to any plugin:

```bash
# After making your changes, add a changeset
npm run changeset:add
# or
npx changeset add
```

This will:
- Ask which packages were changed
- Ask what type of change (patch/minor/major)
- Ask for a summary of the changes
- Create a markdown file in `.changeset/` folder

### 2. Types of Changes

- **Patch** (1.0.0 → 1.0.1): Bug fixes, small tweaks
- **Minor** (1.0.0 → 1.1.0): New features, backward compatible
- **Major** (1.0.0 → 2.0.0): Breaking changes

### 3. Releasing

#### Option A: Automatic Release (Recommended)
Push to `main` branch and the GitHub Action will:
1. Create a PR with version bumps and changelog updates
2. When you merge the PR, it will automatically create git tags like `fair-payment@1.2.3`

#### Option B: Manual Release
```bash
# Update versions and generate changelogs (also syncs WordPress plugin headers)
npm run version-packages

# Create git tags and publish (if configured)
npm run release
```

## 🏷️ Git Tags

Tags are automatically created in the format:
- `fair-payment@1.2.3`
- `fair-calendar-button@2.0.1`
- `fair-schedule@1.1.0`

This allows you to easily track releases for each plugin individually.

## 📚 Commands Reference

| Command | Description |
|---------|-------------|
| `npm run changeset:add` | Add a new changeset for your changes |
| `npm run changeset:status` | Check status of pending changes |
| `npm run version-packages` | Update package versions based on changesets & sync WordPress headers |
| `npm run sync-wp-versions` | Manually sync WordPress plugin header versions |
| `npm run release` | Publish packages (creates git tags) |

## 🔄 Example Workflow

1. **Make changes** to `fair-calendar-button`
2. **Add changeset**: `npm run changeset:add`
   - Select `fair-calendar-button`
   - Choose `minor` (new feature)
   - Write: "Add exception dates support for recurring events"
3. **Commit and push** to `main`
4. **GitHub Action** creates release PR
5. **Merge PR** → Automatic tag creation: `fair-calendar-button@1.1.0`

## ⚙️ WordPress Plugin Header Sync

The `sync-wp-versions` script automatically updates WordPress plugin headers:

```php
// Before sync
/*
Plugin Name: Fair Calendar Button
Version: 1.0.0
*/

// After sync (when package.json shows 1.2.0)
/*
Plugin Name: Fair Calendar Button
Version: 1.2.0  // ← Automatically updated!
*/
```

### Files Updated:
- `fair-payment/fair-payment.php`
- `fair-calendar-button/fair-calendar-button.php`
- `fair-schedule/plugin.php`

The sync runs automatically when you use `npm run version-packages`.

## ⚙️ Configuration

Changesets is configured in `.changeset/config.json`:
- **Independent versioning**: Each plugin versions separately
- **Automatic tagging**: Git tags created on release
- **Changelog generation**: Automatic changelog per plugin
- **WordPress sync**: Automatic plugin header version updates

## 🎉 Benefits

- ✅ **Independent versioning**: Release plugins separately
- ✅ **Semantic versioning**: Automatic version bumps
- ✅ **Git tags**: Easy release tracking (`fair-payment@1.2.3`)
- ✅ **Changelogs**: Auto-generated per plugin
- ✅ **GitHub integration**: Automated release PRs
- ✅ **Flexibility**: Release one or all plugins as needed
