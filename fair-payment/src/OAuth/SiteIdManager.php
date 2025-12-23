<?php
/**
 * Site ID Manager for OAuth authentication
 *
 * @package FairPayment
 */

namespace FairPayment\OAuth;

defined( 'WPINC' ) || die;

/**
 * Manages unique site identifier for OAuth flow
 */
class SiteIdManager {
	/**
	 * Get unique site ID
	 *
	 * Generates a stable unique identifier for this WordPress installation
	 * based on the site URL and installation path. This ID is used to identify
	 * the site during the OAuth flow with fair-platform.
	 *
	 * @return string Unique site identifier (SHA-256 hash).
	 */
	public static function get_site_id() {
		$site_id = get_option( 'fair_payment_mollie_site_id' );

		if ( empty( $site_id ) ) {
			// Generate unique ID from home URL and absolute path
			// This ensures the ID remains stable across requests
			$site_id = hash( 'sha256', home_url() . ABSPATH );
			update_option( 'fair_payment_mollie_site_id', $site_id );
		}

		return $site_id;
	}

	/**
	 * Regenerate site ID
	 *
	 * Forces regeneration of the site ID. This should only be used in rare
	 * cases where the site has been migrated and needs a new identity.
	 *
	 * @return string New unique site identifier.
	 */
	public static function regenerate_site_id() {
		$site_id = hash( 'sha256', home_url() . ABSPATH . time() );
		update_option( 'fair_payment_mollie_site_id', $site_id );
		return $site_id;
	}
}
