<?php
/**
 * Venue Info block renderer.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\Venue;

defined( 'WPINC' ) || die;

/**
 * Renders a venue's public details for the Venue Info block as one escaped
 * HTML fragment. Shared by the block's render.php for both the public page
 * and the editor preview (ServerSideRender), so both always match.
 */
class VenueInfoRenderer {

	/**
	 * Render the block for a stored venue ID.
	 *
	 * @param mixed  $venue_id           Venue ID from the block attributes.
	 * @param string $wrapper_attributes Escaped wrapper attributes from get_block_wrapper_attributes().
	 * @return string HTML, or '' when the venue is unset, invalid, or deleted.
	 */
	public static function render( $venue_id, $wrapper_attributes ) {
		$venue_id = is_numeric( $venue_id ) ? (int) $venue_id : 0;
		if ( $venue_id <= 0 ) {
			return '';
		}

		$venue = Venue::get_by_id( $venue_id );
		if ( ! $venue ) {
			return '';
		}

		return self::render_venue( $venue, $wrapper_attributes );
	}

	/**
	 * Render a resolved venue.
	 *
	 * @param Venue  $venue              Venue.
	 * @param string $wrapper_attributes Escaped wrapper attributes from get_block_wrapper_attributes().
	 * @return string HTML.
	 */
	public static function render_venue( Venue $venue, $wrapper_attributes ) {
		$destinations = self::get_destinations( $venue );
		$name         = trim( (string) $venue->name );
		if ( '' === $name ) {
			$name = __( '(unnamed venue)', 'fair-events' );
		}

		$name_url = self::get_name_url( $destinations );

		$html  = '<div ' . $wrapper_attributes . '>';
		$html .= '<p class="wp-block-fair-events-venue-info__name">';
		if ( $name_url ) {
			$html .= self::external_link( $name_url, esc_html( $name ) );
		} else {
			$html .= esc_html( $name );
		}
		$html .= '</p>';

		$address = trim( (string) $venue->address );
		if ( '' !== $address ) {
			$html .= '<p class="wp-block-fair-events-venue-info__address">' . nl2br( esc_html( $address ), false ) . '</p>';
		}

		$labels = array(
			'website'   => __( 'Website', 'fair-events' ),
			'maps'      => __( 'Google Maps', 'fair-events' ),
			'facebook'  => __( 'Facebook', 'fair-events' ),
			'instagram' => __( 'Instagram', 'fair-events' ),
		);

		$items = '';
		foreach ( $labels as $key => $label ) {
			if ( empty( $destinations[ $key ] ) ) {
				continue;
			}
			$items .= '<li class="wp-block-fair-events-venue-info__link wp-block-fair-events-venue-info__link--' . esc_attr( $key ) . '">'
				. self::external_link( $destinations[ $key ], esc_html( $label ) )
				. '</li>';
		}
		if ( '' !== $items ) {
			$html .= '<ul class="wp-block-fair-events-venue-info__links">' . $items . '</ul>';
		}

		$html .= '</div>';

		return $html;
	}

	/**
	 * Resolve every safe external destination of a venue.
	 *
	 * @param Venue $venue Venue.
	 * @return array<string, string|null> Keys website, maps, facebook, instagram.
	 */
	public static function get_destinations( Venue $venue ) {
		return array(
			'website'   => self::safe_url( $venue->website_url ),
			'maps'      => self::safe_url( $venue->get_maps_url() ),
			'facebook'  => self::safe_url( $venue->facebook_page_link ),
			'instagram' => self::instagram_url( $venue->instagram_handle ),
		);
	}

	/**
	 * Pick the venue-name link: website, then Google Maps, then Instagram.
	 * Facebook is only ever a separate destination.
	 *
	 * @param array<string, string|null> $destinations Result of get_destinations().
	 * @return string|null URL, or null to show the name as plain text.
	 */
	public static function get_name_url( array $destinations ) {
		foreach ( array( 'website', 'maps', 'instagram' ) as $key ) {
			if ( ! empty( $destinations[ $key ] ) ) {
				return $destinations[ $key ];
			}
		}
		return null;
	}

	/**
	 * Accept only absolute http(s) URLs with a host.
	 *
	 * @param string|null $url Stored URL.
	 * @return string|null The URL, or null when missing or unsafe.
	 */
	public static function safe_url( $url ) {
		$url = null === $url ? '' : trim( (string) $url );
		if ( '' === $url || preg_match( '/[\s<>"]/', $url ) ) {
			return null;
		}

		$parts = wp_parse_url( $url );
		if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
			return null;
		}

		$scheme = strtolower( $parts['scheme'] ?? '' );
		if ( 'http' !== $scheme && 'https' !== $scheme ) {
			return null;
		}

		return $url;
	}

	/**
	 * Build an Instagram profile URL from a handle stored with or without "@".
	 *
	 * @param string|null $handle Stored handle.
	 * @return string|null Profile URL, or null when the handle is missing or malformed.
	 */
	public static function instagram_url( $handle ) {
		$handle = null === $handle ? '' : ltrim( trim( (string) $handle ), '@' );
		if ( ! preg_match( '/^[A-Za-z0-9._]{1,30}$/', $handle ) ) {
			return null;
		}

		return 'https://www.instagram.com/' . $handle . '/';
	}

	/**
	 * Render a link that opens in a new tab, announcing that to screen readers.
	 *
	 * @param string $url        Safe URL.
	 * @param string $label_html Escaped link text.
	 * @return string HTML.
	 */
	private static function external_link( $url, $label_html ) {
		return '<a href="' . esc_url( $url ) . '" target="_blank" rel="noopener noreferrer">'
			. $label_html
			. '<span class="wp-block-fair-events-venue-info__new-tab"> ' . esc_html__( '(opens in a new tab)', 'fair-events' ) . '</span>'
			. '</a>';
	}
}
