<?php
/**
 * ApiTokenOwnership tests
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Core;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Core\ApiTokenOwnership;

/**
 * Exactly one plugin serves API tokens for every combination of installed
 * releases, in either update order.
 */
class ApiTokenOwnershipTest extends TestCase {

	/**
	 * Without the experimental plugin, this plugin serves API tokens.
	 */
	public function test_owns_api_tokens_when_the_experimental_plugin_is_inactive() {
		$this->assertTrue( ApiTokenOwnership::resolve( false, false ) );
	}

	/**
	 * Updated experimental plugin hands API tokens over.
	 */
	public function test_owns_api_tokens_when_the_experimental_plugin_hands_off() {
		$this->assertTrue( ApiTokenOwnership::resolve( true, true ) );
	}

	/**
	 * Main plugin updated first: the older experimental release keeps serving
	 * API tokens, so this plugin stays out of the way.
	 */
	public function test_leaves_api_tokens_to_an_experimental_release_without_the_handoff() {
		$this->assertFalse( ApiTokenOwnership::resolve( true, false ) );
	}

	/**
	 * The live check reads the constants the plugins define; with none of the
	 * experimental ones defined this plugin is the owner.
	 */
	public function test_is_owner_reads_the_experimental_constants() {
		$this->assertFalse( defined( ApiTokenOwnership::EXPERIMENTAL_VERSION_CONSTANT ) );
		$this->assertTrue( ApiTokenOwnership::is_owner() );
	}

	/**
	 * The signal names match the ones the two plugins' main files define, and
	 * the experimental plugin's fallback reads.
	 */
	public function test_signal_names_match_both_plugins() {
		$this->assertSame( 'FAIR_PAYMENTS_CONNECTOR_OWNS_API_TOKENS', ApiTokenOwnership::OWNS_CONSTANT );
		$this->assertSame( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_API_TOKENS_HANDOFF', ApiTokenOwnership::HANDOFF_CONSTANT );
		$this->assertSame( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_VERSION', ApiTokenOwnership::EXPERIMENTAL_VERSION_CONSTANT );

		$root = dirname( __DIR__, 3 );
		// phpcs:disable WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- reads local source files.
		$main         = file_get_contents( $root . '/fair-payments-connector/fair-payments-connector.php' );
		$experimental = file_get_contents( $root . '/fair-payments-connector-experimental/fair-payments-connector-experimental.php' );
		$fallback     = file_get_contents( $root . '/fair-payments-connector-experimental/src/Core/ApiTokenFallback.php' );
		// phpcs:enable

		$this->assertStringContainsString( "define( '" . ApiTokenOwnership::OWNS_CONSTANT . "', true );", $main );
		$this->assertStringContainsString( "define( '" . ApiTokenOwnership::HANDOFF_CONSTANT . "', true );", $experimental );
		$this->assertStringContainsString( "define( '" . ApiTokenOwnership::EXPERIMENTAL_VERSION_CONSTANT . "',", $experimental );
		$this->assertStringContainsString( "const OWNS_CONSTANT = '" . ApiTokenOwnership::OWNS_CONSTANT . "';", $fallback );
	}

	/**
	 * Every pairing of releases has exactly one owner. The experimental
	 * plugin's own rule (Core\ApiTokenFallback there) is "serve API tokens
	 * unless Fair Payments Connector declares it does"; a release from before
	 * the handoff always serves them.
	 *
	 * @dataProvider release_pairings
	 *
	 * @param bool        $connector_declares Whether this plugin's release defines OWNS_CONSTANT.
	 * @param string|null $experimental       Experimental release: null (inactive), 'old' or 'new'.
	 * @param string      $expected_owner     'connector' or 'experimental'.
	 */
	public function test_every_release_pairing_has_exactly_one_owner( $connector_declares, $experimental, $expected_owner ) {
		$connector_owns = $connector_declares
			&& ApiTokenOwnership::resolve( null !== $experimental, 'new' === $experimental );

		$experimental_owns = false;
		if ( 'old' === $experimental ) {
			$experimental_owns = true;
		} elseif ( 'new' === $experimental ) {
			$experimental_owns = ! $connector_declares;
		}

		$this->assertNotSame( $connector_owns, $experimental_owns, 'Exactly one plugin must own API tokens.' );
		$this->assertSame( 'connector' === $expected_owner, $connector_owns );
	}

	/**
	 * Release pairings that can be active together.
	 *
	 * @return array[]
	 */
	public function release_pairings() {
		return array(
			'connector only'                  => array( true, null, 'connector' ),
			'new connector, old experimental' => array( true, 'old', 'experimental' ),
			'old connector, old experimental' => array( false, 'old', 'experimental' ),
			'old connector, new experimental' => array( false, 'new', 'experimental' ),
			'both updated'                    => array( true, 'new', 'connector' ),
		);
	}
}
