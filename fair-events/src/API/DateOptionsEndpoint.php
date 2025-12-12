<?php
/**
 * REST API endpoint for dynamic date options
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Handles REST API endpoint for retrieving dynamic date options
 */
class DateOptionsEndpoint extends WP_REST_Controller {

	/**
	 * Namespace for the REST API
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Resource name
	 *
	 * @var string
	 */
	protected $rest_base = 'date-options';

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
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_date_options' ),
					'permission_callback' => function () {
						// Allow any logged-in user with edit_posts capability to access this
						return current_user_can( 'edit_posts' );
					},
				),
			)
		);
	}

	/**
	 * Get dynamic date options from all registered plugins
	 *
	 * @param \WP_REST_Request $request Request object.
	 * @return \WP_REST_Response Response with date options.
	 */
	public function get_date_options( $request ) {
		/**
		 * Filter to collect dynamic date options for UI dropdowns.
		 *
		 * Plugins should add their date options as arrays with 'value' and 'label' keys:
		 * - 'value': The special format string (e.g., 'fair-event:start')
		 * - 'label': Translated display label (e.g., __('Event Start', 'textdomain'))
		 *
		 * @param array $options Array of date options. Each option is an array with:
		 *                       - 'value' (string): Format string to use
		 *                       - 'label' (string): Display label for UI
		 * @return array Updated array of date options.
		 */
		$options = apply_filters( 'fair_events_date_options', array() );

		return rest_ensure_response(
			array(
				'success' => true,
				'options' => $options,
			)
		);
	}
}
