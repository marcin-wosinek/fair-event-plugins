# Release Management with Changesets

This project uses [Changesets](https://github.com/changesets/changesets) for independent versioning and releasing of each plugin (fair-payments-connector, fair-events, fair-audience).

## 🎯 Overview

Each plugin is versioned independently using semantic versioning:
- `fair-payments-connector@1.2.3`
- `fair-events@2.0.1`
- `fair-audience@1.1.0`

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
2. When you merge the PR, it will automatically create git tags like `fair-payments-connector@1.2.3`

#### Option B: Manual Release
```bash
# Update versions and generate changelogs (also syncs WordPress plugin headers)
npm run version-packages

# Create git tags and publish (if configured)
npm run release
```

## 🏷️ Git Tags

Tags are automatically created in the format:
- `fair-payments-connector@1.2.3`
- `fair-events@2.0.1`
- `fair-audience@1.1.0`

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

1. **Make changes** to `fair-events`
2. **Add changeset**: `npm run changeset:add`
   - Select `fair-events`
   - Choose `minor` (new feature)
   - Write: "Add exception dates support for recurring events"
3. **Commit and push** to `main`
4. **GitHub Action** creates release PR
5. **Merge PR** → Automatic tag creation: `fair-events@1.1.0`
6. **Publish to wordpress.org** → Run the [Publish to WordPress.org SVN](./DEPLOYMENT.md#publishing-to-wordpressorg-svn) workflow with the new tag (dry-run first, then live)

## ⚙️ WordPress Plugin Header Sync

The `sync-wp-versions` script automatically updates WordPress plugin headers:

```php
// Before sync
/*
Plugin Name: Fair Events
Version: 1.0.0
*/

// After sync (when package.json shows 1.2.0)
/*
Plugin Name: Fair Events
Version: 1.2.0  // ← Automatically updated!
*/
```

### Files Updated:
- `fair-payments-connector/fair-payments-connector.php`
- `fair-events/fair-events.php`
- `fair-audience/fair-audience.php`

The sync runs automatically when you use `npm run version-packages`.

## ⚙️ Configuration

Changesets is configured in `.changeset/config.json`:
- **Independent versioning**: Each plugin versions separately
- **Automatic tagging**: Git tags created on release
- **Changelog generation**: Automatic changelog per plugin
- **WordPress sync**: Automatic plugin header version updates

## 🔗 Cross-plugin interface changes

Changesets only version-bumps and releases the packages named in a
changeset. If a change touches a method/class in one plugin (e.g.
`fair-events-experimental`) and migrates call sites in another plugin (e.g.
`fair-audience`) onto the new interface, the changeset **must declare a
version bump for every plugin whose code changed** — not just the one where
the primary feature lives. Otherwise the release ships the calling plugin's
new code while the plugin it calls into stays on its old build, and any site
that updates one but not the other hits a mismatch (missing method, changed
signature) at runtime — see issue #1421, where a note-formatting fix updated
`fair-audience` call sites onto renamed/new `fair-events-experimental`
methods, but the changeset only declared `fair-audience`.

Before adding a changeset for a change that crosses plugin boundaries, check
every plugin directory the diff touches and list all of them in the
changeset frontmatter, e.g.:

```markdown
---
"fair-audience": patch
"fair-events-experimental": patch
---
```

As defense in depth, call sites that reach into another plugin's namespace
should also guard with `method_exists()` (not just `class_exists()`) and
degrade gracefully — see `fair-audience/src/Services/SignupPriceResolver.php`
— so a future release gap doesn't fatal a page even if a changeset is missed.

## 🎉 Benefits

- ✅ **Independent versioning**: Release plugins separately
- ✅ **Semantic versioning**: Automatic version bumps
- ✅ **Git tags**: Easy release tracking (`fair-payments-connector@1.2.3`)
- ✅ **Changelogs**: Auto-generated per plugin
- ✅ **GitHub integration**: Automated release PRs
- ✅ **Flexibility**: Release one or all plugins as needed
