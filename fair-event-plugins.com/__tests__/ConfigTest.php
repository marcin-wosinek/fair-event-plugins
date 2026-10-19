<?php
/**
 * Config validation tests.
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

namespace MarcinWosinek\FairEventPluginsCom\Tests;

use MarcinWosinek\FairEventPluginsCom\Config;
use MarcinWosinek\FairEventPluginsCom\ConfigurationException;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for the Stripe key, client and site base URL configuration.
 */
class ConfigTest extends TestCase {

	/**
	 * The client is pinned to the documented API version.
	 */
	public function test_stripe_client_pins_api_version(): void {
		$client = ( new Config( array( 'STRIPE_SECRET_KEY' => 'sk_test_abc123' ) ) )->stripe_client();

		$this->assertSame( '2026-09-30.endive', Config::STRIPE_API_VERSION );
		$this->assertSame( Config::STRIPE_API_VERSION, $client->getStripeVersion() );
		$this->assertSame( 'sk_test_abc123', $client->getApiKey() );
	}

	/**
	 * Missing or malformed keys are configuration errors.
	 *
	 * @dataProvider invalid_keys
	 *
	 * @param mixed $key Configured key.
	 */
	public function test_invalid_secret_key_is_rejected( $key ): void {
		$this->expectException( ConfigurationException::class );
		( new Config( array( 'STRIPE_SECRET_KEY' => $key ) ) )->stripe_client();
	}

	/**
	 * Invalid keys.
	 *
	 * @return array
	 */
	public function invalid_keys(): array {
		return array(
			'missing'         => array( null ),
			'empty'           => array( '' ),
			'publishable key' => array( 'pk_test_abc123' ),
			'no mode'         => array( 'sk_abc123' ),
			'not a string'    => array( 123 ),
		);
	}

	/**
	 * Test mode is detected from the key prefix only.
	 */
	public function test_is_test_mode(): void {
		$this->assertTrue( ( new Config( array( 'STRIPE_SECRET_KEY' => 'sk_test_abc' ) ) )->is_test_mode() );
		$this->assertTrue( ( new Config( array( 'STRIPE_SECRET_KEY' => 'rk_test_abc' ) ) )->is_test_mode() );
		$this->assertFalse( ( new Config( array( 'STRIPE_SECRET_KEY' => 'sk_live_abc' ) ) )->is_test_mode() );
		$this->assertFalse( ( new Config( array() ) )->is_test_mode() );
	}

	/**
	 * Valid base URLs are normalized without a trailing slash.
	 *
	 * @dataProvider valid_base_urls
	 *
	 * @param string $raw      Configured URL.
	 * @param string $expected Normalized URL.
	 */
	public function test_valid_site_base_url( string $raw, string $expected ): void {
		$this->assertSame( $expected, ( new Config( array( 'SITE_BASE_URL' => $raw ) ) )->site_base_url() );
	}

	/**
	 * Valid base URLs.
	 *
	 * @return array
	 */
	public function valid_base_urls(): array {
		return array(
			'https'          => array( 'https://fair-event-plugins.com', 'https://fair-event-plugins.com' ),
			'trailing slash' => array( 'https://fair-event-plugins.com/', 'https://fair-event-plugins.com' ),
			'local http'     => array( 'http://localhost:4242', 'http://localhost:4242' ),
			'loopback http'  => array( 'http://127.0.0.1:4242/', 'http://127.0.0.1:4242' ),
		);
	}

	/**
	 * Invalid base URLs are configuration errors.
	 *
	 * @dataProvider invalid_base_urls
	 *
	 * @param string $raw Configured URL.
	 */
	public function test_invalid_site_base_url_is_rejected( string $raw ): void {
		$this->expectException( ConfigurationException::class );
		( new Config( array( 'SITE_BASE_URL' => $raw ) ) )->site_base_url();
	}

	/**
	 * Invalid base URLs.
	 *
	 * @return array
	 */
	public function invalid_base_urls(): array {
		return array(
			'empty'        => array( '' ),
			'not a url'    => array( 'fair-event-plugins.com' ),
			'remote http'  => array( 'http://fair-event-plugins.com' ),
			'other scheme' => array( 'ftp://fair-event-plugins.com' ),
			'path prefix'  => array( 'https://fair-event-plugins.com/setup' ),
			'query string' => array( 'https://fair-event-plugins.com?x=1' ),
			'fragment'     => array( 'https://fair-event-plugins.com#x' ),
			'credentials'  => array( 'https://user:pass@fair-event-plugins.com' ),
			'javascript'   => array( 'javascript:alert(1)' ),
		);
	}
}
