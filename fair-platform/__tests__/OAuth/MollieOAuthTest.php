<?php
/**
 * MollieOAuth tests: requested permissions, refresh payload, and where an
 * authorization error may be returned (#1693).
 *
 * @package FairPlatform
 */

namespace FairPlatform\Tests\OAuth;

use PHPUnit\Framework\TestCase;
use FairPlatform\OAuth\MollieOAuth;

/**
 * Unit tests for the side-effect-free parts of the Mollie OAuth flow.
 */
class MollieOAuthTest extends TestCase {

	/** A site that does not ask for settlement access gets today's permissions. */
	public function test_default_scope_is_the_existing_permission_set() {
		$this->assertSame(
			'payments.read payments.write refunds.read refunds.write organizations.read profiles.read profiles.write balances.read',
			MollieOAuth::authorization_scope( false )
		);
	}

	/** Settlement access adds exactly one permission to the existing set. */
	public function test_settlement_access_appends_only_settlements_read() {
		$this->assertSame(
			MollieOAuth::authorization_scope( false ) . ' settlements.read',
			MollieOAuth::authorization_scope( true )
		);
	}

	/** Only the literal flag requests settlement access; no scope list is accepted. */
	public function test_settlement_access_flag_is_bounded() {
		$this->assertTrue( MollieOAuth::is_settlement_access_requested( '1' ) );

		foreach ( array( '', '0', 'true', 'settlements.read', 'payments.read settlements.read', 1, true, null ) as $value ) {
			$this->assertFalse( MollieOAuth::is_settlement_access_requested( $value ) );
		}
	}

	/** A refresh response without scope metadata does not invent any. */
	public function test_refresh_data_omits_scope_and_refresh_token_when_mollie_omits_them() {
		$data = MollieOAuth::refresh_response_data(
			array(
				'access_token' => 'access_new',
				'expires_in'   => 1800,
			)
		);

		$this->assertSame(
			array(
				'access_token' => 'access_new',
				'expires_in'   => 1800,
			),
			$data
		);
	}

	/** Scope and a rotated refresh token are passed through as Mollie returned them. */
	public function test_refresh_data_passes_scope_and_rotated_refresh_token_through() {
		$data = MollieOAuth::refresh_response_data(
			array(
				'access_token'  => 'access_new',
				'refresh_token' => 'refresh_new',
				'scope'         => 'payments.read settlements.read',
			)
		);

		$this->assertSame( 'access_new', $data['access_token'] );
		$this->assertSame( 3600, $data['expires_in'] );
		$this->assertSame( 'payments.read settlements.read', $data['scope'] );
		$this->assertSame( 'refresh_new', $data['refresh_token'] );
	}

	/** Empty or non-string values are treated as absent. */
	public function test_refresh_data_ignores_empty_scope_and_refresh_token() {
		$data = MollieOAuth::refresh_response_data(
			array(
				'access_token'  => 'access_new',
				'refresh_token' => '',
				'scope'         => array( 'settlements.read' ),
			)
		);

		$this->assertArrayNotHasKey( 'scope', $data );
		$this->assertArrayNotHasKey( 'refresh_token', $data );
	}

	/** A cancellation with valid stored state goes back to that site, with its own state. */
	public function test_error_is_returned_to_the_site_named_by_stored_state() {
		$url = MollieOAuth::error_return_url(
			array(
				'return_url'   => 'https://site.test/wp-admin/admin.php?page=fair-payments-connector-settings',
				'client_state' => 'client-state-1',
			),
			'access_denied',
			'The user cancelled & left'
		);

		$this->assertSame(
			'https://site.test/wp-admin/admin.php?page=fair-payments-connector-settings&error=access_denied&error_description=The%20user%20cancelled%20%26%20left&state=client-state-1',
			$url
		);
	}

	/** Without stored state there is no site to return the error to. */
	public function test_error_is_not_returned_anywhere_without_valid_stored_state() {
		$this->assertSame( '', MollieOAuth::error_return_url( false, 'access_denied', 'Cancelled' ) );
		$this->assertSame( '', MollieOAuth::error_return_url( array(), 'access_denied', 'Cancelled' ) );
		$this->assertSame(
			'',
			MollieOAuth::error_return_url( array( 'client_state' => 'x' ), 'access_denied', 'Cancelled' )
		);
	}
}
