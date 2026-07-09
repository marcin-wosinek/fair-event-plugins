<?php
/**
 * Weekly Events Controller
 *
 * Returns events for a given event source grouped by day for a specific ISO week.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

defined( 'WPINC' ) || die;

use FairEvents\Services\WeeklyEventsProvider;

/**
 * REST controller for weekly events aggregation.
 */
class WeeklyEventsController extends \WP_REST_Controller {

	/**
	 * Constructor.
	 */
	public function __construct() {
		$this->namespace = 'fair-events/v1';
		$this->rest_base = 'weekly-events';
	}

	/**
	 * Register routes.
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => \WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'get_items_permissions_check' ),
					'args'                => array(
						'source' => array(
							'required'          => true,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
						'week'   => array(
							'required'          => false,
							'type'              => 'string',
							'sanitize_callback' => 'sanitize_text_field',
						),
					),
				),
			)
		);
	}

	/**
	 * Permission check.
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return bool
	 */
	public function get_items_permissions_check( $request ) {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Get weekly events.
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function get_items( $request ) {
		$slug       = $request->get_param( 'source' );
		$week_param = $request->get_param( 'week' );

		$provider = new WeeklyEventsProvider();
		$parsed   = $provider->parse_iso_week( $week_param );

		$year = $parsed['year'] ?? null;
		$week = $parsed['week'] ?? null;

		$result = $provider->get_week( $slug, $year, $week );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( $result );
	}
}
