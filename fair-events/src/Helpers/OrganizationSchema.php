<?php
/**
 * Schema.org Organization JSON-LD shaping
 *
 * Pure, static helpers for building the sitewide Organization/SportsClub
 * identity node and the `organizer` reference embedded in event JSON-LD,
 * from the `fair_events_organizer` setting.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use FairEvents\Settings\Organizer;

defined( 'WPINC' ) || die;

/**
 * Builds Schema.org Organization/SportsClub JSON-LD structures.
 */
class OrganizationSchema {

	/**
	 * The sitewide identity node's `@id`.
	 *
	 * @return string
	 */
	public static function node_id(): string {
		return home_url( '/' ) . '#organization';
	}

	/**
	 * Build the sitewide Schema.org Organization/SportsClub object.
	 *
	 * @return array|null Organization object (without `@context`), or null when no name is configured.
	 */
	public static function organization_to_jsonld() {
		$organizer = Organizer::get();

		if ( '' === $organizer['name'] ) {
			return null;
		}

		$data = array(
			'@type' => $organizer['type'],
			'@id'   => self::node_id(),
			'name'  => $organizer['name'],
			'url'   => home_url(),
		);

		$address = self::build_address( $organizer );
		if ( ! empty( $address ) ) {
			$data['address'] = $address;
		}

		if ( ! empty( $organizer['same_as'] ) ) {
			$data['sameAs'] = $organizer['same_as'];
		}

		$logo_url = self::get_logo_url();
		if ( $logo_url ) {
			$data['logo'] = $logo_url;
		}

		return $data;
	}

	/**
	 * Build the `organizer` reference embedded in an event's JSON-LD.
	 *
	 * When a name is configured, references the sitewide identity node by
	 * `@id`. Otherwise falls back to the site name/home URL, verbatim, so the
	 * unconfigured-fallback output stays byte-identical to today's.
	 *
	 * @return array Organizer reference object.
	 */
	public static function organizer_ref(): array {
		$organizer = Organizer::get();

		if ( '' === $organizer['name'] ) {
			return array(
				'@type' => 'Organization',
				'name'  => get_bloginfo( 'name' ),
				'url'   => home_url(),
			);
		}

		return array(
			'@type' => $organizer['type'],
			'@id'   => self::node_id(),
			'name'  => $organizer['name'],
			'url'   => home_url(),
		);
	}

	/**
	 * Build a Schema.org PostalAddress from the organizer's address parts.
	 *
	 * @param array $organizer Normalized organizer identity, as returned by Organizer::get().
	 * @return array PostalAddress object, or an empty array when every part is empty.
	 */
	private static function build_address( array $organizer ): array {
		$map = array(
			'street_address'   => 'streetAddress',
			'address_locality' => 'addressLocality',
			'address_region'   => 'addressRegion',
			'postal_code'      => 'postalCode',
			'address_country'  => 'addressCountry',
		);

		$address = array();
		foreach ( $map as $source_key => $schema_key ) {
			if ( ! empty( $organizer[ $source_key ] ) ) {
				$address[ $schema_key ] = $organizer[ $source_key ];
			}
		}

		if ( empty( $address ) ) {
			return array();
		}

		return array_merge( array( '@type' => 'PostalAddress' ), $address );
	}

	/**
	 * Resolve the site's logo URL from the `custom_logo` theme mod. Block
	 * themes' site-logo block writes to the same theme mod, so this covers
	 * classic and block themes alike.
	 *
	 * @return string|null Logo URL, or null when there is no logo set (or the attachment is gone).
	 */
	private static function get_logo_url() {
		$attachment_id = get_theme_mod( 'custom_logo' );
		if ( ! $attachment_id ) {
			return null;
		}

		$url = wp_get_attachment_image_url( $attachment_id, 'full' );

		return $url ? $url : null;
	}
}
