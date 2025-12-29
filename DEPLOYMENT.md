# Deployment Setup Instructions

The deployment workflow uses a reusable workflow architecture:
- **`.github/workflows/deploy-to-environment.yml`** - Reusable workflow containing all deployment logic
- **`.github/workflows/php-ci.yml`** - Main workflow with two separate jobs (`deploy-acroyoga` and `deploy-fair-event-plugins`) that call the reusable workflow with hardcoded environment values

This approach eliminates matrix complexity while maintaining code reusability. It uses GitHub Environments to configure deployment targets.

## GitHub Environment Configuration

You need to configure two environments in GitHub:
- **Settings** → **Environments** → **New environment**

### Environment: `acroyoga-club.es`

**Variables:**
- `PLUGINS_TO_DEPLOY` = `all` (or comma-separated list: `fair-rsvp,fair-events,fair-payment`)
- `SSH_HOST` - SSH hostname (e.g., `acroyoga-club.es`)
- `SSH_PORT` - SSH port (e.g., `22`)
- `SSH_USER` - SSH username
- `WORDPRESS_PLUGINS_PATH` - Path to WordPress plugins directory (e.g., `/var/www/html/wp-content/plugins`)

**Secrets:**
- `SSH_PRIVATE_KEY` - SSH private key for deployment

### Environment: `fair-event-plugins.com`

**Variables:**
- `PLUGINS_TO_DEPLOY` = `fair-platform` (or comma-separated list, or `all`)
- `SSH_HOST` - SSH hostname
- `SSH_PORT` - SSH port (e.g., `22`)
- `SSH_USER` - SSH username
- `WORDPRESS_PLUGINS_PATH` - Path to WordPress plugins directory (e.g., `/var/www/html/wp-content/plugins`)

**Secrets:**
- `SSH_PRIVATE_KEY` - SSH private key for deployment

## How It Works

### 1. Automatic Deployment (on main branch push)
   - CI runs and builds all plugins
   - After successful build, deploys to both environments in parallel
   - Each environment deploys only the plugins specified in `PLUGINS_TO_DEPLOY`

### 2. Manual Deployment (workflow_dispatch)
   - Go to **Actions** → **Continuous integration** → **Run workflow**
   - Select the branch you want to deploy from
   - Choose which environment to deploy to:
     - `acroyoga-club.es` - Deploy only to acroyoga-club.es
     - `fair-event-plugins.com` - Deploy only to fair-event-plugins.com
     - `both` - Deploy to both environments in parallel
   - The workflow will build the plugins from the selected branch and deploy them
   - Uses the same `PLUGINS_TO_DEPLOY` configuration from the environment

### 3. Plugin Selection
   - Set `PLUGINS_TO_DEPLOY` variable in each environment
   - Use `all` to deploy all plugins
   - Or provide comma-separated list: `fair-rsvp,fair-events,fair-payment`
   - Spaces are automatically trimmed

### 4. Available Plugins
   - fair-rsvp
   - fair-events
   - fair-payment
   - fair-calendar-button
   - fair-schedule
   - fair-timetable
   - fair-registration
   - fair-membership
   - fair-user-import
   - fair-team
   - fair-platform

## Workflow Architecture

### Reusable Workflow Pattern
The deployment logic is extracted into a reusable workflow that accepts an `environment` input parameter. This provides:
- **Code reusability** - Single source of truth for deployment steps
- **Clear separation** - Two explicit jobs with hardcoded environment names
- **No matrix complexity** - Each environment has its own dedicated job
- **Easy debugging** - Direct mapping between job name and environment

### Job Flow
1. **Main workflow** (`php-ci.yml`) triggers on push or manual dispatch
2. **Build job** runs first, creating plugin artifacts
3. **Deploy jobs** run in parallel (if both environments should deploy):
   - `deploy-acroyoga` → calls reusable workflow with `environment: acroyoga-club.es`
   - `deploy-fair-event-plugins` → calls reusable workflow with `environment: fair-event-plugins.com`
4. Each deploy job checks conditions (push to main OR manual trigger with matching environment)

## Benefits of This Approach

✅ **Reusable code** - All deployment logic in one maintainable workflow file
✅ **Environment-based** - Easy to add new deployment targets (add new job + call reusable workflow)
✅ **Explicit jobs** - Hardcoded environment values make the workflow easier to read
✅ **Flexible** - Each environment can deploy different plugins via environment variables
✅ **Parallel deployment** - Both environments deploy simultaneously when triggered
✅ **No matrix complexity** - Clear, straightforward job definitions
✅ **Manual deployment** - Deploy any branch to any environment on demand
✅ **Branch flexibility** - Test changes from feature branches before merging

## Migration from Old Workflows

The old workflows (`deploy-acroyoga.yml` and `deploy-fair-platform.yml`) have been removed. The new consolidated approach provides the same functionality with better maintainability.
