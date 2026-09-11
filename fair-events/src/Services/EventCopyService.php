<?php
/**
 * Event copy source resolution and creation.
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEvents\Settings\Settings;

/**
 * Copies the reusable representation and configuration of an event.
 */
class EventCopyService {

	/**
	 * Resolve an event-date row to an authorized canonical source.
	 *
	 * @param int  $event_date_id Event-date row ID.
	 * @param bool $check_permissions Whether to enforce current-user capabilities.
	 * @return array|\WP_Error Source data or an error.
	 */
	public static function resolve_source( $event_date_id, $check_permissions = true ) {
		$source = EventDates::get_by_id( absint( $event_date_id ) );
		if ( ! $source ) {
			return new \WP_Error( 'event_copy_not_found', __( 'The event to copy could not be found.', 'fair-events' ) );
		}

		if ( 'generated' === $source->occurrence_type ) {
			$source = $source->master_id ? EventDates::get_by_id( (int) $source->master_id ) : null;
		}

		if ( ! $source || ! in_array( $source->occurrence_type, array( 'single', 'master' ), true ) || ! $source->start_datetime ) {
			return new \WP_Error( 'event_copy_unsupported', __( 'This event has a source state that cannot be copied.', 'fair-events' ) );
		}

		if ( $source->event_id ) {
			$post = get_post( (int) $source->event_id );
			if ( ! $post ) {
				return new \WP_Error( 'event_copy_post_missing', __( 'The post linked to this event could not be found.', 'fair-events' ) );
			}

			$post_type = get_post_type_object( $post->post_type );
			if ( ! $post_type || ! in_array( $post->post_type, Settings::get_enabled_post_types(), true ) ) {
				return new \WP_Error( 'event_copy_type_disabled', __( 'The post type linked to this event is not enabled for Fair Events.', 'fair-events' ) );
			}

			$canonical = EventDates::get_by_event_id( $post->ID );
			if ( ! $canonical || (int) $canonical->id !== (int) $source->id ) {
				return new \WP_Error( 'event_copy_inconsistent', __( 'The event and its primary post are not linked consistently.', 'fair-events' ) );
			}

			$create_capability = isset( $post_type->cap->create_posts ) ? $post_type->cap->create_posts : $post_type->cap->edit_posts;
			if ( $check_permissions && ( ! current_user_can( 'edit_post', $post->ID ) || ! current_user_can( $create_capability ) ) ) {
				return new \WP_Error( 'event_copy_forbidden', __( 'You do not have permission to edit the source and create its copy.', 'fair-events' ) );
			}

			return array(
				'master'         => $source,
				'post'           => $post,
				'post_type'      => $post_type,
				'representation' => 'post',
			);
		}

		if ( 'post' === $source->link_type || ! empty( EventDates::get_linked_post_ids( $source->id ) ) ) {
			return new \WP_Error( 'event_copy_inconsistent', __( 'This calendar event has an inconsistent post link and cannot be copied.', 'fair-events' ) );
		}

		if ( $check_permissions && ! current_user_can( 'edit_posts' ) ) {
			return new \WP_Error( 'event_copy_forbidden', __( 'You do not have permission to copy calendar events.', 'fair-events' ) );
		}

		return array(
			'master'         => $source,
			'post'           => null,
			'post_type'      => null,
			'representation' => 'calendar',
		);
	}

	/**
	 * Build an authorized URL for the copy screen.
	 *
	 * @param int $event_date_id Event-date row ID.
	 * @return string|null Copy URL, or null when unavailable.
	 */
	public static function get_copy_url( $event_date_id ) {
		$source = self::resolve_source( $event_date_id );
		if ( is_wp_error( $source ) ) {
			return null;
		}

		$master_id = (int) $source['master']->id;
		return add_query_arg(
			array(
				'page'          => 'fair-events-copy',
				'event_date_id' => $master_id,
				'_wpnonce'      => wp_create_nonce( 'copy_fair_event_' . $master_id ),
			),
			admin_url( 'admin.php' )
		);
	}

	/**
	 * Copy an event and its reusable configuration.
	 *
	 * @param array  $source    Resolved source from resolve_source().
	 * @param string $new_title Destination title.
	 * @param string $new_start Destination start datetime.
	 * @param string $new_end   Destination end datetime.
	 * @return array|\WP_Error Destination identifiers or an error.
	 * @throws \RuntimeException Internally when a required copy operation fails.
	 */
	public function copy( $source, $new_title, $new_start, $new_end ) {
		$master            = $source['master'];
		$new_post_id       = 0;
		$new_event_date_id = 0;

		try {
			if ( 'post' === $source['representation'] ) {
				$new_post_id = $this->copy_post( $source['post'], $new_title );
				if ( ! $new_post_id ) {
					throw new \RuntimeException( 'post' );
				}
				$this->assert_checkpoint( 'post_insertion' );
				$new_event_date_id = EventDates::save_or_update_master(
					$new_post_id,
					$new_start,
					$new_end,
					$master->all_day,
					'none' === $master->recurrence_mode ? 'single' : 'master',
					'rule' === $master->recurrence_mode ? $master->rrule : null,
					$master->recurrence_mode
				);
			} else {
				$new_event_date_id = EventDates::create_standalone(
					array(
						'start_datetime'  => $new_start,
						'end_datetime'    => $new_end,
						'all_day'         => $master->all_day,
						'occurrence_type' => 'none' === $master->recurrence_mode ? 'single' : 'master',
						'rrule'           => 'rule' === $master->recurrence_mode ? $master->rrule : null,
						'title'           => $new_title,
						'external_url'    => $master->external_url,
						'link_type'       => $master->link_type,
						'attendance_mode' => $master->attendance_mode,
						'joining_link'    => $master->joining_link,
					)
				);
			}

			if ( ! $new_event_date_id ) {
				throw new \RuntimeException( 'event-date' );
			}

			if ( ! EventDates::update_by_id(
				$new_event_date_id,
				array(
					'title'             => $new_title,
					'venue_id'          => $master->venue_id,
					'address'           => $master->address,
					'external_url'      => $master->external_url,
					'link_type'         => $master->link_type,
					'attendance_mode'   => $master->attendance_mode,
					'joining_link'      => $master->joining_link,
					'capacity'          => $master->capacity,
					'recurrence_mode'   => $master->recurrence_mode,
					'recurrence_anchor' => ( new \DateTimeImmutable( $new_start, wp_timezone() ) )->format( 'Y-m-d' ),
				)
			) ) {
				throw new \RuntimeException( 'event-fields' );
			}

			if ( $new_post_id && ! EventDates::add_linked_post( $new_event_date_id, $new_post_id ) ) {
				throw new \RuntimeException( 'post-link' );
			}
			if ( 'calendar' === $source['representation'] && ! EventDates::set_category_ids( $new_event_date_id, EventDates::get_category_ids( $master->id ) ) ) {
				throw new \RuntimeException( 'event-categories' );
			}
			$this->assert_checkpoint( 'event_date_creation' );

			$this->copy_recurrence( $master, $new_event_date_id, $new_post_id, $new_start, $new_end );
			$this->assert_checkpoint( 'recurrence_generation' );

			$source_start = new \DateTimeImmutable( str_replace( 'T', ' ', $master->start_datetime ), wp_timezone() );
			$copied_start = new \DateTimeImmutable( str_replace( 'T', ' ', $new_start ), wp_timezone() );
			$date_shift   = $source_start->diff( $copied_start );
			$copier       = new EventTicketConfigurationCopier();
			$copy_result  = $copier->copy( $master->id, $new_event_date_id, $date_shift );
			if ( false === $copy_result ) {
				throw new \RuntimeException( 'configuration' );
			}
			if ( $new_post_id && ! $this->remap_ticket_type_conditions( $new_post_id, $copy_result['ticket_type_id_map'] ) ) {
				throw new \RuntimeException( 'post-content' );
			}
			$this->assert_checkpoint( 'configuration_cloning' );

			return array(
				'event_date_id' => (int) $new_event_date_id,
				'post_id'       => (int) $new_post_id,
			);
		} catch ( \Throwable $error ) {
			$this->cleanup( $new_event_date_id, $new_post_id );
			return new \WP_Error( 'event_copy_failed', __( 'The event copy could not be completed, and any partial copy was removed. Please try again.', 'fair-events' ) );
		}
	}

	/**
	 * Remap ticket-type references stored in copied Conditional Sections.
	 *
	 * @param int             $post_id  Copied post ID.
	 * @param array<int, int> $type_map Old-to-new ticket type ID map.
	 * @return bool Whether the content was left consistent.
	 */
	private function remap_ticket_type_conditions( $post_id, $type_map ) {
		$post = get_post( $post_id );
		if ( ! $post ) {
			return false;
		}

		$blocks  = parse_blocks( $post->post_content );
		$changed = $this->remap_ticket_type_ids_in_blocks( $blocks, $type_map );
		if ( ! $changed ) {
			return true;
		}

		$result = wp_update_post(
			array(
				'ID'           => $post_id,
				'post_content' => serialize_blocks( $blocks ),
			),
			true
		);

		return ! is_wp_error( $result ) && 0 !== $result;
	}

	/**
	 * Recursively remap ticket-type IDs in parsed blocks.
	 *
	 * @param array           $blocks   Parsed blocks, updated by reference.
	 * @param array<int, int> $type_map Old-to-new ticket type ID map.
	 * @return bool Whether any block attributes changed.
	 */
	private function remap_ticket_type_ids_in_blocks( &$blocks, $type_map ) {
		$changed = false;

		foreach ( $blocks as &$block ) {
			if ( 'fair-audience/fair-form-conditional' === $block['blockName'] && isset( $block['attrs']['conditionTicketTypeIds'] ) && is_array( $block['attrs']['conditionTicketTypeIds'] ) ) {
				$remapped = array();
				foreach ( $block['attrs']['conditionTicketTypeIds'] as $source_id ) {
					$source_id = (int) $source_id;
					if ( isset( $type_map[ $source_id ] ) ) {
						$remapped[] = $type_map[ $source_id ];
					}
				}

				if ( $remapped !== $block['attrs']['conditionTicketTypeIds'] ) {
					$block['attrs']['conditionTicketTypeIds'] = $remapped;
					$changed                                  = true;
				}
			}

			if ( ! empty( $block['innerBlocks'] ) && $this->remap_ticket_type_ids_in_blocks( $block['innerBlocks'], $type_map ) ) {
				$changed = true;
			}
		}
		unset( $block );

		return $changed;
	}

	/**
	 * Provide deterministic failure points for integration coverage.
	 *
	 * @param string $checkpoint Copy stage name.
	 * @return void
	 * @throws \RuntimeException When a test or extension requests failure.
	 */
	private function assert_checkpoint( $checkpoint ) {
		if ( apply_filters( 'fair_events_event_copy_fail_at', false, $checkpoint ) ) {
			throw new \RuntimeException( 'Event copy checkpoint failed.' );
		}
	}

	/**
	 * Copy a post-backed representation.
	 *
	 * @param \WP_Post $source    Source post.
	 * @param string   $new_title Destination title.
	 * @return int New post ID, or zero on failure.
	 */
	private function copy_post( $source, $new_title ) {
		$new_id = wp_insert_post(
			array(
				'post_title'   => $new_title,
				'post_content' => $source->post_content,
				'post_excerpt' => $source->post_excerpt,
				'post_type'    => $source->post_type,
				'post_status'  => 'draft',
				'post_author'  => get_current_user_id(),
			),
			true
		);
		if ( is_wp_error( $new_id ) ) {
			return 0;
		}

		$location = get_post_meta( $source->ID, 'event_location', true );
		if ( '' !== $location && false === update_post_meta( $new_id, 'event_location', $location ) ) {
			wp_delete_post( $new_id, true );
			return 0;
		}

		if ( post_type_supports( $source->post_type, 'thumbnail' ) ) {
			$thumbnail_id = get_post_thumbnail_id( $source->ID );
			if ( $thumbnail_id && ! set_post_thumbnail( $new_id, $thumbnail_id ) ) {
				wp_delete_post( $new_id, true );
				return 0;
			}
		}

		foreach ( get_object_taxonomies( $source->post_type ) as $taxonomy ) {
			$terms = wp_get_object_terms( $source->ID, $taxonomy, array( 'fields' => 'ids' ) );
			if ( is_wp_error( $terms ) ) {
				wp_delete_post( $new_id, true );
				return 0;
			}
			if ( ! empty( $terms ) && is_wp_error( wp_set_object_terms( $new_id, $terms, $taxonomy ) ) ) {
				wp_delete_post( $new_id, true );
				return 0;
			}
		}

		return (int) $new_id;
	}

	/**
	 * Copy recurrence and shifted cancellation state.
	 *
	 * @param EventDates $master        Source master.
	 * @param int        $destination_id Destination event-date ID.
	 * @param int        $post_id        Destination post ID, if any.
	 * @param string     $new_start      Destination start datetime.
	 * @param string     $new_end        Destination end datetime.
	 * @return void
	 * @throws \RuntimeException When recurrence cannot be recreated.
	 */
	private function copy_recurrence( $master, $destination_id, $post_id, $new_start, $new_end ) {
		if ( 'none' === $master->recurrence_mode ) {
			return;
		}

		$source_start = new \DateTimeImmutable( str_replace( 'T', ' ', $master->start_datetime ), wp_timezone() );
		$copied_start = new \DateTimeImmutable( str_replace( 'T', ' ', $new_start ), wp_timezone() );
		$shift        = $source_start->diff( $copied_start );
		$source_rows  = EventDates::get_generated_by_master_id( $master->id, true );

		if ( 'rule' === $master->recurrence_mode ) {
			$expected = count( RecurrenceService::generate_occurrences( $new_start, $new_end, $master->rrule ) );
			$created  = $post_id
				? RecurrenceService::regenerate_event_occurrences( $post_id, $master->rrule )
				: RecurrenceService::regenerate_standalone_occurrences( $destination_id, $master->rrule );
		} elseif ( 'manual' === $master->recurrence_mode ) {
			$dates = array( ( new \DateTimeImmutable( $master->start_datetime, wp_timezone() ) )->add( $shift )->format( 'Y-m-d' ) );
			foreach ( $source_rows as $row ) {
				$dates[] = ( new \DateTimeImmutable( $row->start_datetime, wp_timezone() ) )->add( $shift )->format( 'Y-m-d' );
			}
			$expected = count( $dates );
			$created  = RecurrenceService::set_manual_occurrences( $destination_id, $dates );
		} else {
			throw new \RuntimeException( 'recurrence-mode' );
		}

		if ( ! $expected || $created !== $expected ) {
			throw new \RuntimeException( 'recurrence' );
		}

		$destination_rows = EventDates::get_generated_by_master_id( $destination_id, true );
		$by_date          = array();
		foreach ( $destination_rows as $row ) {
			$by_date[ substr( $row->start_datetime, 0, 10 ) ] = $row;
		}
		foreach ( $source_rows as $row ) {
			if ( 'cancelled' !== $row->status ) {
				continue;
			}
			$shifted_date = ( new \DateTimeImmutable( $row->start_datetime, wp_timezone() ) )->add( $shift )->format( 'Y-m-d' );
			if ( isset( $by_date[ $shifted_date ] ) && ! EventDates::update_by_id( $by_date[ $shifted_date ]->id, array( 'status' => 'cancelled' ) ) ) {
				throw new \RuntimeException( 'cancellation' );
			}
		}
	}

	/**
	 * Remove every destination record owned by the copy attempt.
	 *
	 * @param int $event_date_id Destination event-date ID.
	 * @param int $post_id       Destination post ID.
	 * @return void
	 */
	private function cleanup( $event_date_id, $post_id ) {
		if ( $event_date_id ) {
			( new EventTicketConfigurationCopier() )->cleanup( $event_date_id );
			EventDates::delete_by_id( $event_date_id );
		}
		if ( $post_id ) {
			wp_delete_post( $post_id, true );
		}
	}
}
