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
use FairEvents\Services\TicketAvailability;
use FairEventsShared\Money;

defined( 'WPINC' ) || die;

/**
 * Builds Schema.org Event/ItemList JSON-LD structures.
 */
class EventSchema {

	/**
	 * Build the full Schema.org Event object for a single event page.
	 *
	 * @param EventDates  $event_date Event date object.
	 * @param int         $post_id    Linked post ID.
	 * @param string|null $url        URL to report, e.g. a per-occurrence canonical.
	 *                                Defaults to the post's plain permalink.
	 * @return array|null Event object (without `@context`), or null when there is no start date.
	 */
	public static function event_to_jsonld( EventDates $event_date, $post_id, $url = null ) {
		$dates = self::timing_to_dates( $event_date->get_timing() );
		if ( ! $dates ) {
			return null;
		}

		$post = get_post( $post_id );

		$data = array(
			'@type'       => 'Event',
			'name'        => self::get_title( $post, $event_date ),
			'startDate'   => $dates['start'],
			'url'         => $url ?? get_permalink( $post_id ),
			'eventStatus' => 'cancelled' === $event_date->status
				? 'https://schema.org/EventCancelled'
				: 'https://schema.org/EventScheduled',
		);

		if ( isset( $dates['end'] ) ) {
			$data['endDate'] = $dates['end'];
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

		$data['organizer'] = OrganizationSchema::organizer_ref();

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
		$timing = isset( $dto['timing'] ) && is_array( $dto['timing'] )
			? $dto['timing']
			: EventTiming::from_datetimes( $dto['start'] ?? null, $dto['end'] ?? null, ! empty( $dto['all_day'] ) );
		$dates  = self::timing_to_dates( $timing );
		if ( ! $dates ) {
			return null;
		}

		$event = array(
			'@type'     => 'Event',
			'name'      => $dto['title'],
			'startDate' => $dates['start'],
			'url'       => $dto['url'],
		);

		if ( isset( $dates['end'] ) ) {
			$event['endDate'] = $dates['end'];
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
	 * Schema.org start and end values for a timing, shared with the Open
	 * Graph event tags.
	 *
	 * A supplied time gives an ISO 8601 datetime with the site's offset. A
	 * missing time, or an all-day event, gives the bare date ('Y-m-d'),
	 * which Schema.org accepts, so no time is ever invented. The end is
	 * omitted for a single-day timed event without an end time, as it was
	 * for an event without an end.
	 *
	 * @param array $timing Canonical timing (see EventTiming).
	 * @return array{start: string, end?: string}|null Values, or null for an undated event.
	 */
	public static function timing_to_dates( array $timing ) {
		$timing = array_merge( EventTiming::undated(), $timing );

		if ( empty( $timing['start_date'] ) ) {
			return null;
		}

		$end_date = $timing['end_date'] ?? $timing['start_date'];
		$dates    = array(
			'start' => self::date_value( $timing['start_date'], $timing['all_day'] ? null : $timing['start_time'] ),
		);

		if ( ! $timing['all_day'] && null !== $timing['end_time'] ) {
			$dates['end'] = self::date_value( $end_date, $timing['end_time'] );
		} elseif ( $timing['all_day'] || $end_date !== $timing['start_date'] ) {
			$dates['end'] = $end_date;
		}

		return $dates;
	}

	/**
	 * A date, or a site-local datetime when the time is known.
	 *
	 * @param string      $date Date ('Y-m-d').
	 * @param string|null $time Time ('H:i:s'), or null.
	 * @return string 'Y-m-d' or an ISO 8601 datetime.
	 */
	private static function date_value( $date, $time ) {
		return null === $time ? $date : DateHelper::local_to_iso8601( $date . ' ' . $time );
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
		$mode    = $neutral['mode'] ?? 'in_person';

		$attendance_mode_map = array(
			'online' => 'https://schema.org/OnlineEventAttendanceMode',
			'hybrid' => 'https://schema.org/MixedEventAttendanceMode',
		);

		return array(
			'location'        => self::location_to_jsonld( $neutral ),
			'attendance_mode' => $attendance_mode_map[ $mode ] ?? 'https://schema.org/OfflineEventAttendanceMode',
		);
	}

	/**
	 * Map a neutral location shape (EventLocation::resolve()) to a
	 * Schema.org location node, guaranteeing a valid, never-null result via
	 * a site-name backstop.
	 *
	 * - `in_person` (or empty/null) → a single `Place` node.
	 * - `online` → a single `VirtualLocation` node.
	 * - `hybrid` → an array of both a `Place` and a `VirtualLocation` node
	 *   (search engines require both entries for a hybrid event).
	 *
	 * @param array|null $neutral Neutral location shape, or null when nothing resolved.
	 * @return array|array[] Schema.org location node, or an array of two nodes for hybrid.
	 */
	public static function location_to_jsonld( $neutral ) {
		$mode = $neutral['mode'] ?? 'in_person';

		if ( 'online' === $mode ) {
			return array(
				'@type' => 'VirtualLocation',
				'url'   => $neutral['joining_url'] ?? '',
			);
		}

		$place = self::place_jsonld( $neutral );

		if ( 'hybrid' === $mode ) {
			return array(
				$place,
				array(
					'@type' => 'VirtualLocation',
					'url'   => $neutral['joining_url'] ?? '',
				),
			);
		}

		return $place;
	}

	/**
	 * Build the Schema.org `Place` node from a neutral location shape's
	 * physical fields, falling back to the site name when none resolved.
	 *
	 * @param array|null $neutral Neutral location shape, or null.
	 * @return array Schema.org `Place` node.
	 */
	private static function place_jsonld( $neutral ) {
		if ( empty( $neutral['name'] ) && empty( $neutral['address'] ) ) {
			return array(
				'@type' => 'Place',
				'name'  => get_bloginfo( 'name' ),
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
	 * A type with an explicit price row for the selected window yields an
	 * `Offer` — price "0" for a stored zero row (advertising the event as
	 * `isAccessibleForFree`), a positive amount otherwise. A type with no
	 * explicit row for the selected window is unavailable, not free (issue
	 * #1624), and yields nothing.
	 *
	 * Sale-period resolution reuses TicketAvailability's pure primitives —
	 * the same position-aware lazy-boundary resolution the purchase form
	 * (event-signup/render.php, get-tickets) relies on: a missing first
	 * start resolves to the earlier of the event/series' creation day and
	 * today (while still before its end) and a missing last end resolves to
	 * the day after the event/series' final active occurrence. When neither the event nor its series has a usable date to
	 * anchor that default, the window stays unresolved and no offer is
	 * shown — an event with no discoverable schedule must never be
	 * advertised as having an unlimited sale window. Unlike the purchase
	 * form, the active-period lookup here does *not* use the `continues`
	 * fallback: JSON-LD must show no offer once a sale has genuinely closed,
	 * even though the purchase form itself keeps such an event purchasable
	 * (see EventSchema #1381 decision). Without any sale period there is no
	 * price row and therefore no offer. Every emitted offer carries
	 * `validFrom`: the selected period's start, explicit or inferred
	 * (issue #1841).
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

		$now         = current_time( 'mysql' );
		$default_end = TicketAvailability::compute_default_sale_end( EventDates::get_last_occurrence_boundary( $pricing_event_date_id ) );
		$periods     = TicketAvailability::resolve_periods(
			$sale_periods,
			$now,
			$default_end,
			TicketAvailability::resolve_default_sale_start( $pricing_event_date_id, $now )
		);

		$selected_period = self::select_offer_period( $periods, $now );

		// Price for each type inside the selected window.
		$price_by_type_id = array();
		if ( $selected_period ) {
			foreach ( $all_prices as $price ) {
				if ( (int) $price->sale_period_id === (int) $selected_period->id ) {
					$price_by_type_id[ (int) $price->ticket_type_id ] = (float) $price->price;
				}
			}
		}

		// select_offer_period() only selects a period with a resolved start.
		$valid_from = $selected_period
			? DateHelper::local_to_iso8601( $selected_period->sale_start )
			: null;

		return self::build_offers_for_types(
			$ticket_types,
			$price_by_type_id,
			$valid_from,
			Money::site_currency(),
			get_permalink( $post_id ),
			$now
		);
	}

	/**
	 * Pick the sale period whose prices JSON-LD advertises: the active one,
	 * else the nearest upcoming one — search crawls happen outside the sale
	 * window, so `offers` isn't empty just because sales haven't opened yet.
	 * Without a selected period no type has a price row, so no offer is
	 * emitted. Pure, DB-free.
	 *
	 * The `continues` fallback is off: a genuinely closed sale must show no
	 * offer in structured data, unlike the purchase form.
	 *
	 * @param object[] $resolved_periods Sale periods, post TicketAvailability::resolve_periods().
	 * @param string   $now              Current site datetime ('Y-m-d H:i:s').
	 * @return object|null Selected period, always with a resolved sale_start, or null.
	 */
	public static function select_offer_period( array $resolved_periods, $now ) {
		$active_period = TicketAvailability::pick_active_period( $resolved_periods, $now, false );

		return $active_period ? $active_period : TicketAvailability::pick_upcoming_period( $resolved_periods, $now );
	}

	/**
	 * Pure, DB-free per-type Offer builder, split out from get_jsonld_offers()
	 * for unit testing without a database — mirrors how TicketAvailability
	 * itself splits DB fetching from pure, unit-tested math.
	 *
	 * @param object[]    $ticket_types     TicketType objects (id, name, disabled, disable_at).
	 * @param float[]     $price_by_type_id Ticket-type ID => price for the selected window.
	 * @param string|null $valid_from       ISO 8601 `validFrom`, the selected window's start, or null.
	 * @param string      $currency         Site currency code.
	 * @param string      $permalink        Event permalink, used as the offer URL.
	 * @param string|null $now              Current site datetime for scheduled disabling; defaults to current_time( 'mysql' ).
	 * @return array Offer objects, one per purchasable type; disabled types and
	 *               types with no explicit price row for the selected window are omitted.
	 */
	public static function build_offers_for_types( array $ticket_types, array $price_by_type_id, $valid_from, $currency, $permalink, $now = null ) {
		$offers = array();

		foreach ( $ticket_types as $ticket_type ) {
			// Scheduled disabling must keep an expired ticket type out of
			// structured data just like manual disabling — a search engine
			// must never be told a lapsed offer is still in stock.
			if ( ! TicketAvailability::is_ticket_type_enabled( $ticket_type, $now ) ) {
				continue;
			}

			$type_id = (int) $ticket_type->id;

			// No explicit price row for the selected window → unavailable, not
			// free (issue #1624); emit nothing.
			if ( ! isset( $price_by_type_id[ $type_id ] ) ) {
				continue;
			}

			// Priced in the current window — a stored 0 row is a genuinely free
			// offer (the site can advertise isAccessibleForFree), any other
			// value is a paid offer.
			$offer = array(
				'@type'         => 'Offer',
				'price'         => (string) $price_by_type_id[ $type_id ],
				'priceCurrency' => $currency,
				'availability'  => 'https://schema.org/InStock',
				'url'           => $permalink,
			);

			// A blank name (the admin ticket editor doesn't require one)
			// is omitted rather than serialized as "" — an empty `name`
			// is itself a structured-data quality issue.
			if ( '' !== (string) $ticket_type->name ) {
				$offer['name'] = $ticket_type->name;
			}

			if ( $valid_from ) {
				$offer['validFrom'] = $valid_from;
			}

			$offers[] = $offer;
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
