<?php
/**
 * PHPUnit bootstrap file
 *
 * @package FairPaymentsConnectorExperimental
 */

// Load Composer autoloader.
require_once dirname( __DIR__ ) . '/vendor/autoload.php';

// WordPress constant stubs.
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', 'wp-includes' );
}
