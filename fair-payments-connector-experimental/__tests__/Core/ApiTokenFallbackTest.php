<?php
/**
 * ApiTokenFallback tests
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\Core;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnectorExperimental\Core\ApiTokenFallback;

/**
 * This plugin serves API tokens only for a Fair Payments Connector release
 * that does not include them yet.
 */
class ApiTokenFallbackTest extends TestCase {

	/**
	 * An updated Fair Payments Connector serves API tokens; this plugin yields.
	 */
	public function test_yields_when_fair_payments_connector_owns_api_tokens() {
		$this->assertFalse( ApiTokenFallback::resolve( true ) );
	}

	/**
	 * Experimental updated first: Fair Payments Connector has no API tokens
	 * yet, so this plugin keeps serving them.
	 */
	public function test_serves_api_tokens_for_an_older_fair_payments_connector() {
		$this->assertTrue( ApiTokenFallback::resolve( false ) );
	}

	/**
	 * The live check reads the constant Fair Payments Connector defines.
	 */
	public function test_is_owner_reads_the_connector_constant() {
		$this->assertFalse( defined( ApiTokenFallback::OWNS_CONSTANT ) );
		$this->assertTrue( ApiTokenFallback::is_owner() );
	}

	/**
	 * The signal names match the ones the two plugins' main files define.
	 */
	public function test_signal_names_match_both_plugins() {
		$root = dirname( __DIR__, 3 );
		// phpcs:disable WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- reads local source files.
		$main         = file_get_contents( $root . '/fair-payments-connector/fair-payments-connector.php' );
		$experimental = file_get_contents( $root . '/fair-payments-connector-experimental/fair-payments-connector-experimental.php' );
		// phpcs:enable

		$this->assertStringContainsString( "define( '" . ApiTokenFallback::OWNS_CONSTANT . "', true );", $main );
		$this->assertStringContainsString( "define( '" . ApiTokenFallback::HANDOFF_CONSTANT . "', true );", $experimental );
	}
}
