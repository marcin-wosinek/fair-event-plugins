# Fair Payment

First plugin form Fair Event Plugins set—all you need for running event page,
fairy priced.

## Development

Use docker compose with:

* `docker compose up`. It spins up:
  * localhost:8080 with the WordPress,
  * localhost:8081 with phpMyAdmin

## Installation

### Using The WordPress Dashboard

1. Navigate to the 'Add New' Plugin Dashboard.
2. Select `fair-payment.zip` from your computer.
3. Upload.
4. Activate the plugin on the WordPress Plugin Dashboard.

### Using FTP

1. Extract `fair-payment.zip` to your computer.
2. Upload the `fair-payment` directory to your `wp-content/plugins` directory.
3. Activate the plugin on the WordPress Plugins Dashboard.

### Git

1. Navigate to the `plugins` directory of your WordPress installation.
2. From the terminal, run `$ git clone git@github.com:tommcfarlin/fair-payment.git`

## Translation

All plugins in this repository support internationalization (i18n). To create or update translations:

### Generate Translation Template

For any plugin (e.g., fair-events, fair-calendar-button):

```bash
cd fair-events
npm run makepot
```

This generates a `.pot` file in the `languages/` directory containing all translatable strings.

### Create a New Translation

1. Copy the `.pot` file and rename it with your locale (e.g., `fair-events-pl_PL.po` for Polish)
2. Use a translation editor like [Poedit](https://poedit.net/) to translate the strings
3. Generate `.mo` file:

```bash
npm run makemo
```

### Update Existing Translations

After adding new translatable strings to the code:

```bash
npm run makepot      # Update template
npm run updatepo     # Update all .po files with new strings
```

Then translate the new strings in your `.po` files and run `npm run makemo`.

### Build with Translations

The build process automatically generates JSON translation files for JavaScript:

```bash
npm run build
```

JSON files are created in `build/languages/` and are required for block editor translations.

## Deployment

Automated deployment to production servers via GitHub Actions is available.

### Quick Start

1. Run the setup script to gather server information:
   ```bash
   ./scripts/setup-deployment.sh
   ```

2. Add the generated secrets to GitHub:
   - Go to **Settings** → **Secrets and variables** → **Actions**
   - Add: `SSH_PRIVATE_KEY`, `SSH_HOST`, `SSH_USER`, `WORDPRESS_PLUGINS_PATH`

3. Push to main branch to deploy automatically:
   ```bash
   git push origin main
   ```

For detailed setup instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

### Manual Deployment

To trigger deployment manually or deploy specific plugins:

```bash
# Via GitHub CLI
gh workflow run deploy-acroyoga.yml -f plugins="fair-rsvp,fair-events"

# Via GitHub UI
# Actions → Deploy to Acroyoga-Club.es → Run workflow
```

## Notes

This specific repository assumes you're running PHP 8.0.  At the time of this writing, WordPress is not fully compatible with PHP 8.0; however, if you change the references to PHP 7.4.28 in

* `composer.json`
* `fair-calendar-button.php`

Then you should be okay. If you still experience problems, make sure you're not running Composer 2. If that still doesn't work, don't hesitate to open an [issue](https://github.com/tommcfarlin/fair-payment/issues).
