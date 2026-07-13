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
		$this->output_meta_tag( 'og:title', $this->get_title( $post, $event_date ) );
		$this->output_meta_tag( 'og:description', $this->get_description( $post ) );
		$this->output_meta_tag( 'og:url', get_permalink( $post_id ) );
		$this->output_meta_tag( 'og:type', 'event' );
		$this->output_meta_tag( 'og:site_name', get_bloginfo( 'name' ) );

		$image_url = $this->get_image_url( $post_id );
		if ( $image_url ) {
			$this->output_meta_tag( 'og:image', $image_url );
		}

		// Event-specific tags — only emitted together, and only when there is a
		// start date, so we never print half-valid event markup (matches the
		// JSON-LD guard below).
		if ( ! empty( $event_date->start_datetime ) ) {
			$this->output_meta_tag( 'event:start_time', $this->format_iso8601( $event_date->start_datetime ) );

			if ( ! empty( $event_date->end_datetime ) ) {
				$this->output_meta_tag( 'event:end_time', $this->format_iso8601( $event_date->end_datetime ) );
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
		$image_url  = $this->get_image_url( $post_id );

		$this->output_name_meta_tag( 'twitter:card', $image_url ? 'summary_large_image' : 'summary' );
		$this->output_name_meta_tag( 'twitter:title', $this->get_title( $post, $event_date ) );
		$this->output_name_meta_tag( 'twitter:description', $this->get_description( $post ) );

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

		$post_id    = $context['post_id'];
		$event_date = $context['event_date'];

		// Never emit half-valid event markup: without a start date there is no
		// event to describe (matches the OG event:* guard above).
		if ( empty( $event_date->start_datetime ) ) {
			return;
		}

		$post = get_post( $post_id );

		$data = array(
			'@context'    => 'https://schema.org',
			'@type'       => 'Event',
			'name'        => $this->get_title( $post, $event_date ),
			'startDate'   => $this->format_iso8601( $event_date->start_datetime ),
			'url'         => get_permalink( $post_id ),
			'eventStatus' => 'cancelled' === $event_date->status
				? 'https://schema.org/EventCancelled'
				: 'https://schema.org/EventScheduled',
		);

		if ( ! empty( $event_date->end_datetime ) ) {
			$data['endDate'] = $this->format_iso8601( $event_date->end_datetime );
		}

		$description = $this->get_description( $post );
		if ( $description ) {
			$data['description'] = $description;
		}

		$image_url = $this->get_image_url( $post_id );
		if ( $image_url ) {
			$data['image'] = $image_url;
		}

		$location_data               = $this->get_jsonld_location( $event_date, $post_id );
		$data['location']            = $location_data['location'];
		$data['eventAttendanceMode'] = $location_data['attendance_mode'];

		$offers = $this->get_jsonld_offers( $event_date, $post_id );
		if ( ! empty( $offers ) ) {
			$data['offers'] = $offers;
		}

		$data['organizer'] = array(
			'@type' => 'Organization',
			'name'  => get_bloginfo( 'name' ),
			'url'   => home_url(),
		);

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
	 * Build Schema.org location object for JSON-LD, guaranteeing a valid
	 * `location` node (never null) and reporting the attendance mode.
	 *
	 * @param EventDates $event_date Event date object.
	 * @param int        $post_id    Post ID.
	 * @return array{location: array, attendance_mode: string} Location data and eventAttendanceMode value.
	 */
	private function get_jsonld_location( $event_date, $post_id ) {
		$offline = 'https://schema.org/OfflineEventAttendanceMode';
		$online  = 'https://schema.org/OnlineEventAttendanceMode';

		// 1. Venue.
		if ( ! empty( $event_date->venue_id )
			&& class_exists( \FairEventsExperimental\Models\Venue::class ) ) {
			$venue = \FairEventsExperimental\Models\Venue::get_by_id( $event_date->venue_id );
			if ( $venue ) {
				$location = array(
					'@type' => 'Place',
					'name'  => $venue->name,
				);

				if ( ! empty( $venue->address ) ) {
					$location['address'] = array(
						'@type' => 'PostalAddress',
						'name'  => $venue->address,
					);
				}

				if ( ! empty( $venue->latitude ) && ! empty( $venue->longitude ) ) {
					$location['geo'] = array(
						'@type'     => 'GeoCoordinates',
						'latitude'  => $venue->latitude,
						'longitude' => $venue->longitude,
					);
				}

				return array(
					'location'        => $location,
					'attendance_mode' => $offline,
				);
			}
		}

		// 2. Event date's own free-text address.
		if ( ! empty( $event_date->address ) ) {
			return array(
				'location'        => array(
					'@type'   => 'Place',
					'name'    => $event_date->address,
					'address' => array(
						'@type' => 'PostalAddress',
						'name'  => $event_date->address,
					),
				),
				'attendance_mode' => $offline,
			);
		}

		// 3. Fall back to event_location meta.
		$meta_location = get_post_meta( $post_id, 'event_location', true );
		if ( ! empty( $meta_location ) ) {
			return array(
				'location'        => array(
					'@type'   => 'Place',
					'name'    => $meta_location,
					'address' => array(
						'@type' => 'PostalAddress',
						'name'  => $meta_location,
					),
				),
				'attendance_mode' => $offline,
			);
		}

		// 4. Online event: no physical location, but an external link.
		if ( 'external' === $event_date->link_type && ! empty( $event_date->external_url ) ) {
			return array(
				'location'        => array(
					'@type' => 'VirtualLocation',
					'url'   => $event_date->external_url,
				),
				'attendance_mode' => $online,
			);
		}

		// 5. Final fallback so `location` is never absent.
		return array(
			'location'        => array(
				'@type' => 'Place',
				'name'  => get_bloginfo( 'name' ),
			),
			'attendance_mode' => $offline,
		);
	}

	/**
	 * Build Schema.org Offer objects for JSON-LD from the ticketing models.
	 *
	 * Everything is behind class_exists() guards since a fair-events-only
	 * site (without ticketing) must not fatal.
	 *
	 * @param EventDates $event_date Event date object.
	 * @param int        $post_id    Post ID.
	 * @return array Offer objects (empty when ticketing is unavailable or unpriced).
	 */
	private function get_jsonld_offers( $event_date, $post_id ) {
		if ( ! class_exists( \FairEvents\Models\TicketType::class )
			|| ! class_exists( \FairEvents\Models\TicketPrice::class )
			|| ! class_exists( \FairEvents\Models\TicketSalePeriod::class ) ) {
			return array();
		}

		// Pivot to the series master for generated occurrences — pricing lives
		// there, same as get-tickets/render.php.
		$pricing_event_date_id = $event_date->id;
		if ( 'generated' === $event_date->occurrence_type && ! empty( $event_date->master_id ) ) {
			$pricing_event_date_id = (int) $event_date->master_id;
		}

		$ticket_types = \FairEvents\Models\TicketType::get_all_by_event_date_id( $pricing_event_date_id );
		if ( empty( $ticket_types ) ) {
			return array();
		}

		$sale_periods = \FairEvents\Models\TicketSalePeriod::get_all_by_event_date_id( $pricing_event_date_id );

		$now             = current_time( 'mysql' );
		$active_period   = null;
		$upcoming_period = null;
		foreach ( $sale_periods as $period ) {
			if ( $period->sale_start <= $now && $period->sale_end >= $now ) {
				$active_period = $period;
				break;
			}
			if ( $period->sale_start > $now && ( ! $upcoming_period || $period->sale_start < $upcoming_period->sale_start ) ) {
				$upcoming_period = $period;
			}
		}

		// Search crawls happen outside the sale window: fall back to the
		// nearest upcoming period's price so `offers` isn't empty just
		// because sales haven't opened yet.
		$selected_period = $active_period ? $active_period : $upcoming_period;
		if ( ! $selected_period ) {
			return array();
		}

		$price_by_type_id = array();
		foreach ( \FairEvents\Models\TicketPrice::get_all_by_event_date_id( $pricing_event_date_id ) as $price ) {
			if ( (int) $price->sale_period_id === (int) $selected_period->id ) {
				$price_by_type_id[ (int) $price->ticket_type_id ] = (float) $price->price;
			}
		}

		$currency   = get_option( 'fair_payment_currency', 'EUR' );
		$permalink  = get_permalink( $post_id );
		$valid_from = $active_period ? null : $this->format_iso8601( $selected_period->sale_start );

		$offers = array();
		foreach ( $ticket_types as $ticket_type ) {
			if ( $ticket_type->disabled || $ticket_type->invitation_only ) {
				continue;
			}

			if ( ! isset( $price_by_type_id[ $ticket_type->id ] ) ) {
				continue;
			}

			$offer = array(
				'@type'         => 'Offer',
				'price'         => (string) $price_by_type_id[ $ticket_type->id ],
				'priceCurrency' => $currency,
				'availability'  => 'https://schema.org/InStock',
				'url'           => $permalink,
			);

			if ( $valid_from ) {
				$offer['validFrom'] = $valid_from;
			}

			$offers[] = $offer;
		}

		return $offers;
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
	 * @param int $post_id Post ID.
	 * @return string|null Image URL or null.
	 */
	private function get_image_url( $post_id ) {
		$thumbnail_id = get_post_thumbnail_id( $post_id );
		if ( ! $thumbnail_id ) {
			return null;
		}

		$url = wp_get_attachment_url( $thumbnail_id );
		return $url ? $url : null;
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
