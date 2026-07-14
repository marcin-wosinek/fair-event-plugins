<?php
/**
 * Open Graph meta tags and JSON-LD structured data for Fair Events
 *
 * Outputs OG meta tags and Schema.org Event JSON-LD on wp_head for
 * singular posts linked to events, enabling rich previews when shared
 * on social media and improved search engine results.
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

use FairEvents\Helpers\DateHelper;
use FairEvents\Helpers\EventSchema;
use FairEvents\Models\EventDates;
use FairEvents\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Handles Open Graph meta tags and JSON-LD structured data for event pages
 */
class OpenGraphHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'wp_head', array( $this, 'output_og_tags' ), 1 );
		add_action( 'wp_head', array( $this, 'output_twitter_tags' ), 1 );
		add_action( 'wp_head', array( $this, 'output_jsonld' ), 1 );
	}

	/**
	 * Output Open Graph meta tags for event pages
	 *
	 * @return void
	 */
	public function output_og_tags() {
		$context = $this->get_event_context();
		if ( ! $context ) {
			return;
		}

		$post_id    = $context['post_id'];
		$event_date = $context['event_date'];
		$post       = get_post( $post_id );

		// Standard OG tags.
		$this->output_meta_tag( 'og:title', EventSchema::get_title( $post, $event_date ) );
		$this->output_meta_tag( 'og:description', EventSchema::get_description( $post ) );
		$this->output_meta_tag( 'og:url', get_permalink( $post_id ) );
		$this->output_meta_tag( 'og:type', 'event' );
		$this->output_meta_tag( 'og:site_name', get_bloginfo( 'name' ) );

		$image_url = EventSchema::get_image_url( $post_id );
		if ( $image_url ) {
			$this->output_meta_tag( 'og:image', $image_url );
		}

		// Event-specific tags — only emitted together, and only when there is a
		// start date, so we never print half-valid event markup (matches the
		// JSON-LD guard below).
		if ( ! empty( $event_date->start_datetime ) ) {
			$this->output_meta_tag( 'event:start_time', DateHelper::local_to_iso8601( $event_date->start_datetime ) );

			if ( ! empty( $event_date->end_datetime ) ) {
				$this->output_meta_tag( 'event:end_time', DateHelper::local_to_iso8601( $event_date->end_datetime ) );
			}

			$location = $this->get_location( $event_date, $post_id );
			if ( $location ) {
				$this->output_meta_tag( 'event:location', $location );
			}
		}
	}

	/**
	 * Output Twitter Card meta tags for event pages
	 *
	 * @return void
	 */
	public function output_twitter_tags() {
		$context = $this->get_event_context();
		if ( ! $context ) {
			return;
		}

		$post_id    = $context['post_id'];
		$event_date = $context['event_date'];
		$post       = get_post( $post_id );
		$image_url  = EventSchema::get_image_url( $post_id );

		$this->output_name_meta_tag( 'twitter:card', $image_url ? 'summary_large_image' : 'summary' );
		$this->output_name_meta_tag( 'twitter:title', EventSchema::get_title( $post, $event_date ) );
		$this->output_name_meta_tag( 'twitter:description', EventSchema::get_description( $post ) );

		if ( $image_url ) {
			$this->output_name_meta_tag( 'twitter:image', $image_url );
		}
	}

	/**
	 * Output Schema.org Event JSON-LD for event pages
	 *
	 * @return void
	 */
	public function output_jsonld() {
		$context = $this->get_event_context();
		if ( ! $context ) {
			return;
		}

		$event = EventSchema::event_to_jsonld( $context['event_date'], $context['post_id'] );

		// Never emit half-valid event markup: without a start date there is no
		// event to describe (matches the OG event:* guard above).
		if ( null === $event ) {
			return;
		}

		$data = array_merge( array( '@context' => 'https://schema.org' ), $event );

		echo '<script type="application/ld+json">' . "\n";
		echo wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT );
		echo "\n" . '</script>' . "\n";
	}

	/**
	 * Build the shared preamble used by all three wp_head hooks: confirms the
	 * current request is a singular, enabled-post-type page linked to an
	 * event date, so OG, Twitter, and JSON-LD all make the same decision.
	 *
	 * @return array{post_id: int, event_date: EventDates}|null Context array, or null if this page has no event.
	 */
	private function get_event_context() {
		if ( ! is_singular() ) {
			return null;
		}

		$post_id       = get_the_ID();
		$post_type     = get_post_type( $post_id );
		$enabled_types = Settings::get_enabled_post_types();

		if ( ! in_array( $post_type, $enabled_types, true ) ) {
			return null;
		}

		$event_date = EventDates::get_by_event_id( $post_id );
		if ( ! $event_date ) {
			return null;
		}

		return array(
			'post_id'    => $post_id,
			'event_date' => $event_date,
		);
	}

	/**
	 * Get the location string for OG tag
	 *
	 * @param EventDates $event_date Event date object.
	 * @param int        $post_id    Post ID.
	 * @return string|null Location string or null.
	 */
	private function get_location( $event_date, $post_id ) {
		if ( ! empty( $event_date->venue_id )
			&& class_exists( \FairEventsExperimental\Models\Venue::class ) ) {
			$venue = \FairEventsExperimental\Models\Venue::get_by_id( $event_date->venue_id );
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
	 * Output a single meta tag with property attribute (OG tags)
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

	/**
	 * Output a single meta tag with name attribute (Twitter tags)
	 *
	 * @param string $name    Meta name.
	 * @param string $content Meta content value.
	 * @return void
	 */
	private function output_name_meta_tag( $name, $content ) {
		if ( empty( $content ) ) {
			return;
		}

		printf(
			'<meta name="%s" content="%s" />' . "\n",
			esc_attr( $name ),
			esc_attr( $content )
		);
	}
}
