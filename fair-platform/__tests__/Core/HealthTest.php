<?php
/**
 * Health tests: when the OAuth proxy reports healthy, and what its answer
 * may contain (#2290).
 *
 * @package FairPlatform
 */

namespace FairPlatform\Tests\Core;

use FairPlatform\Core\Health;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the proxy health signal.
 */
class HealthTest extends TestCase {

	/** Credentials and the Mollie library together make a healthy proxy. */
	public function test_configured_proxy_is_healthy() {
		$this->assertTrue( Health::is_healthy( 'app_client', 'secret_value', true ) );
	}

	/**
	 * Missing or empty credentials, or a missing library, are unhealthy.
	 *
	 * @return array<string, array{mixed, mixed, bool}>
	 */
	public static function unhealthy_cases() {
		return array(
			'client ID undefined'     => array( null, 'secret_value', true ),
			'client secret undefined' => array( 'app_client', null, true ),
			'client ID empty'         => array( '', 'secret_value', true ),
			'client secret empty'     => array( 'app_client', '', true ),
			'client ID blank'         => array( '   ', 'secret_value', true ),
			'client secret not text'  => array( 'app_client', 123, true ),
			'client ID false'         => array( false, 'secret_value', true ),
			'library missing'         => array( 'app_client', 'secret_value', false ),
			'nothing configured'      => array( null, null, false ),
		);
	}

	/**
	 * Each unhealthy configuration is reported as unhealthy.
	 *
	 * @param mixed $client_id         Client ID.
	 * @param mixed $client_secret     Client secret.
	 * @param bool  $library_available Library availability.
	 */
	#[DataProvider( 'unhealthy_cases' )]
	public function test_incomplete_configuration_is_unhealthy( $client_id, $client_secret, $library_available ) {
		$this->assertFalse( Health::is_healthy( $client_id, $client_secret, $library_available ) );
	}

	/** A healthy answer is a 200 with the fixed service identifier. */
	public function test_healthy_answer() {
		$this->assertSame( 200, Health::status_code( true ) );
		$this->assertSame(
			array(
				'service' => 'fair-platform-oauth-proxy',
				'status'  => 'ok',
			),
			Health::body( true )
		);
	}

	/** An unhealthy answer is a 503 that says nothing about the cause. */
	public function test_unhealthy_answer() {
		$this->assertSame( 503, Health::status_code( false ) );
		$this->assertSame(
			array(
				'service' => 'fair-platform-oauth-proxy',
				'status'  => 'unhealthy',
			),
			Health::body( false )
		);
	}

	/** Without credential constants, this site is unhealthy. */
	public function test_site_without_credentials_is_unhealthy() {
		$this->assertFalse( defined( 'MOLLIE_CLIENT_ID' ) );
		$this->assertFalse( Health::check() );
	}

	/** With credential constants and the bundled library, this site is healthy. */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_site_with_credentials_is_healthy() {
		define( 'MOLLIE_CLIENT_ID', 'app_marker_client_id' );
		define( 'MOLLIE_CLIENT_SECRET', 'marker_client_secret' );

		$this->assertTrue( Health::check() );

		// The answer never carries a configured value.
		$encoded = implode( ' ', Health::body( Health::check() ) );
		$this->assertStringNotContainsString( 'marker_client', $encoded );
	}

	/** Empty credential constants are unhealthy. */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_site_with_empty_credentials_is_unhealthy() {
		define( 'MOLLIE_CLIENT_ID', '' );
		define( 'MOLLIE_CLIENT_SECRET', '' );

		$this->assertFalse( Health::check() );
	}
}
