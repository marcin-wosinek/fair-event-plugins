<?php
/**
 * Fair Membership Uninstall Script
 *
 * Fired when the plugin is uninstalled.
 *
 * @package FairMembership
 */

// If uninstall not called from WordPress, then exit.
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

require_once __DIR__ . '/vendor/autoload.php';

use FairMembership\Database\Installer;

// Remove database tables and options
Installer::uninstall();