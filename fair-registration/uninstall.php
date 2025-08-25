<?php
/**
 * Uninstall script for Fair Registration
 *
 * @package FairRegistration
 */

// If uninstall not called from WordPress, exit
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

// Load the plugin autoloader
require_once __DIR__ . '/vendor/autoload.php';

use FairRegistration\Hooks\ActivationHooks;

// Run uninstall cleanup
ActivationHooks::uninstall();