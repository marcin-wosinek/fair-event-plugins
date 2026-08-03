<?php
/**
 * Sitewide organizer identity for Schema.org structured data.
 *
 * @package FairEvents
 */

namespace FairEvents\Settings;

defined( 'WPINC' ) || die;

/**
 * Pure option logic for the `fair_events_organizer` setting: read accessor +
 * sanitizer, modeled on {@see \FairEvents\Core\Features}. No WP hooks here,
 * so it unit-tests against the stub bootstrap.
 *
 * The sanitizer is a backstop, not the primary validation layer: core's
 * settings endpoint can't surface a per-entry rejection back to the UI, so
 * the Organizer settings tab validates URLs before submit. This class must
 * still never let a malformed value reach stored state or JSON-LD output.
 */
class Organizer {

	/**
	 * Option key holding the organizer identity.
	 */
	public const OPTION = 'fair_events_organizer';

	/**
	 * Allowed Schema.org `@type` values for the organizer.
	 */
	public const TYPES = array( 'Organization', 'SportsClub' );

	/**
	 * Read the stored organizer identity, normalized so every key is always
	 * present. Public so other plugins can read the identity (same pattern
	 * as `Branding::is_enabled()`).
	 *
	 * @return array{name: string, type: string, street_address: string, address_locality: string, address_region: string, postal_code: string, address_country: string, same_as: string[], logo_id: int, website: string, contact_email: string, contact_phone: string}
	 */
	public static function get(): array {
		$stored = get_option( self::OPTION, array() );
		if ( ! is_array( $stored ) ) {
			$stored = array();
		}

		return array(
			'name'             => isset( $stored['name'] ) ? (string) $stored['name'] : '',
			'type'             => isset( $stored['type'] ) && in_array( $stored['type'], self::TYPES, true )
				? $stored['type']
				: 'Organization',
			'street_address'   => isset( $stored['street_address'] ) ? (string) $stored['street_address'] : '',
			'address_locality' => isset( $stored['address_locality'] ) ? (string) $stored['address_locality'] : '',
			'address_region'   => isset( $stored['address_region'] ) ? (string) $stored['address_region'] : '',
			'postal_code'      => isset( $stored['postal_code'] ) ? (string) $stored['postal_code'] : '',
			'address_country'  => isset( $stored['address_country'] ) ? (string) $stored['address_country'] : '',
			'same_as'          => isset( $stored['same_as'] ) && is_array( $stored['same_as'] )
				? array_values( $stored['same_as'] )
				: array(),
			'logo_id'          => isset( $stored['logo_id'] ) ? absint( $stored['logo_id'] ) : 0,
			'website'          => isset( $stored['website'] ) ? (string) $stored['website'] : '',
			'contact_email'    => isset( $stored['contact_email'] ) ? (string) $stored['contact_email'] : '',
			'contact_phone'    => isset( $stored['contact_phone'] ) ? (string) $stored['contact_phone'] : '',
		);
	}

	/**
	 * Sanitize a raw organizer option payload.
	 *
	 * @param mixed $value Raw option value.
	 * @return array Sanitized organizer identity.
	 */
	public static function sanitize_option( $value ): array {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$out = array();

		foreach ( array( 'name', 'street_address', 'address_locality', 'address_region', 'postal_code', 'address_country' ) as $key ) {
			if ( ! empty( $value[ $key ] ) ) {
				$sanitized = trim( sanitize_text_field( $value[ $key ] ) );
				if ( '' !== $sanitized ) {
					$out[ $key ] = $sanitized;
				}
			}
		}

		if ( isset( $value['type'] ) && in_array( $value['type'], self::TYPES, true ) ) {
			$out['type'] = $value['type'];
		} else {
			$out['type'] = 'Organization';
		}

		$same_as = array();
		if ( ! empty( $value['same_as'] ) && is_array( $value['same_as'] ) ) {
			foreach ( $value['same_as'] as $url ) {
				$url = esc_url_raw( (string) $url );
				if ( '' === $url || ! filter_var( $url, FILTER_VALIDATE_URL ) ) {
					continue;
				}
				$same_as[] = $url;
			}
		}
		$out['same_as'] = array_values( array_unique( $same_as ) );

		foreach (
			array(
				'logo_id'       => array( self::class, 'sanitize_logo_id' ),
				'website'       => array( self::class, 'sanitize_website' ),
				'contact_email' => array( self::class, 'sanitize_contact_email' ),
				'contact_phone' => array( self::class, 'sanitize_contact_phone' ),
			) as $key => $sanitizer
		) {
			if ( empty( $value[ $key ] ) ) {
				continue;
			}

			$sanitized = call_user_func( $sanitizer, $value[ $key ] );
			if ( null !== $sanitized ) {
				$out[ $key ] = $sanitized;
			}
		}

		return $out;
	}

	/**
	 * Sanitize+validate a raw `logo_id` value.
	 *
	 * @param mixed $raw_value Raw attachment ID.
	 * @return int|null Sanitized attachment ID, or null when invalid.
	 */
	private static function sanitize_logo_id( $raw_value ) {
		$logo_id = absint( $raw_value );

		return ( $logo_id && wp_attachment_is_image( $logo_id ) ) ? $logo_id : null;
	}

	/**
	 * Sanitize+validate a raw `website` value.
	 *
	 * @param mixed $raw_value Raw website URL.
	 * @return string|null Sanitized URL, or null when invalid.
	 */
	private static function sanitize_website( $raw_value ) {
		$website = esc_url_raw( (string) $raw_value );

		return ( '' !== $website && filter_var( $website, FILTER_VALIDATE_URL ) ) ? $website : null;
	}

	/**
	 * Sanitize+validate a raw `contact_email` value.
	 *
	 * @param mixed $raw_value Raw email address.
	 * @return string|null Sanitized email, or null when invalid.
	 */
	private static function sanitize_contact_email( $raw_value ) {
		$email = sanitize_email( (string) $raw_value );

		return ( '' !== $email && is_email( $email ) ) ? $email : null;
	}

	/**
	 * Sanitize+validate a raw `contact_phone` value.
	 *
	 * @param mixed $raw_value Raw phone number.
	 * @return string|null Sanitized phone number, or null when empty.
	 */
	private static function sanitize_contact_phone( $raw_value ) {
		$phone = trim( sanitize_text_field( $raw_value ) );

		return ( '' !== $phone ) ? $phone : null;
	}
}
