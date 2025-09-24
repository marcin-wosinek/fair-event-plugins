<?php
/**
 * PHPUnit bootstrap file for Fair Membership plugin tests
 *
 * @package FairMembership
 */

// Include Composer autoloader
require_once __DIR__ . '/../vendor/autoload.php';

// Define WordPress constants that might be needed for testing
if ( ! defined( 'WPINC' ) ) {
	define( 'WPINC', true );
}

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', '/tmp/' );
}