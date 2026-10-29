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
	public const WEBHOOK_OPTION    = 'fair_events_experimental_whatsapp_webhook';

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
	 * Remember that Meta verified the callback URL with the verify token in
	 * effect.
	 *
	 * @return void
	 */
	public static function record_webhook_verification() {
		self::update_webhook(
			array(
				'verified_at'    => current_time( 'mysql', true ),
				'verified_token' => self::fingerprint( Connector::webhook_credential( 'verify_token' )['token'] ),
			)
		);
	}

	/**
	 * Remember that an authenticated callback for the saved account arrived.
	 *
	 * @return void
	 */
	public static function record_webhook_receipt() {
		self::update_webhook(
			array(
				'received_at'  => current_time( 'mysql', true ),
				'received_for' => self::receipt_fingerprint(),
			)
		);
	}

	/**
	 * When the webhook was last verified and when it last delivered an
	 * authenticated event, each only while it still applies: another verify
	 * token voids the verification; another App Secret or other IDs void the
	 * receipt.
	 *
	 * @return array{verified_at: string|null, received_at: string|null}
	 */
	public static function webhook() {
		$stored = get_option( self::WEBHOOK_OPTION, array() );
		$stored = is_array( $stored ) ? $stored : array();
		$token  = self::fingerprint( Connector::webhook_credential( 'verify_token' )['token'] );
		$secret = self::receipt_fingerprint();

		return array(
			'verified_at' => '' !== $token && hash_equals( $token, (string) ( $stored['verified_token'] ?? '' ) )
				? (string) ( $stored['verified_at'] ?? '' )
				: null,
			'received_at' => '' !== $secret && hash_equals( $secret, (string) ( $stored['received_for'] ?? '' ) )
				? (string) ( $stored['received_at'] ?? '' )
				: null,
		);
	}

	/**
	 * Merge fields into the stored webhook indicators.
	 *
	 * @param array $fields Fields to store.
	 * @return void
	 */
	private static function update_webhook( array $fields ) {
		$stored = get_option( self::WEBHOOK_OPTION, array() );
		update_option( self::WEBHOOK_OPTION, array_merge( is_array( $stored ) ? $stored : array(), $fields ), false );
	}

	/**
	 * What a receipt was recorded for: the App Secret and both IDs.
	 *
	 * @return string Empty while the App Secret is missing.
	 */
	private static function receipt_fingerprint() {
		$secret = Connector::webhook_credential( 'app_secret' )['token'];
		return '' === $secret ? '' : self::fingerprint( $secret . '|' . implode( '|', self::ids() ) );
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
