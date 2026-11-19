<?php
/**
 * An administrator's own default number for WhatsApp test sends.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WhatsApp;

defined( 'WPINC' ) || die;

/**
 * Stores one optional default test recipient per user, in protected user
 * meta (the leading underscore keeps it out of the generic user REST fields
 * and the custom fields UI). Saving a number never sends anything: it only
 * prefills the test form on later visits.
 */
class TestRecipient {
	public const META_KEY = '_fair_events_experimental_whatsapp_test_recipient';

	/**
	 * The user's saved number, digits only, or '' when none is saved.
	 *
	 * @param int $user_id User ID.
	 * @return string
	 */
	public static function get( $user_id ) {
		$value = get_user_meta( (int) $user_id, self::META_KEY, true );
		// Only a number that still validates is offered back.
		return is_string( $value ) ? Client::normalize_recipient( $value ) : '';
	}

	/**
	 * Save the user's number, or remove it with ''. The number must already be
	 * normalized with {@see Client::normalize_recipient()}.
	 *
	 * @param int    $user_id User ID.
	 * @param string $digits  Normalized number, or '' to clear it.
	 * @return bool Whether the stored value now matches the request.
	 */
	public static function save( $user_id, $digits ) {
		$user_id = (int) $user_id;
		$digits  = (string) $digits;
		if ( self::get( $user_id ) === $digits && ( '' !== $digits || ! metadata_exists( 'user', $user_id, self::META_KEY ) ) ) {
			// Unchanged: update_user_meta() would report false.
			return true;
		}
		if ( '' === $digits ) {
			delete_user_meta( $user_id, self::META_KEY );
		} else {
			update_user_meta( $user_id, self::META_KEY, $digits );
		}
		wp_cache_delete( $user_id, 'user_meta' );
		$stored = get_user_meta( $user_id, self::META_KEY, true );
		return '' === $digits ? ! metadata_exists( 'user', $user_id, self::META_KEY ) : $stored === $digits;
	}
}
