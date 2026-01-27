<?php
/**
 * Collaborators REST API Controller
 *
 * @package FairAudience
 */

namespace FairAudience\API;

use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * REST API controller for collaborators.
 *
 * Returns participants who have collaborated on at least one event
 * (label='collaborator' in event_participants table).
 */
class CollaboratorsController extends WP_REST_Controller {

	/**
	 * REST API namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-audience/v1';

	/**
	 * REST API base route.
	 *
	 * @var string
	 */
	protected $rest_base = 'collaborators';

	/**
	 * Register REST API routes.
	 */
	public function register_routes() {
		// GET /fair-audience/v1/collaborators.
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_items' ),
				'permission_callback' => 'is_user_logged_in',
				'args'                => array(
					'search'   => array(
						'type'    => 'string',
						'default' => '',
					),
					'orderby'  => array(
						'type'    => 'string',
						'default' => 'surname',
						'enum'    => array( 'surname', 'email', 'photo_count', 'event_count' ),
					),
					'order'    => array(
						'type'    => 'string',
						'default' => 'ASC',
						'enum'    => array( 'ASC', 'DESC', 'asc', 'desc' ),
					),
					'per_page' => array(
						'type'    => 'integer',
						'default' => 25,
						'minimum' => 1,
						'maximum' => 100,
					),
					'page'     => array(
						'type'    => 'integer',
						'default' => 1,
						'minimum' => 1,
					),
				),
			)
		);
	}

	/**
	 * Get collaborators with photo and event counts.
	 *
	 * @param WP_REST_Request $request Request object.
	 * @return WP_REST_Response|WP_Error Response object or error.
	 */
	public function get_items( $request ) {
		global $wpdb;

		$search   = $request->get_param( 'search' );
		$orderby  = $request->get_param( 'orderby' );
		$order    = strtoupper( $request->get_param( 'order' ) );
		$per_page = (int) $request->get_param( 'per_page' );
		$page     = (int) $request->get_param( 'page' );

		$participants_table       = $wpdb->prefix . 'fair_audience_participants';
		$event_participants_table = $wpdb->prefix . 'fair_audience_event_participants';
		$photo_participants_table = $wpdb->prefix . 'fair_audience_photo_participants';

		// Base query to get collaborators with counts.
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$base_query = "
			SELECT p.*,
				COUNT(DISTINCT ep.event_id) as event_count,
				COALESCE(pc.photo_count, 0) as photo_count
			FROM %i p
			INNER JOIN %i ep
				ON p.id = ep.participant_id AND ep.label = 'collaborator'
			LEFT JOIN (
				SELECT pp.participant_id, COUNT(DISTINCT pp.attachment_id) as photo_count
				FROM %i pp
				WHERE pp.role = 'author'
				GROUP BY pp.participant_id
			) pc ON p.id = pc.participant_id
		";

		// Build WHERE clause for search.
		$where_clause = '';
		$where_params = array();
		if ( ! empty( $search ) ) {
			$like_search  = '%' . $wpdb->esc_like( $search ) . '%';
			$where_clause = 'WHERE (p.name LIKE %s OR p.surname LIKE %s OR p.email LIKE %s)';
			$where_params = array( $like_search, $like_search, $like_search );
		}

		// Build ORDER BY clause.
		$order_clause = 'ORDER BY ';
		switch ( $orderby ) {
			case 'email':
				$order_clause .= "p.email {$order}";
				break;
			case 'photo_count':
				$order_clause .= "photo_count {$order}";
				break;
			case 'event_count':
				$order_clause .= "event_count {$order}";
				break;
			case 'surname':
			default:
				$order_clause .= "p.surname {$order}, p.name {$order}";
				break;
		}

		// Get total count for pagination.
		$count_query = "
			SELECT COUNT(DISTINCT p.id)
			FROM %i p
			INNER JOIN %i ep
				ON p.id = ep.participant_id AND ep.label = 'collaborator'
			{$where_clause}
		";

		$count_params = array_merge(
			array( $participants_table, $event_participants_table ),
			$where_params
		);

		$total = (int) $wpdb->get_var(
			$wpdb->prepare( $count_query, $count_params )
		);

		// Calculate pagination.
		$total_pages = (int) ceil( $total / $per_page );
		$offset      = ( $page - 1 ) * $per_page;

		// Get collaborators.
		$full_query = "{$base_query} {$where_clause} GROUP BY p.id {$order_clause} LIMIT %d OFFSET %d";

		$query_params = array_merge(
			array( $participants_table, $event_participants_table, $photo_participants_table ),
			$where_params,
			array( $per_page, $offset )
		);

		$results = $wpdb->get_results(
			$wpdb->prepare( $full_query, $query_params ),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching

		$items = array_map(
			function ( $row ) {
				return array(
					'id'                => (int) $row['id'],
					'name'              => $row['name'],
					'surname'           => $row['surname'],
					'email'             => $row['email'],
					'photo_count'       => (int) $row['photo_count'],
					'event_count'       => (int) $row['event_count'],
					'media_library_url' => admin_url( 'upload.php?mode=list&fair_photo_author_filter=' . (int) $row['id'] ),
				);
			},
			$results
		);

		$response = rest_ensure_response( $items );
		$response->header( 'X-WP-Total', $total );
		$response->header( 'X-WP-TotalPages', $total_pages );

		return $response;
	}
}
