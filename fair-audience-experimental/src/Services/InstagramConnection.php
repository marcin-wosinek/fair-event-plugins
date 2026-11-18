<?php
/**
 * Instagram connection used by manual posting
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Services;

use WP_Error;

defined( 'WPINC' ) || die;

/**
 * The shared Instagram connection, wherever it is managed.
 *
 * While Fair Events Experimental owns the connection (it defines
 * OWNER_CONSTANT), the token and account come from its Connection class.
 * Otherwise Fair Audience owns it, as before. The stored options are the
 * same either way, so posting keeps working across the handoff.
 */
class InstagramConnection {

	/**
	 * Defined by Fair Events Experimental while it owns the connection.
	 */
	const OWNER_CONSTANT = 'FAIR_EVENTS_EXPERIMENTAL_INSTAGRAM_OWNER';

	/**
	 * Fair Events Experimental's connection class.
	 */
	const OWNER_CLASS = '\FairEventsExperimental\Instagram\Connection';

	/**
	 * Fair Audience's credential class.
	 */
	const AUDIENCE_CLASS = '\FairAudience\Settings\InstagramCredentials';

	/**
	 * Whether Fair Events Experimental manages the connection on this request.
	 *
	 * @return bool
	 */
	public static function managed_by_events() {
		return defined( self::OWNER_CONSTANT );
	}

	/**
	 * Why the connection cannot be used to publish, or null when it can.
	 *
	 * @return WP_Error|null
	 */
	public static function unavailable_reason() {
		if ( self::managed_by_events() ) {
			$owner = self::OWNER_CLASS;
			if ( ! class_exists( $owner ) ) {
				return new WP_Error(
					'instagram_connection_unavailable',
					__( 'The Instagram connection is managed by Fair Events Experimental, which is not available right now. Make sure Fair Events and Fair Events Experimental are active and up to date.', 'fair-audience-experimental' )
				);
			}
			return $owner::unavailable_reason();
		}

		$credentials = self::AUDIENCE_CLASS;

		// Checked before the token itself, which reads as empty when unreadable.
		if ( class_exists( $credentials ) && ! $credentials::is_available() ) {
			return new WP_Error(
				'instagram_credentials_unavailable',
				$credentials::admin_message( $credentials::status() )
			);
		}

		if ( '' === self::access_token() ) {
			return new WP_Error(
				'instagram_not_configured',
				__( 'Instagram access token is not configured. Please connect your Instagram account in Fair Audience → Settings → Instagram.', 'fair-audience-experimental' )
			);
		}

		if ( '' === self::user_id() ) {
			return new WP_Error(
				'instagram_not_configured',
				__( 'Instagram user ID is not configured. Please connect your Instagram account in Fair Audience → Settings → Instagram.', 'fair-audience-experimental' )
			);
		}

		return null;
	}

	/**
	 * The usable access token, or ''.
	 *
	 * @return string
	 */
	public static function access_token() {
		if ( self::managed_by_events() ) {
			$owner = self::OWNER_CLASS;
			return class_exists( $owner ) ? $owner::access_token() : '';
		}

		$token = get_option( 'fair_audience_instagram_access_token', '' );
		return is_string( $token ) ? $token : '';
	}

	/**
	 * The connected account's Instagram user ID, or ''.
	 *
	 * @return string
	 */
	public static function user_id() {
		return (string) get_option( 'fair_audience_instagram_user_id', '' );
	}
}
