<?php
/**
 * Schema.org Event JSON-LD shaping
 *
 * Pure, static helpers for building Schema.org `Event` structures — shared
 * between the single-event JSON-LD emitted on wp_head (OpenGraphHooks) and
 * the `ItemList` JSON-LD emitted by the calendar/week blocks, so both stay
 * in sync with a single source of truth.
 *
 * @package FairEvents
 */

namespace FairEvents\Helpers;

use FairEvents\Models\EventDates;

defined( 'WPINC' ) || die;

/**
 * Builds Schema.org Event/ItemList JSON-LD structures.
 */
class EventSchema {

	/**
	 * Build the full Schema.org Event object for a single event page.
	 *
	 * @param EventDates $event_date Event date object.
	 * @param int        $post_id    Linked post ID.
	 * @return array|null Event object (without `@context`), or null when there is no start date.
	 */
	public static function event_to_jsonld( EventDates $event_date, $post_id ) {
		if ( empty( $event_date->start_datetime ) ) {
			return null;
		}

		$post = get_post( $post_id );

		$data = array(
			'@type'       => 'Event',
			'name'        => self::get_title( $post, $event_date ),
			'startDate'   => DateHelper::local_to_iso8601( $event_date->start_datetime ),
			'url'         => get_permalink( $post_id ),
			'eventStatus' => 'cancelled' === $event_date->status
				? 'https://schema.org/EventCancelled'
				: 'https://schema.org/EventScheduled',
		);

		if ( ! empty( $event_date->end_datetime ) ) {
			$data['endDate'] = DateHelper::local_to_iso8601( $event_date->end_datetime );
		}

		$description = self::get_description( $post );
		if ( $description ) {
			$data['description'] = $description;
		}

		$image_url = self::get_image_url( $post_id );
		if ( $image_url ) {
			$data['image'] = $image_url;
		}

		$location_data               = self::get_jsonld_location( $event_date, $post_id );
		$data['location']            = $location_data['location'];
		$data['eventAttendanceMode'] = $location_data['attendance_mode'];

		$offers = self::get_jsonld_offers( $event_date, $post_id );
		if ( ! empty( $offers ) ) {
			$data['offers'] = $offers;

			if ( self::is_free_offer_set( $offers ) ) {
				$data['isAccessibleForFree'] = true;
			}
		}

		$data['organizer'] = array(
			'@type' => 'Organization',
			'name'  => get_bloginfo( 'name' ),
			'url'   => home_url(),
		);

		return $data;
	}

	/**
	 * Build a lean Schema.org Event object from an EventFeedProvider occurrence
	 * DTO, for use inside an `ItemList`.
	 *
	 * Carries `name`, `startDate`, `endDate`, `url`, `description`, and
	 * `location` (built from the DTO's carried neutral location, when
	 * present, for every source). Does not include
	 * `offers`/`organizer`/`image`/`eventStatus`; those stay single-page-only.
	 *
	 * @param array $dto Occurrence DTO, as returned by EventFeedProvider::get_occurrences().
	 * @return array|null Event object, or null when the DTO has no start.
	 */
	public static function occurrence_to_jsonld( array $dto ) {
		if ( empty( $dto['start'] ) ) {
			return null;
		}

		$event = array(
			'@type'     => 'Event',
			'name'      => $dto['title'],
			'startDate' => DateHelper::local_to_iso8601( $dto['start'] ),
			'url'       => $dto['url'],
		);

		if ( ! empty( $dto['end'] ) ) {
			$event['endDate'] = DateHelper::local_to_iso8601( $dto['end'] );
		}

		if ( ! empty( $dto['description'] ) ) {
			$event['description'] = $dto['description'];
		}

		if ( ! empty( $dto['location'] ) ) {
			$event['location'] = self::location_to_jsonld( $dto['location'] );
		}

		return $event;
	}

	/**
	 * Build a Schema.org `ItemList` of `ListItem` → `Event` entries from a flat
	 * occurrence list.
	 *
	 * @param array[] $occurrences Flat DTO list, as returned by EventFeedProvider::get_occurrences().
	 * @return array|null ItemList object (with `@context`), or null when there are no valid occurrences.
	 */
	public static function item_list_from_occurrences( array $occurrences ) {
		$list_items = array();
		$position   = 1;

		foreach ( $occurrences as $occurrence ) {
			$event = self::occurrence_to_jsonld( $occurrence );
			if ( null === $event ) {
				continue;
			}

			$list_items[] = array(
				'@type'    => 'ListItem',
				'position' => $position,
				'item'     => $event,
			);

			++$position;
		}

		if ( empty( $list_items ) ) {
			return null;
		}

		return array(
			'@context'        => 'https://schema.org',
			'@type'           => 'ItemList',
			'itemListElement' => $list_items,
		);
	}

	/**
	 * Get the display title for an event.
	 *
	 * @param \WP_Post   $post       Post object.
	 * @param EventDates $event_date Event date object.
	 * @return string Title string.
	 */
	public static function get_title( $post, EventDates $event_date ) {
		$title = $event_date->get_display_title();

		if ( ! $title ) {
			$title = $post->post_title;
		}

		return $title;
	}

	/**
	 * Get the description for an event.
	 *
	 * @param \WP_Post $post Post object.
	 * @return string Description string.
	 */
	public static function get_description( $post ) {
		$excerpt = get_the_excerpt( $post );

		if ( $excerpt ) {
			return $excerpt;
		}

		return wp_trim_words( wp_strip_all_tags( $post->post_content ), 30, '...' );
	}

	/**
	 * Get the featured image URL for an event.
	 *
	 * @param int $post_id Post ID.
	 * @return string|null Image URL or null.
	 */
	public static function get_image_url( $post_id ) {
		$thumbnail_id = get_post_thumbnail_id( $post_id );
		if ( ! $thumbnail_id ) {
			return null;
		}

		$url = wp_get_attachment_url( $thumbnail_id );
		return $url ? $url : null;
	}

	/**
	 * Build Schema.org location object for JSON-LD, guaranteeing a valid
	 * `location` node (never null) and reporting the attendance mode.
	 *
	 * @param EventDates $event_date Event date object.
	 * @param int        $post_id    Post ID.
	 * @return array{location: array, attendance_mode: string} Location data and eventAttendanceMode value.
	 */
	public static function get_jsonld_location( EventDates $event_date, $post_id ) {
		$neutral = EventLocation::resolve( $event_date, $post_id );

		return array(
			'location'        => self::location_to_jsonld( $neutral ),
			'attendance_mode' => ! empty( $neutral['online'] )
				? 'https://schema.org/OnlineEventAttendanceMode'
				: 'https://schema.org/OfflineEventAttendanceMode',
		);
	}

	/**
	 * Map a neutral location shape (EventLocation::resolve()) to a
	 * Schema.org `Place`/`VirtualLocation` node, guaranteeing a valid,
	 * never-null result via a site-name backstop.
	 *
	 * @param array|null $neutral Neutral location shape, or null when nothing resolved.
	 * @return array Schema.org location node.
	 */
	public static function location_to_jsonld( $neutral ) {
		if ( empty( $neutral ) ) {
			return array(
				'@type' => 'Place',
				'name'  => get_bloginfo( 'name' ),
			);
		}

		if ( ! empty( $neutral['online'] ) ) {
			return array(
				'@type' => 'VirtualLocation',
				'url'   => $neutral['url'],
			);
		}

		$location = array(
			'@type' => 'Place',
			'name'  => ! empty( $neutral['name'] ) ? $neutral['name'] : $neutral['address'],
		);

		if ( ! empty( $neutral['address'] ) ) {
			$location['address'] = array(
				'@type' => 'PostalAddress',
				'name'  => $neutral['address'],
			);
		}

		if ( ! empty( $neutral['latitude'] ) && ! empty( $neutral['longitude'] ) ) {
			$location['geo'] = array(
				'@type'     => 'GeoCoordinates',
				'latitude'  => $neutral['latitude'],
				'longitude' => $neutral['longitude'],
			);
		}

		return $location;
	}

	/**
	 * Build Schema.org Offer objects for JSON-LD from the ticketing models.
	 *
	 * Priced ticket types yield a paid `Offer`; a genuinely free ticket type
	 * (enabled, non-invitation, with no positive price in any sale period — the
	 * free RSVP/signup case) yields a price-"0" `Offer` so the event can be
	 * marked `isAccessibleForFree`. A paid type whose sale window has closed
	 * yields nothing and is never advertised as free.
	 *
	 * Everything is behind class_exists() guards since a fair-events-only
	 * site (without ticketing) must not fatal.
	 *
	 * @param EventDates $event_date Event date object.
	 * @param int        $post_id    Post ID.
	 * @return array Offer objects (empty when ticketing is unavailable, or every
	 *               type is a paid ticket with sales closed).
	 */
	public static function get_jsonld_offers( EventDates $event_date, $post_id ) {
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

		$all_prices   = \FairEvents\Models\TicketPrice::get_all_by_event_date_id( $pricing_event_date_id );
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
		// because sales haven't opened yet. When no period exists at all the
		// event can still carry free RSVP ticket types (handled below).
		$selected_period = $active_period ? $active_period : $upcoming_period;

		// Price for each type inside the selected window.
		$price_by_type_id = array();
		if ( $selected_period ) {
			foreach ( $all_prices as $price ) {
				if ( (int) $price->sale_period_id === (int) $selected_period->id ) {
					$price_by_type_id[ (int) $price->ticket_type_id ] = (float) $price->price;
				}
			}
		}

		// Type IDs carrying a positive price in *any* period: paid tickets, even
		// when the current window has none (sales closed). Never advertised free.
		$paid_type_ids = array();
		foreach ( $all_prices as $price ) {
			if ( (float) $price->price > 0.0 ) {
				$paid_type_ids[ (int) $price->ticket_type_id ] = true;
			}
		}

		$currency   = get_option( 'fair_payment_currency', 'EUR' );
		$permalink  = get_permalink( $post_id );
		$valid_from = ( $selected_period && ! $active_period )
			? DateHelper::local_to_iso8601( $selected_period->sale_start )
			: null;

		$offers = array();
		foreach ( $ticket_types as $ticket_type ) {
			if ( $ticket_type->disabled || $ticket_type->invitation_only ) {
				continue;
			}

			$type_id = (int) $ticket_type->id;

			// Priced in the current window (the price may itself be 0).
			if ( isset( $price_by_type_id[ $type_id ] ) ) {
				$offer = array(
					'@type'         => 'Offer',
					'price'         => (string) $price_by_type_id[ $type_id ],
					'priceCurrency' => $currency,
					'availability'  => 'https://schema.org/InStock',
					'url'           => $permalink,
				);

				if ( $valid_from ) {
					$offer['validFrom'] = $valid_from;
				}

				$offers[] = $offer;
				continue;
			}

			// No price in the current window: a type priced elsewhere is a paid
			// ticket with sales closed — emit nothing.
			if ( isset( $paid_type_ids[ $type_id ] ) ) {
				continue;
			}

			// Genuinely free ticket type (a free RSVP/signup with no price row):
			// advertise a price-"0" offer so the event is accessible for free.
			$offers[] = array(
				'@type'         => 'Offer',
				'price'         => '0',
				'priceCurrency' => $currency,
				'availability'  => 'https://schema.org/InStock',
				'url'           => $permalink,
			);
		}

		return $offers;
	}

	/**
	 * Whether an offer set represents a genuinely free event.
	 *
	 * True only when every offer is priced at zero AND at least one offer
	 * exists — an empty set means ticketing isn't configured, not that the
	 * event is free, so it must not trigger `isAccessibleForFree`.
	 *
	 * @param array $offers Offer objects, as built by get_jsonld_offers().
	 * @return bool True when every offer is priced at zero.
	 */
	public static function is_free_offer_set( array $offers ): bool {
		if ( empty( $offers ) ) {
			return false;
		}

		foreach ( $offers as $offer ) {
			if ( 0.0 !== (float) $offer['price'] ) {
				return false;
			}
		}

		return true;
	}
}
