<?php
/**
 * Campaign facts: authoritative occurrence and venue facts for campaign
 * snapshots (#2420).
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

use DateTimeZone;
use Exception;
use FairEvents\Models\EventDates;
use FairEvents\Models\Venue;
use FairEventsShared\Helpers\DisplayText;
use WP_Error;

/**
 * Reads the event and venue facts of one occurrence for Event Content
 * Studio's campaign-facts v1 snapshot.
 *
 * The response is built from an explicit field list, so operational fields
 * such as the joining link, the external display URL and the occurrence's
 * free-text address never leave the site. Unknown values are null; a failed
 * or inconsistent source read is a WP_Error, never an unknown value.
 *
 * Shape (camelCase, as the snapshot uses):
 *
 *     eventDateId  int
 *     event        title, contentLanguage, status, publicationStatus,
 *                  attendanceMode, timing { timezone, allDay, startDate,
 *                  endDate, startTime, endTime }, venueId, urls { event, booking }
 *     venues       zero or one venue, referenced by event.venueId
 */
class CampaignFacts {

	const STATUSES             = array( 'active', 'cancelled' );
	const PUBLICATION_STATUSES = array( 'publish', 'draft' );
	const ATTENDANCE_MODES     = array( 'in_person', 'online', 'hybrid' );

	/**
	 * Read the facts of one event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array|WP_Error Facts, or an error (404 when the event date doesn't exist).
	 */
	public static function read( $event_date_id ) {
		$event_date = EventDates::get_by_id_checked( (int) $event_date_id );

		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}

		if ( ! $event_date ) {
			return new WP_Error(
				'rest_event_date_not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$title = self::title( $event_date->get_display_title() );
		if ( is_wp_error( $title ) ) {
			return $title;
		}

		$timing = self::timing( $event_date->get_timing(), wp_timezone_string() );
		if ( is_wp_error( $timing ) ) {
			return $timing;
		}

		$choices = self::choices( $event_date );
		if ( is_wp_error( $choices ) ) {
			return $choices;
		}

		$event_url = $event_date->get_event_page_url_checked();
		if ( is_wp_error( $event_url ) ) {
			return $event_url;
		}

		$venues = array();
		if ( $event_date->venue_id ) {
			$venue = Venue::get_by_id_checked( $event_date->venue_id );
			if ( is_wp_error( $venue ) ) {
				return $venue;
			}

			if ( ! $venue ) {
				return self::invalid( 'fair_events_venue_missing', __( 'The venue of this event could not be found.', 'fair-events' ), 500 );
			}

			$venue = self::venue( $venue );
			if ( is_wp_error( $venue ) ) {
				return $venue;
			}

			$venues[] = $venue;
		}

		return array(
			'eventDateId' => (int) $event_date->id,
			'event'       => array(
				'title'             => $title,
				// No authoritative source yet; never inferred from the site locale.
				'contentLanguage'   => null,
				'status'            => $choices['status'],
				'publicationStatus' => $choices['publicationStatus'],
				'attendanceMode'    => $choices['attendanceMode'],
				'timing'            => $timing,
				'venueId'           => $venues ? $venues[0]['id'] : null,
				'urls'              => array(
					'event'   => $event_url,
					// No authoritative source yet; never derived from another URL.
					'booking' => null,
				),
			),
			'venues'      => $venues,
		);
	}

	/**
	 * The resolved title as plain text, which must not be empty.
	 *
	 * @param string|null $raw Resolved display title (stored, HTML-encoded).
	 * @return string|WP_Error Decoded, edge-trimmed title, or an error when empty.
	 */
	public static function title( $raw ) {
		$title = DisplayText::event_title( $raw, '' );

		if ( '' === $title ) {
			return self::invalid( 'fair_events_campaign_facts_title_missing', __( 'The event has no title.', 'fair-events' ) );
		}

		return $title;
	}

	/**
	 * Status, publication status and attendance mode, checked against
	 * their allowed values. A stored null attendance mode reads as in person.
	 *
	 * @param EventDates $event_date Resolved event date.
	 * @return array|WP_Error Choices keyed by snapshot field, or an error.
	 */
	public static function choices( EventDates $event_date ) {
		$attendance_mode = $event_date->attendance_mode ?? 'in_person';

		if ( ! in_array( $event_date->status, self::STATUSES, true )
			|| ! in_array( $event_date->publication_status, self::PUBLICATION_STATUSES, true )
			|| ! in_array( $attendance_mode, self::ATTENDANCE_MODES, true )
		) {
			return self::invalid( 'fair_events_campaign_facts_invalid_status', __( 'The event has an unsupported status or attendance mode.', 'fair-events' ) );
		}

		return array(
			'status'            => $event_date->status,
			'publicationStatus' => $event_date->publication_status,
			'attendanceMode'    => $attendance_mode,
		);
	}

	/**
	 * Snapshot timing from canonical event-date timing (see EventTiming).
	 *
	 * Dates are inclusive. An undated event has no dates or times and is not
	 * all day; an all-day event has no times; missing times stay null.
	 *
	 * @param array  $timing   Canonical timing (EventDates::get_timing()).
	 * @param string $timezone Configured site timezone (wp_timezone_string()).
	 * @return array|WP_Error Timing, or an error for an unusable timezone or inconsistent dates.
	 */
	public static function timing( array $timing, $timezone ) {
		$timezone = self::timezone( $timezone );
		if ( is_wp_error( $timezone ) ) {
			return $timezone;
		}

		$start_date = self::matching( $timing['start_date'] ?? null, '/^\d{4}-\d{2}-\d{2}$/' );
		$end_date   = self::matching( $timing['end_date'] ?? null, '/^\d{4}-\d{2}-\d{2}$/' );
		$start_time = self::matching( $timing['start_time'] ?? null, '/^\d{2}:\d{2}:\d{2}$/' );
		$end_time   = self::matching( $timing['end_time'] ?? null, '/^\d{2}:\d{2}:\d{2}$/' );
		$all_day    = ! empty( $timing['all_day'] );

		if ( false === $start_date || false === $end_date || false === $start_time || false === $end_time
			|| ( null === $start_date ) !== ( null === $end_date )
			|| ( null !== $start_date && $end_date < $start_date )
			|| ( null === $start_date && ( null !== $start_time || null !== $end_time ) )
		) {
			return self::invalid( 'fair_events_campaign_facts_invalid_timing', __( 'The event has inconsistent dates or times.', 'fair-events' ) );
		}

		$all_day = $all_day && null !== $start_date;

		return array(
			'timezone'  => $timezone,
			'allDay'    => $all_day,
			'startDate' => $start_date,
			'endDate'   => $end_date,
			'startTime' => $all_day ? null : $start_time,
			'endTime'   => $all_day ? null : $end_time,
		);
	}

	/**
	 * The configured timezone: an IANA name, or a fixed `±HH:MM` offset.
	 *
	 * @param string $timezone Configured timezone.
	 * @return string|WP_Error Timezone, or an error when missing or unresolvable.
	 */
	public static function timezone( $timezone ) {
		$timezone = is_string( $timezone ) ? trim( $timezone ) : '';
		$valid    = false;

		if ( preg_match( '/^[+-](\d{2}):(\d{2})$/', $timezone, $matches ) ) {
			$valid = (int) $matches[1] <= 14 && (int) $matches[2] < 60;
		} elseif ( '' !== $timezone ) {
			try {
				$valid = ( new DateTimeZone( $timezone ) )->getName() === $timezone
					&& in_array( $timezone, DateTimeZone::listIdentifiers( DateTimeZone::ALL_WITH_BC ), true );
			} catch ( Exception $e ) {
				$valid = false;
			}
		}

		if ( ! $valid ) {
			return self::invalid( 'fair_events_campaign_facts_invalid_timezone', __( 'The site timezone is missing or cannot be resolved.', 'fair-events' ) );
		}

		return $timezone;
	}

	/**
	 * A venue registry entry.
	 *
	 * @param Venue $venue Venue record.
	 * @return array|WP_Error Entry, or an error when the venue has no name.
	 */
	public static function venue( Venue $venue ) {
		$name = self::text( $venue->name );
		if ( null === $name ) {
			return self::invalid( 'fair_events_campaign_facts_venue_name_missing', __( 'The venue of this event has no name.', 'fair-events' ) );
		}

		$instagram = self::text( $venue->instagram_handle );
		if ( null !== $instagram && '@' === $instagram[0] ) {
			$instagram = self::text( substr( $instagram, 1 ) );
		}

		return array(
			'id'              => 'venue:' . (int) $venue->id,
			'sourceId'        => (int) $venue->id,
			'name'            => $name,
			'address'         => self::text( $venue->address ),
			'coordinates'     => self::coordinates( $venue->latitude, $venue->longitude ),
			'websiteUrl'      => self::text( $venue->website_url ),
			'instagramHandle' => $instagram,
			'facebookPageUrl' => self::text( $venue->facebook_page_link ),
		);
	}

	/**
	 * A numeric coordinate pair, or null unless both stored values are set,
	 * numeric and in range. Zero is a valid coordinate.
	 *
	 * @param mixed $latitude  Stored latitude.
	 * @param mixed $longitude Stored longitude.
	 * @return array{latitude: float, longitude: float}|null
	 */
	public static function coordinates( $latitude, $longitude ) {
		$latitude  = self::text( $latitude );
		$longitude = self::text( $longitude );

		if ( null === $latitude || null === $longitude || ! is_numeric( $latitude ) || ! is_numeric( $longitude ) ) {
			return null;
		}

		$latitude  = (float) $latitude;
		$longitude = (float) $longitude;

		if ( $latitude < -90 || $latitude > 90 || $longitude < -180 || $longitude > 180 ) {
			return null;
		}

		return array(
			'latitude'  => $latitude,
			'longitude' => $longitude,
		);
	}

	/**
	 * Trimmed text, with blank values as null.
	 *
	 * @param mixed $value Stored value.
	 * @return string|null
	 */
	private static function text( $value ) {
		if ( null === $value || ! is_scalar( $value ) ) {
			return null;
		}

		$value = trim( (string) $value );

		return '' === $value ? null : $value;
	}

	/**
	 * A value matching a pattern, null when unset, or false when malformed.
	 *
	 * @param mixed  $value   Value.
	 * @param string $pattern Pattern it must match.
	 * @return string|null|false
	 */
	private static function matching( $value, $pattern ) {
		if ( null === $value ) {
			return null;
		}

		return is_string( $value ) && preg_match( $pattern, $value ) ? $value : false;
	}

	/**
	 * An error for a required fact that the source holds in an unusable form.
	 *
	 * @param string $code    Error code.
	 * @param string $message Translated message.
	 * @param int    $status  HTTP status.
	 * @return WP_Error
	 */
	private static function invalid( $code, $message, $status = 422 ) {
		return new WP_Error( $code, $message, array( 'status' => $status ) );
	}
}
