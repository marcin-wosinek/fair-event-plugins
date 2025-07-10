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

## Notes

This specific repository assumes you're running PHP 8.0.  At the time of this writing, WordPress is not fully compatible with PHP 8.0; however, if you change the references to PHP 7.4.28 in

* `composer.json`
* `plugin.php`

Then you should be okay. If you still experience problems, make sure you're not running Composer 2. If that still doesn't work, don't hesitate to open an [issue](https://github.com/tommcfarlin/fair-payment/issues).
