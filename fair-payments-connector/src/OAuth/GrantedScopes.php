<?php
/**
 * Mollie permissions granted to this site's OAuth connection
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\OAuth;

defined( 'WPINC' ) || die;

/**
 * Records the permissions Mollie actually granted, as reported with the
 * tokens. Nothing here is derived from what was requested or from which
 * plugins are active — a connection made before scopes were recorded has
 * unknown permissions until it is reconnected.
 */
class GrantedScopes {

	/**
	 * Option holding the granted scopes as a list of strings. Deliberately
	 * not registered with register_setting(), so it never reaches
	 * /wp/v2/settings.
	 */
	const OPTION = 'fair_payment_mollie_scopes';

	/**
	 * Permission needed to read settlements.
	 */
	const SETTLEMENTS_READ = 'settlements.read';

	/**
	 * Turn Mollie's space-separated scope string into a clean list.
	 *
	 * @param mixed $scope Scope string as returned by Mollie.
	 * @return string[] Unique, well-formed scopes in the order given.
	 */
	public static function normalize( $scope ) {
		if ( ! is_string( $scope ) ) {
			return array();
		}

		$scopes = array();
		foreach ( preg_split( '/\s+/', trim( $scope ) ) as $candidate ) {
			if ( 1 === preg_match( '/^[a-z0-9-]+(\.[a-z0-9-]+)+$/', $candidate ) && ! in_array( $candidate, $scopes, true ) ) {
				$scopes[] = $candidate;
			}
		}

		return $scopes;
	}

	/**
	 * Record the scopes that came with a set of tokens. A response without
	 * usable scope metadata leaves the permissions unknown.
	 *
	 * @param mixed $scope Scope string as returned by Mollie.
	 * @return void
	 */
	public static function store( $scope ) {
		$scopes = self::normalize( $scope );

		if ( empty( $scopes ) ) {
			self::clear();
			return;
		}

		update_option( self::OPTION, $scopes );
	}

	/**
	 * Forget the recorded scopes.
	 *
	 * @return void
	 */
	public static function clear() {
		delete_option( self::OPTION );
	}

	/**
	 * Recorded scopes, or null when the connection's permissions are unknown.
	 *
	 * @return string[]|null
	 */
	public static function get() {
		$scopes = get_option( self::OPTION, null );

		if ( ! is_array( $scopes ) || empty( $scopes ) ) {
			return null;
		}

		return array_values( array_filter( $scopes, 'is_string' ) );
	}

	/**
	 * Whether settlements may be read: an active connection whose recorded
	 * scopes include exactly `settlements.read`.
	 *
	 * @return bool
	 */
	public static function has_settlement_access() {
		if ( ! get_option( 'fair_payment_mollie_connected', false ) ) {
			return false;
		}

		$scopes = self::get();

		return null !== $scopes && in_array( self::SETTLEMENTS_READ, $scopes, true );
	}

	/**
	 * Whether a plugin on this site wants settlement access requested when
	 * connecting to Mollie. Fair Finance turns this on.
	 *
	 * @return bool
	 */
	public static function is_settlement_access_requested() {
		/**
		 * Filters whether the Mollie connection should also request
		 * permission to read settlements.
		 *
		 * @param bool $requested Whether to request settlement access. Default false.
		 */
		return true === apply_filters( 'fair_payment_request_settlement_access', false );
	}
}
