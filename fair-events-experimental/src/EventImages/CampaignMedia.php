<?php
/**
 * Event images for complete campaign facts.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\EventImages;

use FairEventsExperimental\Core\Plugin;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * The checked export projection of an event's image lists for Fair Events'
 * complete campaign-facts read (#2424), answering the
 * `fair_events_campaign_media` filter.
 *
 * Reads the owner's lists (the series master for a generated occurrence)
 * for the event and for each programme item Fair Events passes, in the
 * organizer's order. Unusable images (trashed, not an image, file missing)
 * are skipped, as consumers of the images read do. A circle is exported
 * only while it is current (see EventImages::associations()). Anything
 * that would otherwise turn into an empty list is an error instead: a
 * failed query (`fair_events_source_unavailable`) or a link to an
 * attachment that no longer exists (`fair_events_event_image_missing`).
 * With the bundle off, the answer is `fair_events_event_images_disabled`.
 *
 * Shape: `{ event: { mediaIds, focalRegions }, items: { <schedule item
 * ID>: { mediaIds, focalRegions } }, media: { <attachment ID>: { url,
 * width, height, alt, credit } } }`, with `media` holding each referenced
 * attachment once.
 */
class CampaignMedia {

	/**
	 * `fair_events_campaign_media` filter.
	 *
	 * @param mixed  $media      Value so far (null: not supplied).
	 * @param object $event_date Selected occurrence (EventDates).
	 * @param int[]  $item_ids   Schedule item IDs in programme order.
	 * @return array|WP_Error
	 */
	public static function filter( $media, $event_date, $item_ids = array() ) {
		if ( null !== $media ) {
			return $media;
		}

		return self::read( $event_date, (array) $item_ids );
	}

	/**
	 * `fair_events_campaign_snapshot_tables` filter: the images table.
	 *
	 * @param string[] $tables Table names.
	 * @return string[]
	 */
	public static function filter_snapshot_tables( $tables ) {
		$tables   = (array) $tables;
		$tables[] = Store::table_name();
		return $tables;
	}

	/**
	 * Read the media of an occurrence and its programme items.
	 *
	 * @param object $event_date Selected occurrence (EventDates).
	 * @param int[]  $item_ids   Schedule item IDs in programme order.
	 * @return array|WP_Error
	 */
	public static function read( $event_date, array $item_ids ) {
		global $wpdb;

		if ( ! Plugin::event_images_available() || ! Store::is_installed() ) {
			return new WP_Error(
				'fair_events_event_images_disabled',
				__( 'Event images are turned off on this site.', 'fair-events-experimental' ),
				array( 'status' => 409 )
			);
		}

		$rows = Store::rows_for_owner( EventImages::owner_id( $event_date ) );
		if ( '' !== $wpdb->last_error ) {
			return new WP_Error(
				'fair_events_source_unavailable',
				__( 'The images of this event could not be read.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		$by_list = array();
		foreach ( $rows as $row ) {
			$by_list[ $row->schedule_item_id ][] = $row;
		}

		$media = array();
		$event = self::project( $by_list[0] ?? array(), $media );
		if ( is_wp_error( $event ) ) {
			return $event;
		}

		$items = array();
		foreach ( $item_ids as $item_id ) {
			$list = self::project( $by_list[ (int) $item_id ] ?? array(), $media );
			if ( is_wp_error( $list ) ) {
				return $list;
			}
			$items[ (int) $item_id ] = $list;
		}

		ksort( $media, SORT_NUMERIC );

		return array(
			'event' => $event,
			'items' => $items,
			'media' => $media,
		);
	}

	/**
	 * One list's media IDs and current circles.
	 *
	 * @param array<int, object> $rows  Rows in list order.
	 * @param array              $media Described attachments by ID, extended in place.
	 * @return array{mediaIds: string[], focalRegions: array}|WP_Error
	 */
	private static function project( array $rows, array &$media ) {
		$ids     = array();
		$regions = array();

		foreach ( $rows as $row ) {
			$source = Source::describe( $row->attachment_id );
			if ( ! $source['ok'] ) {
				if ( 'missing' === $source['reason'] ) {
					return new WP_Error(
						'fair_events_event_image_missing',
						__( 'An image of this event refers to a Media Library item that no longer exists.', 'fair-events-experimental' ),
						array(
							'status'        => 500,
							'attachment_id' => (int) $row->attachment_id,
						)
					);
				}
				continue;
			}

			$media_id = 'media:' . (int) $row->attachment_id;
			$ids[]    = $media_id;

			if ( null !== $row->radius && $row->source_revision === $source['revision'] ) {
				$regions[ $media_id ] = array(
					'centerX' => $row->center_x,
					'centerY' => $row->center_y,
					'radius'  => $row->radius,
				);
			}

			$media[ (int) $row->attachment_id ] = array(
				'url'    => $source['url'],
				'width'  => $source['width'],
				'height' => $source['height'],
				'alt'    => $source['alt'],
				'credit' => $source['credit'],
			);
		}

		return array(
			'mediaIds'     => $ids,
			'focalRegions' => $regions,
		);
	}
}
