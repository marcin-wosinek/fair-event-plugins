<?php
/**
 * Event and programme-item images with optional focal regions.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\EventImages;

use FairEvents\Models\EventDates;
use WP_Error;

defined( 'WPINC' ) || die;

// phpcs:disable WordPress.DB.DirectDatabaseQuery

/**
 * Reads and replaces the ordered image lists of an event (#2397).
 *
 * Every event has one list of its own and one per saved programme item
 * (standalone items and workshops linked to an add-on). A series keeps its
 * lists on its master, like its schedule: a generated occurrence reads them
 * with the same IDs and circles, read-only.
 *
 * A list is replaced as a whole. The client sends the revision it loaded;
 * when the list changed since, nothing is written. Associations keep their
 * IDs across reorders and circle edits; a replaced image is a new
 * association that starts without a circle.
 *
 * See docs/event-images.md for the consumer contract.
 */
class EventImages {

	/**
	 * Most images one list holds.
	 */
	public const MAX_IMAGES = 50;

	/**
	 * Seconds a save waits for another save of the same list.
	 */
	private const LOCK_TIMEOUT = 5;

	/**
	 * The event date image lists are stored on: the series master for a
	 * generated occurrence, the event date itself otherwise. Same rule as
	 * the schedule (EventSchedule::config_event_date_id()).
	 *
	 * @param object $event_date Event date.
	 * @return int
	 */
	public static function owner_id( $event_date ) {
		if ( class_exists( \FairEvents\Services\EventSchedule::class ) ) {
			return \FairEvents\Services\EventSchedule::config_event_date_id( $event_date );
		}
		return ( 'generated' === $event_date->occurrence_type && ! empty( $event_date->master_id ) )
			? (int) $event_date->master_id
			: (int) $event_date->id;
	}

	/**
	 * The saved programme items of an owner, in programme order.
	 *
	 * @param object $event_date Requested event date (dates are shifted to it).
	 * @return array<int, array{id: int, title: string, ticketOptionId: int|null, startDatetime: string, endDatetime: string}>|null Null when this Fair Events stores no schedule.
	 */
	private static function schedule_items( $event_date ) {
		if ( ! class_exists( \FairEvents\Services\EventSchedule::class ) ) {
			return null;
		}

		$payload = \FairEvents\Services\EventSchedule::get_payload( $event_date );
		$items   = array();
		foreach ( (array) ( $payload['items'] ?? array() ) as $item ) {
			$items[ (int) $item['id'] ] = array(
				'id'             => (int) $item['id'],
				'title'          => (string) $item['title'],
				'ticketOptionId' => $item['ticket_option_id'] ? (int) $item['ticket_option_id'] : null,
				'startDatetime'  => (string) $item['start_datetime'],
				'endDatetime'    => (string) $item['end_datetime'],
			);
		}
		return $items;
	}

	/**
	 * Everything the Images tab and consumers read for an event date.
	 *
	 * @param EventDates $event_date Requested event date.
	 * @return array
	 */
	public static function get_payload( $event_date ) {
		$owner_id  = self::owner_id( $event_date );
		$read_only = (int) $event_date->id !== $owner_id;
		$items     = self::schedule_items( $event_date );

		$by_list = array();
		foreach ( Store::rows_for_owner( $owner_id ) as $row ) {
			$by_list[ $row->schedule_item_id ][] = $row;
		}

		$schedule_lists = array();
		foreach ( (array) $items as $item_id => $item ) {
			$rows             = $by_list[ $item_id ] ?? array();
			$schedule_lists[] = array_merge(
				array(
					'scheduleItemId' => $item_id,
				),
				array_diff_key( $item, array( 'id' => true ) ),
				array(
					'revision' => self::revision( $rows ),
					'images'   => self::associations( $rows ),
				)
			);
		}

		$event_rows = $by_list[0] ?? array();

		return array(
			'eventDateId'        => (int) $event_date->id,
			'ownerEventDateId'   => $owner_id,
			'readOnly'           => $read_only,
			'ownerEditUrl'       => $read_only ? admin_url( 'admin.php?page=fair-events-manage-event&event_date_id=' . $owner_id . '&tab=images' ) : null,
			'scheduleAvailable'  => null !== $items,
			'event'              => array(
				'revision' => self::revision( $event_rows ),
				'images'   => self::associations( $event_rows ),
			),
			'scheduleItems'      => $schedule_lists,
			'maxImagesPerList'   => self::MAX_IMAGES,
			'supportedMimeTypes' => Source::MIME_TYPES,
		);
	}

	/**
	 * Shape stored rows for the response. Rows whose attachment no longer
	 * exists are left out; an attachment that exists but cannot be shown
	 * (trashed, no longer an image) is reported unavailable.
	 *
	 * @param array<int, object> $rows Rows in list order.
	 * @return array<int, array>
	 */
	private static function associations( array $rows ) {
		$out = array();
		foreach ( $rows as $row ) {
			$source = Source::describe( $row->attachment_id );
			if ( ! $source['ok'] && 'missing' === $source['reason'] ) {
				continue;
			}

			$stored_circle = null !== $row->radius;
			$current       = $source['ok'] && $row->source_revision === $source['revision'];
			$circle        = $stored_circle && $current
				? array(
					'centerX' => $row->center_x,
					'centerY' => $row->center_y,
					'radius'  => $row->radius,
				)
				: null;

			$out[] = array(
				'id'                     => $row->id,
				'position'               => count( $out ),
				'attachmentId'           => $row->attachment_id,
				'available'              => $source['ok'],
				'unavailableReason'      => $source['ok'] ? null : $source['reason'],
				'sourceUrl'              => $source['ok'] ? $source['url'] : null,
				'width'                  => $source['ok'] ? $source['width'] : null,
				'height'                 => $source['ok'] ? $source['height'] : null,
				'sourceRevision'         => $source['ok'] ? $source['revision'] : null,
				'altText'                => $source['ok'] ? $source['alt'] : null,
				'credit'                 => $source['ok'] ? $source['credit'] : null,
				'title'                  => $source['ok'] ? $source['title'] : '',
				'focalRegion'            => $circle,
				// The image changed since its circle was drawn: the circle
				// is withheld until the organizer marks the subject again.
				'focalRegionNeedsReview' => $stored_circle && ! $current,
			);
		}
		return $out;
	}

	/**
	 * Concurrency token of a list: changes whenever anything stored in it
	 * changes, and is the same for every empty list.
	 *
	 * @param array<int, object> $rows Rows in list order.
	 * @return string
	 */
	private static function revision( array $rows ) {
		$parts = array();
		foreach ( $rows as $row ) {
			$parts[] = array( $row->id, $row->attachment_id, $row->position, $row->center_x, $row->center_y, $row->radius, $row->source_revision );
		}
		return substr( hash( 'sha256', (string) wp_json_encode( $parts ) ), 0, 16 );
	}

	/**
	 * Replace one list.
	 *
	 * @param EventDates $event_date       Requested event date.
	 * @param int        $schedule_item_id Programme item ID, 0 for the event's own images.
	 * @param string     $revision         Revision the client loaded.
	 * @param array      $raw_images       Submitted images, in order.
	 * @return array|WP_Error The new payload (get_payload()), or an error.
	 * @throws \Throwable Re-thrown after rolling back.
	 */
	public static function save( $event_date, $schedule_item_id, $revision, array $raw_images ) {
		global $wpdb;

		$owner_id = self::owner_id( $event_date );
		if ( (int) $event_date->id !== $owner_id ) {
			return new WP_Error(
				'event_images_managed_on_series',
				__( 'This date is part of a series. Its images are managed on the series.', 'fair-events-experimental' ),
				array(
					'status'              => 409,
					'owner_event_date_id' => $owner_id,
				)
			);
		}

		$schedule_item_id = (int) $schedule_item_id;
		if ( $schedule_item_id ) {
			$items = self::schedule_items( $event_date );
			if ( null === $items || ! isset( $items[ $schedule_item_id ] ) ) {
				return new WP_Error(
					'event_images_schedule_item_not_found',
					__( 'This programme item is no longer on the schedule. Reload the page to see the current programme.', 'fair-events-experimental' ),
					array( 'status' => 404 )
				);
			}
		}

		if ( count( $raw_images ) > self::MAX_IMAGES ) {
			return new WP_Error(
				'event_images_too_many',
				sprintf(
					/* translators: %d: maximum number of images */
					__( 'A list can hold up to %d images.', 'fair-events-experimental' ),
					self::MAX_IMAGES
				),
				array( 'status' => 400 )
			);
		}

		$clean = self::sanitize( array_values( $raw_images ) );
		if ( is_wp_error( $clean ) ) {
			return $clean;
		}

		$lock = 'fair_evx_images_' . $owner_id . '_' . $schedule_item_id;
		if ( 1 !== (int) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK( %s, %d )', $lock, self::LOCK_TIMEOUT ) ) ) {
			return self::busy_error();
		}

		$wpdb->query( 'START TRANSACTION' );
		try {
			$result = self::write( $owner_id, $schedule_item_id, (string) $revision, $clean, $event_date );
		} catch ( \Throwable $e ) {
			$wpdb->query( 'ROLLBACK' );
			$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK( %s )', $lock ) );
			throw $e;
		}

		if ( is_wp_error( $result ) ) {
			$wpdb->query( 'ROLLBACK' );
		} else {
			$wpdb->query( 'COMMIT' );
		}
		$wpdb->query( $wpdb->prepare( 'SELECT RELEASE_LOCK( %s )', $lock ) );

		return is_wp_error( $result ) ? $result : self::get_payload( $event_date );
	}

	/**
	 * Check the submitted images' shape, attachments and circles before
	 * anything is locked or written.
	 *
	 * @param array $raw_images Submitted images, in order.
	 * @return array<int, array{id: int, attachment_id: int, circle: array|null, revision: string}>|WP_Error
	 */
	private static function sanitize( array $raw_images ) {
		$clean       = array();
		$attachments = array();
		$ids         = array();

		foreach ( $raw_images as $index => $raw ) {
			if ( ! is_array( $raw ) ) {
				return self::image_error( 'event_images_invalid', __( 'An image in the list could not be read. Reload the page and try again.', 'fair-events-experimental' ), $index );
			}

			$id            = isset( $raw['id'] ) ? absint( $raw['id'] ) : 0;
			$attachment_id = isset( $raw['attachmentId'] ) ? absint( $raw['attachmentId'] ) : 0;

			if ( ! $attachment_id ) {
				return self::image_error( 'event_images_invalid', __( 'An image in the list could not be read. Reload the page and try again.', 'fair-events-experimental' ), $index );
			}

			if ( isset( $attachments[ $attachment_id ] ) ) {
				return self::image_error( 'event_images_duplicate', __( 'The same image is in this list twice. Remove one of them and save again.', 'fair-events-experimental' ), $index );
			}
			$attachments[ $attachment_id ] = true;

			if ( $id ) {
				if ( isset( $ids[ $id ] ) ) {
					return self::image_error( 'event_images_invalid', __( 'An image in the list could not be read. Reload the page and try again.', 'fair-events-experimental' ), $index );
				}
				$ids[ $id ] = true;
			}

			$source = Source::describe( $attachment_id );
			if ( ! $source['ok'] || ! current_user_can( 'read_post', $attachment_id ) ) {
				return self::image_error(
					'event_images_invalid_attachment',
					( $source['ok'] || 'not_image' !== $source['reason'] )
						? __( 'One of the images is not available in the Media Library. Remove it or choose another image.', 'fair-events-experimental' )
						: __( 'Only JPEG, PNG, GIF, WebP and AVIF images can be used.', 'fair-events-experimental' ),
					$index,
					array( 'reason' => $source['ok'] ? 'not_readable' : $source['reason'] )
				);
			}

			$circle = null;
			if ( isset( $raw['focalRegion'] ) && null !== $raw['focalRegion'] ) {
				$sent_revision = isset( $raw['sourceRevision'] ) ? (string) $raw['sourceRevision'] : '';
				if ( $sent_revision !== $source['revision'] ) {
					return self::image_error(
						'event_images_source_changed',
						__( 'An image was edited in the Media Library after you marked its focal region. Reload the page and mark it again.', 'fair-events-experimental' ),
						$index,
						array( 'status' => 409 )
					);
				}

				$check = Geometry::validate( $raw['focalRegion'], $source['width'], $source['height'] );
				if ( ! $check['ok'] ) {
					return self::image_error(
						'event_images_invalid_focal_region',
						'dimensions_unknown' === $check['code']
							? __( 'This image has no known size, so a focal region cannot be saved for it. Remove the focal region or use another image.', 'fair-events-experimental' )
							: __( 'A focal region must be a circle with a positive size that fits entirely inside the image.', 'fair-events-experimental' ),
						$index,
						array( 'reason' => $check['code'] )
					);
				}
				$circle = $check['circle'];
			}

			$clean[] = array(
				'id'            => $id,
				'attachment_id' => $attachment_id,
				'circle'        => $circle,
				'revision'      => $source['revision'],
			);
		}

		return $clean;
	}

	/**
	 * Write a sanitized list inside the caller's transaction and lock.
	 *
	 * @param int        $owner_id         Owner event date ID.
	 * @param int        $schedule_item_id Programme item ID, 0 for the event.
	 * @param string     $revision         Revision the client loaded.
	 * @param array      $clean            Sanitized images.
	 * @param EventDates $event_date       Requested event date.
	 * @return true|WP_Error
	 */
	private static function write( $owner_id, $schedule_item_id, $revision, array $clean, $event_date ) {
		$existing = Store::rows_for_list( $owner_id, $schedule_item_id, true );

		// Compare with what the client could see: an association whose
		// attachment was deleted is gone from its list too.
		$visible = array_values(
			array_filter(
				$existing,
				static function ( $row ) {
					$source = Source::describe( $row->attachment_id );
					return $source['ok'] || 'missing' !== $source['reason'];
				}
			)
		);
		if ( ! hash_equals( self::revision( $existing ), $revision ) && ! hash_equals( self::revision( $visible ), $revision ) ) {
			return new WP_Error(
				'event_images_revision_mismatch',
				__( 'These images were changed elsewhere since you opened them. Reload the page to see the latest version, then make your changes again.', 'fair-events-experimental' ),
				array( 'status' => 409 )
			);
		}

		$by_id = array();
		foreach ( $existing as $row ) {
			$by_id[ $row->id ] = $row;
		}

		foreach ( $clean as $index => $image ) {
			if ( ! $image['id'] ) {
				continue;
			}
			$row = $by_id[ $image['id'] ] ?? null;
			// An ID from another list, or one whose image was swapped,
			// would carry a circle drawn on something else.
			if ( ! $row || $row->attachment_id !== $image['attachment_id'] ) {
				return self::image_error( 'event_images_invalid', __( 'An image in the list could not be read. Reload the page and try again.', 'fair-events-experimental' ), $index );
			}
		}

		$kept = array_filter( wp_list_pluck( $clean, 'id' ) );
		$gone = array_diff( array_keys( $by_id ), $kept );

		// Rows of programme items no longer on the schedule are never shown;
		// drop them while the owner is being written anyway.
		$items = self::schedule_items( $event_date );
		if ( null !== $items ) {
			foreach ( Store::rows_for_owner( $owner_id ) as $row ) {
				if ( $row->schedule_item_id && ! isset( $items[ $row->schedule_item_id ] ) ) {
					$gone[] = $row->id;
				}
			}
		}

		if ( ! Store::delete_ids( $gone ) ) {
			return self::save_failed();
		}

		foreach ( $clean as $position => $image ) {
			$data = array(
				'event_date_id'    => $owner_id,
				'schedule_item_id' => $schedule_item_id,
				'attachment_id'    => $image['attachment_id'],
				'position'         => $position,
				'center_x'         => $image['circle'] ? $image['circle']['centerX'] : null,
				'center_y'         => $image['circle'] ? $image['circle']['centerY'] : null,
				'radius'           => $image['circle'] ? $image['circle']['radius'] : null,
				'source_revision'  => $image['revision'],
			);
			$ok   = $image['id'] ? Store::update( $image['id'], $data ) : (bool) Store::insert( $data );
			if ( ! $ok ) {
				return self::save_failed();
			}
		}

		return true;
	}

	/**
	 * Error about one submitted image.
	 *
	 * @param string $code    Error code.
	 * @param string $message Message.
	 * @param int    $index   Position of the image in the submitted list.
	 * @param array  $data    Extra error data.
	 * @return WP_Error
	 */
	private static function image_error( $code, $message, $index, array $data = array() ) {
		return new WP_Error(
			$code,
			$message,
			array_merge(
				array(
					'status' => 400,
					'index'  => (int) $index,
				),
				$data
			)
		);
	}

	/**
	 * Error for a list another save is writing.
	 *
	 * @return WP_Error
	 */
	private static function busy_error() {
		return new WP_Error(
			'event_images_busy',
			__( 'These images are being saved from another window. Wait a moment and save again.', 'fair-events-experimental' ),
			array( 'status' => 409 )
		);
	}

	/**
	 * Error for a failed write.
	 *
	 * @return WP_Error
	 */
	private static function save_failed() {
		return new WP_Error(
			'event_images_save_failed',
			__( 'The images could not be saved. Nothing was changed — try again.', 'fair-events-experimental' ),
			array( 'status' => 500 )
		);
	}
}
