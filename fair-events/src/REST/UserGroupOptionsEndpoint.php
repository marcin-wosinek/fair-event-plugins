<?php
/**
 * REST API endpoint for dynamic user group options
 *
 * @package FairEvents
 */

namespace FairEvents\REST;

defined( 'WPINC' ) || die;

/**
 * Handles REST API endpoint for retrieving dynamic user group options
 */
class UserGroupOptionsEndpoint {

	/**
	 * Constructor - registers REST routes
	 */
	public function __construct() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	/**
	 * Register REST API routes
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			'fair-events/v1',
			'/user-group-options',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'get_user_group_options' ),
				'permission_callback' => function () {
					// Allow any logged-in user with edit_posts capability to access this.
					return current_user_can( 'edit_posts' );
				},
			)
		);
	}

	/**
	 * Get dynamic user group options from all registered plugins
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return \WP_REST_Response Response with user group options.
	 */
	public function get_user_group_options( $request ) {
		// Check if the global function exists (defensive pattern).
		if ( ! function_exists( 'fair_events_user_group_options' ) ) {
			return rest_ensure_response(
				array(
					'success' => false,
					'options' => array(),
					'message' => 'User group options function not available.',
				)
			);
		}

		/**
		 * Get user group options via the global function which applies filters.
		 *
		 * Plugins should add their group options as arrays with:
		 * - 'value' (string): Group identifier (e.g., 'fair-membership:premium-members')
		 * - 'label' (string): Translated display label
		 * - 'description' (string, optional): Optional description for UI tooltips
		 */
		$options = fair_events_user_group_options();

		return rest_ensure_response(
			array(
				'success' => true,
				'options' => $options,
			)
		);
	}
}
