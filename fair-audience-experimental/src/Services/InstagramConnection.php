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
 *
 * Connections are made through Meta's Unified Login in Fair Events →
 * Instagram (#2427) and publish through graph.facebook.com. A connection
 * stored before that carries no format marker and is never used: the
 * administrator connects again.
 */
class InstagramConnection {

	/**
	 * Connection metadata Fair Events Experimental writes with a Unified
	 * Login connection.
	 */
	const FORMAT_OPTION        = 'fair_audience_instagram_connection_format';
	const FORMAT_UNIFIED_LOGIN = 'unified_login';
	const EXPIRY_OPTION        = 'fair_audience_instagram_token_expiry';
	const EXPIRES_OPTION       = 'fair_audience_instagram_token_expires';
	const GRAPH_VERSION_OPTION = 'fair_audience_instagram_graph_version';

	/**
	 * Graph API version used when a connection names none.
	 */
	const DEFAULT_GRAPH_VERSION = 'v27.0';

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
			// A Fair Events Experimental older than #2427 still holds the
			// retired Instagram Login connection.
			if ( ! method_exists( $owner, 'graph_base' ) ) {
				return new WP_Error(
					'instagram_connection_outdated',
					__( 'Instagram publishing needs an updated Fair Events Experimental. Update it, then connect again in Fair Events → Instagram.', 'fair-audience-experimental' )
				);
			}
			return $owner::unavailable_reason();
		}

		$credentials = self::AUDIENCE_CLASS;

		$stored = get_option( 'fair_audience_instagram_access_token', '' );
		if ( is_string( $stored ) && '' !== $stored && ! self::is_unified() ) {
			return new WP_Error(
				'instagram_reconnect_required',
				__( 'Instagram needs to be reconnected: Meta replaced the way sites connect to Instagram, and this connection was made the old way. Turn on Instagram in Fair Events → Settings → Experimental, then connect again in Fair Events → Instagram.', 'fair-audience-experimental' )
			);
		}

		if ( self::is_unified() && self::has_expired() ) {
			return new WP_Error(
				'instagram_token_expired',
				__( 'Instagram needs to be reconnected: the access token has expired. Turn on Instagram in Fair Events → Settings → Experimental, then connect again in Fair Events → Instagram.', 'fair-audience-experimental' )
			);
		}

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
				__( 'Instagram is not connected. Turn on Instagram in Fair Events → Settings → Experimental, then connect an account in Fair Events → Instagram.', 'fair-audience-experimental' )
			);
		}

		if ( '' === self::user_id() ) {
			return new WP_Error(
				'instagram_not_configured',
				__( 'The Instagram account is not known. Connect again in Fair Events → Instagram.', 'fair-audience-experimental' )
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
			return class_exists( $owner ) && method_exists( $owner, 'graph_base' ) ? $owner::access_token() : '';
		}

		if ( ! self::is_unified() || self::has_expired() ) {
			return '';
		}

		$token = get_option( 'fair_audience_instagram_access_token', '' );
		return is_string( $token ) ? $token : '';
	}

	/**
	 * Whether the stored connection was made through Unified Login.
	 *
	 * @return bool
	 */
	public static function is_unified() {
		return self::FORMAT_UNIFIED_LOGIN === get_option( self::FORMAT_OPTION, '' );
	}

	/**
	 * Whether the stored token's finite expiry has passed.
	 *
	 * @return bool
	 */
	private static function has_expired() {
		return 'expires' === get_option( self::EXPIRY_OPTION, '' ) && (int) get_option( self::EXPIRES_OPTION, 0 ) <= time();
	}

	/**
	 * Graph API base URL for publishing, with the connection's version.
	 *
	 * @return string
	 */
	public static function graph_base() {
		if ( self::managed_by_events() ) {
			$owner = self::OWNER_CLASS;
			if ( class_exists( $owner ) && method_exists( $owner, 'graph_base' ) ) {
				return $owner::graph_base();
			}
		}

		$version = (string) get_option( self::GRAPH_VERSION_OPTION, '' );
		if ( ! preg_match( '/^v\d{1,3}\.\d{1,3}$/', $version ) ) {
			$version = self::DEFAULT_GRAPH_VERSION;
		}
		return 'https://graph.facebook.com/' . $version;
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
