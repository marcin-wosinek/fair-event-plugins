<?php
/**
 * OAuth proxy health signal
 *
 * @package FairPlatform
 */

namespace FairPlatform\Core;

defined( 'ABSPATH' ) || die;

/**
 * Whether this site can serve as the Mollie OAuth proxy, and the fixed
 * machine-readable answer the health route gives (#2290).
 *
 * The check is local and cheap: Mollie credentials are configured and the
 * Mollie library is loaded. It never contacts Mollie, and its answer never
 * carries configuration values, versions or connected-site details.
 */
class Health {

	/**
	 * Identifies the answer as the proxy's, not some other JSON on the site.
	 */
	const SERVICE = 'fair-platform-oauth-proxy';

	/**
	 * Status value of a healthy proxy.
	 */
	const STATUS_OK = 'ok';

	/**
	 * Status value of a proxy that is running but can't serve OAuth.
	 */
	const STATUS_UNHEALTHY = 'unhealthy';

	/**
	 * Whether the proxy can serve OAuth requests.
	 *
	 * @param mixed $client_id         Configured Mollie client ID, or null.
	 * @param mixed $client_secret     Configured Mollie client secret, or null.
	 * @param bool  $library_available Whether the Mollie library is loaded.
	 * @return bool
	 */
	public static function is_healthy( $client_id, $client_secret, $library_available ) {
		return self::is_configured( $client_id )
			&& self::is_configured( $client_secret )
			&& true === $library_available;
	}

	/**
	 * Whether this site's own configuration is healthy.
	 *
	 * @return bool
	 */
	public static function check() {
		return self::is_healthy(
			defined( 'MOLLIE_CLIENT_ID' ) ? constant( 'MOLLIE_CLIENT_ID' ) : null,
			defined( 'MOLLIE_CLIENT_SECRET' ) ? constant( 'MOLLIE_CLIENT_SECRET' ) : null,
			class_exists( '\Mollie\Api\MollieApiClient' )
		);
	}

	/**
	 * HTTP status for a health answer.
	 *
	 * @param bool $healthy Health check result.
	 * @return int
	 */
	public static function status_code( $healthy ) {
		return $healthy ? 200 : 503;
	}

	/**
	 * Body of a health answer: the fixed service identifier and status, and
	 * nothing about why an unhealthy proxy is unhealthy.
	 *
	 * @param bool $healthy Health check result.
	 * @return array{service: string, status: string}
	 */
	public static function body( $healthy ) {
		return array(
			'service' => self::SERVICE,
			'status'  => $healthy ? self::STATUS_OK : self::STATUS_UNHEALTHY,
		);
	}

	/**
	 * Whether a credential value is a non-empty string.
	 *
	 * @param mixed $value Credential value.
	 * @return bool
	 */
	private static function is_configured( $value ) {
		return is_string( $value ) && '' !== trim( $value );
	}
}
