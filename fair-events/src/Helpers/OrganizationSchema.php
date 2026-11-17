<?php
/**
 * Schema.org Organization JSON-LD shaping
 *
 * Pure, static helpers for building the sitewide organizer
 * identity node and the `organizer` reference embedded in event JSON-LD,
 * from the `fair_events_organizer` setting.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use FairEvents\Settings\Organizer;

defined( 'WPINC' ) || die;

/**
 * Builds Schema.org organizer JSON-LD structures.
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
	 * Build the sitewide Schema.org organizer object.
	 *
	 * @return array|null Organization object (without `@context`), or null when no name is configured.
	 */
	public static function organization_to_jsonld() {
		$organizer = Organizer::get();

		if ( '' === $organizer['name'] ) {
			return null;
		}

		return self::organizer_to_jsonld( $organizer, self::node_id(), true );
	}

	/**
	 * Build a full Schema.org Organization/Person object for one organizer
	 * identity: the identity block plus address, `sameAs`, logo and contact
	 * point, each only when set.
	 *
	 * Reads only the public identity fields, so a record that also carries
	 * private notification recipients (an additional organizer from Fair
	 * Events Experimental) can be passed as it is.
	 *
	 * @param array  $organizer          Normalized organizer identity, shaped like Organizer::get().
	 * @param string $node_id            The node's `@id`.
	 * @param bool   $site_logo_fallback Whether to fall back to the site logo
	 *                                   when the organizer has none; only the
	 *                                   sitewide organizer stands for the site.
	 * @return array Organizer object (without `@context`).
	 */
	public static function organizer_to_jsonld( array $organizer, string $node_id, bool $site_logo_fallback = false ): array {
		$data        = self::build_identity_node( $organizer );
		$data['@id'] = $node_id;

		$address = self::build_address( $organizer );
		if ( ! empty( $address ) ) {
			$data['address'] = $address;
		}

		if ( ! empty( $organizer['same_as'] ) ) {
			$data['sameAs'] = $organizer['same_as'];
		}

		$logo_url = self::get_logo_url( $organizer, $site_logo_fallback );
		if ( $logo_url ) {
			// Schema.org `Person` has no `logo`; its picture is `image`.
			$data[ 'Person' === $organizer['type'] ? 'image' : 'logo' ] = $logo_url;
		}

		$contact_point = self::build_contact_point( $organizer );
		if ( ! empty( $contact_point ) ) {
			$data['contactPoint'] = $contact_point;
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

		return self::build_identity_node( $organizer );
	}

	/**
	 * Build the shared `@type`/`@id`/`name`/`url` identity block used by both
	 * the sitewide Organization object and the per-event organizer reference.
	 *
	 * @param array $organizer Normalized organizer identity, as returned by Organizer::get().
	 * @return array{'@type': string, '@id': string, name: string, url: string} Identity node.
	 */
	private static function build_identity_node( array $organizer ): array {
		return array(
			'@type' => $organizer['type'],
			'@id'   => self::node_id(),
			'name'  => $organizer['name'],
			'url'   => '' !== $organizer['website'] ? $organizer['website'] : home_url(),
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
	 * Resolve the organizer's logo URL: the organizer setting's `logo_id`
	 * when set, else the `custom_logo` theme mod (block themes' site-logo
	 * block writes to the same theme mod, so this covers classic and block
	 * themes alike).
	 *
	 * @param array $organizer          Normalized organizer identity, as returned by Organizer::get().
	 * @param bool  $site_logo_fallback Whether to use the site logo when the organizer has none.
	 * @return string|null Logo URL, or null when there is no logo set (or the attachment is gone).
	 */
	private static function get_logo_url( array $organizer, bool $site_logo_fallback = true ) {
		$attachment_id = ! empty( $organizer['logo_id'] ) ? (int) $organizer['logo_id'] : 0;
		if ( ! $attachment_id && $site_logo_fallback ) {
			$attachment_id = get_theme_mod( 'custom_logo' );
		}
		if ( ! $attachment_id ) {
			return null;
		}

		$url = wp_get_attachment_image_url( $attachment_id, 'full' );

		return $url ? $url : null;
	}

	/**
	 * Build a Schema.org ContactPoint from the organizer's contact fields.
	 *
	 * @param array $organizer Normalized organizer identity, as returned by Organizer::get().
	 * @return array ContactPoint object, or an empty array when neither field is set.
	 */
	private static function build_contact_point( array $organizer ): array {
		if ( '' === $organizer['contact_email'] && '' === $organizer['contact_phone'] ) {
			return array();
		}

		$contact_point = array(
			'@type'       => 'ContactPoint',
			'contactType' => 'customer service',
		);

		if ( '' !== $organizer['contact_email'] ) {
			$contact_point['email'] = $organizer['contact_email'];
		}

		if ( '' !== $organizer['contact_phone'] ) {
			$contact_point['telephone'] = $organizer['contact_phone'];
		}

		return $contact_point;
	}
}
