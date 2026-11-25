<?php
/**
 * Complete campaign facts: every source fact of a campaign-facts v1
 * snapshot in one coherent, permission-checked read (#2424).
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Models\EventDateSetting;
use FairEvents\Models\ScheduleItem;
use FairEvents\Models\TicketOption;
use WP_Error;

/**
 * Assembles the source facts of Event Content Studio's campaign-facts v1
 * snapshot for one occurrence: CampaignFacts::read()'s event and venue
 * facts, the resolved programme, contributors, promotional profiles and
 * ordered media, all read inside one CampaignSnapshot.
 *
 * Contributors, profiles and media come from optional providers, normally
 * Fair Events Experimental:
 *
 * - `fair_events_campaign_contributors` (null, $event_date_id):
 *   `{ eventContributors, items: [{ id, contributors }], memberIds }`.
 * - `fair_events_campaign_team_profiles` (null, int[] $member_ids,
 *   $event_date_id): `{ members, portraits }`.
 * - `fair_events_campaign_media` (null, EventDates $event_date, int[]
 *   $schedule_item_ids): `{ event: { mediaIds, focalRegions }, items:
 *   { <schedule item ID>: { mediaIds, focalRegions } }, media:
 *   { <attachment ID>: { url, width, height, alt, credit } } }`.
 *
 * A provider left at null (companion inactive) or answering
 * `fair_events_team_directory_disabled` / `fair_events_event_images_disabled`
 * makes its feature unavailable. Unavailable features are a 409
 * `fair_events_campaign_facts_features_unavailable` naming each one in
 * `data.features`, never null or empty values. Every other provider error
 * is returned as is.
 *
 * Importer-owned metadata (`schemaVersion`, `source.provider`,
 * `source.siteUrl`, `source.importedAt`) is not part of the response, and
 * schedule times are the shifted naive local times the importer resolves
 * in `event.timing.timezone`. See REST_API_BACKEND.md § Complete campaign
 * facts.
 */
class CompleteCampaignFacts {

	const FEATURE_TEAM   = 'team-members';
	const FEATURE_IMAGES = 'event-images';

	/**
	 * Read the complete facts of one event date in one snapshot.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array|WP_Error Facts, or an error.
	 */
	public static function read( $event_date_id ) {
		return CampaignSnapshot::read(
			static function () use ( $event_date_id ) {
				return self::assemble( (int) $event_date_id );
			}
		);
	}

	/**
	 * Assemble the facts; called inside the snapshot.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array|WP_Error
	 */
	public static function assemble( $event_date_id ) {
		$base = CampaignFacts::read( $event_date_id );
		if ( is_wp_error( $base ) ) {
			return $base;
		}

		$event_date = EventDates::get_by_id_checked( $event_date_id );
		if ( is_wp_error( $event_date ) ) {
			return $event_date;
		}
		if ( ! $event_date ) {
			return new WP_Error( 'rest_event_date_not_found', __( 'Event date not found.', 'fair-events' ), array( 'status' => 404 ) );
		}

		$schedule = self::schedule( $event_date );
		if ( is_wp_error( $schedule ) ) {
			return $schedule;
		}
		$item_ids = array_keys( $schedule['items'] );

		$unavailable = array();

		$team = self::team( $event_date_id, $item_ids );
		if ( is_wp_error( $team ) ) {
			return $team;
		}
		if ( isset( $team['unavailable'] ) ) {
			$unavailable[] = array(
				'feature' => self::FEATURE_TEAM,
				'reason'  => $team['unavailable'],
			);
		}

		$media = self::media( $event_date, $item_ids );
		if ( is_wp_error( $media ) ) {
			return $media;
		}
		if ( isset( $media['unavailable'] ) ) {
			$unavailable[] = array(
				'feature' => self::FEATURE_IMAGES,
				'reason'  => $media['unavailable'],
			);
		}

		if ( $unavailable ) {
			return new WP_Error(
				'fair_events_campaign_facts_features_unavailable',
				__( 'Some event information is turned off on this site, so the event facts are incomplete.', 'fair-events' ),
				array(
					'status'   => 409,
					'features' => $unavailable,
				)
			);
		}

		$items = array();
		foreach ( $schedule['items'] as $item_id => $item ) {
			$items[] = array_merge(
				$item,
				array(
					'contributors' => $team['items'][ $item_id ],
					'mediaIds'     => $media['items'][ $item_id ]['mediaIds'],
					'focalRegions' => (object) $media['items'][ $item_id ]['focalRegions'],
				)
			);
		}

		$registry = self::media_registry( $media['media'], $team['portraits'] );
		if ( is_wp_error( $registry ) ) {
			return $registry;
		}

		return array(
			'eventDateId'         => $base['eventDateId'],
			'scheduleEventDateId' => $schedule['ownerId'],
			'event'               => array_merge(
				$base['event'],
				array(
					'mediaIds'     => $media['event']['mediaIds'],
					'focalRegions' => (object) $media['event']['focalRegions'],
				)
			),
			'venues'              => $base['venues'],
			'schedule'            => array(
				'enabled' => $schedule['enabled'],
				'items'   => $items,
			),
			'team'                => array(
				'members'           => $team['members'],
				'eventContributors' => $team['eventContributors'],
			),
			'media'               => $registry,
		);
	}

	/**
	 * The programme of the selected occurrence: the owner's schedule with
	 * every time shifted to the occurrence, as EventSchedule::get_payload()
	 * resolves it, with every read checked.
	 *
	 * @param EventDates $event_date Selected occurrence.
	 * @return array{ownerId: int, enabled: bool, items: array<int, array>}|WP_Error Items keyed by schedule item ID, in programme order.
	 */
	public static function schedule( EventDates $event_date ) {
		global $wpdb;

		$owner_id   = EventSchedule::config_event_date_id( $event_date );
		$date_shift = null;

		if ( (int) $event_date->id !== $owner_id ) {
			$master = EventDates::get_by_id_checked( $owner_id );
			if ( is_wp_error( $master ) ) {
				return $master;
			}
			if ( ! $master ) {
				return new WP_Error(
					'fair_events_series_master_missing',
					__( 'The series of this event date could not be found.', 'fair-events' ),
					array( 'status' => 500 )
				);
			}
			if ( $master->start_date && $event_date->start_date ) {
				$date_shift = EventCopyService::get_date_shift( $master->get_timing(), $event_date->get_timing() );
			}
		}

		$enabled = EventDateSetting::get( $owner_id, 'schedule_enabled' );
		if ( '' !== $wpdb->last_error ) {
			return self::source_unavailable();
		}

		$options = array();
		foreach ( TicketOption::get_all_by_event_date_id( $owner_id ) as $option ) {
			$options[ (int) $option->id ] = $option;
		}
		if ( '' !== $wpdb->last_error ) {
			return self::source_unavailable();
		}

		$stored = ScheduleItem::get_all_by_event_date_id( $owner_id );
		if ( '' !== $wpdb->last_error ) {
			return self::source_unavailable();
		}

		$items = array();
		foreach ( $stored as $item ) {
			$projected = self::schedule_item( $item, $options, $date_shift );
			if ( is_wp_error( $projected ) ) {
				return $projected;
			}
			$items[ (int) $item->id ] = $projected;
		}

		return array(
			'ownerId' => $owner_id,
			'enabled' => '1' === (string) $enabled,
			'items'   => $items,
		);
	}

	/**
	 * One programme item, without its contributors and media.
	 *
	 * @param ScheduleItem       $item       Stored item.
	 * @param array<int, object> $options    The owner's ticket options by ID.
	 * @param \DateInterval|null $date_shift Shift from the owner to the occurrence.
	 * @return array|WP_Error
	 */
	public static function schedule_item( ScheduleItem $item, array $options, $date_shift = null ) {
		$ticket_option_id = $item->ticket_option_id ? (int) $item->ticket_option_id : null;

		if ( null !== $ticket_option_id && ! isset( $options[ $ticket_option_id ] ) ) {
			return new WP_Error(
				'fair_events_schedule_ticket_option_missing',
				__( 'A workshop on the schedule refers to a ticket option that no longer exists.', 'fair-events' ),
				array(
					'status'           => 500,
					'schedule_item_id' => (int) $item->id,
					'ticket_option_id' => $ticket_option_id,
				)
			);
		}

		// A linked workshop is named by its ticket option's current name.
		$title = self::text( null !== $ticket_option_id ? $options[ $ticket_option_id ]->name : $item->title );
		if ( null === $title ) {
			return new WP_Error(
				'fair_events_campaign_facts_item_title_missing',
				__( 'A programme item has no title.', 'fair-events' ),
				array(
					'status'           => 422,
					'schedule_item_id' => (int) $item->id,
				)
			);
		}

		$start = self::local_time( $item->start_datetime, $date_shift );
		$end   = self::local_time( $item->end_datetime, $date_shift );
		if ( null === $start || null === $end || $end <= $start ) {
			return new WP_Error(
				'fair_events_campaign_facts_invalid_schedule_time',
				__( 'A programme item has an invalid start or end time.', 'fair-events' ),
				array(
					'status'           => 422,
					'schedule_item_id' => (int) $item->id,
				)
			);
		}

		return array(
			'id'             => 'schedule-item:' . (int) $item->id,
			'sourceId'       => (int) $item->id,
			'ticketOptionId' => $ticket_option_id,
			'title'          => $title,
			'description'    => self::text( $item->description ),
			'startsAtLocal'  => $start,
			'endsAtLocal'    => $end,
			'location'       => self::text( $item->location ),
			// Teaching languages have no source (#2423 was dropped).
			'languages'      => null,
			// Whether the workshop can be chosen with a ticket, regardless of
			// remaining capacity. A standalone item is never a ticket choice.
			'bookable'       => null !== $ticket_option_id && (bool) $item->bookable,
		);
	}

	/**
	 * Contributors and promotional profiles from their providers.
	 *
	 * @param int   $event_date_id Selected occurrence.
	 * @param int[] $item_ids      Schedule item IDs in programme order.
	 * @return array|WP_Error `{ unavailable: reason }` for an unavailable feature, else
	 *                        `{ members, eventContributors, items, portraits }` with `items`
	 *                        keyed by schedule item ID.
	 */
	private static function team( $event_date_id, array $item_ids ) {
		$contributors = apply_filters( 'fair_events_campaign_contributors', null, (int) $event_date_id );
		if ( is_wp_error( $contributors ) ) {
			return $contributors;
		}

		$member_ids = is_array( $contributors ) ? (array) ( $contributors['memberIds'] ?? array() ) : array();

		/**
		 * Filters the promotional profiles of the team members a complete
		 * campaign-facts read references (#2424).
		 *
		 * @param array|null|WP_Error $profiles      `{ members, portraits }`; null when not supplied.
		 * @param int[]               $member_ids    Referenced profile IDs.
		 * @param int                 $event_date_id Selected occurrence.
		 */
		$profiles = apply_filters( 'fair_events_campaign_team_profiles', null, $member_ids, (int) $event_date_id );

		if ( null === $profiles ) {
			return array( 'unavailable' => 'not_provided' );
		}
		if ( is_wp_error( $profiles ) ) {
			return 'fair_events_team_directory_disabled' === $profiles->get_error_code()
				? array( 'unavailable' => 'disabled' )
				: $profiles;
		}
		if ( null === $contributors ) {
			return array( 'unavailable' => 'disabled' );
		}

		$items = array();
		foreach ( (array) ( $contributors['items'] ?? array() ) as $item ) {
			$items[ (int) substr( (string) $item['id'], strlen( 'schedule-item:' ) ) ] = $item['contributors'];
		}
		if ( ! self::same_items( array_keys( $items ), $item_ids ) ) {
			return self::inconsistent();
		}

		$members    = (array) ( $profiles['members'] ?? array() );
		$profiled   = array_map( 'intval', wp_list_pluck( $members, 'sourceId' ) );
		$referenced = array_map( 'intval', $member_ids );
		sort( $profiled );
		sort( $referenced );
		if ( $profiled !== $referenced ) {
			return self::inconsistent();
		}

		return array(
			'members'           => array_values( $members ),
			'eventContributors' => $contributors['eventContributors'],
			'items'             => $items,
			'portraits'         => (array) ( $profiles['portraits'] ?? array() ),
		);
	}

	/**
	 * Ordered media and focal regions from their provider.
	 *
	 * @param EventDates $event_date Selected occurrence.
	 * @param int[]      $item_ids   Schedule item IDs in programme order.
	 * @return array|WP_Error `{ unavailable: reason }` for an unavailable feature, else the provider's read.
	 */
	private static function media( EventDates $event_date, array $item_ids ) {
		/**
		 * Filters the ordered media of an occurrence and its programme
		 * items for a complete campaign-facts read (#2424).
		 *
		 * @param array|null|WP_Error $media      See the class description; null when not supplied.
		 * @param EventDates          $event_date Selected occurrence.
		 * @param int[]               $item_ids   Schedule item IDs in programme order.
		 */
		$media = apply_filters( 'fair_events_campaign_media', null, $event_date, $item_ids );

		if ( null === $media ) {
			return array( 'unavailable' => 'not_provided' );
		}
		if ( is_wp_error( $media ) ) {
			return 'fair_events_event_images_disabled' === $media->get_error_code()
				? array( 'unavailable' => 'disabled' )
				: $media;
		}

		$items = (array) ( $media['items'] ?? array() );
		if ( ! self::same_items( array_map( 'intval', array_keys( $items ) ), $item_ids ) || ! isset( $media['event'] ) ) {
			return self::inconsistent();
		}

		return array(
			'event' => $media['event'],
			'items' => $items,
			'media' => (array) ( $media['media'] ?? array() ),
		);
	}

	/**
	 * The `media` registry: each referenced attachment once, sorted by ID.
	 *
	 * @param array<int, array> $images    Described images by attachment ID.
	 * @param array<int, array> $portraits Described portraits by attachment ID.
	 * @return array[]|WP_Error
	 */
	public static function media_registry( array $images, array $portraits ) {
		$described = $images + $portraits;
		ksort( $described, SORT_NUMERIC );

		$registry = array();
		foreach ( $described as $attachment_id => $source ) {
			$url = isset( $source['url'] ) ? (string) $source['url'] : '';
			if ( ! preg_match( '#^https?://#i', $url ) ) {
				return new WP_Error(
					'fair_events_campaign_facts_media_url_invalid',
					__( 'An image of this event has no usable address.', 'fair-events' ),
					array(
						'status'        => 422,
						'attachment_id' => (int) $attachment_id,
					)
				);
			}

			$width  = isset( $source['width'] ) ? (int) $source['width'] : 0;
			$height = isset( $source['height'] ) ? (int) $source['height'] : 0;
			$known  = $width > 0 && $height > 0;

			$registry[] = array(
				'id'        => 'media:' . (int) $attachment_id,
				'sourceId'  => (int) $attachment_id,
				'sourceUrl' => $url,
				'altText'   => self::text( $source['alt'] ?? null ),
				'credit'    => self::text( $source['credit'] ?? null ),
				'width'     => $known ? $width : null,
				'height'    => $known ? $height : null,
			);
		}

		return $registry;
	}

	/**
	 * A stored naive local datetime shifted to the occurrence, as
	 * `YYYY-MM-DDTHH:MM:SS`, or null when malformed.
	 *
	 * @param string             $value      Stored datetime.
	 * @param \DateInterval|null $date_shift Shift, or null.
	 * @return string|null
	 */
	public static function local_time( $value, $date_shift = null ) {
		$value = str_replace( 'T', ' ', (string) $value );
		if ( ! preg_match( '/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/', $value ) ) {
			return null;
		}

		$time = \DateTimeImmutable::createFromFormat( '!Y-m-d H:i:s', $value, new \DateTimeZone( 'UTC' ) );
		if ( ! $time || $time->format( 'Y-m-d H:i:s' ) !== $value ) {
			return null;
		}

		if ( $date_shift ) {
			// Shift in the site timezone, as EventSchedule::get_payload() does.
			$time = ( new \DateTimeImmutable( $value, wp_timezone() ) )->add( $date_shift );
		}

		return $time->format( 'Y-m-d\TH:i:s' );
	}

	/**
	 * Whether two lists hold the same schedule item IDs.
	 *
	 * @param int[] $a IDs.
	 * @param int[] $b IDs.
	 * @return bool
	 */
	private static function same_items( array $a, array $b ) {
		$a = array_map( 'intval', $a );
		$b = array_map( 'intval', $b );
		sort( $a );
		sort( $b );
		return $a === $b;
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
	 * Error for a failed source query.
	 *
	 * @return WP_Error
	 */
	private static function source_unavailable() {
		return new WP_Error(
			'fair_events_source_unavailable',
			__( 'Event data could not be read.', 'fair-events' ),
			array( 'status' => 500 )
		);
	}

	/**
	 * Error for providers that disagree about the programme they read.
	 *
	 * @return WP_Error
	 */
	private static function inconsistent() {
		return new WP_Error(
			'fair_events_campaign_facts_inconsistent',
			__( 'The event facts changed while they were being read. Try again.', 'fair-events' ),
			array(
				'status'    => 409,
				'retryable' => true,
			)
		);
	}
}
