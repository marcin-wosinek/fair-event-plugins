<?php
/**
 * Migration Summary REST API Controller
 *
 * Provides a diagnostic endpoint for verifying event_date_id migration progress.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Returns per-table migration counts.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class MigrationSummaryController extends WP_REST_Controller {

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->namespace = 'fair-events/v1';
		$this->rest_base = 'migration-summary';
	}

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/fix-orphans',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'fix_orphans' ),
					'permission_callback' => function () {
						return current_user_can( 'manage_options' );
					},
					'args'                => array(
						'table' => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'type'  => array(
							'required'          => true,
							'type'              => 'string',
							'enum'              => array( 'event_id', 'event_date_id' ),
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Allowed table configurations.
	 *
	 * @return array
	 */
	private function get_table_configs() {
		return array(
			'fair_events_event_photos'           => array(
				'label'             => __( 'Event Photos', 'fair-events' ),
				'event_id_nullable' => false,
			),
			'fair_audience_event_participants'   => array(
				'label'             => __( 'Event Participants', 'fair-events' ),
				'event_id_nullable' => false,
			),
			'fair_audience_polls'                => array(
				'label'             => __( 'Polls', 'fair-events' ),
				'event_id_nullable' => false,
			),
			'fair_audience_gallery_access_keys'  => array(
				'label'             => __( 'Gallery Access Keys', 'fair-events' ),
				'event_id_nullable' => false,
			),
			'fair_audience_custom_mail_messages' => array(
				'label'             => __( 'Custom Mail Messages', 'fair-events' ),
				'event_id_nullable' => true,
			),
		);
	}

	/**
	 * Get migration summary for all tracked tables.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$tables = $this->get_table_configs();
		$result = array();

		foreach ( $tables as $table_suffix => $config ) {
			$result[ $table_suffix ] = $this->get_table_summary( $table_suffix, $config );
		}

		return rest_ensure_response( array( 'tables' => $result ) );
	}

	/**
	 * Delete orphaned rows from a specific table.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error
	 */
	public function fix_orphans( $request ) {
		global $wpdb;

		$table_suffix = $request->get_param( 'table' );
		$orphan_type  = $request->get_param( 'type' );
		$configs      = $this->get_table_configs();

		if ( ! isset( $configs[ $table_suffix ] ) ) {
			return new WP_Error(
				'invalid_table',
				__( 'Invalid table name.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$table_name = $wpdb->prefix . $table_suffix;

		// Verify the table exists.
		$exists = $wpdb->get_var(
			$wpdb->prepare( 'SHOW TABLES LIKE %s', $table_name )
		);

		if ( ! $exists ) {
			return new WP_Error(
				'table_not_found',
				__( 'Table does not exist.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}

		if ( 'event_id' === $orphan_type ) {
			$deleted = $wpdb->query(
				$wpdb->prepare(
					'DELETE t FROM %i t LEFT JOIN %i p ON t.event_id = p.ID WHERE t.event_id IS NOT NULL AND t.event_id != 0 AND p.ID IS NULL',
					$table_name,
					$wpdb->posts
				)
			);
		} else {
			$event_dates_table = $wpdb->prefix . 'fair_event_dates';
			$deleted           = $wpdb->query(
				$wpdb->prepare(
					'DELETE t FROM %i t LEFT JOIN %i ed ON t.event_date_id = ed.id WHERE t.event_date_id IS NOT NULL AND ed.id IS NULL',
					$table_name,
					$event_dates_table
				)
			);
		}

		return rest_ensure_response(
			array(
				'success' => true,
				'deleted' => (int) $deleted,
			)
		);
	}

	/**
	 * Get migration summary for a single table.
	 *
	 * @param string $table_suffix Table name without prefix.
	 * @param array  $config       Table configuration.
	 * @return array|null Counts array, or null if table does not exist.
	 */
	private function get_table_summary( $table_suffix, $config ) {
		global $wpdb;

		$table_name = $wpdb->prefix . $table_suffix;

		// Check if the table exists.
		$exists = $wpdb->get_var(
			$wpdb->prepare( 'SHOW TABLES LIKE %s', $table_name )
		);

		if ( ! $exists ) {
			return null;
		}

		$event_dates_table = $wpdb->prefix . 'fair_event_dates';

		// Total rows.
		$total = (int) $wpdb->get_var(
			$wpdb->prepare( 'SELECT COUNT(*) FROM %i', $table_name )
		);

		// Migrated: event_date_id IS NOT NULL.
		$migrated = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i WHERE event_date_id IS NOT NULL',
				$table_name
			)
		);

		// Pending: event_date_id IS NULL (with event_id present).
		if ( $config['event_id_nullable'] ) {
			$pending = (int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM %i WHERE event_date_id IS NULL AND event_id IS NOT NULL',
					$table_name
				)
			);
		} else {
			$pending = (int) $wpdb->get_var(
				$wpdb->prepare(
					'SELECT COUNT(*) FROM %i WHERE event_date_id IS NULL',
					$table_name
				)
			);
		}

		// Orphaned event_id: points to non-existent post.
		$orphaned_event_id = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i t LEFT JOIN %i p ON t.event_id = p.ID WHERE t.event_id IS NOT NULL AND t.event_id != 0 AND p.ID IS NULL',
				$table_name,
				$wpdb->posts
			)
		);

		// Orphaned event_date_id: points to non-existent event_date.
		$orphaned_event_date_id = (int) $wpdb->get_var(
			$wpdb->prepare(
				'SELECT COUNT(*) FROM %i t LEFT JOIN %i ed ON t.event_date_id = ed.id WHERE t.event_date_id IS NOT NULL AND ed.id IS NULL',
				$table_name,
				$event_dates_table
			)
		);

		return array(
			'label'                  => $config['label'],
			'total'                  => $total,
			'migrated'               => $migrated,
			'pending'                => $pending,
			'orphaned_event_id'      => $orphaned_event_id,
			'orphaned_event_date_id' => $orphaned_event_date_id,
		);
	}
}
