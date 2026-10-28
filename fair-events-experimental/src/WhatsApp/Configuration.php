<?php
/**
 * Saved WhatsApp configuration and its validation result.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WhatsApp;

defined( 'WPINC' ) || die;

/**
 * Stores the WhatsApp Business Account ID and Phone Number ID, and the result
 * of the last successful validation.
 *
 * A validation result only counts while it was made for the IDs and the access
 * token in effect now: saving other IDs clears it, and a token replaced or
 * removed in Connectors (or overridden by the environment) no longer matches
 * its fingerprint. Saving never contacts Meta.
 */
class Configuration {
	public const WABA_OPTION       = 'fair_events_experimental_whatsapp_waba_id';
	public const PHONE_OPTION      = 'fair_events_experimental_whatsapp_phone_number_id';
	public const VALIDATION_OPTION = 'fair_events_experimental_whatsapp_validation';

	/**
	 * Whether a value can be a WhatsApp Business Account or Phone Number ID.
	 *
	 * @param mixed $value Candidate ID.
	 * @return bool
	 */
	public static function valid_id( $value ) {
		return is_string( $value ) && 1 === preg_match( '/^\d{1,32}$/', $value );
	}

	/**
	 * The saved IDs.
	 *
	 * @return array{waba_id: string, phone_number_id: string}
	 */
	public static function ids() {
		return array(
			'waba_id'         => (string) get_option( self::WABA_OPTION, '' ),
			'phone_number_id' => (string) get_option( self::PHONE_OPTION, '' ),
		);
	}

	/**
	 * Save both IDs; an empty value removes one. Changed IDs clear the
	 * previous validation result.
	 *
	 * @param string $waba_id         WhatsApp Business Account ID, or ''.
	 * @param string $phone_number_id Phone Number ID, or ''.
	 * @return void
	 */
	public static function save( $waba_id, $phone_number_id ) {
		$next = array(
			'waba_id'         => (string) $waba_id,
			'phone_number_id' => (string) $phone_number_id,
		);
		if ( self::ids() !== $next ) {
			self::clear_validation();
		}
		update_option( self::WABA_OPTION, $next['waba_id'], false );
		update_option( self::PHONE_OPTION, $next['phone_number_id'], false );
	}

	/**
	 * Remember a successful validation of the saved IDs with the token in
	 * effect.
	 *
	 * @param array $sender Allowlisted sender details.
	 * @return void
	 */
	public static function record_validation( array $sender ) {
		update_option(
			self::VALIDATION_OPTION,
			array_merge(
				self::ids(),
				array(
					'token'        => self::fingerprint( Connector::token() ),
					'validated_at' => current_time( 'mysql', true ),
					'sender'       => $sender,
				)
			),
			false
		);
	}

	/**
	 * Forget the previous validation result.
	 *
	 * @return void
	 */
	public static function clear_validation() {
		delete_option( self::VALIDATION_OPTION );
	}

	/**
	 * The last validation, while it still applies to the saved IDs and the
	 * token in effect.
	 *
	 * @return array{validated_at: string, sender: array}|null
	 */
	public static function validation() {
		$stored = get_option( self::VALIDATION_OPTION, null );
		$token  = Connector::token();
		if (
			! is_array( $stored )
			|| '' === $token
			|| self::ids() !== array(
				'waba_id'         => (string) ( $stored['waba_id'] ?? '' ),
				'phone_number_id' => (string) ( $stored['phone_number_id'] ?? '' ),
			)
			|| ! hash_equals( self::fingerprint( $token ), (string) ( $stored['token'] ?? '' ) )
		) {
			return null;
		}

		return array(
			'validated_at' => (string) ( $stored['validated_at'] ?? '' ),
			'sender'       => (array) ( $stored['sender'] ?? array() ),
		);
	}

	/**
	 * A salted hash that tells tokens apart without storing one.
	 *
	 * @param string $token Access token.
	 * @return string
	 */
	private static function fingerprint( $token ) {
		return '' === $token ? '' : wp_hash( $token, 'auth' );
	}
}
