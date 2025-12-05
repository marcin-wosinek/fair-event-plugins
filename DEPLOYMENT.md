# Deployment Setup for Acroyoga-Club.es

This document explains how to set up automated deployment of WordPress plugins to acroyoga-club.es using GitHub Actions.

## Overview

The deployment workflow automatically:
1. Builds all plugins (JavaScript, CSS, translations)
2. Installs production PHP dependencies
3. Deploys to Hostinger via SSH/rsync
4. Syncs only necessary files (excludes source files, tests, etc.)

## Prerequisites

- SSH access to your Hostinger server
- GitHub repository with Actions enabled
- WordPress site at acroyoga-club.es

## Step 1: Generate SSH Key Pair

On your local machine:

```bash
# Generate a new SSH key (don't use a passphrase for automation)
ssh-keygen -t ed25519 -C "github-actions@acroyoga-club.es" -f ~/.ssh/acroyoga_deploy

# This creates two files:
# ~/.ssh/acroyoga_deploy (private key - for GitHub)
# ~/.ssh/acroyoga_deploy.pub (public key - for Hostinger)
```

## Step 2: Add Public Key to Hostinger

### Option A: Via Hostinger Panel (Recommended)

1. Log in to Hostinger control panel
2. Go to **Advanced** → **SSH Access**
3. Click **Add SSH Key**
4. Copy the content of `~/.ssh/acroyoga_deploy.pub`
5. Paste it and save

### Option B: Manually via SSH

```bash
# Copy public key to server
cat ~/.ssh/acroyoga_deploy.pub | ssh your-username@your-host.hostinger.com \
  "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

## Step 3: Get Server Information

You need to find these values from Hostinger:

### SSH_HOST
- Usually: `yourdomain.com` or an IP address
- Check: Hostinger panel → SSH Access → Server details

### SSH_USER
- Your SSH username
- Check: Hostinger panel → SSH Access

### WORDPRESS_PLUGINS_PATH
- Full path to WordPress plugins directory
- Usually: `/home/YOUR_USERNAME/public_html/wp-content/plugins`
- Or: `/home/YOUR_USERNAME/domains/acroyoga-club.es/public_html/wp-content/plugins`

To find it, SSH into your server and run:
```bash
ssh your-username@your-host
cd ~/public_html
find . -type d -name "plugins" | grep wp-content
```

## Step 4: Configure GitHub Secrets

1. Go to your GitHub repository
2. Click **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret** for each:

### Required Secrets

| Secret Name | Description | Example Value |
|-------------|-------------|---------------|
| `SSH_PRIVATE_KEY` | Private SSH key content | Content of `~/.ssh/acroyoga_deploy` |
| `SSH_HOST` | Hostinger server hostname | `srv123.hostinger.com` |
| `SSH_USER` | SSH username | `u123456789` |
| `WORDPRESS_PLUGINS_PATH` | Full path to plugins dir | `/home/u123456789/public_html/wp-content/plugins` |

### How to Get SSH_PRIVATE_KEY

```bash
# Display private key content
cat ~/.ssh/acroyoga_deploy

# Copy everything including:
# -----BEGIN OPENSSH PRIVATE KEY-----
# ... all the content ...
# -----END OPENSSH PRIVATE KEY-----
```

## Step 5: Create GitHub Environment (Optional but Recommended)

1. Go to **Settings** → **Environments**
2. Click **New environment**
3. Name it: `acroyoga-club.es`
4. Add **Deployment protection rules** if you want manual approval

## How to Use

### Automatic Deployment

The workflow automatically runs when you push to the `main` branch:

```bash
git add .
git commit -m "Update fair-rsvp plugin"
git push origin main
```

All plugins will be built and deployed automatically.

### Manual Deployment

You can also trigger deployment manually:

1. Go to **Actions** tab in GitHub
2. Click **Deploy to Acroyoga-Club.es**
3. Click **Run workflow**
4. Choose:
   - **all** (default): Deploy all plugins
   - **fair-rsvp,fair-events**: Deploy specific plugins (comma-separated)

### Deploy Specific Plugins

To deploy only specific plugins, use the workflow dispatch:

```bash
# Using GitHub CLI
gh workflow run deploy-acroyoga.yml -f plugins="fair-rsvp,fair-events"
```

## What Gets Deployed

### Included Files
- ✅ Built JavaScript/CSS (`build/` directories)
- ✅ PHP source files
- ✅ Production vendor dependencies
- ✅ Translation files
- ✅ Plugin metadata files (readme.txt, etc.)

### Excluded Files (Not Deployed)
- ❌ Source files (`src/` directories)
- ❌ Node modules
- ❌ Development dependencies
- ❌ Tests (`tests/`, `__tests__/`)
- ❌ Build configuration files
- ❌ Git files

## Troubleshooting

### Test SSH Connection

```bash
# Test connection with the key
ssh -i ~/.ssh/acroyoga_deploy your-username@your-host

# If successful, you should get a shell prompt
```

### Check GitHub Actions Logs

1. Go to **Actions** tab
2. Click on the failed workflow run
3. Expand the failed step to see error messages

### Common Issues

**Permission denied (publickey)**
- Ensure public key is added to `~/.ssh/authorized_keys` on server
- Check private key is correctly added to GitHub secrets

**rsync: connection unexpectedly closed**
- Verify SSH_HOST is correct
- Check firewall settings on Hostinger

**rsync: change_dir ... failed: No such file or directory**
- Verify WORDPRESS_PLUGINS_PATH is correct
- The directory must exist on the server

**Plugin directory not found**
- Ensure you've run `git add` for all plugins before pushing
- Check the plugin directory exists in your repository

## Monitoring Deployments

After deployment, check:

1. **GitHub Actions logs** for build/deploy status
2. **WordPress admin** → Plugins to verify versions
3. **Site frontend** to ensure everything works

## Security Notes

- Never commit the private SSH key to the repository
- Use GitHub Secrets for all sensitive data
- Consider using deployment environments with protection rules
- Rotate SSH keys periodically
- Monitor GitHub Actions audit logs

## Rollback

If a deployment causes issues:

1. **Revert locally:**
   ```bash
   git revert HEAD
   git push origin main
   ```

2. **Or manually via SSH:**
   ```bash
   ssh your-username@your-host
   cd ~/public_html/wp-content/plugins
   # Restore from backup or previous version
   ```

## Additional Features

### Deploy on Git Tag

To deploy only on version releases, modify `.github/workflows/deploy-acroyoga.yml`:

```yaml
on:
  push:
    tags:
      - 'v*.*.*'
```

### Add Deployment Notifications

Add Slack/Discord notification steps to the workflow.

### Deploy to Staging First

Create a separate workflow for staging environment before production.

## Support

If you encounter issues:
1. Check GitHub Actions logs
2. Verify SSH connection manually
3. Check Hostinger server logs
4. Review rsync verbose output in GitHub Actions
