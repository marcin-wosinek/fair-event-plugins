<?php
/**
 * Open Graph meta tags for Fair Events
 *
 * Outputs OG meta tags on wp_head for singular posts linked to events,
 * enabling rich previews when shared on social media.
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

use FairEvents\Models\EventDates;
use FairEvents\Models\Venue;
use FairEvents\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Handles Open Graph meta tag output for event pages
 */
class OpenGraphHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'wp_head', array( $this, 'output_og_tags' ), 1 );
	}

	/**
	 * Output Open Graph meta tags for event pages
	 *
	 * @return void
	 */
	public function output_og_tags() {
		if ( ! is_singular() ) {
			return;
		}

		$post_id       = get_the_ID();
		$post_type     = get_post_type( $post_id );
		$enabled_types = Settings::get_enabled_post_types();

		if ( ! in_array( $post_type, $enabled_types, true ) ) {
			return;
		}

		$event_date = EventDates::get_by_event_id( $post_id );
		if ( ! $event_date ) {
			return;
		}

		$post = get_post( $post_id );

		// Standard OG tags.
		$this->output_meta_tag( 'og:title', $this->get_title( $post, $event_date ) );
		$this->output_meta_tag( 'og:description', $this->get_description( $post ) );
		$this->output_meta_tag( 'og:url', get_permalink( $post_id ) );
		$this->output_meta_tag( 'og:type', 'website' );
		$this->output_meta_tag( 'og:site_name', get_bloginfo( 'name' ) );

		$image_url = $this->get_image_url( $post_id, $event_date );
		if ( $image_url ) {
			$this->output_meta_tag( 'og:image', $image_url );
		}

		// Event-specific tags.
		if ( ! empty( $event_date->start_datetime ) ) {
			$this->output_meta_tag( 'event:start_time', $this->format_iso8601( $event_date->start_datetime ) );
		}

		if ( ! empty( $event_date->end_datetime ) ) {
			$this->output_meta_tag( 'event:end_time', $this->format_iso8601( $event_date->end_datetime ) );
		}

		$location = $this->get_location( $event_date, $post_id );
		if ( $location ) {
			$this->output_meta_tag( 'event:location', $location );
		}
	}

	/**
	 * Get the title for OG tag
	 *
	 * @param \WP_Post   $post       Post object.
	 * @param EventDates $event_date Event date object.
	 * @return string Title string.
	 */
	private function get_title( $post, $event_date ) {
		$title = $event_date->get_display_title();

		if ( ! $title ) {
			$title = $post->post_title;
		}

		return $title;
	}

	/**
	 * Get the description for OG tag
	 *
	 * @param \WP_Post $post Post object.
	 * @return string Description string.
	 */
	private function get_description( $post ) {
		$excerpt = get_the_excerpt( $post );

		if ( $excerpt ) {
			return $excerpt;
		}

		return wp_trim_words( wp_strip_all_tags( $post->post_content ), 30, '...' );
	}

	/**
	 * Get the image URL for OG tag
	 *
	 * Checks theme_image_id first, then falls back to post featured image.
	 *
	 * @param int        $post_id    Post ID.
	 * @param EventDates $event_date Event date object.
	 * @return string|null Image URL or null.
	 */
	private function get_image_url( $post_id, $event_date ) {
		// Try theme image first.
		if ( ! empty( $event_date->theme_image_id ) ) {
			$url = wp_get_attachment_url( $event_date->theme_image_id );
			if ( $url ) {
				return $url;
			}
		}

		// Fall back to post featured image.
		$thumbnail_id = get_post_thumbnail_id( $post_id );
		if ( $thumbnail_id ) {
			$url = wp_get_attachment_url( $thumbnail_id );
			if ( $url ) {
				return $url;
			}
		}

		return null;
	}

	/**
	 * Get the location string for OG tag
	 *
	 * @param EventDates $event_date Event date object.
	 * @param int        $post_id    Post ID.
	 * @return string|null Location string or null.
	 */
	private function get_location( $event_date, $post_id ) {
		if ( ! empty( $event_date->venue_id ) ) {
			$venue = Venue::get_by_id( $event_date->venue_id );
			if ( $venue ) {
				$location = $venue->name;
				if ( ! empty( $venue->address ) ) {
					$location .= ', ' . $venue->address;
				}
				return $location;
			}
		}

		// Fall back to event_location meta.
		$location = get_post_meta( $post_id, 'event_location', true );

		return ! empty( $location ) ? $location : null;
	}

	/**
	 * Format a MySQL datetime string as ISO 8601
	 *
	 * @param string $datetime MySQL datetime (Y-m-d H:i:s).
	 * @return string ISO 8601 formatted datetime.
	 */
	private function format_iso8601( $datetime ) {
		$dt = \DateTime::createFromFormat( 'Y-m-d H:i:s', $datetime );

		if ( ! $dt ) {
			return $datetime;
		}

		return $dt->format( 'c' );
	}

	/**
	 * Output a single meta tag
	 *
	 * @param string $property Meta property name.
	 * @param string $content  Meta content value.
	 * @return void
	 */
	private function output_meta_tag( $property, $content ) {
		if ( empty( $content ) ) {
			return;
		}

		printf(
			'<meta property="%s" content="%s" />' . "\n",
			esc_attr( $property ),
			esc_attr( $content )
		);
	}
}
