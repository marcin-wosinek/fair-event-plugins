<?php
/**
 * Event Merge REST API Controller
 *
 * Provides endpoints for previewing and executing event date merges.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Models\EventDates;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles merging one event_date into another.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class EventMergeController extends WP_REST_Controller {

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->namespace = 'fair-events/v1';
		$this->rest_base = 'event-dates';
	}

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)/merge-preview',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'merge_preview' ),
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
					'args'                => array(
						'id' => array(
							'required'          => true,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<id>[\d]+)/merge',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'execute_merge' ),
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
					'args'                => array(
						'id'            => array(
							'required'          => true,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'source_id'     => array(
							'required'          => true,
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
						'actions'       => array(
							'required' => true,
							'type'     => 'object',
						),
						'delete_source' => array(
							'type'    => 'boolean',
							'default' => false,
						),
					),
				),
			)
		);
	}

	/**
	 * Get counts of all linked data for an event_date.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function merge_preview( $request ) {
		global $wpdb;

		$event_date_id = $request->get_param( 'id' );

		$event_date = EventDates::get_by_id( $event_date_id );
		if ( ! $event_date ) {
			return new WP_Error(
				'not_found',
				__( 'Event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$counts = $this->get_linked_data_counts( $event_date_id );

		return rest_ensure_response(
			array(
				'event_date' => $event_date,
				'counts'     => $counts,
			)
		);
	}

	/**
	 * Execute the merge of source event_date into target.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function execute_merge( $request ) {
		global $wpdb;

		$target_id     = $request->get_param( 'id' );
		$source_id     = $request->get_param( 'source_id' );
		$actions       = $request->get_param( 'actions' );
		$delete_source = $request->get_param( 'delete_source' );

		// Validate both event dates exist.
		$target = EventDates::get_by_id( $target_id );
		if ( ! $target ) {
			return new WP_Error(
				'not_found',
				__( 'Target event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		$source = EventDates::get_by_id( $source_id );
		if ( ! $source ) {
			return new WP_Error(
				'not_found',
				__( 'Source event date not found.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( $target_id === $source_id ) {
			return new WP_Error(
				'invalid_merge',
				__( 'Cannot merge an event date into itself.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
		$wpdb->query( 'START TRANSACTION' );

		try {
			$this->process_linked_posts( $source_id, $target_id, $actions['linked_posts'] ?? 'skip' );
			$this->process_categories( $source_id, $target_id, $actions['categories'] ?? 'skip' );
			$this->process_simple_table( 'fair_events_group_pricing_rules', $source_id, $target_id, $actions['group_pricing_rules'] ?? 'skip' );
			$this->process_simple_table( 'fair_events_ticket_types', $source_id, $target_id, $actions['ticket_types'] ?? 'skip' );
			$this->process_simple_table( 'fair_events_ticket_sale_periods', $source_id, $target_id, $actions['ticket_sale_periods'] ?? 'skip' );
			$this->process_simple_table( 'fair_events_group_permission_rules', $source_id, $target_id, $actions['group_permission_rules'] ?? 'skip' );
			$this->process_image_exports( $source_id, $target_id, $actions['image_exports'] ?? 'skip' );
			$this->process_event_photos( $source_id, $target_id, $actions['event_photos'] ?? 'skip' );

			// Cross-plugin tables (check existence first).
			$this->process_cross_plugin_table( 'fair_audience_event_participants', $source_id, $target_id, $actions['participants'] ?? 'skip' );
			$this->process_cross_plugin_table( 'fair_audience_polls', $source_id, $target_id, $actions['polls'] ?? 'skip' );
			$this->process_cross_plugin_table( 'fair_audience_gallery_access_keys', $source_id, $target_id, $actions['gallery_access_keys'] ?? 'skip' );
			$this->process_cross_plugin_table( 'fair_audience_custom_mail_messages', $source_id, $target_id, $actions['custom_mail_messages'] ?? 'skip' );
			$this->process_cross_plugin_table( 'fair_payment_financial_entries', $source_id, $target_id, $actions['financial_entries'] ?? 'skip' );

			if ( $delete_source ) {
				EventDates::delete_by_id( $source_id );
			}

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$wpdb->query( 'COMMIT' );
		} catch ( \Exception $e ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery
			$wpdb->query( 'ROLLBACK' );
			return new WP_Error(
				'merge_failed',
				$e->getMessage(),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'success'   => true,
				'target_id' => $target_id,
			)
		);
	}

	/**
	 * Get counts of linked data for an event_date_id.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return array Associative array of key => count.
	 */
	private function get_linked_data_counts( $event_date_id ) {
		global $wpdb;

		$counts = array();

		// Fair-events tables.
		$counts['linked_posts']           = $this->count_rows( 'fair_event_date_posts', $event_date_id );
		$counts['categories']             = $this->count_rows( 'fair_event_date_categories', $event_date_id );
		$counts['group_pricing_rules']    = $this->count_rows( 'fair_events_group_pricing_rules', $event_date_id );
		$counts['ticket_types']           = $this->count_rows( 'fair_events_ticket_types', $event_date_id );
		$counts['ticket_sale_periods']    = $this->count_rows( 'fair_events_ticket_sale_periods', $event_date_id );
		$counts['group_permission_rules'] = $this->count_rows( 'fair_events_group_permission_rules', $event_date_id );

		// Image exports (postmeta).
		$counts['image_exports'] = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*) FROM {$wpdb->postmeta} WHERE meta_key = '_fair_events_event_date_id' AND meta_value = %s",
				$event_date_id
			)
		);

		// Event photos (now keyed by event_date_id).
		$counts['event_photos'] = $this->count_rows( 'fair_events_event_photos', $event_date_id );

		// Cross-plugin tables.
		$counts['participants']         = $this->count_rows_if_exists( 'fair_audience_event_participants', $event_date_id );
		$counts['polls']                = $this->count_rows_if_exists( 'fair_audience_polls', $event_date_id );
		$counts['gallery_access_keys']  = $this->count_rows_if_exists( 'fair_audience_gallery_access_keys', $event_date_id );
		$counts['custom_mail_messages'] = $this->count_rows_if_exists( 'fair_audience_custom_mail_messages', $event_date_id );
		$counts['financial_entries']    = $this->count_rows_if_exists( 'fair_payment_financial_entries', $event_date_id );

		return $counts;
	}

	/**
	 * Count rows in a table by event_date_id.
	 *
	 * @param string $table_suffix Table name without prefix.
	 * @param int    $event_date_id Event date ID.
	 * @return int Row count.
	 */
	private function count_rows( $table_suffix, $event_date_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . $table_suffix;

		return (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE event_date_id = %d',
				$table_name,
				$event_date_id
			)
		);
	}

	/**
	 * Count rows in a table by event_date_id, returning 0 if table doesn't exist.
	 *
	 * @param string $table_suffix Table name without prefix.
	 * @param int    $event_date_id Event date ID.
	 * @return int Row count, or 0 if table doesn't exist.
	 */
	private function count_rows_if_exists( $table_suffix, $event_date_id ) {
		global $wpdb;

		$table_name = $wpdb->prefix . $table_suffix;

		$exists = $wpdb->get_var(
			$wpdb->prepare( 'SHOW TABLES LIKE %s', $table_name )
		);

		if ( ! $exists ) {
			return 0;
		}

		return $this->count_rows( $table_suffix, $event_date_id );
	}

	/**
	 * Process linked_posts junction table (handles duplicates).
	 *
	 * @param int    $source_id Source event date ID.
	 * @param int    $target_id Target event date ID.
	 * @param string $action    Action: move, delete, or skip.
	 * @return void
	 */
	private function process_linked_posts( $source_id, $target_id, $action ) {
		global $wpdb;

		if ( 'skip' === $action ) {
			return;
		}

		$table_name = $wpdb->prefix . 'fair_event_date_posts';

		if ( 'delete' === $action ) {
			$wpdb->delete( $table_name, array( 'event_date_id' => $source_id ), array( '%d' ) );
			return;
		}

		if ( 'move' === $action ) {
			// Get existing target post IDs to avoid duplicates.
			$existing = $wpdb->get_col(
				$wpdb->prepare(
					'SELECT post_id FROM %i WHERE event_date_id = %d',
					$table_name,
					$target_id
				)
			);

			$source_posts = $wpdb->get_col(
				$wpdb->prepare(
					'SELECT post_id FROM %i WHERE event_date_id = %d',
					$table_name,
					$source_id
				)
			);

			foreach ( $source_posts as $post_id ) {
				if ( in_array( (int) $post_id, array_map( 'intval', $existing ), true ) ) {
					// Duplicate — just delete the source row.
					$wpdb->delete(
						$table_name,
						array(
							'event_date_id' => $source_id,
							'post_id'       => $post_id,
						),
						array( '%d', '%d' )
					);
				} else {
					$wpdb->update(
						$table_name,
						array( 'event_date_id' => $target_id ),
						array(
							'event_date_id' => $source_id,
							'post_id'       => $post_id,
						),
						array( '%d' ),
						array( '%d', '%d' )
					);
				}
			}
		}
	}

	/**
	 * Process categories junction table (handles duplicates).
	 *
	 * @param int    $source_id Source event date ID.
	 * @param int    $target_id Target event date ID.
	 * @param string $action    Action: move, delete, or skip.
	 * @return void
	 */
	private function process_categories( $source_id, $target_id, $action ) {
		global $wpdb;

		if ( 'skip' === $action ) {
			return;
		}

		$table_name = $wpdb->prefix . 'fair_event_date_categories';

		if ( 'delete' === $action ) {
			$wpdb->delete( $table_name, array( 'event_date_id' => $source_id ), array( '%d' ) );
			return;
		}

		if ( 'move' === $action ) {
			$existing = $wpdb->get_col(
				$wpdb->prepare(
					'SELECT category_id FROM %i WHERE event_date_id = %d',
					$table_name,
					$target_id
				)
			);

			$source_cats = $wpdb->get_col(
				$wpdb->prepare(
					'SELECT category_id FROM %i WHERE event_date_id = %d',
					$table_name,
					$source_id
				)
			);

			foreach ( $source_cats as $cat_id ) {
				if ( in_array( (int) $cat_id, array_map( 'intval', $existing ), true ) ) {
					$wpdb->delete(
						$table_name,
						array(
							'event_date_id' => $source_id,
							'category_id'   => $cat_id,
						),
						array( '%d', '%d' )
					);
				} else {
					$wpdb->update(
						$table_name,
						array( 'event_date_id' => $target_id ),
						array(
							'event_date_id' => $source_id,
							'category_id'   => $cat_id,
						),
						array( '%d' ),
						array( '%d', '%d' )
					);
				}
			}
		}
	}

	/**
	 * Process a simple 1:N table (UPDATE or DELETE).
	 *
	 * @param string $table_suffix Table name without prefix.
	 * @param int    $source_id    Source event date ID.
	 * @param int    $target_id    Target event date ID.
	 * @param string $action       Action: move, delete, or skip.
	 * @return void
	 */
	private function process_simple_table( $table_suffix, $source_id, $target_id, $action ) {
		global $wpdb;

		if ( 'skip' === $action ) {
			return;
		}

		$table_name = $wpdb->prefix . $table_suffix;

		if ( 'delete' === $action ) {
			$wpdb->delete( $table_name, array( 'event_date_id' => $source_id ), array( '%d' ) );
			return;
		}

		if ( 'move' === $action ) {
			$wpdb->update(
				$table_name,
				array( 'event_date_id' => $target_id ),
				array( 'event_date_id' => $source_id ),
				array( '%d' ),
				array( '%d' )
			);
		}
	}

	/**
	 * Process image exports (postmeta-based).
	 *
	 * @param int    $source_id Source event date ID.
	 * @param int    $target_id Target event date ID.
	 * @param string $action    Action: move, delete, or skip.
	 * @return void
	 */
	private function process_image_exports( $source_id, $target_id, $action ) {
		global $wpdb;

		if ( 'skip' === $action ) {
			return;
		}

		if ( 'delete' === $action ) {
			$attachment_ids = $wpdb->get_col(
				$wpdb->prepare(
					"SELECT post_id FROM {$wpdb->postmeta} WHERE meta_key = '_fair_events_event_date_id' AND meta_value = %s",
					$source_id
				)
			);

			foreach ( $attachment_ids as $attachment_id ) {
				wp_delete_attachment( $attachment_id, true );
			}
			return;
		}

		if ( 'move' === $action ) {
			$wpdb->update(
				$wpdb->postmeta,
				array( 'meta_value' => $target_id ),
				array(
					'meta_key'   => '_fair_events_event_date_id',
					'meta_value' => $source_id,
				),
				array( '%s' ),
				array( '%s', '%s' )
			);
		}
	}

	/**
	 * Process event photos (keyed by event_date_id).
	 *
	 * Moves or deletes rows in fair_events_event_photos. Skips duplicates
	 * since attachment_id has a UNIQUE constraint.
	 *
	 * @param int    $source_id Source event date ID.
	 * @param int    $target_id Target event date ID.
	 * @param string $action    Action: move, delete, or skip.
	 * @return void
	 */
	private function process_event_photos( $source_id, $target_id, $action ) {
		global $wpdb;

		if ( 'skip' === $action ) {
			return;
		}

		$table_name = $wpdb->prefix . 'fair_events_event_photos';

		if ( 'delete' === $action ) {
			$wpdb->delete( $table_name, array( 'event_date_id' => $source_id ), array( '%d' ) );
			return;
		}

		if ( 'move' === $action ) {
			// Get existing attachment_ids on target to avoid UNIQUE constraint violations.
			$existing_attachments = $wpdb->get_col(
				$wpdb->prepare(
					'SELECT attachment_id FROM %i WHERE event_date_id = %d',
					$table_name,
					$target_id
				)
			);

			$source_photos = $wpdb->get_results(
				$wpdb->prepare(
					'SELECT id, attachment_id FROM %i WHERE event_date_id = %d',
					$table_name,
					$source_id
				)
			);

			foreach ( $source_photos as $photo ) {
				if ( in_array( (int) $photo->attachment_id, array_map( 'intval', $existing_attachments ), true ) ) {
					// Duplicate attachment — delete the source row.
					$wpdb->delete( $table_name, array( 'id' => $photo->id ), array( '%d' ) );
				} else {
					$wpdb->update(
						$table_name,
						array( 'event_date_id' => $target_id ),
						array( 'id' => $photo->id ),
						array( '%d' ),
						array( '%d' )
					);
				}
			}
		}
	}

	/**
	 * Process a cross-plugin table, checking existence first.
	 *
	 * @param string $table_suffix Table name without prefix.
	 * @param int    $source_id    Source event date ID.
	 * @param int    $target_id    Target event date ID.
	 * @param string $action       Action: move, delete, or skip.
	 * @return void
	 */
	private function process_cross_plugin_table( $table_suffix, $source_id, $target_id, $action ) {
		global $wpdb;

		if ( 'skip' === $action ) {
			return;
		}

		$table_name = $wpdb->prefix . $table_suffix;

		$exists = $wpdb->get_var(
			$wpdb->prepare( 'SHOW TABLES LIKE %s', $table_name )
		);

		if ( ! $exists ) {
			return;
		}

		$this->process_simple_table( $table_suffix, $source_id, $target_id, $action );
	}
}
