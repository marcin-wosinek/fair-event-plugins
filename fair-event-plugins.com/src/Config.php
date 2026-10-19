<?php
/**
 * Server configuration for the Stripe onboarding endpoints.
 *
 * @package MarcinWosinek\FairEventPluginsCom
 */

namespace MarcinWosinek\FairEventPluginsCom;

use Dotenv\Dotenv;
use Stripe\StripeClient;

/**
 * Reads and validates STRIPE_SECRET_KEY and SITE_BASE_URL.
 */
class Config {

	/**
	 * Stripe API version both endpoints use. Pinned to the version
	 * stripe/stripe-php 22.0.0 was generated against; change it together
	 * with the SDK (see README.md).
	 */
	const STRIPE_API_VERSION = '2026-09-30.endive';

	/**
	 * Raw configuration values keyed by variable name.
	 *
	 * @var array<string, string>
	 */
	private $values;

	/**
	 * Constructor.
	 *
	 * @param array<string, mixed> $values Raw configuration values.
	 */
	public function __construct( array $values ) {
		$this->values = array();
		foreach ( array( 'STRIPE_SECRET_KEY', 'SITE_BASE_URL' ) as $name ) {
			$this->values[ $name ] = isset( $values[ $name ] ) && is_string( $values[ $name ] ) ? trim( $values[ $name ] ) : '';
		}
	}

	/**
	 * Load configuration from `<dir>/.env` (optional) and the process environment.
	 *
	 * @param string $dir Directory holding the .env file.
	 * @return self
	 */
	public static function from_environment( string $dir ): self {
		// A missing or unreadable .env is a configuration error reported later,
		// inside the endpoints' JSON error boundary.
		try {
			Dotenv::createImmutable( $dir )->safeLoad();
		} catch ( \Throwable $e ) {
			unset( $e );
		}

		$values = array();
		foreach ( array( 'STRIPE_SECRET_KEY', 'SITE_BASE_URL' ) as $name ) {
			$value           = $_ENV[ $name ] ?? getenv( $name ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Server configuration; validated by the getters.
			$values[ $name ] = is_string( $value ) ? $value : '';
		}

		return new self( $values );
	}

	/**
	 * Stripe secret key.
	 *
	 * @return string
	 * @throws ConfigurationException When the key is missing or malformed.
	 */
	public function stripe_secret_key(): string {
		$key = $this->values['STRIPE_SECRET_KEY'];
		if ( ! preg_match( '/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/', $key ) ) {
			throw new ConfigurationException( 'STRIPE_SECRET_KEY is missing or malformed.' );
		}
		return $key;
	}

	/**
	 * Whether the configured key is a Stripe test-mode key.
	 *
	 * @return bool
	 */
	public function is_test_mode(): bool {
		return 1 === preg_match( '/^(sk|rk)_test_/', $this->values['STRIPE_SECRET_KEY'] );
	}

	/**
	 * Stripe client pinned to STRIPE_API_VERSION.
	 *
	 * @return StripeClient
	 * @throws ConfigurationException When the key is missing or malformed.
	 */
	public function stripe_client(): StripeClient {
		return new StripeClient(
			array(
				'api_key'        => $this->stripe_secret_key(),
				'stripe_version' => self::STRIPE_API_VERSION,
			)
		);
	}

	/**
	 * Public base URL of the onboarding page, without a trailing slash.
	 *
	 * Must be https, except for localhost development, and name the site
	 * root: index.html and index.js use root-relative paths.
	 *
	 * @return string
	 * @throws ConfigurationException When the URL is missing or invalid.
	 */
	public function site_base_url(): string {
		$url   = rtrim( $this->values['SITE_BASE_URL'], '/' );
		$parts = filter_var( $url, FILTER_VALIDATE_URL ) ? parse_url( $url ) : false; // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- Not a WordPress runtime.

		if ( ! is_array( $parts ) || empty( $parts['host'] ) || isset( $parts['path'] ) || isset( $parts['query'] ) || isset( $parts['fragment'] ) || isset( $parts['user'] ) ) {
			throw new ConfigurationException( 'SITE_BASE_URL is missing or invalid.' );
		}

		$scheme   = strtolower( $parts['scheme'] ?? '' );
		$is_local = in_array( strtolower( $parts['host'] ), array( 'localhost', '127.0.0.1' ), true );
		if ( 'https' !== $scheme && ! ( 'http' === $scheme && $is_local ) ) {
			throw new ConfigurationException( 'SITE_BASE_URL must use https outside localhost.' );
		}

		return $url;
	}
}
